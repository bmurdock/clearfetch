import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ConfigError,
  HttpError,
  NetworkError,
} from '../src/errors.js'
import { createClient } from '../src/index.js'
import { request } from '../src/request.js'
import {
  withMockedFetch,
  withPatchedResponseMethod,
} from './helpers/mock-fetch.js'
import { trackOriginalResponseBodyCancellation } from './helpers/response-body.js'

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
  const seenStatuses: number[] = []

  await withMockedFetch(
    async () =>
      new Response('missing', {
        status: 404,
        statusText: 'Not Found',
      }),
    async () => {
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
    },
  )
})
test('beforeRequest hooks can inspect serialized query metadata', async () => {
  const originalFetch = globalThis.fetch
  let queryString: string | undefined

  globalThis.fetch = async () => new Response(JSON.stringify({ ok: true }))

  try {
    const result = await request<{ ok: boolean }>(
      'https://api.example.com/users?active=true',
      {
        query: {
          tag: ['a', 'b'],
          page: 1,
        },
        hooks: {
          beforeRequest: [
            (context) => {
              queryString = context.options.queryString
              assert.equal(
                context.url.href,
                'https://api.example.com/users?active=true&tag=a&tag=b&page=1',
              )
            },
          ],
        },
      },
    )

    assert.deepEqual(result, { ok: true })
    assert.equal(queryString, 'tag=a&tag=b&page=1')
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
  await withMockedFetch(
    async () => new Response(JSON.stringify({ ok: true })),
    async () => {
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
    },
  )
})

test('hook failures propagate instead of being swallowed', async () => {
  const observedErrors: unknown[] = []

  await withMockedFetch(
    async () => new Response(JSON.stringify({ ok: true })),
    async () => {
      const client = createClient({
        hooks: {
          beforeRequest: [
            async () => {
              throw new Error('hook failure')
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
        (error) => error instanceof Error && error.message === 'hook failure',
      )

      assert.equal(observedErrors.length, 1)
      assert.ok(observedErrors[0] instanceof Error)
      assert.equal((observedErrors[0] as Error).message, 'hook failure')
    },
  )
})

test('afterResponse hook failures propagate without NetworkError wrapping', async () => {
  const seenStatuses: number[] = []
  const seenErrors: unknown[] = []

  await withMockedFetch(
    async () => new Response(JSON.stringify({ ok: true })),
    async () => {
      const client = createClient({
        hooks: {
          afterResponse: [
            async () => {
              throw new Error('afterResponse failure')
            },
          ],
          onError: [
            async (context) => {
              seenErrors.push(context.error)
              seenStatuses.push(context.response?.status ?? -1)
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

      assert.equal(seenErrors.length, 1)
      assert.ok(seenErrors[0] instanceof Error)
      assert.equal((seenErrors[0] as Error).message, 'afterResponse failure')
      assert.deepEqual(seenStatuses, [200])
    },
  )
})

test('afterResponse hook failures cancel the abandoned response body', async () => {
  let bodyCancelCalls = 0

  await withMockedFetch(
    async () => {
      return trackOriginalResponseBodyCancellation(new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('response'))
            controller.close()
          },
        }),
      ), () => {
        bodyCancelCalls += 1
      })
    },
    async () => {
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
          error instanceof Error && error.message === 'afterResponse failure',
      )

      assert.equal(bodyCancelCalls, 1)
    },
  )
})

test('responses are not cloned when no afterResponse hooks are registered', async () => {
  const originalClone = Response.prototype.clone
  let cloneCalls = 0

  await withPatchedResponseMethod(
    'clone',
    function cloneWithCount(this: Response): Response {
      cloneCalls += 1
      return originalClone.call(this)
    },
    () =>
      withMockedFetch(
        async () => new Response(JSON.stringify({ ok: true })),
        async () => {
          const result = await request<{ ok: boolean }>(
            'https://api.example.com/users',
          )

          assert.deepEqual(result, { ok: true })
          assert.equal(cloneCalls, 0)
        },
      ),
  )
})

test('afterResponse may read the response body without breaking json parsing', async () => {
  const seenBodies: string[] = []

  await withMockedFetch(
    async () => new Response(JSON.stringify({ ok: true })),
    async () => {
      const client = createClient({
        hooks: {
          afterResponse: [
            async (context) => {
              seenBodies.push(await context.response.text())
            },
          ],
        },
      })

      const result = await client.get<{ ok: boolean }>(
        'https://api.example.com/users',
      )

      assert.deepEqual(seenBodies, ['{"ok":true}'])
      assert.deepEqual(result, { ok: true })
    },
  )
})

test('afterResponse hooks receive independently readable response bodies', async () => {
  const seenBodies: string[] = []

  await withMockedFetch(
    async () => new Response(JSON.stringify({ ok: true })),
    async () => {
      const client = createClient({
        hooks: {
          afterResponse: [
            async (context) => {
              seenBodies.push(await context.response.text())
            },
            async (context) => {
              seenBodies.push(await context.response.text())
            },
          ],
        },
      })

      const result = await client.get<{ ok: boolean }>(
        'https://api.example.com/users',
      )

      assert.deepEqual(seenBodies, ['{"ok":true}', '{"ok":true}'])
      assert.deepEqual(result, { ok: true })
    },
  )
})

test('beforeRequest cannot mutate execution options through context.options', async () => {
  await withMockedFetch(
    async () => new Response(JSON.stringify({ ok: true })),
    async () => {
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
    },
  )
})

test('beforeRequest hook contexts do not expose internal execution state', async () => {
  let hasInternalOptions = true
  let contextKeys: string[] = []

  await withMockedFetch(
    async () => new Response(JSON.stringify({ ok: true })),
    async () => {
      const client = createClient({
        hooks: {
          beforeRequest: [
            async (context) => {
              hasInternalOptions = Object.hasOwn(context, '_internalOptions')
              contextKeys = Object.keys(context)
            },
          ],
        },
      })

      const result = await client.get<{ ok: boolean }>(
        'https://api.example.com/users',
      )

      assert.equal(hasInternalOptions, false)
      assert.equal(contextKeys.includes('_internalOptions'), false)
      assert.deepEqual(result, { ok: true })
    },
  )
})

test('afterResponse cannot mutate parse behavior through context.options', async () => {
  await withMockedFetch(
    async () => new Response(JSON.stringify({ ok: true })),
    async () => {
      const client = createClient({
        hooks: {
          afterResponse: [
            async (context) => {
              ;(context.options as { responseType?: string }).responseType =
                'raw'
            },
          ],
        },
      })

      await assert.rejects(
        () => client.get('https://api.example.com/users'),
        (error) => error instanceof TypeError,
      )
    },
  )
})

test('hook contexts share one read-only options snapshot per failed attempt', async () => {
  let beforeOptions: unknown
  let afterOptions: unknown
  let errorOptions: unknown

  await withMockedFetch(
    async () =>
      new Response('missing', {
        status: 404,
        statusText: 'Not Found',
      }),
    async () => {
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
    },
  )
})

test('network failure hook contexts share one read-only options snapshot per failed attempt', async () => {
  let beforeOptions: unknown
  let errorOptions: unknown

  await withMockedFetch(
    async () => {
      throw new TypeError('fetch failed')
    },
    async () => {
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
    },
  )
})

test('afterResponse body reads do not prevent HttpError bodyText capture', async () => {
  const seenBodies: string[] = []

  await withMockedFetch(
    async () =>
      new Response('missing', {
        status: 404,
        statusText: 'Not Found',
      }),
    async () => {
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
    },
  )
})
