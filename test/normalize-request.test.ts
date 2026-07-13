import assert from 'node:assert/strict'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

import { ConfigError } from '../src/errors.js'
import {
  buildRequestFromContext,
  createBeforeRequestContext,
  normalizeRequestOptions,
  resolveRequestURL,
  serializeQueryParams,
} from '../src/internal/normalize-request.js'
import type { RequestOptions } from '../src/types.js'

test('serializeQueryParams repeats array keys and skips undefined', () => {
  const query = serializeQueryParams({
    page: 1,
    empty: undefined,
    tags: ['a', 'b'],
    nullable: null,
  })

  assert.equal(query, 'page=1&tags=a&tags=b&nullable=null')
})

test('serializeQueryParams preserves URLSearchParams ordering and duplicate keys', () => {
  const query = new URLSearchParams()
  query.append('tag', 'a')
  query.append('page', '1')
  query.append('tag', 'b')

  assert.equal(serializeQueryParams(query), 'tag=a&page=1&tag=b')
})

test('serializeQueryParams accepts URLSearchParams values across realm boundaries', () => {
  const query = new URLSearchParams('tag=a&page=1&tag=b')
  Object.setPrototypeOf(query, null)

  assert.equal(
    serializeQueryParams(query as URLSearchParams),
    'tag=a&page=1&tag=b',
  )
})

test('resolveRequestURL appends URLSearchParams query input', () => {
  const query = new URLSearchParams('tag=a&page=1&tag=b')
  const url = resolveRequestURL(
    '/users?active=true',
    'https://api.example.com',
    query,
  )

  assert.equal(
    url.href,
    'https://api.example.com/users?active=true&tag=a&page=1&tag=b',
  )
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
  assert.equal(context.options.method, 'GET')
  assert.deepEqual(context.options.query, {
    page: 2,
    tags: ['design', 'types'],
  })
})

test('normalizeRequestOptions rejects body plus json', () => {
  assert.throws(
    () =>
      normalizeRequestOptions({}, {
        body: 'raw',
        json: {
          hello: 'world',
        },
      } as RequestOptions),
    (error) =>
      error instanceof ConfigError &&
      error.message === '`body` and `json` cannot both be provided',
  )
})

test('normalizeRequestOptions rejects non-string request methods', () => {
  assert.throws(
    () =>
      normalizeRequestOptions({}, {
        method: 123 as never,
      }),
    (error) =>
      error instanceof ConfigError &&
      error.message === '`method` must be a string',
  )
})

test('normalizeRequestOptions rejects request bodies for GET and HEAD', () => {
  assert.throws(
    () =>
      normalizeRequestOptions({}, {
        method: 'GET',
        body: 'payload',
      } as RequestOptions),
    (error) =>
      error instanceof ConfigError &&
      error.message === '`GET` requests cannot include a request body',
  )

  assert.throws(
    () =>
      normalizeRequestOptions({}, {
        method: 'HEAD',
        json: {
          ping: true,
        },
      } as RequestOptions),
    (error) =>
      error instanceof ConfigError &&
      error.message === '`HEAD` requests cannot include a request body',
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

test('normalizeRequestOptions rejects invalid hook configuration', () => {
  assert.throws(
    () =>
      normalizeRequestOptions({}, {
        hooks: {
          beforeRequest: (() => undefined) as never,
        },
      }),
    (error) =>
      error instanceof ConfigError &&
      error.message === '`hooks.beforeRequest` must be an array of functions',
  )

  assert.throws(
    () =>
      normalizeRequestOptions({}, {
        hooks: {
          onError: [undefined as never],
        },
      }),
    (error) =>
      error instanceof ConfigError &&
      error.message === '`hooks.onError` must be an array of functions',
  )

  assert.throws(
    () =>
      normalizeRequestOptions({}, {
        hooks: {
          afterResponse: new Array(1) as never,
        },
      }),
    (error) =>
      error instanceof ConfigError &&
      error.message === '`hooks.afterResponse` must be an array of functions',
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

test('normalizeRequestOptions rejects invalid query containers with ConfigError', () => {
  for (const query of [null, 42, []]) {
    assert.throws(
      () =>
        normalizeRequestOptions({}, {
          query: query as never,
        }),
      (error) =>
        error instanceof ConfigError &&
        error.message === '`query` must be a record or URLSearchParams',
    )
  }
})

test('normalizeRequestOptions accepts query records across realm boundaries', () => {
  const query = runInNewContext('({ page: 2, tags: ["design", "types"] })')
  const options = normalizeRequestOptions({}, {
    query,
  })

  assert.equal(serializeQueryParams(options.query), 'page=2&tags=design&tags=types')
})

test('createBeforeRequestContext validates query input before URL serialization', () => {
  assert.throws(
    () =>
      createBeforeRequestContext('https://api.example.com/users', {}, {
        query: null as never,
      }),
    (error) =>
      error instanceof ConfigError &&
      error.message === '`query` must be a record or URLSearchParams',
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

test('createBeforeRequestContext rejects json values that serialize to undefined', () => {
  for (const json of [undefined, Symbol('value'), () => undefined]) {
    assert.throws(
      () =>
        createBeforeRequestContext('https://api.example.com/users', {}, {
          method: 'POST',
          json,
        }),
      (error) =>
        error instanceof ConfigError &&
        error.message === '`json` must serialize to a JSON value',
    )
  }
})

test('explicit undefined json still participates in option validation', () => {
  assert.throws(
    () =>
      normalizeRequestOptions({}, {
        method: 'POST',
        body: 'raw',
        json: undefined,
      } as unknown as RequestOptions),
    (error) =>
      error instanceof ConfigError &&
      error.message === '`body` and `json` cannot both be provided',
  )

  assert.throws(
    () =>
      normalizeRequestOptions({}, {
        method: 'GET',
        json: undefined,
      } as unknown as RequestOptions),
    (error) =>
      error instanceof ConfigError &&
      error.message === '`GET` requests cannot include a request body',
  )
})

test('createBeforeRequestContext wraps json serialization failures as ConfigError', () => {
  const json: { self?: unknown } = {}
  json.self = json

  assert.throws(
    () =>
      createBeforeRequestContext('https://api.example.com/users', {}, {
        method: 'POST',
        json,
      }),
    (error) =>
      error instanceof ConfigError &&
      error.message === '`json` must serialize to a JSON value' &&
      error.cause instanceof TypeError,
  )
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
