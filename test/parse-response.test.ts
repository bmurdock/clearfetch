import assert from 'node:assert/strict'
import test from 'node:test'

import {
  AbortRequestError,
  HttpError,
  NetworkError,
  ParseError,
  TimeoutError,
} from '../src/errors.js'
import { normalizeExecutionError } from '../src/internal/normalize-error.js'
import { parseResponse } from '../src/internal/parse-response.js'

test('parseResponse returns undefined for empty json bodies', async () => {
  const response = new Response(null, { status: 204 })

  const result = await parseResponse({
    response,
    responseType: 'json',
    parseJson: JSON.parse,
  })

  assert.equal(result, undefined)
})

test('parseResponse throws ParseError for invalid non-empty json', async () => {
  const response = new Response('{', {
    headers: {
      'Content-Type': 'application/json',
    },
  })

  await assert.rejects(
    () =>
      parseResponse({
        response,
        responseType: 'json',
        parseJson: JSON.parse,
      }),
    (error) =>
      error instanceof ParseError &&
      error.bodyText === '{' &&
      error.responseType === 'json',
  )
})

test('parseResponse throws HttpError for non-2xx responses', async () => {
  const request = new Request('https://api.example.com/users')
  const response = new Response('missing', {
    status: 404,
    statusText: 'Not Found',
  })

  await assert.rejects(
    () =>
      parseResponse({
        request,
        response,
        responseType: 'text',
        parseJson: JSON.parse,
      }),
    (error) =>
      error instanceof HttpError &&
      error.status === 404 &&
      error.bodyText === 'missing',
  )
})

test('normalizeExecutionError maps aborts to TimeoutError when timeout is present', () => {
  const error = normalizeExecutionError({
    error: new DOMException('Aborted', 'AbortError'),
    timeout: 500,
  })

  assert.ok(error instanceof TimeoutError)
})

test('normalizeExecutionError maps aborts to AbortRequestError without timeout', () => {
  const error = normalizeExecutionError({
    error: new DOMException('Aborted', 'AbortError'),
  })

  assert.ok(error instanceof AbortRequestError)
})

test('normalizeExecutionError maps unknown failures to NetworkError', () => {
  const error = normalizeExecutionError({
    error: new TypeError('fetch failed'),
  })

  assert.ok(error instanceof NetworkError)
})
