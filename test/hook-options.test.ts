import assert from 'node:assert/strict'
import test from 'node:test'

import { createHookRequestOptions } from '../src/internal/hook-options.js'
import type { NormalizedRequestOptions } from '../src/types.js'

function createOptions(
  overrides: Partial<NormalizedRequestOptions> = {},
): NormalizedRequestOptions {
  return {
    method: 'GET',
    headers: new Headers(),
    responseType: 'json',
    retry: false,
    hooks: {
      beforeRequest: [],
      afterResponse: [],
      onError: [],
    },
    parseJson: JSON.parse,
    ...overrides,
  }
}

test('createHookRequestOptions freezes the top-level options object', () => {
  const snapshot = createHookRequestOptions(createOptions())

  assert.equal(Object.isFrozen(snapshot), true)
})

test('createHookRequestOptions freezes retry metadata and retry arrays when retry is enabled', () => {
  const retry: Exclude<NormalizedRequestOptions['retry'], false> = {
    attempts: 2,
    backoffMs: 10,
    maxBackoffMs: 100,
    multiplier: 2,
    retryOnStatuses: [503],
    retryOnMethods: ['GET'],
  }

  const snapshot = createHookRequestOptions(createOptions({ retry }))

  assert.notEqual(snapshot.retry, retry)
  if (snapshot.retry === false) {
    assert.fail('expected retry metadata when retry is enabled')
  }

  assert.equal(Object.isFrozen(snapshot.retry), true)
  assert.notEqual(snapshot.retry.retryOnStatuses, retry.retryOnStatuses)
  assert.notEqual(snapshot.retry.retryOnMethods, retry.retryOnMethods)
  assert.equal(Object.isFrozen(snapshot.retry.retryOnStatuses), true)
  assert.equal(Object.isFrozen(snapshot.retry.retryOnMethods), true)
  assert.deepEqual(snapshot.retry.retryOnStatuses, [503])
  assert.deepEqual(snapshot.retry.retryOnMethods, ['GET'])
})

test('createHookRequestOptions freezes query metadata and query arrays when query is present', () => {
  const query = {
    page: 2,
    tags: ['design', 'types'],
    nullable: null,
  }

  const snapshot = createHookRequestOptions(createOptions({ query }))

  assert.notEqual(snapshot.query, query)
  assert.equal(Object.isFrozen(snapshot.query), true)
  assert.notEqual(snapshot.query?.tags, query.tags)
  assert.equal(Object.isFrozen(snapshot.query?.tags), true)
  assert.deepEqual(snapshot.query, query)
})

test('createHookRequestOptions omits optional metadata keys when absent', () => {
  const snapshot = createHookRequestOptions(createOptions())

  assert.equal(Object.hasOwn(snapshot, 'query'), false)
  assert.equal(Object.hasOwn(snapshot, 'timeout'), false)
  assert.equal(Object.hasOwn(snapshot, 'signal'), false)
})

test('createHookRequestOptions sets retry to exactly false when retries are disabled', () => {
  const snapshot = createHookRequestOptions(createOptions({ retry: false }))

  assert.equal(snapshot.retry, false)
})
