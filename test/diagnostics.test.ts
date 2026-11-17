import assert from 'node:assert/strict'
import test from 'node:test'

import { redactHeaders } from '../src/index.js'

test('redactHeaders redacts common sensitive headers case-insensitively', () => {
  const redacted = redactHeaders({
    Authorization: 'Bearer secret',
    Cookie: 'session=secret',
    'Set-Cookie': 'session=secret',
    'Proxy-Authorization': 'Basic secret',
    'X-API-Key': 'secret',
    'Api-Key': 'secret',
    Accept: 'application/json',
  })

  assert.equal(redacted.get('authorization'), '[redacted]')
  assert.equal(redacted.get('cookie'), '[redacted]')
  assert.equal(redacted.get('set-cookie'), '[redacted]')
  assert.equal(redacted.get('proxy-authorization'), '[redacted]')
  assert.equal(redacted.get('x-api-key'), '[redacted]')
  assert.equal(redacted.get('api-key'), '[redacted]')
  assert.equal(redacted.get('accept'), 'application/json')
})

test('redactHeaders returns a copy and supports custom redaction options', () => {
  const source = new Headers({
    authorization: 'Bearer secret',
    cookie: 'session=secret',
    'x-secret-token': 'secret',
    accept: 'application/json',
  })

  const redacted = redactHeaders(source, {
    headerNames: ['x-secret-token'],
    replacement: '<hidden>',
  })

  assert.equal(source.get('x-secret-token'), 'secret')
  assert.equal(source.get('authorization'), 'Bearer secret')
  assert.equal(redacted.get('x-secret-token'), '<hidden>')
  assert.equal(redacted.get('authorization'), '<hidden>')
  assert.equal(redacted.get('cookie'), '<hidden>')
  assert.equal(redacted.get('accept'), 'application/json')
})
