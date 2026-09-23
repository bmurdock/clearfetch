import assert from 'node:assert/strict'
import { getEventListeners, once } from 'node:events'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { request } from '../../src/index.js'
import { createTimeoutController } from '../../src/internal/timeout-controller.js'

// Run in an isolated process with --expose-gc. Yield between collections so
// WeakRef's current-job retention and finalization callbacks can finish.
async function collectGarbage(): Promise<void> {
  assert.notEqual(global.gc, undefined)
  for (let count = 0; count < 20; count += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10))
    global.gc!()
  }
}

const source = new AbortController()

function abandonBody(): WeakRef<ReadableStream<Uint8Array>> {
  const timeout = createTimeoutController(source.signal)
  const body = new ReadableStream<Uint8Array>()
  timeout.retainExternalAbort(body, new Request('https://example.com', {
    signal: timeout.signal,
  }))
  timeout.cleanup()
  return new WeakRef(body)
}

const abandoned = abandonBody()
assert.equal(getEventListeners(source.signal, 'abort').length, 1)
await collectGarbage()
assert.equal(abandoned.deref(), undefined, 'caller signal retained the abandoned body')
assert.equal(getEventListeners(source.signal, 'abort').length, 0)

const server = createServer((incoming, response) => {
  response.writeHead(200, { 'Content-Type': 'text/plain' })
  if (incoming.url === '/complete') {
    response.end('complete body')
  } else {
    response.write('first chunk')
  }
})
server.listen(0, '127.0.0.1')
await once(server, 'listening')

const originalFetch = globalThis.fetch
let originalResponse: WeakRef<Response> | undefined
globalThis.fetch = async (input, init) => {
  const response = await originalFetch(input, init)
  originalResponse = new WeakRef(response)
  return response
}

async function getReaderOnly(): Promise<ReadableStreamDefaultReader<Uint8Array>> {
  const address = server.address() as AddressInfo
  const response = await request(`http://127.0.0.1:${address.port}`, {
    responseType: 'raw',
    signal: source.signal,
  })
  assert.equal(response, originalResponse?.deref(), 'raw response identity changed')
  return response.body!.getReader()
}

async function consumeBody(): Promise<WeakRef<ReadableStream<Uint8Array>>> {
  const address = server.address() as AddressInfo
  const response = await request(`http://127.0.0.1:${address.port}/complete`, {
    responseType: 'raw',
    signal: source.signal,
  })
  const body = new WeakRef(response.body!)
  assert.equal(await response.text(), 'complete body')
  return body
}

let deadline: ReturnType<typeof setTimeout> | undefined
try {
  const completed = await consumeBody()
  await collectGarbage()
  assert.equal(completed.deref(), undefined, 'completed native body was retained')
  assert.equal(getEventListeners(source.signal, 'abort').length, 0)

  const reader = await getReaderOnly()
  assert.equal((await reader.read()).done, false)
  await collectGarbage()
  const read = reader.read()
  source.abort()
  await assert.rejects(
    Promise.race([
      read,
      new Promise<never>((_resolve, reject) => {
        deadline = setTimeout(() => reject(new Error('body ignored abort after GC')), 1_000)
      }),
    ]),
    (error) => error instanceof Error && error.name === 'AbortError',
  )
  assert.equal(getEventListeners(source.signal, 'abort').length, 0)
} finally {
  clearTimeout(deadline)
  globalThis.fetch = originalFetch
  server.closeAllConnections()
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error === undefined ? resolve() : reject(error))
  })
}
