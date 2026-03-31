export type RequestMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'HEAD'
  | 'OPTIONS'

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

export interface RetryOptions {
  attempts?: number
  backoffMs?: number
  maxBackoffMs?: number
  multiplier?: number
  retryOnStatuses?: number[]
  retryOnMethods?: RequestMethod[]
}

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

export interface ClientDefaults {
  baseURL?: string | URL
  headers?: HeadersInit
  timeout?: number
  responseType?: ResponseType
  retry?: false | RetryOptions
  hooks?: Hooks
  parseJson?: (text: string) => unknown
}

export interface BeforeRequestContext {
  input: string | URL
  url: URL
  headers: Headers
  body?: BodyInit | null
  options: NormalizedRequestOptions
}

export interface AfterResponseContext {
  input: string | URL
  request: Request
  response: Response
  options: NormalizedRequestOptions
}

export interface ErrorContext {
  input: string | URL
  request?: Request
  response?: Response
  error: unknown
  options?: NormalizedRequestOptions
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

export interface HttpClient {
  request<T = unknown>(
    input: string | URL,
    options?: RequestOptions,
  ): Promise<T | Response | undefined>

  get<T = unknown>(
    input: string | URL,
    options?: Omit<RequestOptions, 'method'>,
  ): Promise<T | Response | undefined>

  post<T = unknown>(
    input: string | URL,
    options?: Omit<RequestOptions, 'method'>,
  ): Promise<T | Response | undefined>

  put<T = unknown>(
    input: string | URL,
    options?: Omit<RequestOptions, 'method'>,
  ): Promise<T | Response | undefined>

  patch<T = unknown>(
    input: string | URL,
    options?: Omit<RequestOptions, 'method'>,
  ): Promise<T | Response | undefined>

  delete<T = unknown>(
    input: string | URL,
    options?: Omit<RequestOptions, 'method'>,
  ): Promise<T | Response | undefined>

  head<T = unknown>(
    input: string | URL,
    options?: Omit<RequestOptions, 'method'>,
  ): Promise<T | Response | undefined>

  options<T = unknown>(
    input: string | URL,
    options?: Omit<RequestOptions, 'method'>,
  ): Promise<T | Response | undefined>

  extend(defaults: ClientDefaults): HttpClient
}
