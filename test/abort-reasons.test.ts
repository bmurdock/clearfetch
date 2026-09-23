import assert from 'node:assert/strict'
import test from 'node:test'

import {
  AbortRequestError,
  ConfigError,
  NetworkError,
  TimeoutError,
  request,
} from '../src/index.js'
import { normalizeExecutionError } from '../src/internal/normalize-error.js'
import { withMockedFetch } from './helpers/mock-fetch.js'

for (const reason of [
  new ConfigError('dependent operation was misconfigured'),
  new NetworkError('dependent operation failed'),
  new TimeoutError(100),
]) {
  for (const phase of ['fetch', 'parser', 'backoff'] as const) {
    test(`${reason.name} abort reason stays cancellation during ${phase}`, {
      timeout: 2_000,
    }, async () => {
      const controller = new AbortController()
      const observed: unknown[] = []
      const options = {
        signal: controller.signal,
        hooks: { onError: [({ error }: { error: unknown }) => { observed.push(error) }] },
      }
      const assertCancellation = async (result: Promise<unknown>) => {
        await assert.rejects(result, (error) => {
          assert.ok(error instanceof AbortRequestError)
          assert.equal(error.cause, reason)
          assert.deepEqual(observed, [error])
          return true
        })
      }

      if (phase === 'fetch') {
        controller.abort(reason)
        // Native fetch rejects with the original reason even before dispatch.
        await assertCancellation(request('data:application/json,{}', options))
      } else if (phase === 'parser') {
        let parserStarted!: () => void
        const started = new Promise<void>((resolve) => { parserStarted = resolve })
        let finishParser!: () => void
        const pendingParser = new Promise<void>((resolve) => { finishParser = resolve })
        const result = request('data:application/json,{}', {
          ...options,
          parseJson: () => { parserStarted(); return pendingParser },
        })
        try {
          await started
          controller.abort(reason)
          await assertCancellation(result)
        } finally {
          finishParser()
        }
      } else {
        let attempts = 0
        let abortId: ReturnType<typeof setTimeout> | undefined
        await withMockedFetch(async () => {
          attempts += 1
          // Run after the rejection has entered the retry-backoff wait.
          abortId = setTimeout(() => controller.abort(reason), 0)
          throw new TypeError('fetch failed')
        }, async () => {
          try {
            await assertCancellation(request('https://api.example.com', {
              ...options,
              retry: { attempts: 2, backoffMs: 1_000 },
            }))
            assert.equal(attempts, 1)
          } finally {
            clearTimeout(abortId)
          }
        })
      }
    })
  }
}

test('error normalization preserves library errors unless cancellation is established', () => {
  const original = new ConfigError('bad configuration')
  assert.equal(normalizeExecutionError({ error: original }), original)
  const timedOut = normalizeExecutionError({
    error: original,
    aborted: true,
    timeout: 50,
  })
  assert.ok(timedOut instanceof TimeoutError)
  assert.equal(timedOut.timeout, 50)
  assert.equal(timedOut.cause, original)
})
