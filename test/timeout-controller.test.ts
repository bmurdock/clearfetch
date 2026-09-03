import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createTimeoutController,
  sleep,
} from '../src/internal/timeout-controller.js'

test('createTimeoutController creates an attempt signal without user abort inputs', () => {
  const timeout = createTimeoutController()

  assert.equal(timeout.signal.aborted, false)
  assert.equal(timeout.didTimeout(), false)
  assert.doesNotThrow(() => timeout.cleanup())
})

test('createTimeoutController may abort an abandoned attempt', () => {
  const timeout = createTimeoutController()
  const reason = new DOMException('Response body abandoned', 'AbortError')

  timeout.abort(reason)

  assert.equal(timeout.signal.aborted, true)
  assert.equal(timeout.signal.reason, reason)
  assert.equal(timeout.didTimeout(), false)

  timeout.cleanup()
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

test('createTimeoutController preserves an already-aborted external signal', () => {
  const controller = new AbortController()
  const reason = new Error('already stopped')
  controller.abort(reason)

  const timeout = createTimeoutController(controller.signal)

  assert.equal(timeout.signal.aborted, true)
  assert.equal(timeout.signal.reason, reason)
  assert.equal(timeout.didTimeout(), false)
  timeout.cleanup()
})

test('createTimeoutController cleanup removes the external abort listener', () => {
  const controller = new AbortController()
  const timeout = createTimeoutController(controller.signal)

  timeout.cleanup()
  controller.abort(new Error('too late'))

  assert.equal(timeout.signal.aborted, false)
  assert.equal(timeout.didTimeout(), false)
})

test('createTimeoutController cleanup clears the pending timeout', async () => {
  const timeout = createTimeoutController(undefined, 5)

  timeout.cleanup()
  await sleep(20)

  assert.equal(timeout.signal.aborted, false)
  assert.equal(timeout.didTimeout(), false)
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
  const promise = sleep(1_000, controller.signal)

  controller.abort()

  await assert.rejects(
    () => promise,
    (error) => error instanceof DOMException && error.name === 'AbortError',
  )
})
