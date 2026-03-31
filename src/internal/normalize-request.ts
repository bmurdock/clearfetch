import { ConfigError } from '../errors.js'
import type {
  BeforeRequestContext,
  ClientDefaults,
  Hooks,
  NormalizedRequestOptions,
  PrimitiveQueryValue,
  QueryParams,
  RequestMethod,
  RequestOptions,
  RetryOptions,
} from '../types.js'

const REQUEST_METHODS = new Set<RequestMethod>([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
])

const DEFAULT_RETRY: Required<RetryOptions> = {
  attempts: 3,
  backoffMs: 250,
  maxBackoffMs: 2_000,
  multiplier: 2,
  retryOnStatuses: [429, 502, 503, 504],
  retryOnMethods: ['GET', 'HEAD'],
}

const EMPTY_HOOKS: Required<Hooks> = {
  beforeRequest: [],
  afterResponse: [],
  onError: [],
}

const DEFAULT_PARSE_JSON = (text: string): unknown => JSON.parse(text) as unknown

export function createBeforeRequestContext(
  input: string | URL,
  defaults: ClientDefaults = {},
  options: RequestOptions = {},
): BeforeRequestContext {
  const url = resolveRequestURL(input, defaults.baseURL, options.query)
  const normalized = normalizeRequestOptions(defaults, options)
  const body = resolveRequestBody(normalized)

  const context: BeforeRequestContext = {
    input,
    url,
    headers: normalized.headers,
    options: {
      ...normalized,
    },
  }

  if (body !== undefined) {
    context.body = body
    context.options.body = body
  }

  return context
}

export function buildRequestFromContext(
  context: BeforeRequestContext,
  signal?: AbortSignal,
): Request {
  if (!(context.url instanceof URL)) {
    throw new ConfigError('beforeRequest URL overrides must be absolute URLs')
  }

  const init: RequestInit = {
    method: context.options.method,
    headers: context.headers,
  }

  if (context.body !== undefined) {
    init.body = context.body
  }

  if (signal !== undefined) {
    init.signal = signal
  } else if (context.options.signal !== undefined) {
    init.signal = context.options.signal
  }

  return new Request(context.url, init)
}

export function normalizeRequestOptions(
  defaults: ClientDefaults = {},
  options: RequestOptions = {},
): NormalizedRequestOptions {
  const method = normalizeMethod(options.method ?? 'GET')
  const timeout = normalizeTimeout(options.timeout ?? defaults.timeout)
  const responseType = options.responseType ?? defaults.responseType ?? 'json'
  const retry = normalizeRetry(defaults.retry, options.retry)
  const hooks = mergeHooks(defaults.hooks, options.hooks)
  const parseJson = options.parseJson ?? defaults.parseJson ?? DEFAULT_PARSE_JSON
  const headers = mergeHeaders(defaults.headers, options.headers)

  if (options.body !== undefined && options.json !== undefined) {
    throw new ConfigError('`body` and `json` cannot both be provided')
  }

  if ((method === 'GET' || method === 'HEAD') && (options.body !== undefined || options.json !== undefined)) {
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
    normalized.query = options.query
  }

  if (options.body !== undefined) {
    normalized.body = options.body
  }

  if (options.json !== undefined) {
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
  query?: QueryParams,
): URL {
  const base = baseURL === undefined ? undefined : toAbsoluteURL(baseURL, 'Invalid base URL')
  const url = input instanceof URL ? new URL(input) : resolveInputURL(input, base)

  applyQueryParams(url, query)
  return url
}

export function serializeQueryParams(query?: QueryParams): string {
  if (query === undefined) {
    return ''
  }

  const params = new URLSearchParams()

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) {
      continue
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        params.append(key, serializeScalarQueryValue(item))
      }
      continue
    }

    params.append(key, serializeScalarQueryValue(value))
  }

  return params.toString()
}

function applyQueryParams(url: URL, query?: QueryParams): void {
  const serialized = serializeQueryParams(query)

  if (serialized === '') {
    return
  }

  const suffix = url.search === '' ? serialized : `&${serialized}`
  url.search += suffix
}

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

function mergeHooks(
  defaultHooks?: Hooks,
  requestHooks?: Hooks,
): Required<Hooks> {
  return {
    beforeRequest: [
      ...(defaultHooks?.beforeRequest ?? EMPTY_HOOKS.beforeRequest),
      ...(requestHooks?.beforeRequest ?? EMPTY_HOOKS.beforeRequest),
    ],
    afterResponse: [
      ...(defaultHooks?.afterResponse ?? EMPTY_HOOKS.afterResponse),
      ...(requestHooks?.afterResponse ?? EMPTY_HOOKS.afterResponse),
    ],
    onError: [
      ...(defaultHooks?.onError ?? EMPTY_HOOKS.onError),
      ...(requestHooks?.onError ?? EMPTY_HOOKS.onError),
    ],
  }
}

function normalizeMethod(method: string): RequestMethod {
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

function normalizeRetry(
  defaultRetry?: false | RetryOptions,
  requestRetry?: false | RetryOptions,
): false | Required<RetryOptions> {
  if (requestRetry === false) {
    return false
  }

  const source = requestRetry ?? defaultRetry
  if (source === undefined || source === false) {
    return false
  }

  return {
    attempts: source.attempts ?? DEFAULT_RETRY.attempts,
    backoffMs: source.backoffMs ?? DEFAULT_RETRY.backoffMs,
    maxBackoffMs: source.maxBackoffMs ?? DEFAULT_RETRY.maxBackoffMs,
    multiplier: source.multiplier ?? DEFAULT_RETRY.multiplier,
    retryOnStatuses: source.retryOnStatuses ?? DEFAULT_RETRY.retryOnStatuses,
    retryOnMethods: source.retryOnMethods ?? DEFAULT_RETRY.retryOnMethods,
  }
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
  if (options.json === undefined) {
    return options.body
  }

  if (!options.headers.has('Content-Type')) {
    options.headers.set('Content-Type', 'application/json')
  }

  return JSON.stringify(options.json)
}

function serializeScalarQueryValue(
  value: PrimitiveQueryValue,
): string {
  if (value === null) {
    return 'null'
  }

  return String(value)
}
