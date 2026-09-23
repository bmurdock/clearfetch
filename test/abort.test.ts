import assert from 'node:assert/strict'
import test from 'node:test'

import {
  AbortRequestError,
  ConfigError,
  TimeoutError,
} from '../src/errors.js'
import { request } from '../src/request.js'
import { withMockedFetch } from './helpers/mock-fetch.js'

for (const reason of [new Error('already cancelled'), null, new ConfigError('cancelled')]) {
  test(`pre-aborted requests skip beforeRequest hooks (${String(reason)})`, async () => {
    const controller = new AbortController()
    controller.abort(reason)
    const observedErrors: unknown[] = []
    let hookCalls = 0
    let fetchCalls = 0

    await withMockedFetch(async () => {
      fetchCalls += 1
      return new Response('ok')
    }, async () => {
      await assert.rejects(request('https://api.example.com/hook', {
        signal: controller.signal,
        hooks: {
          beforeRequest: [() => { hookCalls += 1 }],
          onError: [(context) => { observedErrors.push(context.error) }],
        },
      }), (error) => {
        assert.ok(error instanceof AbortRequestError)
        assert.equal(error.cause, reason)
        assert.deepEqual(observedErrors, [error])
        return true
      })
    })
    assert.equal(hookCalls, 0)
    assert.equal(fetchCalls, 0)
  })
}

