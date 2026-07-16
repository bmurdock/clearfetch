import { ConfigError } from '../errors.js'
import type {
  BeforeRequestContext,
  ClientDefaults,
  NormalizedRequestOptions,
  QueryInput,
  RequestMethod,
  RequestOptions,
  ResponseType,
} from '../types.js'
import { mergeHooks } from './hooks.js'
import { createHookRequestOptions } from './hook-options.js'
import {
  isReadableStream,
  snapshotRequestBody,
} from './platform-values.js'
import {
  applyQueryString,
  serializeQueryParams,
  serializeValidatedQueryParams,
  snapshotQueryInput,
  validateQueryInput,
} from './query-params.js'
import {
  getEffectiveRetryAttempts,
  REQUEST_METHODS,
  normalizeRetry,
} from './retry-policy.js'

const RESPONSE_TYPES = new Set<ResponseType>([
  'json',
  'text',
  'blob',
  'arrayBuffer',
  'raw',
])

const DEFAULT_PARSE_JSON = (text: string): unknown => JSON.parse(text)

export interface ExecutionBeforeRequestContext {
  readonly hookContext: BeforeRequestContext
  readonly normalizedOptions: NormalizedRequestOptions
}

export interface BeforeRequestContextSnapshot {
  input: string | URL
  url: URL
  options: NormalizedRequestOptions
  queryString?: string
}

export function createBeforeRequestContext(
  input: string | URL,
  defaults: ClientDefaults = {},
  options: RequestOptions = {},
  attempt = 1,
): ExecutionBeforeRequestContext {
  const normalized = normalizeRequestOptions(defaults, options)
  const queryString = serializeValidatedQueryParams(normalized.query)
  const url = resolveRequestURLWithQueryString(
    input,
    defaults.baseURL,
    queryString,
  )
  const resolvedBody = resolveRequestBody(normalized)
  const maxAttempts = getEffectiveRetryAttempts(
    normalized.method,
    normalized.retry,
  )
  validateRetryableBody(resolvedBody, maxAttempts)
  const body =
    maxAttempts === 1 || resolvedBody === undefined
      ? resolvedBody
      : snapshotRequestBody(resolvedBody)

  return createExecutionBeforeRequestContext({
    attempt,
    body,
    input,
    normalized,
    queryString,
    url,
  })
}

export function snapshotBeforeRequestContext(
  context: ExecutionBeforeRequestContext,
): BeforeRequestContextSnapshot {
  const { hookContext } = context
  const options = cloneNormalizedRequestOptions(context.normalizedOptions)

  delete options.json
  if (hookContext.body !== undefined) {
    options.body =
      options.hooks.beforeRequest.length === 0
        ? hookContext.body
        : snapshotRequestBody(hookContext.body)
  } else {
    delete options.body
  }

  const snapshot: BeforeRequestContextSnapshot = {
    input: cloneRequestInput(hookContext.input),
    url: new URL(hookContext.url),
    options,
  }

  if (hookContext.options.queryString !== undefined) {
    snapshot.queryString = hookContext.options.queryString
  }

  return snapshot
}

export function createBeforeRequestContextFromSnapshot(
  snapshot: BeforeRequestContextSnapshot,
  attempt: number,
): ExecutionBeforeRequestContext {
  const normalized = cloneNormalizedRequestOptions(snapshot.options)
  if (
    normalized.body !== undefined &&
    normalized.hooks.beforeRequest.length > 0
  ) {
    normalized.body = snapshotRequestBody(normalized.body)
  }

  return createExecutionBeforeRequestContext({
    attempt,
    body: normalized.body,
    input: cloneRequestInput(snapshot.input),
    normalized,
    queryString: snapshot.queryString ?? '',
    url: new URL(snapshot.url),
  })
}

