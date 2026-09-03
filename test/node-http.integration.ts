import assert from 'node:assert/strict'
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http'
import type { AddressInfo } from 'node:net'
import test from 'node:test'

import {
  AbortRequestError,
  TimeoutError,
  createClient,
} from '../src/index.js'

test('public client works through native Node fetch and local HTTP', {
  timeout: 10_000,
}, async (t) => {
  const retryBodies: string[] = []
  let retryAttempts = 0
  let signalAbortRequest: (() => void) | undefined
  const abortRequestReceived = new Promise<void>((resolve) => {
    signalAbortRequest = resolve
  })
  const server = createServer(async (request, response) => {
    try {
      await handleRequest(request, response, retryBodies, () => {
        retryAttempts += 1
        return retryAttempts
      }, () => signalAbortRequest?.())
    } catch (error) {
      response.destroy(error instanceof Error ? error : new Error(String(error)))
    }
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close((error) => error === undefined ? resolve() : reject(error))
    server.closeAllConnections()
  }))

  const address = server.address() as AddressInfo
  const client = createClient({
    baseURL: `http://127.0.0.1:${address.port}`,
  })

  const echo = await client.post<{
    body: string
    contentType: string
    method: string
    search: string
  }>('/echo', {
    json: { name: 'Ada' },
    query: { active: true, tag: ['admin', 'editor'] },
  })

  assert.deepEqual(echo, {
    body: '{"name":"Ada"}',
    contentType: 'application/json',
    method: 'POST',
    search: '?active=true&tag=admin&tag=editor',
  })

  const retried = await client.post<{ attempts: number }>('/retry', {
    json: { stable: true },
    retry: {
      attempts: 2,
      backoffMs: 0,
      maxBackoffMs: 0,
      retryOnMethods: ['POST'],
      retryOnStatuses: [503],
    },
  })

  assert.deepEqual(retried, { attempts: 2 })
  assert.deepEqual(retryBodies, ['{"stable":true}', '{"stable":true}'])

  await assert.rejects(
    () => client.get('/timeout', { timeout: 20 }),
    (error) => error instanceof TimeoutError && error.timeout === 20,
  )

  const controller = new AbortController()
  const reason = new Error('caller stopped request')
  const abortedRequest = client.get('/abort', { signal: controller.signal })
  await abortRequestReceived
  controller.abort(reason)
  await assert.rejects(
    () => abortedRequest,
    (error) => error instanceof AbortRequestError && error.cause === reason,
  )
})

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  retryBodies: string[],
  nextRetryAttempt: () => number,
  onAbortRequest: () => void,
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1')
  const body = await readRequestBody(request)

  if (url.pathname === '/echo') {
    sendJson(response, {
      body,
      contentType: request.headers['content-type'] ?? '',
      method: request.method ?? '',
      search: url.search,
    })
    return
  }

  if (url.pathname === '/retry') {
    const attempt = nextRetryAttempt()
    retryBodies.push(body)
    if (attempt === 1) {
      response.writeHead(503, { 'Content-Type': 'text/plain' })
      response.end('retry')
      return
    }

    sendJson(response, { attempts: attempt })
    return
  }

  if (url.pathname === '/timeout' || url.pathname === '/abort') {
    if (url.pathname === '/abort') {
      onAbortRequest()
    }
    request.once('close', () => response.destroy())
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.write('{"pending":')
    return
  }

  response.writeHead(404)
  response.end()
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString('utf8')
}

function sendJson(response: ServerResponse, value: unknown): void {
  response.writeHead(200, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify(value))
}
