import assert from 'node:assert/strict'
import test from 'node:test'

import { ConfigError, HttpError, NetworkError } from '../src/errors.js'
import { createClient } from '../src/index.js'
import { request } from '../src/request.js'

test('public request surfaces reject invalid option containers', async () => {
  const client = createClient()

  await assert.rejects(
    () => request('https://api.example.com/users', null as never),
    (error) =>
      error instanceof ConfigError &&
      error.message === '`options` must be an object',
  )
  await assert.rejects(
    () => client.request('https://api.example.com/users', null as never),
    (error) =>
      error instanceof ConfigError &&
      error.message === '`options` must be an object',
  )
  await assert.rejects(
    () => client.get('https://api.example.com/users', null as never),
    (error) =>
      error instanceof ConfigError &&
      error.message === '`options` must be an object',
  )
})

test('createClient rejects invalid defaults during construction', () => {
  assert.throws(
    () => createClient({ timeout: -1 }),
    (error) =>
      error instanceof ConfigError &&
      error.message === '`timeout` must be a non-negative finite number',
  )

  assert.throws(
    () => createClient({ responseType: 'xml' as never }),
    (error) =>
      error instanceof ConfigError &&
      error.message === 'Unsupported responseType: xml',
  )

  assert.throws(
    () => createClient({ baseURL: 'not a URL' }),
    (error) =>
      error instanceof ConfigError &&
      error.message === '`baseURL` must be a string or URL',
  )
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
    const result = await request('https://api.example.com/text', {
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
    const result = await request('https://api.example.com/binary', {
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
    const result = await request('https://api.example.com/blob', {
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

test('createClient snapshots defaults against later external mutation', async () => {
  const originalFetch = globalThis.fetch
  const requests: Request[] = []
  const defaultHeaders = new Headers({
    Accept: 'application/json',
  })
  const beforeRequestHooks = [
    (context: { headers: Headers }) => {
      context.headers.set('x-from-hook', 'original')
    },
  ]
  const defaults = {
    baseURL: 'https://api.example.com',
    headers: defaultHeaders,
    hooks: {
      beforeRequest: beforeRequestHooks,
    },
  }

  globalThis.fetch = async (input) => {
    requests.push(input as Request)
    return new Response(JSON.stringify({ ok: true }))
  }

  try {
    const client = createClient(defaults)

    defaults.baseURL = 'https://mutated.example.com'
    defaultHeaders.set('Accept', 'text/plain')
    beforeRequestHooks[0] = (context: { headers: Headers }) => {
      context.headers.set('x-from-hook', 'mutated')
    }

    await client.get('/users')

    assert.equal(requests[0]?.url, 'https://api.example.com/users')
    assert.equal(requests[0]?.headers.get('accept'), 'application/json')
    assert.equal(requests[0]?.headers.get('x-from-hook'), 'original')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('clients scope sensitive headers to the base origin after URL resolution and hooks', async () => {
  const originalFetch = globalThis.fetch
  const requests: Request[] = []
  let retryAttempts = 0
  globalThis.fetch = async (input) => {
    const outgoing = input as Request
    requests.push(outgoing)
    const retry = new URL(outgoing.url).pathname === '/retry' && ++retryAttempts === 1
    return new Response(null, { status: retry ? 503 : 204 })
  }

  const sensitiveHeaders = {
    Authorization: 'Bearer fixture',
    Cookie: 'session=fixture',
    'Set-Cookie': 'session=fixture',
    'Proxy-Authorization': 'Basic fixture',
    'X-API-Key': 'fixture',
    'Api-Key': 'fixture',
  }
  const client = createClient({
    baseURL: 'https://api.example.com',
    headers: { ...sensitiveHeaders, Accept: 'application/json' },
  })

  try {
    await client.get('/items')
    await client.get('https://api.example.com:443/items')
    await client.get('//other.example.com/items')
    await client.get('https://api.example.com:8443/items')
    await client.get('https://other.example.com/items', {
      headers: { Authorization: 'Bearer explicit' },
    })
    await client.extend({
      hooks: { beforeRequest: [({ headers }) => { headers.set('X-API-Key', 'hook') }] },
    }).get('/items', {
      hooks: { beforeRequest: [(context) => {
        context.url = new URL('https://other.example.com/items')
      }] },
    })
    await client.get('https://other.example.com/items', {
      hooks: { beforeRequest: [(context) => {
        context.url = new URL('https://api.example.com/items')
      }] },
    })
    await request('https://other.example.com/items', { headers: sensitiveHeaders })
    await client.get('https://other.example.com/retry', {
      retry: { attempts: 2, backoffMs: 0 },
    })

    const expected = [
      { origin: 'https://api.example.com', credentials: true, accept: 'application/json' },
      { origin: 'https://api.example.com', credentials: true, accept: 'application/json' },
      { origin: 'https://other.example.com', credentials: false, accept: 'application/json' },
      { origin: 'https://api.example.com:8443', credentials: false, accept: 'application/json' },
      { origin: 'https://other.example.com', credentials: false, accept: 'application/json' },
      { origin: 'https://other.example.com', credentials: false, accept: 'application/json' },
      { origin: 'https://api.example.com', credentials: true, accept: 'application/json' },
      { origin: 'https://other.example.com', credentials: true, accept: null },
      { origin: 'https://other.example.com', credentials: false, accept: 'application/json' },
      { origin: 'https://other.example.com', credentials: false, accept: 'application/json' },
    ]
    assert.deepEqual(requests.map((outgoing) => {
      const credentials = outgoing.headers.has('authorization')
      for (const name of Object.keys(sensitiveHeaders)) {
        assert.equal(outgoing.headers.has(name), credentials, name)
      }
      return {
        origin: new URL(outgoing.url).origin,
        credentials,
        accept: outgoing.headers.get('accept'),
      }
    }), expected)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('method helpers preserve prototype-backed and non-enumerable options', async () => {
  class TextOptions {
    get responseType(): 'text' { return 'text' }
    get method(): 'HEAD' { throw new Error('helper method is authoritative') }
  }

  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input) => {
    const outgoing = input as Request
    assert.equal(outgoing.method, 'GET')
    assert.equal(outgoing.headers.get('x-fixture'), 'enabled')
    return new Response('"fixture"')
  }
  try {
    const options = new TextOptions()
    Object.defineProperty(options, 'headers', { value: { 'x-fixture': 'enabled' } })
    assert.equal(await createClient().get('https://api.example.com/items', options), '"fixture"')
  } finally {
    globalThis.fetch = originalFetch
  }
})
