import assert from 'node:assert/strict'
import test from 'node:test'

import { Window } from 'happy-dom'

import { createClient } from '../src/index.js'

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
