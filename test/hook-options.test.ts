import assert from 'node:assert/strict'
import test from 'node:test'

import { createHookRequestOptions } from '../src/internal/hook-options.js'
import type { NormalizedRequestOptions } from '../src/types.js'

const DEFAULT_METADATA = {
  attempt: 1,
  maxAttempts: 1,
}

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
  const snapshot = createHookRequestOptions(createOptions(), DEFAULT_METADATA)

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

  const snapshot = createHookRequestOptions(
    createOptions({ retry }),
    DEFAULT_METADATA,
  )

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

test('createHookRequestOptions exposes retry attempt metadata', () => {
  const snapshot = createHookRequestOptions(
    createOptions({
      retry: {
        attempts: 3,
        backoffMs: 10,
        maxBackoffMs: 100,
        multiplier: 2,
        retryOnStatuses: [503],
        retryOnMethods: ['GET'],
      },
    }),
    {
      attempt: 2,
      maxAttempts: 3,
    },
  )

  assert.equal(snapshot.attempt, 2)
  assert.equal(snapshot.maxAttempts, 3)
})

test('createHookRequestOptions exposes serialized query metadata', () => {
  const snapshot = createHookRequestOptions(createOptions(), {
    attempt: 1,
    maxAttempts: 1,
    queryString: 'tag=a&tag=b&page=1',
  })

  assert.equal(snapshot.queryString, 'tag=a&tag=b&page=1')
})

test('createHookRequestOptions exposes serialized URLSearchParams query metadata', () => {
  const query = new URLSearchParams('tag=a&page=1&tag=b')
  const snapshot = createHookRequestOptions(
    createOptions({ query }),
    {
      attempt: 1,
      maxAttempts: 1,
      queryString: 'tag=a&page=1&tag=b',
    },
  )

  assert.equal(Object.hasOwn(snapshot, 'query'), false)
  assert.equal(snapshot.queryString, 'tag=a&page=1&tag=b')
})

test('createHookRequestOptions recognizes cross-realm URLSearchParams metadata', () => {
  const query = new URLSearchParams('tag=a&page=1&tag=b')
  Object.setPrototypeOf(query, null)
  const snapshot = createHookRequestOptions(
    createOptions({ query: query as URLSearchParams }),
    DEFAULT_METADATA,
  )

  assert.equal(Object.hasOwn(snapshot, 'query'), false)
})

test('createHookRequestOptions freezes query metadata and query arrays when query is present', () => {
  const query = {
    page: 2,
    tags: ['design', 'types'],
    nullable: null,
  }

  const snapshot = createHookRequestOptions(
    createOptions({ query }),
    DEFAULT_METADATA,
  )

  assert.notEqual(snapshot.query, query)
  assert.equal(Object.isFrozen(snapshot.query), true)
  assert.notEqual(snapshot.query?.tags, query.tags)
  assert.equal(Object.isFrozen(snapshot.query?.tags), true)
  assert.deepEqual(snapshot.query, query)
})

test('createHookRequestOptions preserves special query keys as own properties', () => {
  const query = JSON.parse(
    '{"__proto__":["admin","editor"],"constructor":"value"}',
  ) as Exclude<NormalizedRequestOptions['query'], undefined>

  const snapshot = createHookRequestOptions(
    createOptions({ query }),
    DEFAULT_METADATA,
  )

  assert.equal(Object.getPrototypeOf(snapshot.query), Object.prototype)
  assert.equal(Object.hasOwn(snapshot.query ?? {}, '__proto__'), true)
  assert.equal(Object.hasOwn(snapshot.query ?? {}, 'constructor'), true)
  assert.deepEqual(snapshot.query?.['__proto__'], ['admin', 'editor'])
  assert.equal(snapshot.query?.constructor, 'value')
})

test('createHookRequestOptions omits optional metadata keys when absent', () => {
  const snapshot = createHookRequestOptions(createOptions(), DEFAULT_METADATA)

  assert.equal(Object.hasOwn(snapshot, 'query'), false)
  assert.equal(Object.hasOwn(snapshot, 'queryString'), false)
  assert.equal(Object.hasOwn(snapshot, 'timeout'), false)
  assert.equal(Object.hasOwn(snapshot, 'signal'), false)
})

test('createHookRequestOptions sets retry to exactly false when retries are disabled', () => {
  const snapshot = createHookRequestOptions(
    createOptions({ retry: false }),
    DEFAULT_METADATA,
  )

  assert.equal(snapshot.retry, false)
})
