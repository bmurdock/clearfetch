import assert from 'node:assert/strict'
import test from 'node:test'

import {
  mergeClientDefaults,
  snapshotClientDefaults,
} from '../src/internal/client-defaults.js'
import type {
  AfterResponseHook,
  BeforeRequestHook,
  OnErrorHook,
  RequestMethod,
} from '../src/types.js'

test('snapshotClientDefaults copies mutable default inputs', () => {
  const baseURL = new URL('https://api.example.com/v1/')
  const headers = new Headers({
    Accept: 'application/json',
  })
  const beforeRequest: BeforeRequestHook = (context) => {
    context.headers.set('x-before', 'original')
  }
  const afterResponse: AfterResponseHook = () => {}
  const onError: OnErrorHook = () => {}
  const hooks = {
    beforeRequest: [beforeRequest],
    afterResponse: [afterResponse],
    onError: [onError],
  }
  const retry = {
    attempts: 2,
    retryOnStatuses: [503],
    retryOnMethods: ['GET'] as RequestMethod[],
  }

  const snapshot = snapshotClientDefaults({
    baseURL,
    headers,
    hooks,
    retry,
  })

  baseURL.pathname = '/mutated/'
  headers.set('Accept', 'text/plain')
  hooks.beforeRequest[0] = (context) => {
    context.headers.set('x-before', 'mutated')
  }
  hooks.afterResponse.push(() => {})
  hooks.onError.push(() => {})
  retry.retryOnStatuses[0] = 500
  retry.retryOnMethods[0] = 'POST'

  assert.equal(String(snapshot.baseURL), 'https://api.example.com/v1/')
  assert.equal(new Headers(snapshot.headers).get('accept'), 'application/json')
  assert.equal(snapshot.hooks?.beforeRequest?.[0], beforeRequest)
  assert.deepEqual(snapshot.hooks?.afterResponse, [afterResponse])
  assert.deepEqual(snapshot.hooks?.onError, [onError])
  assert.deepEqual(
    snapshot.retry !== false ? snapshot.retry?.retryOnStatuses : undefined,
    [503],
  )
  assert.deepEqual(
    snapshot.retry !== false ? snapshot.retry?.retryOnMethods : undefined,
    ['GET'],
  )
})

test('snapshotClientDefaults preserves property insertion order', () => {
  const snapshot = snapshotClientDefaults({
    baseURL: 'https://api.example.com',
    headers: {
      Accept: 'application/json',
    },
    timeout: 1000,
    responseType: 'json',
    retry: {
      attempts: 2,
    },
    hooks: {
      beforeRequest: [() => {}],
    },
    parseJson: JSON.parse,
  })

  assert.deepEqual(Object.keys(snapshot), [
    'baseURL',
    'headers',
    'timeout',
    'responseType',
    'retry',
    'hooks',
    'parseJson',
  ])
})

test('mergeClientDefaults lets child scalar defaults override parent defaults', () => {
  const parentParser = (text: string) => ({ parent: text })
  const childParser = (text: string) => ({ text })

  const merged = mergeClientDefaults(
    {
      baseURL: 'https://parent.example.com',
      timeout: 1000,
      responseType: 'json',
      parseJson: parentParser,
    },
    {
      baseURL: 'https://child.example.com',
      timeout: 2000,
      responseType: 'text',
      parseJson: childParser,
    },
  )

  assert.equal(merged.baseURL, 'https://child.example.com')
  assert.equal(merged.timeout, 2000)
  assert.equal(merged.responseType, 'text')
  assert.deepEqual(merged.parseJson?.('ok'), { text: 'ok' })
})

test('mergeClientDefaults merges headers and appends hooks parent then child', () => {
  const parentBefore: BeforeRequestHook = () => {}
  const childBefore: BeforeRequestHook = () => {}
  const parentAfter: AfterResponseHook = () => {}
  const childAfter: AfterResponseHook = () => {}
  const parentError: OnErrorHook = () => {}
  const childError: OnErrorHook = () => {}

  const merged = mergeClientDefaults(
    {
      headers: {
        Accept: 'application/json',
        'X-Shared': 'parent',
      },
      hooks: {
        beforeRequest: [parentBefore],
        afterResponse: [parentAfter],
        onError: [parentError],
      },
    },
    {
      headers: {
        'X-Child': 'child',
        'X-Shared': 'child',
      },
      hooks: {
        beforeRequest: [childBefore],
        afterResponse: [childAfter],
        onError: [childError],
      },
    },
  )

  const headers = new Headers(merged.headers)
  assert.equal(headers.get('accept'), 'application/json')
  assert.equal(headers.get('x-child'), 'child')
  assert.equal(headers.get('x-shared'), 'child')
  assert.deepEqual(merged.hooks?.beforeRequest, [parentBefore, childBefore])
  assert.deepEqual(merged.hooks?.afterResponse, [parentAfter, childAfter])
  assert.deepEqual(merged.hooks?.onError, [parentError, childError])
})
