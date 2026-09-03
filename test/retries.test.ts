import assert from 'node:assert/strict'
import test from 'node:test'

import { HttpError } from '../src/errors.js'
import { request } from '../src/request.js'
import {
  withMockedFetch,
  withPatchedResponseMethod,
} from './helpers/mock-fetch.js'
import { trackOriginalResponseBodyCancellation } from './helpers/response-body.js'

test('retries use configured methods and statuses with bounded backoff', async () => {
  const originalFetch = globalThis.fetch
  let attempts = 0
  const lifecycleEvents: string[] = []

  globalThis.fetch = async () => {
    attempts += 1
    lifecycleEvents.push(`fetch-${attempts}`)

    if (attempts < 3) {
      return new Response('retry', {
        status: 503,
        statusText: 'Service Unavailable',
      })
    }

    return new Response(JSON.stringify({ ok: true }))
  }

  try {
    const result = await request<{ ok: boolean }>('https://api.example.com/users', {
      hooks: {
        afterResponse: [
          (context) => {
            lifecycleEvents.push(`hook-${context.response.status}`)
          },
        ],
      },
      retry: {
        attempts: 3,
        backoffMs: 1,
        maxBackoffMs: 2,
        multiplier: 2,
        retryOnStatuses: [503],
        retryOnMethods: ['GET'],
      },
    })

    assert.deepEqual(result, { ok: true })
    assert.equal(attempts, 3)
    assert.deepEqual(lifecycleEvents, [
      'fetch-1',
      'hook-503',
      'fetch-2',
      'hook-503',
      'fetch-3',
      'hook-200',
    ])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('first attempt reuses the initial normalized context', async () => {
  const originalFetch = globalThis.fetch
  let stringifyCalls = 0

  const payload = {
    toJSON() {
      stringifyCalls += 1
      return { ok: true }
    },
  }

  globalThis.fetch = async () => new Response(JSON.stringify({ ok: true }))

  try {
    const result = await request<{ ok: boolean }>('https://api.example.com/users', {
      method: 'POST',
      json: payload,
    })

    assert.deepEqual(result, { ok: true })
    assert.equal(stringifyCalls, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('retry attempts rebuild hook context after the first attempt', async () => {
  const originalFetch = globalThis.fetch
  let attempts = 0
  const seenHeaders: string[] = []

  globalThis.fetch = async (input) => {
    attempts += 1
    const req = input as Request
    seenHeaders.push(req.headers.get('x-attempt') ?? '')

    if (attempts < 2) {
      return new Response('retry', {
        status: 503,
        statusText: 'Service Unavailable',
      })
    }

    return new Response(JSON.stringify({ ok: true }))
  }

  try {
    const result = await request<{ ok: boolean }>('https://api.example.com/users', {
      hooks: {
        beforeRequest: [
          async (context) => {
            const previousAttempt = context.headers.get('x-attempt')
            context.headers.set(
              'x-attempt',
              previousAttempt === null
                ? String(attempts + 1)
                : `${previousAttempt},leaked`,
            )
          },
        ],
      },
      retry: {
        attempts: 2,
        backoffMs: 1,
        maxBackoffMs: 1,
        multiplier: 1,
        retryOnStatuses: [503],
        retryOnMethods: ['GET'],
      },
    })

    assert.deepEqual(result, { ok: true })
    assert.deepEqual(seenHeaders, ['1', '2'])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('beforeRequest hooks can inspect retry attempt metadata', async () => {
  const originalFetch = globalThis.fetch
  const attempts: Array<{ attempt: number; maxAttempts: number }> = []
  let calls = 0

  globalThis.fetch = async () => {
    calls += 1

    if (calls === 1) {
      return new Response('retry', {
        status: 503,
        statusText: 'Service Unavailable',
      })
    }

    return new Response(JSON.stringify({ ok: true }))
  }

  try {
    const result = await request<{ ok: boolean }>('https://api.example.com/retry', {
      retry: {
        attempts: 2,
        backoffMs: 0,
        maxBackoffMs: 0,
        retryOnStatuses: [503],
        retryOnMethods: ['GET'],
      },
      hooks: {
        beforeRequest: [
          (context) => {
            attempts.push({
              attempt: context.options.attempt,
              maxAttempts: context.options.maxAttempts,
            })
          },
        ],
      },
    })

    assert.deepEqual(result, { ok: true })
    assert.deepEqual(attempts, [
      { attempt: 1, maxAttempts: 2 },
      { attempt: 2, maxAttempts: 2 },
    ])
    assert.equal(calls, 2)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('retry attempts reuse one serialized POST json body', async () => {
  const originalFetch = globalThis.fetch
  let attempts = 0
  let stringifyCalls = 0
  const seenBodies: string[] = []

  const payload = {
    toJSON() {
      stringifyCalls += 1
      return { serialization: stringifyCalls }
    },
  }

  globalThis.fetch = async (input) => {
    attempts += 1
    const req = input as Request
    seenBodies.push(await req.clone().text())

    if (attempts < 2) {
      return new Response('retry', {
        status: 503,
        statusText: 'Service Unavailable',
      })
    }

    return new Response(JSON.stringify({ ok: true }))
  }

  try {
    const result = await request<{ ok: boolean }>('https://api.example.com/users', {
      method: 'POST',
      json: payload,
      retry: {
        attempts: 2,
        backoffMs: 1,
        maxBackoffMs: 1,
        multiplier: 1,
        retryOnStatuses: [503],
        retryOnMethods: ['POST'],
      },
    })

    assert.deepEqual(result, { ok: true })
    assert.equal(attempts, 2)
    assert.equal(stringifyCalls, 1)
    assert.deepEqual(seenBodies, [
      '{"serialization":1}',
      '{"serialization":1}',
    ])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('retry attempts do not reread mutable request headers or query', async () => {
  const originalFetch = globalThis.fetch
  const headers = new Headers({
    'X-Request-Version': 'initial',
  })
  const query = {
    version: 'initial',
  }
  let attempts = 0
  const seenRequests: Array<{ header: string | null; url: string }> = []

  globalThis.fetch = async (input) => {
    attempts += 1
    const req = input as Request
    seenRequests.push({
      header: req.headers.get('x-request-version'),
      url: req.url,
    })

    if (attempts === 1) {
      headers.set('X-Request-Version', 'mutated')
      query.version = 'mutated'

      return new Response('retry', {
        status: 503,
        statusText: 'Service Unavailable',
      })
    }

    return new Response(JSON.stringify({ ok: true }))
  }

  try {
    const result = await request<{ ok: boolean }>('https://api.example.com/users', {
      headers,
      query,
      retry: {
        attempts: 2,
        backoffMs: 1,
        maxBackoffMs: 1,
        multiplier: 1,
        retryOnStatuses: [503],
        retryOnMethods: ['GET'],
      },
    })

    assert.deepEqual(result, { ok: true })
    assert.deepEqual(seenRequests, [
      {
        header: 'initial',
        url: 'https://api.example.com/users?version=initial',
      },
      {
        header: 'initial',
        url: 'https://api.example.com/users?version=initial',
      },
    ])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('retry decisions use an initial snapshot of caller-owned policy arrays', async () => {
  const originalFetch = globalThis.fetch
  const retryOnStatuses = [503]
  const retryOnMethods: Array<'GET'> = ['GET']
  let attempts = 0

  globalThis.fetch = async () => {
    attempts += 1

    if (attempts === 1) {
      retryOnStatuses[0] = 500
      retryOnMethods.length = 0

      return new Response('retry', {
        status: 503,
        statusText: 'Service Unavailable',
      })
    }

    return new Response(JSON.stringify({ ok: true }))
  }

  try {
    const result = await request<{ ok: boolean }>('https://api.example.com/users', {
      retry: {
        attempts: 2,
        backoffMs: 1,
        maxBackoffMs: 1,
        multiplier: 1,
        retryOnStatuses,
        retryOnMethods,
      },
    })

    assert.deepEqual(result, { ok: true })
    assert.equal(attempts, 2)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('retry attempts isolate mutable raw bodies from prior hook mutations', async () => {
  const originalFetch = globalThis.fetch
  const seenBodies: string[] = []
  let attempts = 0

  globalThis.fetch = async (input) => {
    attempts += 1
    const req = input as Request
    seenBodies.push(await req.clone().text())

    if (attempts < 3) {
      return new Response('retry', {
        status: 503,
        statusText: 'Service Unavailable',
      })
    }

    return new Response(JSON.stringify({ ok: true }))
  }

  try {
    const result = await request<{ ok: boolean }>('https://api.example.com/users', {
      method: 'POST',
      body: new URLSearchParams({ value: 'base' }),
      hooks: {
        beforeRequest: [
          (context) => {
            assert.ok(context.body instanceof URLSearchParams)
            context.body.append('hook', String(context.options.attempt))
          },
        ],
      },
      retry: {
        attempts: 3,
        backoffMs: 1,
        maxBackoffMs: 1,
        multiplier: 1,
        retryOnStatuses: [503],
        retryOnMethods: ['POST'],
      },
    })

    assert.deepEqual(result, { ok: true })
    assert.deepEqual(seenBodies, [
      'value=base&hook=1',
      'value=base&hook=2',
      'value=base&hook=3',
    ])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('retryable HTTP responses do not read body text before retrying', async () => {
  const originalText = Response.prototype.text
  let attempts = 0
  let textCalls = 0

  const fetchImpl: typeof fetch = async () => {
    attempts += 1

    if (attempts < 3) {
      return new Response('retry body should not be read', {
        status: 503,
        statusText: 'Service Unavailable',
      })
    }

    return new Response(JSON.stringify({ ok: true }))
  }

  await withPatchedResponseMethod(
    'text',
    function textWithCount(this: Response): Promise<string> {
      textCalls += 1
      return originalText.call(this)
    },
    () =>
      withMockedFetch(fetchImpl, async () => {
        const result = await request<{ ok: boolean }>(
          'https://api.example.com/users',
          {
            retry: {
              attempts: 3,
              backoffMs: 1,
              maxBackoffMs: 1,
              multiplier: 1,
              retryOnStatuses: [503],
              retryOnMethods: ['GET'],
            },
          },
        )

        assert.deepEqual(result, { ok: true })
        assert.equal(attempts, 3)
        assert.equal(textCalls, 1)
      }),
  )
})

test('retryable HTTP responses cancel bodies after observational response hooks', async () => {
  let attempts = 0
  let bodyCancelCalls = 0

  const fetchImpl: typeof fetch = async () => {
    attempts += 1

    if (attempts === 1) {
      return trackOriginalResponseBodyCancellation(new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('retry'))
        },
      }), {
        status: 503,
        statusText: 'Service Unavailable',
      }), () => {
        bodyCancelCalls += 1
      })
    }

    return new Response(JSON.stringify({ ok: true }))
  }

  await withMockedFetch(fetchImpl, async () => {
    const result = await request<{ ok: boolean }>(
      'https://api.example.com/users',
      {
        hooks: {
          afterResponse: [() => undefined],
        },
        retry: {
          attempts: 2,
          backoffMs: 1,
          maxBackoffMs: 1,
          multiplier: 1,
          retryOnStatuses: [503],
          retryOnMethods: ['GET'],
        },
      },
    )

    assert.deepEqual(result, { ok: true })
    assert.equal(bodyCancelCalls, 1)
  })
})

test('retry does not run for unsupported methods even when status is eligible', async () => {
  let attempts = 0

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
            method: 'POST',
            retry: {
              attempts: 3,
              backoffMs: 1,
              maxBackoffMs: 2,
              multiplier: 2,
              retryOnStatuses: [503],
              retryOnMethods: ['GET'],
            },
          }),
        (error) => error instanceof HttpError && error.status === 503,
      )

      assert.equal(attempts, 1)
    },
  )
})

test('retry does not run for unsupported statuses', async () => {
  let attempts = 0

  await withMockedFetch(
    async () => {
      attempts += 1
      return new Response('no retry', {
        status: 500,
        statusText: 'Internal Server Error',
      })
    },
    async () => {
      await assert.rejects(
        () =>
          request('https://api.example.com/users', {
            retry: {
              attempts: 3,
              backoffMs: 1,
              maxBackoffMs: 2,
              multiplier: 2,
              retryOnStatuses: [503],
              retryOnMethods: ['GET'],
            },
          }),
        (error) => error instanceof HttpError && error.status === 500,
      )

      assert.equal(attempts, 1)
    },
  )
})

test('retry runs for network failures when method is eligible', async () => {
  const originalFetch = globalThis.fetch
  let attempts = 0

  globalThis.fetch = async () => {
    attempts += 1
    if (attempts < 2) {
      throw new TypeError('fetch failed')
    }

    return new Response(JSON.stringify({ ok: true }))
  }

  try {
    const result = await request<{ ok: boolean }>('https://api.example.com/users', {
      retry: {
        attempts: 2,
        backoffMs: 1,
        maxBackoffMs: 2,
        multiplier: 2,
        retryOnStatuses: [503],
        retryOnMethods: ['GET'],
      },
    })

    assert.deepEqual(result, { ok: true })
    assert.equal(attempts, 2)
  } finally {
    globalThis.fetch = originalFetch
  }
})
