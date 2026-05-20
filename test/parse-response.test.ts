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

test('parseResponse truncates large HttpError body text', async () => {
  const response = new Response('x'.repeat(20_000), {
    status: 500,
    statusText: 'Internal Server Error',
  })

  await assert.rejects(
    () =>
      parseResponse({
        response,
        responseType: 'text',
        parseJson: JSON.parse,
      }),
    (error) =>
      error instanceof HttpError &&
      typeof error.bodyText === 'string' &&
      error.bodyText.length < 20_000 &&
      error.bodyText.endsWith('...[truncated]'),
  )
})

test('parseResponse caps decoded HttpError body chunks before retaining text', async () => {
  const originalTextDecoder = globalThis.TextDecoder
  let maxDecodedBytes = 0

  const TestTextDecoder = class {
    decode(input?: ArrayBuffer | ArrayBufferView | null): string {
      const byteLength = input === undefined || input === null
        ? 0
        : input.byteLength
      maxDecodedBytes = Math.max(maxDecodedBytes, byteLength)

      return 'x'.repeat(byteLength)
    }
  } as unknown as typeof TextDecoder

  Object.defineProperty(globalThis, 'TextDecoder', {
    configurable: true,
    value: TestTextDecoder,
    writable: true,
  })

  const response = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(20_000))
      },
    }),
    {
      status: 500,
      statusText: 'Internal Server Error',
    },
  )

  try {
    await assert.rejects(
      () =>
        parseResponse({
          response,
          responseType: 'text',
          parseJson: JSON.parse,
        }),
      (error) =>
        error instanceof HttpError &&
        typeof error.bodyText === 'string' &&
        error.bodyText.endsWith('...[truncated]'),
    )

    assert.ok(maxDecodedBytes < 20_000)
  } finally {
    Object.defineProperty(globalThis, 'TextDecoder', {
      configurable: true,
      value: originalTextDecoder,
      writable: true,
    })
  }
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

test('normalizeExecutionError preserves explicit abort reason as cause', () => {
  const reason = { code: 'USER_NAVIGATED' }
  const error = normalizeExecutionError({
    aborted: true,
    abortReason: reason,
    error: new DOMException('Aborted', 'AbortError'),
  })

  assert.ok(error instanceof AbortRequestError)
  assert.equal(error.cause, reason)
})

test('normalizeExecutionError maps unknown failures to NetworkError', () => {
  const error = normalizeExecutionError({
    error: new TypeError('fetch failed'),
  })

  assert.ok(error instanceof NetworkError)
})

test('normalizeExecutionError recognizes abort-shaped errors across realms', () => {
  const error = normalizeExecutionError({
    error: {
      name: 'AbortError',
      message: 'Request aborted',
    },
  })

  assert.ok(error instanceof AbortRequestError)
})
