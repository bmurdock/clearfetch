/**
 * Supported HTTP methods for the public request surface.
 */
export type RequestMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'HEAD'
  | 'OPTIONS'

/**
 * Supported response parsing modes.
 *
 * `json` is the default mode. `raw` returns the native `Response`.
 */
export type ResponseType =
  | 'json'
  | 'text'
  | 'blob'
  | 'arrayBuffer'
  | 'raw'

export type PrimitiveQueryValue = string | number | boolean | null

export type QueryValue =
  | PrimitiveQueryValue
  | PrimitiveQueryValue[]
  | undefined

export type QueryParams = Record<string, QueryValue>

export type QueryInput = QueryParams | URLSearchParams

export interface RedactHeadersOptions {
  headerNames?: readonly string[]
  replacement?: string
}

/**
 * Conservative retry configuration.
 *
 * Retries are opt-in and intended for bounded, explicit use.
 */
export interface RetryOptions {
  attempts?: number
  backoffMs?: number
  maxBackoffMs?: number
  multiplier?: number
  retryOnStatuses?: number[]
  retryOnMethods?: RequestMethod[]
}

/**
 * Per-request configuration for `request()` and client method calls.
 */
export type BodyCapableRequestMethod = Exclude<RequestMethod, 'GET' | 'HEAD'>

export interface RequestOptionsBase {
  headers?: HeadersInit
  query?: QueryInput
  timeout?: number
  signal?: AbortSignal
  responseType?: ResponseType
  retry?: false | RetryOptions
  hooks?: Hooks
  parseJson?: (text: string) => unknown | PromiseLike<unknown>
}

export type BodylessRequestOptions = RequestOptionsBase & {
  method?: 'GET' | 'HEAD'
  body?: never
  json?: never
}

export type BodyCapableRequestWithoutBody = RequestOptionsBase & {
  method?: BodyCapableRequestMethod
  body?: never
  json?: never
}

export type RawBodyRequestOptions = RequestOptionsBase & {
  method: BodyCapableRequestMethod
  body: BodyInit | null
  json?: never
}

export type JsonBodyRequestOptions = RequestOptionsBase & {
  method: BodyCapableRequestMethod
  body?: never
  json: unknown
}

export type RequestOptions =
  | BodylessRequestOptions
  | BodyCapableRequestWithoutBody
  | RawBodyRequestOptions
  | JsonBodyRequestOptions

export type ClientMethodOptions =
  | (RequestOptionsBase & { body?: never; json?: never })
  | (RequestOptionsBase & { body: BodyInit | null; json?: never })
  | (RequestOptionsBase & { body?: never; json: unknown })

/**
 * Shared defaults captured by a client created with `createClient()`.
 */
export interface ClientDefaults {
  baseURL?: string | URL
  headers?: HeadersInit
  timeout?: number
  responseType?: ResponseType
  retry?: false | RetryOptions
  hooks?: Hooks
  parseJson?: (text: string) => unknown | PromiseLike<unknown>
}

/**
 * Read-only retry metadata exposed to hooks.
 */
export interface HookRetryOptions {
  readonly attempts: number
  readonly backoffMs: number
  readonly maxBackoffMs: number
  readonly multiplier: number
  readonly retryOnStatuses: readonly number[]
  readonly retryOnMethods: readonly RequestMethod[]
}

/**
 * Read-only normalized request metadata exposed to hooks.
 *
 * Hooks may inspect these values, but they are not a supported mutation surface.
 */
export interface HookRequestOptions {
  readonly method: RequestMethod
  readonly attempt: number
  readonly maxAttempts: number
  readonly query?: QueryParams
  readonly queryString?: string
  readonly timeout?: number
  readonly signal?: AbortSignal
  readonly responseType: ResponseType
  readonly retry: false | HookRetryOptions
  readonly parseJson: (text: string) => unknown | PromiseLike<unknown>
}

/**
 * Context passed to `beforeRequest` hooks.
 *
 * Hooks may mutate `headers` and may replace `url` with a final absolute URL.
 * Other request metadata is exposed through `options` as read-only state.
 */
export interface BeforeRequestContext {
  input: string | URL
  url: URL
  headers: Headers
  readonly body?: BodyInit | null
  readonly options: HookRequestOptions
}

