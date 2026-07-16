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
  parseJson?: (text: string) => unknown
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
  readonly attempt: number
  readonly maxAttempts: number
  readonly query?: QueryParams
  readonly queryString?: string
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
  parseJson: (text: string) => unknown
}

/**
 * Reusable client API produced by `createClient()`.
 */
export interface HttpClient<DefaultResponseType extends ResponseType = 'json'> {
  request<T = unknown>(
    input: string | URL,
    options?: DefaultRequestOptions,
  ): Promise<ResponseResult<T, DefaultResponseType>>

  request<T = unknown>(
    input: string | URL,
    options: JsonRequestOptions,
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
    options?: DefaultBodylessClientMethodOptions,
  ): Promise<ResponseResult<T, DefaultResponseType>>

  get<T = unknown>(
    input: string | URL,
    options: JsonBodylessClientMethodOptions,
  ): Promise<T | undefined>

  get(
    input: string | URL,
    options: TextBodylessClientMethodOptions,
  ): Promise<string>

  get(
    input: string | URL,
    options: BlobBodylessClientMethodOptions,
  ): Promise<Blob>

  get(
    input: string | URL,
    options: ArrayBufferBodylessClientMethodOptions,
  ): Promise<ArrayBuffer>

  get(
    input: string | URL,
    options: RawBodylessClientMethodOptions,
  ): Promise<Response>

  post<T = unknown>(
    input: string | URL,
    options?: DefaultClientMethodOptions,
  ): Promise<ResponseResult<T, DefaultResponseType>>

  post<T = unknown>(
    input: string | URL,
    options: JsonClientMethodOptions,
  ): Promise<T | undefined>

  post(
    input: string | URL,
    options: TextClientMethodOptions,
  ): Promise<string>

  post(
    input: string | URL,
    options: BlobClientMethodOptions,
  ): Promise<Blob>

  post(
    input: string | URL,
    options: ArrayBufferClientMethodOptions,
  ): Promise<ArrayBuffer>

  post(
    input: string | URL,
    options: RawClientMethodOptions,
  ): Promise<Response>

  put<T = unknown>(
    input: string | URL,
    options?: DefaultClientMethodOptions,
  ): Promise<ResponseResult<T, DefaultResponseType>>

  put<T = unknown>(
    input: string | URL,
    options: JsonClientMethodOptions,
  ): Promise<T | undefined>

  put(
    input: string | URL,
    options: TextClientMethodOptions,
  ): Promise<string>

  put(
    input: string | URL,
    options: BlobClientMethodOptions,
  ): Promise<Blob>

  put(
    input: string | URL,
    options: ArrayBufferClientMethodOptions,
  ): Promise<ArrayBuffer>

  put(
    input: string | URL,
    options: RawClientMethodOptions,
  ): Promise<Response>

  patch<T = unknown>(
    input: string | URL,
    options?: DefaultClientMethodOptions,
  ): Promise<ResponseResult<T, DefaultResponseType>>

  patch<T = unknown>(
    input: string | URL,
    options: JsonClientMethodOptions,
  ): Promise<T | undefined>

  patch(
    input: string | URL,
    options: TextClientMethodOptions,
  ): Promise<string>

  patch(
    input: string | URL,
    options: BlobClientMethodOptions,
  ): Promise<Blob>

  patch(
    input: string | URL,
    options: ArrayBufferClientMethodOptions,
  ): Promise<ArrayBuffer>

  patch(
    input: string | URL,
    options: RawClientMethodOptions,
  ): Promise<Response>

  delete<T = unknown>(
    input: string | URL,
    options?: DefaultClientMethodOptions,
  ): Promise<ResponseResult<T, DefaultResponseType>>

  delete<T = unknown>(
    input: string | URL,
    options: JsonClientMethodOptions,
  ): Promise<T | undefined>

  delete(
    input: string | URL,
    options: TextClientMethodOptions,
  ): Promise<string>

  delete(
    input: string | URL,
    options: BlobClientMethodOptions,
  ): Promise<Blob>

