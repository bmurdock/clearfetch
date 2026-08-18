import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright'

import type { BeforeRequestContext } from '../src/types.js'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const distDir = path.join(rootDir, 'dist')

test('real browser handles native values created in another realm', {
  timeout: 30_000,
}, async (t) => {
  const attempts = new Map<string, number>()
  const requestBodies = new Map<string, Buffer[]>()
  const requestContentTypes = new Map<string, string[]>()
  const server = createServer(async (request, response) => {
    try {
      await handleRequest(
        request,
        response,
        attempts,
        requestBodies,
        requestContentTypes,
      )
    } catch (error) {
      console.error(error)
      response.writeHead(500, { 'Content-Type': 'text/plain' })
      response.end('Internal test server error')
    }
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close((error) => error === undefined ? resolve() : reject(error))
  }))

  const address = server.address()
  assert(address !== null && typeof address === 'object')
  const origin = `http://127.0.0.1:${address.port}`

  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage()
  await page.goto(origin)

  let result: {
    arrayBufferResult: { attempts: number; bodies: number[][] }
    crossRealmBaseURLResult: { pathname: string }
    crossRealmSignalResult: { search: string }
    crossRealmURLResult: { search: string }
    formDataResult: { attempts: number; bodies: string[]; contentTypes: string[] }
    queryResult: { search: string }
    streamResult: { body: string }
  }
  try {
    result = await page.evaluate(async ({ origin }) => {
      const { createClient } = await import(`${origin}/dist/index.js`)
      const {
        buildRequestFromContext,
        createBeforeRequestContext,
      } = await import(`${origin}/dist/internal/normalize-request.js`)
      const iframe = document.createElement('iframe')
      iframe.srcdoc = '<!doctype html><title>foreign realm</title>'
      const iframeLoaded = new Promise<void>((resolve) => {
        iframe.addEventListener('load', () => resolve(), { once: true })
      })
      document.body.append(iframe)
      await iframeLoaded

      const foreignWindow = iframe.contentWindow
      if (foreignWindow === null) {
        throw new Error('iframe realm is unavailable')
      }
      const foreign = foreignWindow as Window & typeof globalThis

      const client = createClient({ baseURL: origin })
      const retry = {
        attempts: 2,
        backoffMs: 0,
        maxBackoffMs: 0,
        retryOnMethods: ['POST'] as const,
        retryOnStatuses: [503],
      }

      const query = new foreign.URLSearchParams('tag=admin&page=1&tag=editor')
      const queryResult = await client.get('/query', { query })

      const crossRealmURLClient = createClient({
        hooks: {
          beforeRequest: [
            (context: BeforeRequestContext) => {
              context.url = new foreign.URL(`${origin}/query?source=foreign`)
            },
          ],
        },
      })
      const crossRealmURLResult = await crossRealmURLClient.get(
        `${origin}/query?source=original`,
      )

      const foreignBaseURL = new foreign.URL(`${origin}/base-original/`)
      const crossRealmBaseURLClient = createClient({
        baseURL: foreignBaseURL,
      })
      foreignBaseURL.pathname = '/base-mutated/'
      const crossRealmBaseURLResult = await crossRealmBaseURLClient.get('query')

      const foreignAbortController = new foreign.AbortController()
      const crossRealmSignalResult = await client.get('/query', {
        query: { source: 'foreign-signal' },
        signal: foreignAbortController.signal,
      })

      const bytes = new foreign.ArrayBuffer(4)
      new foreign.Uint8Array(bytes).set([1, 2, 3, 4])
      const arrayBufferResult = await client.post('/array-buffer', {
        body: bytes,
        retry,
      })

      const form = new foreign.FormData()
      form.append('field', 'value')
      form.append(
        'file',
        new foreign.File(['file-contents'], 'avatar.txt', { type: 'text/plain' }),
      )
      const formDataResult = await client.post('/form-data', {
        body: form,
        retry,
      })

      const stream = new foreign.ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new foreign.TextEncoder().encode('stream-body'))
          controller.close()
        },
      })
      const streamContext = createBeforeRequestContext(`${origin}/stream`, {}, {
        method: 'POST',
        body: stream,
      })
      const streamRequest = buildRequestFromContext(streamContext)
      const streamResult = {
        body: await new Response(streamRequest.body).text(),
      }

      iframe.remove()
      return {
        arrayBufferResult,
        crossRealmBaseURLResult,
        crossRealmSignalResult,
        crossRealmURLResult,
        formDataResult,
        queryResult,
        streamResult,
      }
    }, { origin }) as typeof result
  } catch (cause) {
    throw new Error(
      `browser request failed after attempts ${JSON.stringify(Object.fromEntries(attempts))} and bodies ${JSON.stringify([...requestBodies.keys()])}`,
      { cause },
    )
  }

  assert.deepEqual(result.queryResult, {
    search: '?tag=admin&page=1&tag=editor',
  })
  assert.deepEqual(result.crossRealmURLResult, {
    search: '?source=foreign',
  })
  assert.deepEqual(result.crossRealmBaseURLResult, {
    pathname: '/base-original/query',
  })
  assert.deepEqual(result.crossRealmSignalResult, {
    search: '?source=foreign-signal',
  })
  assert.deepEqual(result.arrayBufferResult, {
    attempts: 2,
    bodies: [[1, 2, 3, 4], [1, 2, 3, 4]],
  })
  assert.equal(result.formDataResult.attempts, 2)
  assert.equal(result.formDataResult.bodies.length, 2)
  assert.equal(result.formDataResult.contentTypes.length, 2)
  for (const [index, body] of result.formDataResult.bodies.entries()) {
    assert.match(result.formDataResult.contentTypes[index] ?? '', /^multipart\/form-data; boundary=/)
    assert.match(body, /name="field"\r\n\r\nvalue/)
    assert.match(body, /name="file"; filename="avatar.txt"/)
    assert.match(body, /Content-Type: text\/plain/)
    assert.match(body, /file-contents/)
  }
  assert.deepEqual(result.streamResult, { body: 'stream-body' })
})

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  attempts: Map<string, number>,
  requestBodies: Map<string, Buffer[]>,
  requestContentTypes: Map<string, string[]>,
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1')

  if (url.pathname.startsWith('/dist/')) {
    const filePath = path.resolve(rootDir, `.${url.pathname}`)
    if (!filePath.startsWith(`${distDir}${path.sep}`)) {
      response.writeHead(403)
      response.end()
      return
    }
    response.writeHead(200, { 'Content-Type': 'text/javascript' })
    response.end(await readFile(filePath))
    return
  }

  if (url.pathname === '/') {
    response.writeHead(200, { 'Content-Type': 'text/html' })
    response.end('<!doctype html><title>clearfetch browser test</title>')
    return
  }

  if (url.pathname === '/query') {
    sendJson(response, { search: url.search })
    return
  }

  if (
    url.pathname === '/base-original/query' ||
    url.pathname === '/base-mutated/query'
  ) {
    sendJson(response, { pathname: url.pathname })
    return
  }

  const body = await readRequestBody(request)
  const bodies = requestBodies.get(url.pathname) ?? []
  bodies.push(body)
  requestBodies.set(url.pathname, bodies)
  const contentTypes = requestContentTypes.get(url.pathname) ?? []
  contentTypes.push(request.headers['content-type'] ?? '')
  requestContentTypes.set(url.pathname, contentTypes)

  if (url.pathname === '/stream') {
    sendJson(response, { body: body.toString('utf8') })
    return
  }

  const attempt = (attempts.get(url.pathname) ?? 0) + 1
  attempts.set(url.pathname, attempt)
  if (attempt === 1) {
    response.writeHead(503, { 'Content-Type': 'text/plain' })
    response.end('retry')
    return
  }

  if (url.pathname === '/array-buffer') {
    sendJson(response, {
      attempts: attempt,
      bodies: bodies.map((value) => [...value]),
    })
    return
  }

  if (url.pathname === '/form-data') {
    sendJson(response, {
      attempts: attempt,
      bodies: bodies.map((value) => value.toString('utf8')),
      contentTypes,
    })
    return
  }

  response.writeHead(404)
  response.end()
}

function sendJson(response: ServerResponse, value: unknown): void {
  response.writeHead(200, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify(value))
}

async function readRequestBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}