/**
 * Context passed to `afterResponse` hooks.
 *
 * `response` is a cloned `Response` intended for safe inspection.
 */
export interface AfterResponseContext {
  input: string | URL
  request: Request
  response: Response
  readonly options: HookRequestOptions
}

/**
 * Context passed to `onError` hooks.
 *
 * Transport, HTTP, timeout, abort, and parse failures are normalized before
 * this hook runs. Hook failures and request-construction failures are exposed
 * as thrown so they are not hidden behind misleading wrapper errors.
 */
export interface ErrorContext {
  input: string | URL
  request?: Request
  response?: Response
  error: unknown
  readonly options?: HookRequestOptions
}

export type BeforeRequestHook = (
  context: BeforeRequestContext,
) => void | Promise<void>

export type AfterResponseHook = (
  context: AfterResponseContext,
) => void | Promise<void>

export type OnErrorHook = (
  context: ErrorContext,
) => void | Promise<void>

/**
 * Lifecycle hook configuration.
 *
 * Client-level hooks run before request-level hooks.
 */
export interface Hooks {
  beforeRequest?: BeforeRequestHook[]
  afterResponse?: AfterResponseHook[]
  onError?: OnErrorHook[]
}

/**
 * @deprecated Internal execution metadata. Prefer public request, client, and
 * hook option types for consumer code.
 */
export interface NormalizedRequestOptions {
  method: RequestMethod
  headers: Headers
  query?: QueryInput
  body?: BodyInit | null
  json?: unknown
  timeout?: number
  signal?: AbortSignal
  responseType: ResponseType
  retry: false | Required<RetryOptions>
  hooks: Required<Hooks>
  parseJson: (text: string) => unknown | PromiseLike<unknown>
}

/**
 * Reusable client API produced by `createClient()`.
 */
export interface HttpClient<DefaultResponseType extends ResponseType = 'json'> {
  request: ClientResponseMethod<RequestOptions, DefaultResponseType>

  get: ClientResponseMethod<BodylessClientMethodOptions, DefaultResponseType>

  post: ClientResponseMethod<ClientMethodOptions, DefaultResponseType>

  put: ClientResponseMethod<ClientMethodOptions, DefaultResponseType>

  patch: ClientResponseMethod<ClientMethodOptions, DefaultResponseType>

  delete: ClientResponseMethod<ClientMethodOptions, DefaultResponseType>

  head: ClientResponseMethod<BodylessClientMethodOptions, DefaultResponseType>

  options: ClientResponseMethod<ClientMethodOptions, DefaultResponseType>

  extend<ChildResponseType extends ResponseType>(
    defaults: Omit<ClientDefaults, 'responseType'> & {
      responseType: ChildResponseType
    },
  ): HttpClient<ChildResponseType> & HttpClient

  extend(
    defaults: Omit<ClientDefaults, 'responseType'> & {
      responseType?: never
    },
  ): HttpClient<DefaultResponseType>

  extend(defaults: ClientDefaults): HttpClient<ResponseType> & HttpClient
}

type ResponseResult<T, ResponseMode extends ResponseType> =
  ResponseMode extends 'json'
    ? T | undefined
    : ResponseMode extends 'text'
      ? string
      : ResponseMode extends 'blob'
        ? Blob
        : ResponseMode extends 'arrayBuffer'
          ? ArrayBuffer
          : Response

type BodylessClientMethodOptions = RequestOptionsBase & {
  body?: never
  json?: never
}

type ClientResponseMethod<
  Options,
  DefaultResponseType extends ResponseType,
> = {
  <T = unknown>(
    input: string | URL,
    options?: Options & { responseType?: never },
  ): Promise<ResponseResult<T, DefaultResponseType>>

  <T = unknown>(
    input: string | URL,
    options: Options & { responseType: 'json' },
  ): Promise<T | undefined>

  (
    input: string | URL,
    options: Options & { responseType: 'text' },
  ): Promise<string>

  (
    input: string | URL,
    options: Options & { responseType: 'blob' },
  ): Promise<Blob>

  (
    input: string | URL,
    options: Options & { responseType: 'arrayBuffer' },
  ): Promise<ArrayBuffer>

  (
    input: string | URL,
    options: Options & { responseType: 'raw' },
  ): Promise<Response>
}
