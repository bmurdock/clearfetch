import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ConfigError,
  HttpError,
  NetworkError,
} from '../src/errors.js'
import { createClient } from '../src/index.js'
import { request } from '../src/request.js'
import { withMockedFetch } from './helpers/mock-fetch.js'

test('onError receives normalized failures after classification', async () => {
  const errorNames: string[] = []

  await withMockedFetch(
    async () =>
      new Response('missing', {
        status: 404,
        statusText: 'Not Found',
      }),
    async () => {
      const client = createClient({
        hooks: {
          onError: [
            async (context) => {
              errorNames.push((context.error as Error).name)
            },
          ],
        },
      })

      await assert.rejects(
        () => client.get('https://api.example.com/users'),
        (error) => error instanceof HttpError,
      )

      assert.deepEqual(errorNames, ['HttpError'])
    },
  )
})

test('exhausted HTTP retries report the final error through onError once', async () => {
  let attempts = 0
  let thrownError: unknown
  const observedErrors: unknown[] = []

  await withMockedFetch(
    async () => {
      attempts += 1
      return new Response('retry', {
        status: 503,
        statusText: 'Service Unavailable',
      })
    },
    async () => {
      await assert.rejects(
        () =>
          request('https://api.example.com/users', {
            hooks: {
              onError: [
                (context) => {
                  observedErrors.push(context.error)
                },
              ],
            },
            retry: {
              attempts: 2,
              backoffMs: 0,
              maxBackoffMs: 0,
              retryOnMethods: ['GET'],
              retryOnStatuses: [503],
            },
          }),
        (error) => {
          thrownError = error
          return error instanceof HttpError && error.status === 503
        },
      )
    },
  )

  assert.equal(attempts, 2)
  assert.deepEqual(observedErrors, [thrownError])
})

test('exhausted network retries report the final error through onError once', async () => {
  let attempts = 0
  let thrownError: unknown
  const observedErrors: unknown[] = []

  await withMockedFetch(
    async () => {
      attempts += 1
      throw new TypeError(`fetch failed ${attempts}`)
    },
    async () => {
      await assert.rejects(
        () =>
          request('https://api.example.com/users', {
            hooks: {
              onError: [
                (context) => {
                  observedErrors.push(context.error)
                },
              ],
            },
            retry: {
              attempts: 2,
              backoffMs: 0,
              maxBackoffMs: 0,
              retryOnMethods: ['GET'],
              retryOnStatuses: [503],
            },
          }),
        (error) => {
          thrownError = error
          return error instanceof NetworkError &&
            error.cause instanceof TypeError &&
            error.cause.message === 'fetch failed 2'
        },
      )
    },
  )

  assert.equal(attempts, 2)
  assert.deepEqual(observedErrors, [thrownError])
})

test('onError observes request construction failures as thrown', async () => {
  const observedErrors: unknown[] = []

  await withMockedFetch(
    async () => new Response(JSON.stringify({ ok: true })),
    async () => {
      const client = createClient({
        hooks: {
          beforeRequest: [
            async (context) => {
              context.url = '/relative' as unknown as URL
            },
          ],
          onError: [
            async (context) => {
              observedErrors.push(context.error)
            },
          ],
        },
      })

      await assert.rejects(
        () => client.get('https://api.example.com/users'),
        (error) =>
          error instanceof ConfigError &&
          error.message === 'beforeRequest URL overrides must be absolute URLs',
      )

      assert.equal(observedErrors.length, 1)
      assert.ok(observedErrors[0] instanceof ConfigError)
      assert.equal(
        (observedErrors[0] as Error).message,
        'beforeRequest URL overrides must be absolute URLs',
      )
    },
  )
})

test('onError hook failures propagate without replacing them with NetworkError', async () => {
  await withMockedFetch(
    async () =>
      new Response('missing', {
        status: 404,
        statusText: 'Not Found',
      }),
    async () => {
      const client = createClient({
        hooks: {
          onError: [
            async () => {
              throw new Error('onError failure')
            },
          ],
        },
      })

      await assert.rejects(
        () => client.get('https://api.example.com/users'),
        (error) =>
          error instanceof Error &&
          !(error instanceof NetworkError) &&
          error.message === 'onError failure',
      )
    },
  )
})

test('onError observes request normalization failures before rethrow', async () => {
  const observedErrors: unknown[] = []

  await assert.rejects(
    () =>
      request('https://api.example.com/users', {
        retry: {
          attempts: 0,
        },
        hooks: {
          onError: [
            async (context) => {
              observedErrors.push(context.error)
            },
          ],
        },
      }),
    (error) =>
      error instanceof ConfigError &&
      error.message === '`retry.attempts` must be a positive integer',
  )

  assert.equal(observedErrors.length, 1)
  assert.ok(observedErrors[0] instanceof ConfigError)
})

test('invalid abort signals fail as ConfigError and run onError', async () => {
  const observedErrors: unknown[] = []

  await assert.rejects(
    () =>
      request('https://api.example.com/users', {
        signal: { aborted: false } as never,
        hooks: {
          onError: [
            (context) => {
              observedErrors.push(context.error)
            },
          ],
        },
      }),
    (error) =>
      error instanceof ConfigError &&
      error.message === '`signal` must be an AbortSignal',
  )

  assert.equal(observedErrors.length, 1)
  assert.ok(observedErrors[0] instanceof ConfigError)
})

test('invalid onError hooks do not mask request normalization failures', async () => {
  await assert.rejects(
    () =>
      request('https://api.example.com/users', {
        method: 123 as never,
        hooks: {
          onError: [undefined as never],
        },
      }),
    (error) =>
      error instanceof ConfigError &&
      error.message === '`method` must be a string',
  )
})

test('method helpers report option materialization failures through onError', async () => {
  const failure = new Error('query getter failed')
  const observedErrors: unknown[] = []
  const client = createClient({
    hooks: {
      onError: [
        (context) => {
          observedErrors.push(context.error)
        },
      ],
    },
  })
  const options = Object.defineProperty({}, 'query', {
    enumerable: true,
    get() {
      throw failure
    },
  })

  await assert.rejects(
    () => client.get('https://api.example.com/users', options),
    (error) => error === failure,
  )
  assert.deepEqual(observedErrors, [failure])
})
