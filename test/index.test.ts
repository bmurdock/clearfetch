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
    'request',
  ])
})
