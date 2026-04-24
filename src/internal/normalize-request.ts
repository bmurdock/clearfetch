import { ConfigError } from '../errors.js'
import type {
  BeforeRequestContext,
  ClientDefaults,
  HookRequestOptions,
  Hooks,
  NormalizedRequestOptions,
  PrimitiveQueryValue,
  QueryParams,
  RequestMethod,
  RequestOptions,
  ResponseType,
} from '../types.js'
import { REQUEST_METHODS, normalizeRetry } from './retry-policy.js'

const RESPONSE_TYPES = new Set<ResponseType>([
  'json',
  'text',
  'blob',
  'arrayBuffer',
  'raw',
])

const EMPTY_HOOKS: Required<Hooks> = {
  beforeRequest: [],
  afterResponse: [],
  onError: [],
}

const DEFAULT_PARSE_JSON = (text: string): unknown => JSON.parse(text)

export interface ExecutionBeforeRequestContext extends BeforeRequestContext {
  _internalOptions: NormalizedRequestOptions
}

export function createBeforeRequestContext(
  input: string | URL,
  defaults: ClientDefaults = {},
  options: RequestOptions = {},
): ExecutionBeforeRequestContext {
  const url = resolveRequestURL(input, defaults.baseURL, options.query)
  const normalized = normalizeRequestOptions(defaults, options)
  const body = resolveRequestBody(normalized)
  validateRetryableBody(body, normalized.retry)
  const optionsView = createHookRequestOptions(normalized)

  const context: ExecutionBeforeRequestContext = {
    input,
    url,
    headers: normalized.headers,
    _internalOptions: normalized,
    options: optionsView,
  }

  if (body !== undefined) {
    // `body` remains readable to hooks, but execution uses `_internalOptions`
    // so hook metadata cannot silently rewrite normalized behavior.
    Object.defineProperty(context, 'body', {
      configurable: false,
      enumerable: true,
      value: body,
      writable: false,
    })
  }

  Object.defineProperty(context, 'options', {
    configurable: false,
    enumerable: true,
    value: optionsView,
    writable: false,
  })

  return context
}

export function buildRequestFromContext(
  context: ExecutionBeforeRequestContext,
  signal?: AbortSignal,
): Request {
  if (!(context.url instanceof URL)) {
    throw new ConfigError('beforeRequest URL overrides must be absolute URLs')
  }

  const init: RequestInit = {
    method: context._internalOptions.method,
    headers: context.headers,
  }

  if (context.body !== undefined) {
    init.body = context.body
  }

  if (signal !== undefined) {
    init.signal = signal
  } else if (context._internalOptions.signal !== undefined) {
    init.signal = context._internalOptions.signal
  }

  return new Request(context.url, init)
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
    validateQueryParams(options.query)
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

function validateQueryParams(query: QueryParams): void {
  for (const [key, value] of Object.entries(query)) {
    validateQueryValue(key, value)
  }
}

function validateQueryValue(key: string, value: QueryParams[string]): void {
  if (value === undefined) {
    return
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      validateQueryScalarValue(key, item)
    }
    return
  }

  validateQueryScalarValue(key, value)
}

function validateQueryScalarValue(key: string, value: unknown): void {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return
  }

  throw new ConfigError(
    `Unsupported query value for \`${key}\`; only string, number, boolean, null, arrays, and undefined are allowed`,
  )
}

function validateRetryableBody(
  body: BodyInit | null | undefined,
  retry: NormalizedRequestOptions['retry'],
): void {
  if (retry === false || body === undefined || body === null) {
    return
  }

  if (
    typeof ReadableStream !== 'undefined' &&
    body instanceof ReadableStream
  ) {
    throw new ConfigError(
      'Retry is not supported for streaming request bodies',
    )
  }
}

export function createHookRequestOptions(
  options: NormalizedRequestOptions,
): HookRequestOptions {
  // Hooks get a read-only metadata view rather than the internal mutable
  // execution object. This keeps hook inspection useful without turning
  // `context.options` into a hidden mutation surface.
  const snapshot: HookRequestOptions = {
    method: options.method,
    responseType: options.responseType,
    retry:
      options.retry === false
        ? false
        : Object.freeze({
            ...options.retry,
            retryOnStatuses: Object.freeze([...options.retry.retryOnStatuses]),
            retryOnMethods: Object.freeze([...options.retry.retryOnMethods]),
          }),
    parseJson: options.parseJson,
  }

  if (options.query !== undefined) {
    Object.defineProperty(snapshot, 'query', {
      configurable: false,
      enumerable: true,
      value: freezeQueryParams(options.query),
      writable: false,
    })
  }

  if (options.timeout !== undefined) {
    Object.defineProperty(snapshot, 'timeout', {
      configurable: false,
      enumerable: true,
      value: options.timeout,
      writable: false,
    })
  }

  if (options.signal !== undefined) {
    Object.defineProperty(snapshot, 'signal', {
      configurable: false,
      enumerable: true,
      value: options.signal,
      writable: false,
    })
  }

  return Object.freeze(snapshot)
}

function freezeQueryParams(query: QueryParams): QueryParams {
  const snapshot: QueryParams = {}

  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) {
      snapshot[key] = Object.freeze([...value]) as PrimitiveQueryValue[]
      continue
    }

    snapshot[key] = value
  }

  return Object.freeze(snapshot)
}
