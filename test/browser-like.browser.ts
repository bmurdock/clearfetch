import assert from 'node:assert/strict'
import test from 'node:test'

import { Window } from 'happy-dom'

import { ConfigError } from '../src/errors.js'
import { createClient } from '../src/index.js'
import { createBeforeRequestContext } from '../src/internal/normalize-request.js'

test('public API works in a browser-like environment', async () => {
  const window = new Window()

  const originalGlobals = {
    AbortController: globalThis.AbortController,
    DOMException: globalThis.DOMException,
    Headers: globalThis.Headers,
    Request: globalThis.Request,
    Response: globalThis.Response,
    URL: globalThis.URL,
    fetch: globalThis.fetch,
  }

  Object.assign(globalThis, {
    AbortController: window.AbortController,
    DOMException: window.DOMException,
    Headers: window.Headers,
    Request: window.Request,
    Response: window.Response,
    URL: window.URL,
    fetch: async (input: RequestInfo | URL) => {
      const request = input as Request
      return new window.Response(
        JSON.stringify({
          ok: true,
          url: request.url,
        }),
        {
          headers: {
            'Content-Type': 'application/json',
          },
        },
      )
    },
  })

  try {
    const client = createClient({
      baseURL: 'https://api.example.com',
    })

    const result = await client.get<{ ok: boolean; url: string }>('/users')

    assert.deepEqual(result, {
      ok: true,
      url: 'https://api.example.com/users',
    })
  } finally {
    Object.assign(globalThis, originalGlobals)
    window.close()
  }
})

test('retry snapshots FormData bodies created in another realm', () => {
  const window = new Window()

  try {
    const foreignBody = new window.FormData()
    foreignBody.append('value', 'original')
    const body = foreignBody as unknown as FormData

    const context = createBeforeRequestContext(
      'https://api.example.com/users',
      {},
      {
        method: 'POST',
        body,
        retry: {
          attempts: 2,
          retryOnMethods: ['POST'],
        },
      },
    )

    assert.notEqual(context.hookContext.body, body)
    foreignBody.append('value', 'mutated')
    assert.deepEqual(
      [...FormData.prototype.entries.call(context.hookContext.body as FormData)],
      [['value', 'original']],
    )
  } finally {
    window.close()
  }
})

test('retry rejects uncloneable foreign FormData files', () => {
  const window = new Window()

  try {
    const body = new window.FormData()
    body.append(
      'file',
      new window.File(['ABC'], 'example.txt', { type: 'text/plain' }),
    )

    assert.throws(
      () =>
        createBeforeRequestContext(
          'https://api.example.com/users',
          {},
          {
            method: 'POST',
            body: body as unknown as FormData,
            retry: {
              attempts: 2,
              retryOnMethods: ['POST'],
            },
          },
        ),
      (error) =>
        error instanceof ConfigError &&
        error.message ===
          'Retry is not supported for FormData files that cannot be cloned safely',
    )
  } finally {
    window.close()
  }
})