function createExecutionBeforeRequestContext(params: {
  attempt: number
  body: BodyInit | null | undefined
  input: string | URL
  normalized: NormalizedRequestOptions
  queryString: string
  url: URL
}): ExecutionBeforeRequestContext {
  const { attempt, body, input, normalized, queryString, url } = params
  const maxAttempts = getEffectiveRetryAttempts(
    normalized.method,
    normalized.retry,
  )
  const optionsView = createHookRequestOptions(normalized, {
    attempt,
    maxAttempts,
    ...(queryString === '' ? {} : { queryString }),
  })

  const hookContext: BeforeRequestContext = {
    input,
    url,
    headers: normalized.headers,
    options: optionsView,
  }

  if (body !== undefined) {
    // `body` remains readable to hooks, while execution keeps normalized
    // behavior in the separate internal context record.
    Object.defineProperty(hookContext, 'body', {
      configurable: false,
      enumerable: true,
      value: body,
      writable: false,
    })
  }

  Object.defineProperty(hookContext, 'options', {
    configurable: false,
    enumerable: true,
    value: optionsView,
    writable: false,
  })

  return Object.freeze({
    hookContext,
    normalizedOptions: normalized,
  })
}

function cloneNormalizedRequestOptions(
  options: NormalizedRequestOptions,
): NormalizedRequestOptions {
  const snapshot: NormalizedRequestOptions = {
    method: options.method,
    headers: new Headers(options.headers),
    responseType: options.responseType,
    retry:
      options.retry === false
        ? false
        : {
            ...options.retry,
            retryOnStatuses: [...options.retry.retryOnStatuses],
            retryOnMethods: [...options.retry.retryOnMethods],
          },
    hooks: {
      beforeRequest: [...options.hooks.beforeRequest],
      afterResponse: [...options.hooks.afterResponse],
      onError: [...options.hooks.onError],
    },
    parseJson: options.parseJson,
  }

  if (options.query !== undefined) {
    snapshot.query = snapshotQueryInput(options.query)
  }

  if (options.body !== undefined) {
    snapshot.body = options.body
  }

  if (Object.hasOwn(options, 'json')) {
    snapshot.json = options.json
  }

  if (options.timeout !== undefined) {
    snapshot.timeout = options.timeout
  }

  if (options.signal !== undefined) {
    snapshot.signal = options.signal
  }

  return snapshot
}

function cloneRequestInput(input: string | URL): string | URL {
  return typeof input === 'string' ? input : new URL(String(input))
}

export function buildRequestFromContext(
  context: ExecutionBeforeRequestContext,
  signal?: AbortSignal,
): Request {
  const { hookContext, normalizedOptions } = context

  if (!(hookContext.url instanceof URL)) {
    throw new ConfigError('beforeRequest URL overrides must be absolute URLs')
  }

  const init: RequestInit = {
    method: normalizedOptions.method,
    headers: hookContext.headers,
  }

  if (hookContext.body !== undefined) {
    init.body = hookContext.body
    if (isReadableStream(hookContext.body)) {
      Object.assign(init, { duplex: 'half' as const })
    }
  }

  if (signal !== undefined) {
    init.signal = signal
  } else if (normalizedOptions.signal !== undefined) {
    init.signal = normalizedOptions.signal
  }

  return new Request(hookContext.url, init)
}

export function normalizeRequestOptions(
  defaults: ClientDefaults = {},
  options: RequestOptions = {},
): NormalizedRequestOptions {
  const method = normalizeMethod(options.method ?? 'GET')
  const timeout = normalizeTimeout(options.timeout ?? defaults.timeout)
  const responseType = normalizeResponseType(
    options.responseType ?? defaults.responseType ?? 'json',
  )
  const retry = normalizeRetry(defaults.retry, options.retry)
  const hooks = mergeHooks(defaults.hooks, options.hooks)
  const parseJson = normalizeParseJson(
    options.parseJson ?? defaults.parseJson ?? DEFAULT_PARSE_JSON,
  )
  const headers = mergeHeaders(defaults.headers, options.headers)

  const hasJson = Object.hasOwn(options, 'json')

  if (options.body !== undefined && hasJson) {
    throw new ConfigError('`body` and `json` cannot both be provided')
  }

  if (
    (method === 'GET' || method === 'HEAD') &&
    (options.body !== undefined || hasJson)
  ) {
    throw new ConfigError(`\`${method}\` requests cannot include a request body`)
  }

  if (!REQUEST_METHODS.has(method)) {
    throw new ConfigError(`Unsupported request method: ${method}`)
  }

  const normalized: NormalizedRequestOptions = {
    method,
    headers,
    responseType,
    retry,
    hooks,
    parseJson,
  }

  if (options.query !== undefined) {
    validateQueryInput(options.query)
    normalized.query = options.query
  }

  if (options.body !== undefined) {
    normalized.body = options.body
  }

  if (hasJson) {
    normalized.json = options.json
  }

  if (timeout !== undefined) {
    normalized.timeout = timeout
  }

  if (options.signal !== undefined) {
    normalized.signal = options.signal
  }

  return normalized
}

