import assert from 'node:assert/strict'
import test from 'node:test'

import { HttpError, NetworkError } from '../src/errors.js'
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

test('request returns text responses when responseType is text', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response('plain text response')

  try {
    const result = await request<string>('https://api.example.com/text', {
      responseType: 'text',
    })

    assert.equal(result, 'plain text response')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('request returns arrayBuffer responses when responseType is arrayBuffer', async () => {
  const originalFetch = globalThis.fetch
  const expected = new Uint8Array([1, 2, 3, 4])

  globalThis.fetch = async () =>
    new Response(expected, {
      headers: {
        'Content-Type': 'application/octet-stream',
      },
    })

  try {
    const result = await request<ArrayBuffer>('https://api.example.com/binary', {
      responseType: 'arrayBuffer',
    })

    assert.ok(result instanceof ArrayBuffer)
    assert.deepEqual(Array.from(new Uint8Array(result)), [1, 2, 3, 4])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('request returns blob responses when responseType is blob', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () =>
    new Response('blob-body', {
      headers: {
        'Content-Type': 'text/plain',
      },
    })

  try {
    const result = await request<Blob>('https://api.example.com/blob', {
      responseType: 'blob',
    })

    assert.ok(result instanceof Blob)
    assert.equal(await result.text(), 'blob-body')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('request normalizes fetch rejections to NetworkError', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => {
    throw new TypeError('fetch failed')
  }

  try {
    await assert.rejects(
      () => request('https://api.example.com/fail'),
      (error) => error instanceof NetworkError,
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('request defaults to json response parsing', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ defaulted: true }), {
      headers: {
        'Content-Type': 'application/json',
      },
    })

  try {
    const result = await request<{ defaulted: boolean }>(
      'https://api.example.com/default-json',
    )

    assert.deepEqual(result, { defaulted: true })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('request-level headers override client defaults on collisions', async () => {
  const originalFetch = globalThis.fetch
  const requests: Request[] = []

  globalThis.fetch = async (input) => {
    requests.push(input as Request)
    return new Response(JSON.stringify({ ok: true }))
  }

  try {
    const client = createClient({
      headers: {
        Accept: 'application/json',
        'X-Trace': 'client',
      },
    })

    await client.get('https://api.example.com/users', {
      headers: {
        Accept: 'text/plain',
      },
    })

    assert.equal(requests[0]?.headers.get('accept'), 'text/plain')
    assert.equal(requests[0]?.headers.get('x-trace'), 'client')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('extend preserves parent defaults unless child overrides them', async () => {
  const originalFetch = globalThis.fetch
  const requests: Request[] = []

  globalThis.fetch = async (input) => {
    requests.push(input as Request)
    return new Response('child text response')
  }

  try {
    const client = createClient({
      baseURL: 'https://api.example.com',
      responseType: 'text',
      headers: {
        Accept: 'text/plain',
        'X-Parent': 'parent',
      },
    })

    const child = client.extend({
      headers: {
        'X-Child': 'child',
      },
    })

    const result = await child.get<string>('/users')

    assert.equal(result, 'child text response')
    assert.equal(requests[0]?.url, 'https://api.example.com/users')
    assert.equal(requests[0]?.headers.get('accept'), 'text/plain')
    assert.equal(requests[0]?.headers.get('x-parent'), 'parent')
    assert.equal(requests[0]?.headers.get('x-child'), 'child')
  } finally {
    globalThis.fetch = originalFetch
  }
})