for (const lateResult of ['resolve', 'reject'] as const) {
  test(`external abort settles a pending beforeRequest hook before its late ${lateResult}`, async () => {
    const controller = new AbortController()
    const reason = new Error('caller cancelled before fetch')
    let finishHook!: () => void
    const hookGate = new Promise<void>((resolve, reject) => {
      finishHook = () => lateResult === 'resolve'
        ? resolve()
        : reject(new Error('late hook failure'))
    })
    let hookStarted!: () => void
    const started = new Promise<void>((resolve) => { hookStarted = resolve })
    const observedErrors: unknown[] = []
    let laterHookCalls = 0
    let fetchCalls = 0
    let deadline: ReturnType<typeof setTimeout> | undefined

    await withMockedFetch(async () => {
      fetchCalls += 1
      return new Response('ok')
    }, async () => {
      const result = request('https://api.example.com/hook', {
        signal: controller.signal,
        hooks: {
          beforeRequest: [
            () => { hookStarted(); return hookGate },
            () => { laterHookCalls += 1 },
          ],
          onError: [(context) => { observedErrors.push(context.error) }],
        },
      }).then(() => undefined, (error: unknown) => error)
      try {
        await started
        controller.abort(reason)
        const error = await Promise.race([
          result,
          new Promise<never>((_resolve, reject) => {
            deadline = setTimeout(() => reject(new Error('request waited for beforeRequest')), 250)
          }),
        ])
        assert.ok(error instanceof AbortRequestError)
        assert.equal(error.cause, reason)
        assert.deepEqual(observedErrors, [error])
      } finally {
        clearTimeout(deadline)
        finishHook()
        await result
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
      assert.equal(laterHookCalls, 0)
      assert.equal(fetchCalls, 0)
      assert.equal(observedErrors.length, 1)
    })
  })
}

test('a synchronously aborting beforeRequest hook observes its rejected promise', async () => {
  const controller = new AbortController()
  const reason = new Error('stop during beforeRequest')
  const observedErrors: unknown[] = []
  await assert.rejects(request('https://api.example.com/hook', {
    signal: controller.signal,
    hooks: {
      beforeRequest: [() => {
        controller.abort(reason)
        return Promise.reject(new Error('hook failure after abort'))
      }],
      onError: [(context) => { observedErrors.push(context.error) }],
    },
  }), (error) => {
    assert.ok(error instanceof AbortRequestError)
    assert.equal(error.cause, reason)
    assert.deepEqual(observedErrors, [error])
    return true
  })
  await new Promise((resolve) => setTimeout(resolve, 0))
})

for (const cancellation of ['timeout', 'external abort'] as const) {
  test(`${cancellation} settles a pending afterResponse hook and stops later hooks`, async () => {
    const controller = new AbortController()
    const reason = new Error('caller stopped the hook')
    let releaseHook!: () => void
    const hookGate = new Promise<void>((resolve) => { releaseHook = resolve })
    let hookStarted!: () => void
    const started = new Promise<void>((resolve) => { hookStarted = resolve })
    const observedErrors: unknown[] = []
    let laterHookRan = false
    let deadline: ReturnType<typeof setTimeout> | undefined

    await withMockedFetch(async () => new Response('ok'), async () => {
      const result = request('https://api.example.com/hook', {
        responseType: 'text',
        signal: controller.signal,
        ...(cancellation === 'timeout' ? { timeout: 10 } : {}),
        hooks: {
          afterResponse: [
            () => { hookStarted(); return hookGate },
            () => { laterHookRan = true },
          ],
          onError: [(context) => { observedErrors.push(context.error) }],
        },
      }).then(() => undefined, (error: unknown) => error)

      try {
        await started
        if (cancellation === 'external abort') {
          controller.abort(reason)
        }
        const error = await Promise.race([
          result,
          new Promise<never>((_resolve, reject) => {
            deadline = setTimeout(() => reject(new Error('request waited for the pending hook')), 250)
          }),
        ])
        if (cancellation === 'timeout') {
          assert.ok(error instanceof TimeoutError)
        } else {
          assert.ok(error instanceof AbortRequestError)
          assert.equal(error.cause, reason)
        }
        assert.deepEqual(observedErrors, [error])
      } finally {
        clearTimeout(deadline)
        // Finishing the canceled hook must not start the next hook.
        releaseHook()
        await result
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
      assert.equal(laterHookRan, false)
      assert.equal(observedErrors.length, 1)
    })
  })
}

test('a synchronously aborting response hook does not leak its rejected promise', async () => {
  const controller = new AbortController()
  const reason = new Error('stop during hook invocation')
  await withMockedFetch(async () => new Response('ok'), async () => {
    await assert.rejects(
      request('https://api.example.com/hook', {
        signal: controller.signal,
        hooks: {
          afterResponse: [() => {
            controller.abort(reason)
            return Promise.reject(new Error('hook failure after abort'))
          }],
        },
      }),
      (error) => error instanceof AbortRequestError && error.cause === reason,
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
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
test('request timeout remains authoritative during asynchronous JSON parsing', async () => {
  await withMockedFetch(
    async () => new Response('{"ok":true}'),
    async () => {
      await assert.rejects(
        () =>
          request('https://api.example.com/users', {
            timeout: 5,
            parseJson: () => new Promise(() => {}),
          }),
        (error) => error instanceof TimeoutError && error.timeout === 5,
      )
    },
  )
})

test('timeout starts after beforeRequest hooks complete', async () => {
  const originalFetch = globalThis.fetch
  let fetchCalls = 0

  globalThis.fetch = async (input) => {
    fetchCalls += 1
    const req = input as Request
    assert.equal(req.signal.aborted, false)
    return new Response(JSON.stringify({ ok: true }))
  }

  try {
    const result = await request<{ ok: boolean }>(
      'https://api.example.com/users',
      {
        timeout: 10,
        hooks: {
          beforeRequest: [
            async () => {
              await new Promise((resolve) => setTimeout(resolve, 25))
            },
          ],
        },
      },
    )

    assert.deepEqual(result, { ok: true })
    assert.equal(fetchCalls, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('timeout expiration during afterResponse hooks surfaces TimeoutError', async () => {
  const originalFetch = globalThis.fetch
  let observedError: unknown

  globalThis.fetch = async () =>
    new Response(JSON.stringify({ ok: true }))

  try {
    await assert.rejects(
      () =>
        request('https://api.example.com/users', {
          timeout: 5,
          hooks: {
            afterResponse: [
              async () => {
                await new Promise((resolve) => setTimeout(resolve, 25))
              },
            ],
            onError: [
              (context) => {
                observedError = context.error
              },
            ],
          },
        }),
      (error) => error instanceof TimeoutError && error.timeout === 5,
    )

    assert.ok(observedError instanceof TimeoutError)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('timeout aborts from afterResponse body reads are normalized', async () => {
  const originalFetch = globalThis.fetch
  let observedError: unknown

  globalThis.fetch = async (input) => {
    const request = input as Request
    const body = new ReadableStream({
      start(controller) {
        request.signal.addEventListener(
          'abort',
          () => controller.error(new DOMException('Aborted', 'AbortError')),
          { once: true },
        )
      },
    })
    return new Response(body)
  }

  try {
    await assert.rejects(
      () =>
        request('https://api.example.com/users', {
          timeout: 5,
          hooks: {
            afterResponse: [
              async (context) => {
                await context.response.text()
              },
            ],
            onError: [
              (context) => {
                observedError = context.error
              },
            ],
          },
        }),
      (error) => error instanceof TimeoutError && error.timeout === 5,
    )

    assert.ok(observedError instanceof TimeoutError)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('external aborts during afterResponse hooks stay AbortRequestError', async () => {
  const originalFetch = globalThis.fetch
  const controller = new AbortController()
  const reason = new Error('stop response inspection')
  let observedError: unknown

  globalThis.fetch = async (input) => {
    const request = input as Request
    const body = new ReadableStream({
      start(streamController) {
        request.signal.addEventListener(
          'abort',
          () => streamController.error(request.signal.reason),
          { once: true },
        )
      },
    })
    return new Response(body)
  }

  const abortId = setTimeout(() => controller.abort(reason), 5)
  try {
    await assert.rejects(
      () =>
        request('https://api.example.com/users', {
          signal: controller.signal,
          hooks: {
            afterResponse: [
              async (context) => {
                await context.response.text()
              },
            ],
            onError: [
              (context) => {
                observedError = context.error
              },
            ],
          },
        }),
      (error) =>
        error instanceof AbortRequestError &&
        error.cause === reason,
    )

    assert.ok(observedError instanceof AbortRequestError)
    assert.equal(observedError.cause, reason)
  } finally {
    clearTimeout(abortId)
    globalThis.fetch = originalFetch
  }
})

test('timeout settles before a later clearfetch error thrown by an afterResponse hook', async () => {
  const originalFetch = globalThis.fetch
  const hookError = new ConfigError('late hook failure')

  globalThis.fetch = async () =>
    new Response(JSON.stringify({ ok: true }))

  try {
    await assert.rejects(
      () =>
        request('https://api.example.com/users', {
          timeout: 5,
          hooks: {
            afterResponse: [
              async () => {
                await new Promise((resolve) => setTimeout(resolve, 25))
                throw hookError
              },
            ],
          },
        }),
      (error) =>
        error instanceof TimeoutError &&
        error.timeout === 5 &&
        error.cause instanceof DOMException &&
        error.cause.name === 'AbortError',
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('external abort classification overrides clearfetch errors thrown by afterResponse hooks', async () => {
  const originalFetch = globalThis.fetch
  const controller = new AbortController()
  const reason = new Error('stop response inspection')

  globalThis.fetch = async () =>
    new Response(JSON.stringify({ ok: true }))

  const abortId = setTimeout(() => controller.abort(reason), 5)
  try {
    await assert.rejects(
      () =>
        request('https://api.example.com/users', {
          signal: controller.signal,
          hooks: {
            afterResponse: [
              async () => {
                await new Promise((resolve) => setTimeout(resolve, 25))
                throw new ConfigError('late hook failure')
              },
            ],
          },
        }),
      (error) =>
        error instanceof AbortRequestError &&
        error.cause === reason,
    )
  } finally {
    clearTimeout(abortId)
    globalThis.fetch = originalFetch
  }
})

test('afterResponse abort classification preserves an explicit null reason', async () => {
  const originalFetch = globalThis.fetch
  const controller = new AbortController()

  globalThis.fetch = async () =>
    new Response(JSON.stringify({ ok: true }))

  const abortId = setTimeout(() => controller.abort(null), 5)
  try {
    await assert.rejects(
      () =>
        request('https://api.example.com/users', {
          signal: controller.signal,
          hooks: {
            afterResponse: [
              async () => {
                await new Promise((resolve) => setTimeout(resolve, 25))
                throw new ConfigError('late hook failure')
              },
            ],
          },
        }),
      (error) =>
        error instanceof AbortRequestError &&
        error.cause === null,
    )
  } finally {
    clearTimeout(abortId)
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

test('external abort with custom reason surfaces AbortRequestError', async () => {
  const originalFetch = globalThis.fetch
  const reason = new Error('caller stopped request')

  globalThis.fetch = async (input) =>
    new Promise((_resolve, reject) => {
      const request = input as Request
      if (request.signal.aborted) {
        reject(request.signal.reason)
        return
      }
      request.signal.addEventListener(
        'abort',
        () => reject(request.signal.reason),
        { once: true },
      )
    })

  try {
    const controller = new AbortController()
    const promise = request('https://api.example.com/users', {
      signal: controller.signal,
    })

    controller.abort(reason)

    await assert.rejects(
      () => promise,
      (error) =>
        error instanceof AbortRequestError && error.cause === reason,
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('external abort with custom object reason surfaces AbortRequestError', async () => {
  const originalFetch = globalThis.fetch
  const reason = { code: 'USER_NAVIGATED' }

  globalThis.fetch = async (input) =>
    new Promise((_resolve, reject) => {
      const request = input as Request
      if (request.signal.aborted) {
        reject(request.signal.reason)
        return
      }
      request.signal.addEventListener(
        'abort',
        () => reject(request.signal.reason),
        { once: true },
      )
    })

  try {
    const controller = new AbortController()
    const promise = request('https://api.example.com/users', {
      signal: controller.signal,
    })

    controller.abort(reason)

    await assert.rejects(
      () => promise,
      (error) =>
        error instanceof AbortRequestError && error.cause === reason,
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('external abort during response body parsing preserves custom cause', async () => {
  const originalFetch = globalThis.fetch
  const reason = { code: 'USER_NAVIGATED' }

  globalThis.fetch = async (input) => {
    const request = input as Request

    return new Response(
      new ReadableStream({
        start(controller) {
          request.signal.addEventListener(
            'abort',
            () => {
              controller.error(new DOMException('Read aborted', 'AbortError'))
            },
            { once: true },
          )
        },
      }),
    )
  }

  try {
    const controller = new AbortController()
    const promise = request('https://api.example.com/users', {
      responseType: 'text',
      signal: controller.signal,
    })

    setTimeout(() => {
      controller.abort(reason)
    }, 1)

    await assert.rejects(
      () => promise,
      (error) =>
        error instanceof AbortRequestError && error.cause === reason,
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('external abort wins over later timeout classification', async () => {
  const originalFetch = globalThis.fetch
  const reason = new Error('caller stopped before timeout')

  globalThis.fetch = async (input) =>
    new Promise((_resolve, reject) => {
      const request = input as Request
      request.signal.addEventListener(
        'abort',
        () => {
          setTimeout(() => reject(request.signal.reason), 30)
        },
        { once: true },
      )
    })

  try {
    const controller = new AbortController()
    const promise = request('https://api.example.com/users', {
      signal: controller.signal,
      timeout: 10,
    })

    setTimeout(() => {
      controller.abort(reason)
    }, 1)

    await assert.rejects(
      () => promise,
      (error) =>
        error instanceof AbortRequestError && error.cause === reason,
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('retry backoff does not consume per-attempt timeout windows', async () => {
  const originalFetch = globalThis.fetch
  let attempts = 0

  globalThis.fetch = async () => {
    attempts += 1
    if (attempts === 1) {
      throw new TypeError('fetch failed')
    }
    return new Response(JSON.stringify({ ok: true }))
  }

  try {
    const result = await request<{ ok: boolean }>('https://api.example.com/users', {
      timeout: 5,
      retry: {
        attempts: 2,
        backoffMs: 25,
        maxBackoffMs: 25,
        multiplier: 1,
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

test('abort during HTTP retry backoff stops promptly with AbortRequestError', async () => {
  const originalFetch = globalThis.fetch
  const controller = new AbortController()
  const observedErrors: unknown[] = []
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
      hooks: {
        onError: [
          (context) => {
            observedErrors.push(context.error)
          },
        ],
      },
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
    assert.equal(observedErrors.length, 1)
    assert.ok(observedErrors[0] instanceof AbortRequestError)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('abort during retry backoff stops promptly with AbortRequestError', async () => {
  const originalFetch = globalThis.fetch
  const observedErrors: unknown[] = []
  let attempts = 0
  let signalFirstAttempt: (() => void) | undefined
  const firstAttempt = new Promise<void>((resolve) => {
    signalFirstAttempt = resolve
  })

  globalThis.fetch = async () => {
    attempts += 1
    signalFirstAttempt?.()
    throw new TypeError('fetch failed')
  }

  try {
    const controller = new AbortController()
    const promise = request('https://api.example.com/users', {
      signal: controller.signal,
      hooks: {
        onError: [
          (context) => {
            observedErrors.push(context.error)
          },
        ],
      },
      retry: {
        attempts: 3,
        backoffMs: 500,
        maxBackoffMs: 500,
        multiplier: 1,
        retryOnStatuses: [503],
        retryOnMethods: ['GET'],
      },
    })

    await firstAttempt
    controller.abort()

    await assert.rejects(
      () => promise,
      (error) => error instanceof AbortRequestError,
    )

    assert.equal(attempts, 1)
    assert.equal(observedErrors.length, 1)
    assert.ok(observedErrors[0] instanceof AbortRequestError)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('custom abort reason during retry backoff surfaces AbortRequestError', async () => {
  const originalFetch = globalThis.fetch
  const reason = new Error('caller stopped retrying')
  let attempts = 0

  globalThis.fetch = async () => {
    attempts += 1
    throw new TypeError('fetch failed')
  }

  try {
    const controller = new AbortController()

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
      controller.abort(reason)
    }, 25)

    await assert.rejects(
      () => promise,
      (error) =>
        error instanceof AbortRequestError && error.cause === reason,
    )

    assert.equal(attempts, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})
