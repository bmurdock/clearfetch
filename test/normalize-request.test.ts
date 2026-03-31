import assert from 'node:assert/strict'
import test from 'node:test'

import { ConfigError } from '../src/errors.js'
import {
  buildRequestFromContext,
  createBeforeRequestContext,
  normalizeRequestOptions,
  resolveRequestURL,
  serializeQueryParams,
} from '../src/internal/normalize-request.js'

test('serializeQueryParams repeats array keys and skips undefined', () => {
  const query = serializeQueryParams({
    page: 1,
    empty: undefined,
    tags: ['a', 'b'],
    nullable: null,
  })

  assert.equal(query, 'page=1&tags=a&tags=b&nullable=null')
})

test('resolveRequestURL requires baseURL for relative inputs', () => {
  assert.throws(
    () => resolveRequestURL('/users'),
    (error) =>
      error instanceof ConfigError &&
      error.message === 'Relative request inputs require `baseURL`',
  )
})

test('createBeforeRequestContext resolves relative input with baseURL and merges headers', () => {
  const context = createBeforeRequestContext(
    '/users',
    {
      baseURL: 'https://api.example.com/root/',
      headers: {
        Accept: 'application/json',
      },
      hooks: {
        beforeRequest: [() => undefined],
      },
    },
    {
      headers: {
        Accept: 'application/vnd.clearfetch+json',
      },
      query: {
        page: 2,
        tags: ['design', 'types'],
      },
    },
  )

  assert.equal(
    context.url.toString(),
    'https://api.example.com/users?page=2&tags=design&tags=types',
  )
  assert.equal(context.headers.get('accept'), 'application/vnd.clearfetch+json')
  assert.equal(context.options.hooks.beforeRequest.length, 1)
})

test('normalizeRequestOptions rejects body plus json', () => {
  assert.throws(
    () =>
      normalizeRequestOptions({}, {
        body: 'raw',
        json: {
          hello: 'world',
        },
      }),
    (error) =>
      error instanceof ConfigError &&
      error.message === '`body` and `json` cannot both be provided',
  )
})

test('normalizeRequestOptions rejects unsupported responseType values', () => {
  assert.throws(
    () =>
      normalizeRequestOptions({}, {
        responseType: 'xml' as never,
      }),
    (error) =>
      error instanceof ConfigError &&
      error.message === 'Unsupported responseType: xml',
  )
})

test('normalizeRequestOptions rejects non-function parseJson values', () => {
  assert.throws(
    () =>
      normalizeRequestOptions({}, {
        parseJson: 'not-a-function' as never,
      }),
    (error) =>
      error instanceof ConfigError &&
      error.message === '`parseJson` must be a function',
  )
})

test('normalizeRequestOptions rejects invalid retry values', () => {
  assert.throws(
    () =>
      normalizeRequestOptions({}, {
        retry: {
          attempts: 0,
        },
      }),
    (error) =>
      error instanceof ConfigError &&
      error.message === '`retry.attempts` must be a positive integer',
  )

  assert.throws(
    () =>
      normalizeRequestOptions({}, {
        retry: {
          retryOnMethods: ['post'] as never,
        },
      }),
    (error) =>
      error instanceof ConfigError &&
      error.message === '`retry.retryOnMethods` must contain supported uppercase methods',
  )

  assert.throws(
    () =>
      normalizeRequestOptions({}, {
        retry: {
          retryOnStatuses: [99],
        },
      }),
    (error) =>
      error instanceof ConfigError &&
      error.message === '`retry.retryOnStatuses` must contain valid HTTP status codes',
  )
})

test('normalizeRequestOptions accepts valid retry values', () => {
  const options = normalizeRequestOptions({}, {
    retry: {
      attempts: 2,
      backoffMs: 10,
      maxBackoffMs: 20,
      multiplier: 2,
      retryOnStatuses: [503],
      retryOnMethods: ['GET'],
    },
  })

  assert.deepEqual(options.retry, {
    attempts: 2,
    backoffMs: 10,
    maxBackoffMs: 20,
    multiplier: 2,
    retryOnStatuses: [503],
    retryOnMethods: ['GET'],
  })
})

test('normalizeRequestOptions rejects unsupported query values', () => {
  assert.throws(
    () =>
      normalizeRequestOptions({}, {
        query: {
          nested: { nope: true } as never,
        },
      }),
    (error) =>
      error instanceof ConfigError &&
      error.message.includes('Unsupported query value for `nested`'),
  )

  assert.throws(
    () =>
      normalizeRequestOptions({}, {
        query: {
          fn: (() => 'x') as never,
        },
      }),
    (error) =>
      error instanceof ConfigError &&
      error.message.includes('Unsupported query value for `fn`'),
  )
})

test('createBeforeRequestContext rejects streaming bodies when retry is enabled', () => {
  assert.throws(
    () =>
      createBeforeRequestContext('https://api.example.com/upload', {}, {
        method: 'POST',
        body: new ReadableStream(),
        retry: {
          attempts: 2,
        },
      }),
    (error) =>
      error instanceof ConfigError &&
      error.message === 'Retry is not supported for streaming request bodies',
  )
})

test('buildRequestFromContext serializes json and sets content-type when absent', () => {
  const context = createBeforeRequestContext(
    'https://api.example.com/users',
    {},
    {
      method: 'POST',
      json: {
        name: 'Brian',
      },
    },
  )

  const request = buildRequestFromContext(context)

  assert.equal(request.headers.get('content-type'), 'application/json')
  assert.equal(context.body, JSON.stringify({ name: 'Brian' }))
})

test('buildRequestFromContext rejects invalid hook URL overrides', () => {
  const context = createBeforeRequestContext('https://api.example.com/users')

  ;(context as { url: unknown }).url = '/relative'

  assert.throws(
    () => buildRequestFromContext(context),
    (error) =>
      error instanceof ConfigError &&
      error.message === 'beforeRequest URL overrides must be absolute URLs',
  )
})