export function resolveRequestURL(
  input: string | URL,
  baseURL?: string | URL,
  query?: QueryInput,
): URL {
  return resolveRequestURLWithQueryString(
    input,
    baseURL,
    serializeQueryParams(query),
  )
}

function resolveRequestURLWithQueryString(
  input: string | URL,
  baseURL: string | URL | undefined,
  queryString: string,
): URL {
  const base = baseURL === undefined ? undefined : toAbsoluteURL(baseURL, 'Invalid base URL')
  const url = input instanceof URL ? new URL(input) : resolveInputURL(input, base)

  applyQueryString(url, queryString)
  return url
}

export { serializeQueryParams } from './query-params.js'

function mergeHeaders(
  defaultHeaders?: HeadersInit,
  requestHeaders?: HeadersInit,
): Headers {
  const headers = new Headers(defaultHeaders)

  if (requestHeaders !== undefined) {
    const overrideHeaders = new Headers(requestHeaders)

    for (const [key, value] of overrideHeaders.entries()) {
      headers.set(key, value)
    }
  }

  return headers
}

function normalizeMethod(method: unknown): RequestMethod {
  if (typeof method !== 'string') {
    throw new ConfigError('`method` must be a string')
  }

  return method.toUpperCase() as RequestMethod
}

function normalizeTimeout(timeout?: number): number | undefined {
  if (timeout === undefined) {
    return undefined
  }

  if (!Number.isFinite(timeout) || timeout < 0) {
    throw new ConfigError('`timeout` must be a non-negative finite number')
  }

  return timeout
}

function normalizeResponseType(responseType: unknown): NormalizedRequestOptions['responseType'] {
  if (
    typeof responseType !== 'string' ||
    !RESPONSE_TYPES.has(responseType as ResponseType)
  ) {
    throw new ConfigError(`Unsupported responseType: ${String(responseType)}`)
  }

  return responseType as NormalizedRequestOptions['responseType']
}

function normalizeParseJson(
  parseJson: unknown,
): NormalizedRequestOptions['parseJson'] {
  if (typeof parseJson !== 'function') {
    throw new ConfigError('`parseJson` must be a function')
  }

  return parseJson as NormalizedRequestOptions['parseJson']
}

function resolveInputURL(input: string, base?: URL): URL {
  try {
    return new URL(input)
  } catch {
    if (base === undefined) {
      throw new ConfigError('Relative request inputs require `baseURL`')
    }

    try {
      return new URL(input, base)
    } catch (cause) {
      throw new ConfigError('Invalid request URL', cause)
    }
  }
}

function toAbsoluteURL(value: string | URL, message: string): URL {
  try {
    return value instanceof URL ? new URL(value) : new URL(value)
  } catch (cause) {
    throw new ConfigError(message, cause)
  }
}

function resolveRequestBody(
  options: Pick<NormalizedRequestOptions, 'body' | 'headers' | 'json'>,
): BodyInit | null | undefined {
  if (!Object.hasOwn(options, 'json')) {
    return options.body
  }

  if (!options.headers.has('Content-Type')) {
    options.headers.set('Content-Type', 'application/json')
  }

  try {
    const body = JSON.stringify(options.json)
    if (body === undefined) {
      throw new ConfigError('`json` must serialize to a JSON value')
    }
    return body
  } catch (cause) {
    if (cause instanceof ConfigError) {
      throw cause
    }
    if (cause instanceof TypeError) {
      throw new ConfigError('`json` must serialize to a JSON value', cause)
    }
    throw cause
  }
}

function validateRetryableBody(
  body: BodyInit | null | undefined,
  maxAttempts: number,
): void {
  if (maxAttempts === 1 || body === undefined || body === null) {
    return
  }

  if (
    isReadableStream(body)
  ) {
    throw new ConfigError(
      'Retry is not supported for streaming request bodies',
    )
  }
}
