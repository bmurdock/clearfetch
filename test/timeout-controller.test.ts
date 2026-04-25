import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createTimeoutController,
  sleep,
} from '../src/internal/timeout-controller.js'

test('createTimeoutController returns no signal when no abort inputs exist', () => {
  const timeout = createTimeoutController()

  assert.equal(timeout.signal, undefined)
  assert.equal(timeout.didTimeout(), false)
  assert.doesNotThrow(() => timeout.cleanup())
})

test('createTimeoutController propagates external aborts without timeout state', () => {
  const controller = new AbortController()
  const timeout = createTimeoutController(controller.signal)
  const reason = new Error('stop')

  controller.abort(reason)

  assert.equal(timeout.signal?.aborted, true)
  assert.equal(timeout.signal?.reason, reason)
  assert.equal(timeout.didTimeout(), false)

  timeout.cleanup()
})

test('createTimeoutController marks timeout aborts', async () => {
  const timeout = createTimeoutController(undefined, 1)

  await sleep(20)

  assert.equal(timeout.signal?.aborted, true)
  assert.equal(timeout.didTimeout(), true)

  timeout.cleanup()
})

test('sleep resolves after duration', async () => {
  const startedAt = Date.now()

  await sleep(10)

  assert.ok(Date.now() - startedAt >= 8)
})

test('sleep rejects promptly when signal aborts', async () => {
  const controller = new AbortController()
  const startedAt = Date.now()
  const promise = sleep(1_000, controller.signal)

  setTimeout(() => {
    controller.abort()
  }, 5)

  await assert.rejects(
    () => promise,
    (error) => error instanceof DOMException && error.name === 'AbortError',
  )
  assert.ok(Date.now() - startedAt < 200)
})