  delete(
    input: string | URL,
    options: ArrayBufferClientMethodOptions,
  ): Promise<ArrayBuffer>

  delete(
    input: string | URL,
    options: RawClientMethodOptions,
  ): Promise<Response>

  head<T = unknown>(
    input: string | URL,
    options?: DefaultBodylessClientMethodOptions,
  ): Promise<ResponseResult<T, DefaultResponseType>>

  head<T = unknown>(
    input: string | URL,
    options: JsonBodylessClientMethodOptions,
  ): Promise<T | undefined>

  head(
    input: string | URL,
    options: TextBodylessClientMethodOptions,
  ): Promise<string>

  head(
    input: string | URL,
    options: BlobBodylessClientMethodOptions,
  ): Promise<Blob>

  head(
    input: string | URL,
    options: ArrayBufferBodylessClientMethodOptions,
  ): Promise<ArrayBuffer>

  head(
    input: string | URL,
    options: RawBodylessClientMethodOptions,
  ): Promise<Response>

  options<T = unknown>(
    input: string | URL,
    options?: DefaultClientMethodOptions,
  ): Promise<ResponseResult<T, DefaultResponseType>>

  options<T = unknown>(
    input: string | URL,
    options: JsonClientMethodOptions,
  ): Promise<T | undefined>

  options(
    input: string | URL,
    options: TextClientMethodOptions,
  ): Promise<string>

  options(
    input: string | URL,
    options: BlobClientMethodOptions,
  ): Promise<Blob>

  options(
    input: string | URL,
    options: ArrayBufferClientMethodOptions,
  ): Promise<ArrayBuffer>

  options(
    input: string | URL,
    options: RawClientMethodOptions,
  ): Promise<Response>

  extend<ChildResponseType extends ResponseType>(
    defaults: Omit<ClientDefaults, 'responseType'> & {
      responseType: ChildResponseType
    },
  ): HttpClient<ChildResponseType>

  extend(
    defaults: Omit<ClientDefaults, 'responseType'> & {
      responseType?: never
    },
  ): HttpClient<DefaultResponseType>

  extend(defaults: ClientDefaults): HttpClient<ResponseType>
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

type DefaultRequestOptions = RequestOptions & {
  responseType?: never
}

type JsonRequestOptions = RequestOptions & {
  responseType: 'json'
}

type DefaultClientMethodOptions = ClientMethodOptions & {
  responseType?: never
}

type JsonClientMethodOptions = ClientMethodOptions & {
  responseType: 'json'
}

type BodylessClientMethodOptions = RequestOptionsBase & {
  body?: never
  json?: never
}

type DefaultBodylessClientMethodOptions = BodylessClientMethodOptions & {
  responseType?: never
}

type JsonBodylessClientMethodOptions = BodylessClientMethodOptions & {
  responseType: 'json'
}

type TextRequestOptions = RequestOptions & {
  responseType: 'text'
}

type TextClientMethodOptions = ClientMethodOptions & {
  responseType: 'text'
}

type TextBodylessClientMethodOptions = BodylessClientMethodOptions & {
  responseType: 'text'
}

type BlobRequestOptions = RequestOptions & {
  responseType: 'blob'
}

type BlobClientMethodOptions = ClientMethodOptions & {
  responseType: 'blob'
}

type BlobBodylessClientMethodOptions = BodylessClientMethodOptions & {
  responseType: 'blob'
}

type ArrayBufferRequestOptions = RequestOptions & {
  responseType: 'arrayBuffer'
}

type ArrayBufferClientMethodOptions = ClientMethodOptions & {
  responseType: 'arrayBuffer'
}

type ArrayBufferBodylessClientMethodOptions = BodylessClientMethodOptions & {
  responseType: 'arrayBuffer'
}

type RawRequestOptions = RequestOptions & {
  responseType: 'raw'
}

type RawClientMethodOptions = ClientMethodOptions & {
  responseType: 'raw'
}

type RawBodylessClientMethodOptions = BodylessClientMethodOptions & {
  responseType: 'raw'
}
