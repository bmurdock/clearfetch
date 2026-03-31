import assert from 'node:assert/strict'
import test from 'node:test'

import {
  AbortRequestError,
  ConfigError,
  HttpError,
  NetworkError,
  TimeoutError,
} from '../src/errors.js'
import { createClient } from '../src/index.js'
import { request } from '../src/request.js'

test('beforeRequest hooks run in client-then-request order', async () => {
  const originalFetch = globalThis.fetch
  const steps: string[] = []
  const seenHeaders: string[] = []

  globalThis.fetch = async (input) => {
    const request = input as Request
    seenHeaders.push(request.headers.get('x-order') ?? '')
    return new Response(JSON.stringify({ ok: true }))
  }

  try {
    const client = createClient({
      hooks: {
        beforeRequest: [
          async (context) => {
            steps.push('client')
            context.headers.set('x-order', 'client')
          },
        ],
      },
    })

    await client.get('https://api.example.com/users', {
      hooks: {
        beforeRequest: [
          async (context) => {
            steps.push('request')
            context.headers.set(
              'x-order',
              `${context.headers.get('x-order')},request`,
            )
          },
        ],
      },
    })

    assert.deepEqual(steps, ['client', 'request'])
    assert.deepEqual(seenHeaders, ['client,request'])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('afterResponse sees raw responses before HttpError classification', async () => {
  const originalFetch = globalThis.fetch
  const seenStatuses: number[] = []

  globalThis.fetch = async () =>
    new Response('missing', {
      status: 404,
      statusText: 'Not Found',
    })

  try {
    const client = createClient({
      hooks: {
        afterResponse: [
          async (context) => {
            seenStatuses.push(context.response.status)
          },
        ],
      },
    })

    await assert.rejects(
      () => client.get('https://api.example.com/users'),
      (error) => error instanceof HttpError && error.status === 404,
    )

    assert.deepEqual(seenStatuses, [404])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('onError receives normalized failures after classification', async () => {
  const originalFetch = globalThis.fetch
  const errorNames: string[] = []

  globalThis.fetch = async () =>
    new Response('missing', {
      status: 404,
      statusText: 'Not Found',
    })

  try {
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
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('request timeout surfaces TimeoutError', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input) =>
    new Promise((_resolve, reject) => {
      const request = input as Request
      if (request.signal.aborted) {
        reject(new DOMException('Aborted', 'AbortError'))
        return
      }
      request.signal.addEventListener(
        'abort',
        () => reject(new DOMException('Aborted', 'AbortError')),
        { once: true },
      )
    })

  try {
    await assert.rejects(
      () =>
        request('https://api.example.com/users', {
          timeout: 10,
        }),
      (error) => error instanceof TimeoutError && error.timeout === 10,
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('external abort surfaces AbortRequestError', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input) =>
    new Promise((_resolve, reject) => {
      const request = input as Request
      if (request.signal.aborted) {
        reject(new DOMException('Aborted', 'AbortError'))
        return
      }
      request.signal.addEventListener(
        'abort',
        () => reject(new DOMException('Aborted', 'AbortError')),
        { once: true },
      )
    })

  try {
    const controller = new AbortController()
    const promise = request('https://api.example.com/users', {
      signal: controller.signal,
    })

    controller.abort()

    await assert.rejects(
      () => promise,
      (error) => error instanceof AbortRequestError,
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('retries use configured methods and statuses with bounded backoff', async () => {
  const originalFetch = globalThis.fetch
  let attempts = 0

  globalThis.fetch = async () => {
    attempts += 1

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
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('beforeRequest may replace the URL with a final absolute URL', async () => {
  const originalFetch = globalThis.fetch
  const urls: string[] = []

  globalThis.fetch = async (input) => {
    const request = input as Request
    urls.push(request.url)
    return new Response(JSON.stringify({ ok: true }))
  }

  try {
    const client = createClient({
      baseURL: 'https://api.example.com',
      hooks: {
        beforeRequest: [
          async (context) => {
            context.url = new URL('https://uploads.example.com/override')
          },
        ],
      },
    })

    await client.get('/users', {
      query: {
        page: 1,
      },
    })

    assert.deepEqual(urls, ['https://uploads.example.com/override'])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('beforeRequest rejects relative URL overrides', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: true }))

  try {
    const client = createClient({
      hooks: {
        beforeRequest: [
          async (context) => {
            ;(context as { url: unknown }).url = '/relative'
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
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('retry does not run for unsupported methods even when status is eligible', async () => {
  const originalFetch = globalThis.fetch
  let attempts = 0

  globalThis.fetch = async () => {
    attempts += 1
    return new Response('retry', {
      status: 503,
      statusText: 'Service Unavailable',
    })
  }

  try {
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
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('retry does not run for unsupported statuses', async () => {
  const originalFetch = globalThis.fetch
  let attempts = 0

  globalThis.fetch = async () => {
    attempts += 1
    return new Response('no retry', {
      status: 500,
      statusText: 'Internal Server Error',
    })
  }

  try {
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
  } finally {
    globalThis.fetch = originalFetch
  }
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

test('hook failures propagate instead of being swallowed', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: true }))

  try {
    const client = createClient({
      hooks: {
        beforeRequest: [
          async () => {
            throw new Error('hook failure')
          },
        ],
      },
    })

    await assert.rejects(
      () => client.get('https://api.example.com/users'),
      (error) => error instanceof Error && error.message === 'hook failure',
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('afterResponse hook failures propagate without NetworkError wrapping', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: true }))

  try {
    const client = createClient({
      hooks: {
        afterResponse: [
          async () => {
            throw new Error('afterResponse failure')
          },
        ],
      },
    })

    await assert.rejects(
      () => client.get('https://api.example.com/users'),
      (error) =>
        error instanceof Error &&
        !(error instanceof NetworkError) &&
        error.message === 'afterResponse failure',
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('onError hook failures propagate without replacing them with NetworkError', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () =>
    new Response('missing', {
      status: 404,
      statusText: 'Not Found',
    })

  try {
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
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('afterResponse may read the response body without breaking json parsing', async () => {
  const originalFetch = globalThis.fetch
  const seenBodies: string[] = []

  globalThis.fetch = async () => new Response(JSON.stringify({ ok: true }))

  try {
    const client = createClient({
      hooks: {
        afterResponse: [
          async (context) => {
            seenBodies.push(await context.response.text())
          },
        ],
      },
    })

    const result = await client.get<{ ok: boolean }>('https://api.example.com/users')

    assert.deepEqual(seenBodies, ['{"ok":true}'])
    assert.deepEqual(result, { ok: true })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('afterResponse body reads do not prevent HttpError bodyText capture', async () => {
  const originalFetch = globalThis.fetch
  const seenBodies: string[] = []

  globalThis.fetch = async () =>
    new Response('missing', {
      status: 404,
      statusText: 'Not Found',
    })

  try {
    const client = createClient({
      hooks: {
        afterResponse: [
          async (context) => {
            seenBodies.push(await context.response.text())
          },
        ],
      },
    })

    await assert.rejects(
      () => client.get('https://api.example.com/users'),
      (error) =>
        error instanceof HttpError &&
        error.status === 404 &&
        error.bodyText === 'missing',
    )

    assert.deepEqual(seenBodies, ['missing'])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('request-level beforeRequest hook can override client header values', async () => {
  const originalFetch = globalThis.fetch
  const seenHeaders: string[] = []

  globalThis.fetch = async (input) => {
    const req = input as Request
    seenHeaders.push(req.headers.get('x-env') ?? '')
    return new Response(JSON.stringify({ ok: true }))
  }

  try {
    const client = createClient({
      hooks: {
        beforeRequest: [
          async (context) => {
            context.headers.set('x-env', 'client')
          },
        ],
      },
    })

    await client.get('https://api.example.com/users', {
      hooks: {
        beforeRequest: [
          async (context) => {
            context.headers.set('x-env', 'request')
          },
        ],
      },
    })

    assert.deepEqual(seenHeaders, ['request'])
  } finally {
    globalThis.fetch = originalFetch
  }
})
