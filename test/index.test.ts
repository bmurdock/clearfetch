import assert from 'node:assert/strict'
import test from 'node:test'

import * as clearfetch from '../src/index.js'

test('package entrypoint loads', () => {
  assert.equal(typeof clearfetch, 'object')
  assert.deepEqual(Object.keys(clearfetch).sort(), [
    'AbortRequestError',
    'ConfigError',
    'HttpClientError',
    'HttpError',
    'NetworkError',
    'ParseError',
    'TimeoutError',
    'createClient',
    'isHttpClientError',
    'isHttpError',
    'request',
  ])
})

test('error type guards narrow clearfetch errors', () => {
  const httpError = new clearfetch.HttpError({
    status: 404,
    statusText: 'Not Found',
    response: new Response('missing', { status: 404, statusText: 'Not Found' }),
  })

  assert.equal(clearfetch.isHttpClientError(httpError), true)
  assert.equal(clearfetch.isHttpError(httpError), true)
  assert.equal(clearfetch.isHttpClientError(new Error('nope')), false)
  assert.equal(clearfetch.isHttpError(new Error('nope')), false)
})
