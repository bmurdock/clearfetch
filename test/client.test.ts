import assert from 'node:assert/strict'
import test from 'node:test'

import { HttpError } from '../src/errors.js'
import { createClient } from '../src/index.js'
import { request } from '../src/request.js'

test('request parses json responses', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ ok: true }), {
      headers: {
        'Content-Type': 'application/json',
      },
    })

  try {
    const result = await request<{ ok: boolean }>('https://api.example.com/users')
    assert.deepEqual(result, { ok: true })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('createClient resolves baseURL and extend merges headers', async () => {
  const originalFetch = globalThis.fetch
  const requests: Request[] = []

  globalThis.fetch = async (request) => {
    requests.push(request as Request)
    return new Response(JSON.stringify({ ok: true }))
  }

  try {
    const client = createClient({
      baseURL: 'https://api.example.com',
      headers: {
        Accept: 'application/json',
      },
    })

    const authed = client.extend({
      headers: {
        Authorization: 'Bearer token',
      },
    })

    await authed.get('/users')

    assert.equal(requests[0]?.url, 'https://api.example.com/users')
    assert.equal(requests[0]?.headers.get('accept'), 'application/json')
    assert.equal(requests[0]?.headers.get('authorization'), 'Bearer token')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('request throws HttpError for non-2xx responses', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () =>
    new Response('missing', {
      status: 404,
      statusText: 'Not Found',
    })

  try {
    await assert.rejects(
      () => request('https://api.example.com/users'),
      (error) => error instanceof HttpError && error.status === 404,
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})
