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

test('retry attempts rebuild POST json bodies after the first attempt', async () => {
  const originalFetch = globalThis.fetch
  let attempts = 0
  let stringifyCalls = 0
  const seenBodies: string[] = []

  const payload = {
    toJSON() {
      stringifyCalls += 1
      return { ok: true }
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
    assert.equal(stringifyCalls, 2)
    assert.deepEqual(seenBodies, ['{"ok":true}', '{"ok":true}'])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('retryable HTTP responses do not read body text before retrying', async () => {
  const originalFetch = globalThis.fetch
  const originalText = Response.prototype.text
  let attempts = 0
  let textCalls = 0

  Response.prototype.text = function textWithCount(this: Response): Promise<string> {
    textCalls += 1
    return originalText.call(this)
  }

  globalThis.fetch = async () => {
    attempts += 1

    if (attempts < 3) {
      return new Response('retry body should not be read', {
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
        maxBackoffMs: 1,
        multiplier: 1,
        retryOnStatuses: [503],
        retryOnMethods: ['GET'],
      },
    })

    assert.deepEqual(result, { ok: true })
    assert.equal(attempts, 3)
    assert.equal(textCalls, 1)
  } finally {
    Response.prototype.text = originalText
    globalThis.fetch = originalFetch
  }
})

test('abort during HTTP retry backoff stops promptly with AbortRequestError', async () => {
  const originalFetch = globalThis.fetch
  const controller = new AbortController()
  let attempts = 0

  globalThis.fetch = async () => {
    attempts += 1
    return new Response('retry', {
      status: 503,
      statusText: 'Service Unavailable',
    })
  }

  try {
    const promise = request('https://api.example.com/users', {
      signal: controller.signal,
      retry: {
        attempts: 2,
        backoffMs: 50,
        maxBackoffMs: 50,
        multiplier: 1,
        retryOnStatuses: [503],
        retryOnMethods: ['GET'],
      },
    })

    controller.abort()

    await assert.rejects(
      () => promise,
      (error) => error instanceof AbortRequestError,
    )
    assert.equal(attempts, 1)
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

test('abort during retry backoff stops promptly with AbortRequestError', async () => {
  const originalFetch = globalThis.fetch
  let attempts = 0

  globalThis.fetch = async () => {
    attempts += 1
    throw new TypeError('fetch failed')
  }

  try {
    const controller = new AbortController()
    const startedAt = Date.now()

    const promise = request('https://api.example.com/users', {
      signal: controller.signal,
      retry: {
        attempts: 3,
        backoffMs: 500,
        maxBackoffMs: 500,
        multiplier: 1,
        retryOnStatuses: [503],
        retryOnMethods: ['GET'],
      },
    })

    setTimeout(() => {
      controller.abort()
    }, 25)

    await assert.rejects(
      () => promise,
      (error) => error instanceof AbortRequestError,
    )

    assert.equal(attempts, 1)
    assert.ok(Date.now() - startedAt < 250)
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

test('responses are not cloned when no afterResponse hooks are registered', async () => {
  const originalFetch = globalThis.fetch
  const originalClone = Response.prototype.clone
  let cloneCalls = 0

  Response.prototype.clone = function cloneWithCount(this: Response): Response {
    cloneCalls += 1
    return originalClone.call(this)
  }

  globalThis.fetch = async () => new Response(JSON.stringify({ ok: true }))

  try {
    const result = await request<{ ok: boolean }>('https://api.example.com/users')

    assert.deepEqual(result, { ok: true })
    assert.equal(cloneCalls, 0)
  } finally {
    Response.prototype.clone = originalClone
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

test('beforeRequest cannot mutate execution options through context.options', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: true }))

  try {
    const client = createClient({
      hooks: {
        beforeRequest: [
          async (context) => {
            ;(context.options as { method?: string }).method = 'POST'
          },
        ],
      },
    })

    await assert.rejects(
      () => client.get('https://api.example.com/users'),
      (error) => error instanceof TypeError,
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('afterResponse cannot mutate parse behavior through context.options', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: true }))

  try {
    const client = createClient({
      hooks: {
        afterResponse: [
          async (context) => {
            ;(context.options as { responseType?: string }).responseType = 'raw'
          },
        ],
      },
    })

    await assert.rejects(
      () => client.get('https://api.example.com/users'),
      (error) => error instanceof TypeError,
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('hook contexts share one read-only options snapshot per failed attempt', async () => {
  const originalFetch = globalThis.fetch
  let beforeOptions: unknown
  let afterOptions: unknown
  let errorOptions: unknown

  globalThis.fetch = async () =>
    new Response('missing', {
      status: 404,
      statusText: 'Not Found',
    })

  try {
    const client = createClient({
      hooks: {
        beforeRequest: [
          async (context) => {
            beforeOptions = context.options
          },
        ],
        afterResponse: [
          async (context) => {
            afterOptions = context.options
          },
        ],
        onError: [
          async (context) => {
            errorOptions = context.options
          },
        ],
      },
    })

    await assert.rejects(
      () => client.get('https://api.example.com/users'),
      (error) => error instanceof HttpError && error.status === 404,
    )

    assert.equal(afterOptions, beforeOptions)
    assert.equal(errorOptions, beforeOptions)
    assert.ok(Object.isFrozen(beforeOptions))
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('network failure hook contexts share one read-only options snapshot per failed attempt', async () => {
  const originalFetch = globalThis.fetch
  let beforeOptions: unknown
  let errorOptions: unknown

  globalThis.fetch = async () => {
    throw new TypeError('fetch failed')
  }

  try {
    const client = createClient({
      retry: false,
      hooks: {
        beforeRequest: [
          async (context) => {
            beforeOptions = context.options
          },
        ],
        onError: [
          async (context) => {
            errorOptions = context.options
          },
        ],
      },
    })

    await assert.rejects(
      () => client.get('https://api.example.com/users'),
      (error) => error instanceof NetworkError,
    )

    assert.equal(errorOptions, beforeOptions)
    assert.ok(Object.isFrozen(beforeOptions))
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
