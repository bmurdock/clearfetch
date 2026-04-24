import assert from 'node:assert/strict'
import test from 'node:test'

import { ConfigError, HttpError, NetworkError } from '../src/errors.js'
import type { RetryOptions } from '../src/types.js'
import {
  DEFAULT_RETRY,
  getRetryDelay,
  normalizeRetry,
  shouldRetryError,
  shouldRetryStatus,
} from '../src/internal/retry-policy.js'

test('normalizeRetry disables retries by default and when request retry is false', () => {
  assert.equal(normalizeRetry(undefined, undefined), false)
  assert.equal(normalizeRetry({ attempts: 2 }, false), false)
})

test('normalizeRetry applies DEFAULT_RETRY values', () => {
  assert.deepEqual(normalizeRetry(undefined, {}), DEFAULT_RETRY)
  assert.deepEqual(normalizeRetry({ attempts: 2 }, undefined), {
    ...DEFAULT_RETRY,
    attempts: 2,
  })
})

test('normalizeRetry rejects invalid attempts with existing message', () => {
  assert.throws(
    () => normalizeRetry(undefined, { attempts: 0 }),
    (error) =>
      error instanceof ConfigError &&
      error.message === '`retry.attempts` must be a positive integer',
  )
})

test('normalizeRetry rejects invalid methods with existing message', () => {
  assert.throws(
    () => normalizeRetry(undefined, { retryOnMethods: ['post'] as never }),
    (error) =>
      error instanceof ConfigError &&
      error.message ===
        '`retry.retryOnMethods` must contain supported uppercase methods',
  )
})

test('normalizeRetry rejects invalid statuses with existing message', () => {
  assert.throws(
    () => normalizeRetry(undefined, { retryOnStatuses: [99] }),
    (error) =>
      error instanceof ConfigError &&
      error.message ===
        '`retry.retryOnStatuses` must contain valid HTTP status codes',
  )
})

test('shouldRetryError respects attempts, methods, statuses, and network failures', () => {
  const retry = normalizeRetry(undefined, {
    attempts: 3,
    retryOnStatuses: [503],
    retryOnMethods: ['GET'],
  })
  assert.notEqual(retry, false)

  const response = new Response('unavailable', {
    status: 503,
    statusText: 'Service Unavailable',
  })
  const httpError = new HttpError({
    status: response.status,
    statusText: response.statusText,
    response,
  })

  assert.equal(shouldRetryError(httpError, 'GET', retry, 1), true)
  assert.equal(shouldRetryError(httpError, 'POST', retry, 1), false)
  assert.equal(shouldRetryError(httpError, 'GET', retry, 3), false)
  assert.equal(
    shouldRetryError(
      new HttpError({
        status: 500,
        statusText: 'Internal Server Error',
        response: new Response('error', {
          status: 500,
          statusText: 'Internal Server Error',
        }),
      }),
      'GET',
      retry,
      1,
    ),
    false,
  )
  assert.equal(shouldRetryError(new NetworkError(), 'GET', retry, 1), true)
  assert.equal(shouldRetryError(new NetworkError(), 'POST', retry, 1), false)
  assert.equal(shouldRetryError(new NetworkError(), 'GET', false, 1), false)
})

test('shouldRetryStatus classifies retryable HTTP responses without reading bodies', () => {
  const originalText = Response.prototype.text
  let textCalls = 0
  Response.prototype.text = function textWithCount(this: Response): Promise<string> {
    textCalls += 1
    return originalText.call(this)
  }

  try {
    const retry = normalizeRetry(undefined, {
      attempts: 2,
      retryOnStatuses: [503],
      retryOnMethods: ['GET'],
    })
    assert.notEqual(retry, false)

    assert.equal(
      shouldRetryStatus(
        new Response('retry body should not be read', {
          status: 503,
          statusText: 'Service Unavailable',
        }),
        'GET',
        retry,
        1,
      ),
      true,
    )
    assert.equal(
      shouldRetryStatus(
        new Response('not configured', {
          status: 500,
          statusText: 'Internal Server Error',
        }),
        'GET',
        retry,
        1,
      ),
      false,
    )
    assert.equal(
      shouldRetryStatus(
        new Response('method not configured', {
          status: 503,
          statusText: 'Service Unavailable',
        }),
        'POST',
        retry,
        1,
      ),
      false,
    )
    assert.equal(
      shouldRetryStatus(
        new Response('last attempt', {
          status: 503,
          statusText: 'Service Unavailable',
        }),
        'GET',
        retry,
        2,
      ),
      false,
    )
    assert.equal(textCalls, 0)
  } finally {
    Response.prototype.text = originalText
  }
})

test('getRetryDelay applies bounded exponential backoff', () => {
  const retry = {
    backoffMs: 100,
    maxBackoffMs: 250,
    multiplier: 2,
  } satisfies Pick<Required<RetryOptions>, 'backoffMs' | 'maxBackoffMs' | 'multiplier'>

  assert.equal(getRetryDelay(false, 1), 0)
  assert.equal(getRetryDelay(retry, 1), 100)
  assert.equal(getRetryDelay(retry, 2), 200)
  assert.equal(getRetryDelay(retry, 3), 250)
})
