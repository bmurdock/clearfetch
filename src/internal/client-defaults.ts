import { ConfigError } from '../errors.js'
import type {
  ClientDefaults,
  Hooks,
  RetryOptions,
} from '../types.js'
import {
  mergeHooks,
  normalizeAfterResponseHooks,
  normalizeBeforeRequestHooks,
  normalizeOnErrorHooks,
} from './hooks.js'
import {
  normalizeParseJson,
  normalizeResponseType,
  normalizeTimeout,
  toAbsoluteURL,
} from './normalize-request.js'
import { normalizeRetry } from './retry-policy.js'

export function mergeClientDefaults(
  parent: ClientDefaults,
  child: ClientDefaults,
): ClientDefaults {
  validateNullDefaultValues(child)
  const merged: ClientDefaults = {}

  mergeScalarDefaults(merged, parent, child)
  mergeHeaderDefaults(merged, parent, child)
  mergeHookDefaults(merged, parent, child)

  return merged
}

function validateNullDefaultValues(defaults: ClientDefaults): void {
  if (
    typeof defaults !== 'object' ||
    defaults === null ||
    Array.isArray(defaults)
  ) {
    throw new ConfigError('`defaults` must be an object')
  }

  const values = defaults as Record<string, unknown>

  if (values.baseURL === null) {
    throw new ConfigError('`baseURL` must be a string or URL')
  }
  if (values.headers === null) {
    throw new ConfigError('`headers` must not be null')
  }
  if (values.timeout === null) {
    throw new ConfigError('`timeout` must be a non-negative finite number')
  }
  if (values.responseType === null) {
    throw new ConfigError('Unsupported responseType: null')
  }
  if (values.retry === null) {
    throw new ConfigError('`retry` must be false or an object')
  }
  if (values.hooks === null) {
    throw new ConfigError('`hooks` must be an object')
  }
  if (values.parseJson === null) {
    throw new ConfigError('`parseJson` must be a function')
  }
}

export function snapshotClientDefaults(defaults: ClientDefaults): ClientDefaults {
  validateNullDefaultValues(defaults)
  const snapshot: ClientDefaults = {}

  snapshotBaseURL(snapshot, defaults)
  snapshotHeaders(snapshot, defaults)
  snapshotScalarDefaults(snapshot, defaults)
  snapshotRetryDefaults(snapshot, defaults)
  snapshotHookDefaults(snapshot, defaults)
  snapshotParseJsonDefault(snapshot, defaults)

  return snapshot
}

function mergeScalarDefaults(
  merged: ClientDefaults,
  parent: ClientDefaults,
  child: ClientDefaults,
): void {
  const baseURL = child.baseURL ?? parent.baseURL
  if (baseURL !== undefined) {
    merged.baseURL = baseURL
  }

  const timeout = child.timeout ?? parent.timeout
  if (timeout !== undefined) {
    merged.timeout = timeout
  }

  const responseType = child.responseType ?? parent.responseType
  if (responseType !== undefined) {
    merged.responseType = responseType
  }

  const retry = child.retry ?? parent.retry
  if (retry !== undefined) {
    merged.retry = retry
  }

  const parseJson = child.parseJson ?? parent.parseJson
  if (parseJson !== undefined) {
    merged.parseJson = parseJson
  }
}

function mergeHeaderDefaults(
  merged: ClientDefaults,
  parent: ClientDefaults,
  child: ClientDefaults,
): void {
  const headers = createHeaders(parent.headers)
  const childHeaders = createHeaders(child.headers)
  for (const [key, value] of childHeaders.entries()) {
    headers.set(key, value)
  }
  if ([...headers.keys()].length > 0) {
    merged.headers = headers
  }
}

function mergeHookDefaults(
  merged: ClientDefaults,
  parent: ClientDefaults,
  child: ClientDefaults,
): void {
  const hooks = mergeHooks(parent.hooks, child.hooks)

  if (hooks.beforeRequest.length + hooks.afterResponse.length + hooks.onError.length > 0) {
    merged.hooks = hooks
  }
}

function snapshotBaseURL(
  snapshot: ClientDefaults,
  defaults: ClientDefaults,
): void {
  if (defaults.baseURL === undefined) {
    return
  }

  if (typeof defaults.baseURL === 'string') {
    toAbsoluteURL(defaults.baseURL, '`baseURL` must be a string or URL')
    snapshot.baseURL = defaults.baseURL
    return
  }

  snapshot.baseURL = toAbsoluteURL(
    defaults.baseURL,
    '`baseURL` must be a string or URL',
  )
}

function snapshotHeaders(
  snapshot: ClientDefaults,
  defaults: ClientDefaults,
): void {
  if (defaults.headers !== undefined) {
    snapshot.headers = createHeaders(defaults.headers)
  }
}

function snapshotScalarDefaults(
  snapshot: ClientDefaults,
  defaults: ClientDefaults,
): void {
  if (defaults.timeout !== undefined) {
    const timeout = normalizeTimeout(defaults.timeout)
    if (timeout !== undefined) {
      snapshot.timeout = timeout
    }
  }

  if (defaults.responseType !== undefined) {
    snapshot.responseType = normalizeResponseType(defaults.responseType)
  }
}

function snapshotRetryDefaults(
  snapshot: ClientDefaults,
  defaults: ClientDefaults,
): void {
  if (defaults.retry !== undefined) {
    snapshot.retry = snapshotRetry(defaults.retry)
  }
}

function snapshotHookDefaults(
  snapshot: ClientDefaults,
  defaults: ClientDefaults,
): void {
  if (defaults.hooks !== undefined) {
    snapshot.hooks = snapshotHooks(defaults.hooks)
  }
}

function snapshotParseJsonDefault(
  snapshot: ClientDefaults,
  defaults: ClientDefaults,
): void {
  if (defaults.parseJson !== undefined) {
    snapshot.parseJson = normalizeParseJson(defaults.parseJson)
  }
}

function snapshotRetry(retry: false | RetryOptions): false | RetryOptions {
  if (retry === false) {
    return false
  }

  return normalizeRetry(undefined, retry)
}

function createHeaders(headers?: HeadersInit): Headers {
  try {
    return new Headers(headers)
  } catch (cause) {
    if (cause instanceof TypeError) {
      throw new ConfigError(
        '`headers` must contain valid header names and values',
        cause,
      )
    }
    throw cause
  }
}

function snapshotHooks(hooks: Hooks): Hooks {
  const beforeRequest = normalizeBeforeRequestHooks(hooks)
  const afterResponse = normalizeAfterResponseHooks(hooks)
  const onError = normalizeOnErrorHooks(hooks)
  const snapshot: Hooks = {}

  if (hooks.beforeRequest !== undefined) {
    snapshot.beforeRequest = beforeRequest
  }

  if (hooks.afterResponse !== undefined) {
    snapshot.afterResponse = afterResponse
  }

  if (hooks.onError !== undefined) {
    snapshot.onError = onError
  }

  return snapshot
}
