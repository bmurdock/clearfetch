import assert from 'node:assert/strict'

import { AbortRequestError, TimeoutError, request } from '../../src/index.js'

assert.notEqual(global.gc, undefined)

async function collectGarbage(): Promise<void> {
  for (let count = 0; count < 10; count += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5))
    global.gc!()
  }
}

const originalFetch = globalThis.fetch
let requestStarted: () => void = () => {}
globalThis.fetch = async (input) => new Promise((_resolve, reject) => {
  const signal = (input as Request).signal
  if (signal.aborted) {
    reject(signal.reason)
    return
  }
  signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  requestStarted()
})

try {
  for (const mode of ['timeout', 'external'] as const) {
    const controller = new AbortController()
    const reason = new Error('caller stopped the request')
    const started = new Promise<void>((resolve) => { requestStarted = resolve })
    const observed: unknown[] = []
    const result = request('https://example.com', {
      ...(mode === 'timeout' ? { timeout: 250 } : { signal: controller.signal }),
      hooks: { onError: [({ error }) => { observed.push(error) }] },
    }).then(() => undefined, (error: unknown) => error)
    await started
    await collectGarbage()
    if (mode === 'external') controller.abort(reason)

    let deadline: ReturnType<typeof setTimeout> | undefined
    try {
      const error = await Promise.race([
        result,
        new Promise<never>((_resolve, reject) => {
          deadline = setTimeout(() => reject(new Error(`${mode} ignored abort after GC`)), 1_000)
        }),
      ])
      if (mode === 'timeout') {
        assert.ok(error instanceof TimeoutError)
      } else {
        assert.ok(error instanceof AbortRequestError)
        assert.equal(error.cause, reason)
      }
      assert.deepEqual(observed, [error])
    } finally {
      clearTimeout(deadline)
    }
  }

  let completedRequest: WeakRef<Request> | undefined
  globalThis.fetch = async (input) => {
    completedRequest = new WeakRef(input as Request)
    return new Response('ok')
  }
  const controller = new AbortController()
  assert.equal(await request('https://example.com', {
    responseType: 'text', signal: controller.signal,
  }), 'ok')
  await collectGarbage()
  assert.ok(completedRequest !== undefined)
  assert.equal(completedRequest.deref(), undefined, 'completed request was retained')
  controller.abort()
} finally {
  globalThis.fetch = originalFetch
}
