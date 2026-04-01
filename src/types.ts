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
export interface RequestOptions {
  method?: RequestMethod
  headers?: HeadersInit
  query?: QueryParams
  body?: BodyInit | null
  json?: unknown
  timeout?: number
  signal?: AbortSignal
  responseType?: ResponseType
  retry?: false | RetryOptions
  hooks?: Hooks
  parseJson?: (text: string) => unknown
}

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
  parseJson?: (text: string) => unknown
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
  readonly query?: QueryParams
  readonly timeout?: number
  readonly signal?: AbortSignal
  readonly responseType: ResponseType
  readonly retry: false | HookRetryOptions
  readonly parseJson: (text: string) => unknown
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
 * Context passed to `onError` hooks after the failure has been normalized.
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

export interface NormalizedRequestOptions {
  method: RequestMethod
  headers: Headers
  query?: QueryParams
  body?: BodyInit | null
  json?: unknown
  timeout?: number
  signal?: AbortSignal
  responseType: ResponseType
  retry: false | Required<RetryOptions>
  hooks: Required<Hooks>
  parseJson: (text: string) => unknown
}

/**
 * Reusable client API produced by `createClient()`.
 */
export interface HttpClient {
  request<T = unknown>(
    input: string | URL,
    options?: JsonRequestOptions,
  ): Promise<T | undefined>

  request(
    input: string | URL,
    options: TextRequestOptions,
  ): Promise<string>

  request(
    input: string | URL,
    options: BlobRequestOptions,
  ): Promise<Blob>

  request(
    input: string | URL,
    options: ArrayBufferRequestOptions,
  ): Promise<ArrayBuffer>

  request(
    input: string | URL,
    options: RawRequestOptions,
  ): Promise<Response>

  get<T = unknown>(
    input: string | URL,
    options?: Omit<JsonRequestOptions, 'method'>,
  ): Promise<T | undefined>

  get(
    input: string | URL,
    options: Omit<TextRequestOptions, 'method'>,
  ): Promise<string>

  get(
    input: string | URL,
    options: Omit<BlobRequestOptions, 'method'>,
  ): Promise<Blob>

  get(
    input: string | URL,
    options: Omit<ArrayBufferRequestOptions, 'method'>,
  ): Promise<ArrayBuffer>

  get(
    input: string | URL,
    options: Omit<RawRequestOptions, 'method'>,
  ): Promise<Response>

  post<T = unknown>(
    input: string | URL,
    options?: Omit<JsonRequestOptions, 'method'>,
  ): Promise<T | undefined>

  post(
    input: string | URL,
    options: Omit<TextRequestOptions, 'method'>,
  ): Promise<string>

  post(
    input: string | URL,
    options: Omit<BlobRequestOptions, 'method'>,
  ): Promise<Blob>

  post(
    input: string | URL,
    options: Omit<ArrayBufferRequestOptions, 'method'>,
  ): Promise<ArrayBuffer>

  post(
    input: string | URL,
    options: Omit<RawRequestOptions, 'method'>,
  ): Promise<Response>

  put<T = unknown>(
    input: string | URL,
    options?: Omit<JsonRequestOptions, 'method'>,
  ): Promise<T | undefined>

  put(
    input: string | URL,
    options: Omit<TextRequestOptions, 'method'>,
  ): Promise<string>

  put(
    input: string | URL,
    options: Omit<BlobRequestOptions, 'method'>,
  ): Promise<Blob>

  put(
    input: string | URL,
    options: Omit<ArrayBufferRequestOptions, 'method'>,
  ): Promise<ArrayBuffer>

  put(
    input: string | URL,
    options: Omit<RawRequestOptions, 'method'>,
  ): Promise<Response>

  patch<T = unknown>(
    input: string | URL,
    options?: Omit<JsonRequestOptions, 'method'>,
  ): Promise<T | undefined>

  patch(
    input: string | URL,
    options: Omit<TextRequestOptions, 'method'>,
  ): Promise<string>

  patch(
    input: string | URL,
    options: Omit<BlobRequestOptions, 'method'>,
  ): Promise<Blob>

  patch(
    input: string | URL,
    options: Omit<ArrayBufferRequestOptions, 'method'>,
  ): Promise<ArrayBuffer>

  patch(
    input: string | URL,
    options: Omit<RawRequestOptions, 'method'>,
  ): Promise<Response>

  delete<T = unknown>(
    input: string | URL,
    options?: Omit<JsonRequestOptions, 'method'>,
  ): Promise<T | undefined>

  delete(
    input: string | URL,
    options: Omit<TextRequestOptions, 'method'>,
  ): Promise<string>

  delete(
    input: string | URL,
    options: Omit<BlobRequestOptions, 'method'>,
  ): Promise<Blob>

  delete(
    input: string | URL,
    options: Omit<ArrayBufferRequestOptions, 'method'>,
  ): Promise<ArrayBuffer>

  delete(
    input: string | URL,
    options: Omit<RawRequestOptions, 'method'>,
  ): Promise<Response>

  head<T = unknown>(
    input: string | URL,
    options?: Omit<JsonRequestOptions, 'method'>,
  ): Promise<T | undefined>

  head(
    input: string | URL,
    options: Omit<TextRequestOptions, 'method'>,
  ): Promise<string>

  head(
    input: string | URL,
    options: Omit<BlobRequestOptions, 'method'>,
  ): Promise<Blob>

  head(
    input: string | URL,
    options: Omit<ArrayBufferRequestOptions, 'method'>,
  ): Promise<ArrayBuffer>

  head(
    input: string | URL,
    options: Omit<RawRequestOptions, 'method'>,
  ): Promise<Response>

  options<T = unknown>(
    input: string | URL,
    options?: Omit<JsonRequestOptions, 'method'>,
  ): Promise<T | undefined>

  options(
    input: string | URL,
    options: Omit<TextRequestOptions, 'method'>,
  ): Promise<string>

  options(
    input: string | URL,
    options: Omit<BlobRequestOptions, 'method'>,
  ): Promise<Blob>

  options(
    input: string | URL,
    options: Omit<ArrayBufferRequestOptions, 'method'>,
  ): Promise<ArrayBuffer>

  options(
    input: string | URL,
    options: Omit<RawRequestOptions, 'method'>,
  ): Promise<Response>

  extend(defaults: ClientDefaults): HttpClient
}

type JsonRequestOptions = RequestOptions & {
  responseType?: 'json'
}

type TextRequestOptions = RequestOptions & {
  responseType: 'text'
}

type BlobRequestOptions = RequestOptions & {
  responseType: 'blob'
}

type ArrayBufferRequestOptions = RequestOptions & {
  responseType: 'arrayBuffer'
}

type RawRequestOptions = RequestOptions & {
  responseType: 'raw'
}
