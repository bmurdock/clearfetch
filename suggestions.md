# Public API

The public API should be intentionally small and centered on two entry points: a one-off request helper and a reusable client.

## Phase 0: design lock

These decisions should be treated as locked before implementation begins.

### Runtime support

Target `Node 18+` and modern browsers. This keeps the package aligned with native `fetch` availability while avoiding legacy support complexity.

### Module strategy

Start with `ESM` as the primary module format. Add CJS support only if it can be done without materially increasing build, test, or maintenance complexity.

### v1 feature lock

v1 includes:

- dependency-free runtime
- `request()`
- `createClient()`
- HTTP verb methods
- `extend()`
- base URL support
- deterministic header merging
- query serialization
- JSON body helper
- response parsing modes
- `responseType`: `json`, `text`, `blob`, `arrayBuffer`, `raw`
- timeout handling
- typed errors
- hooks
- conservative retry support
- strict TypeScript types
- ESM build
- thorough tests

v1 excludes:

- upload progress
- download progress abstractions
- adapters
- Node HTTP/HTTPS custom transports
- progress callback APIs
- old browser support
- XSRF special handling
- request/response transform chains
- pluggable serializer framework
- automatic caching
- cookie jar management
- tracing integrations in core

## Top-level exports

```ts
export { createClient } from './client'
export { request } from './request'

export {
  HttpClientError,
  HttpError,
  NetworkError,
  TimeoutError,
  AbortRequestError,
  ParseError,
  ConfigError,
} from './errors'

export type {
  ClientDefaults,
  RequestOptions,
  NormalizedRequestOptions,
  RequestMethod,
  ResponseType,
  PrimitiveQueryValue,
  QueryValue,
  QueryParams,
  RetryOptions,
  BeforeRequestContext,
  AfterResponseContext,
  ErrorContext,
  Hooks,
  BeforeRequestHook,
  AfterResponseHook,
  OnErrorHook,
  HttpClient,
} from './types'
```

## Core method and response types

```ts
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
```

## Retry configuration

Retry support should stay conservative and be disabled by default unless the caller opts in.

```ts
export interface RetryOptions {
  attempts?: number
  backoffMs?: number
  maxBackoffMs?: number
  multiplier?: number
  retryOnStatuses?: number[]
  retryOnMethods?: RequestMethod[]
}
```

## Hooks

Hooks should receive context objects rather than raw values. That keeps the signatures stable as the library grows and gives room to add metadata later without breaking callers.

```ts
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

export type BeforeRequestHook =
  (context: BeforeRequestContext) => void | Promise<void>

export type AfterResponseHook =
  (context: AfterResponseContext) => void | Promise<void>

export type OnErrorHook =
  (context: ErrorContext) => void | Promise<void>

export interface Hooks {
  beforeRequest?: BeforeRequestHook[]
  afterResponse?: AfterResponseHook[]
  onError?: OnErrorHook[]
}
```

## Request and client config

```ts
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
```

## Behavioral rules

These rules should be treated as part of the v1 contract and documented clearly.

### JSON request behavior

If `json` is provided:

- set `Content-Type: application/json` if it is not already present
- serialize the payload with `JSON.stringify(json)`
- reject the request with `ConfigError` if `body` is also provided

### JSON response behavior

If `responseType` is `json`:

- read the response body as text
- parse it with the configured JSON parser
- return `undefined` if the body text is empty
- throw `ParseError` if parsing fails

The implementation should not silently fall back to returning text.

### Non-2xx behavior

Always throw `HttpError` for non-2xx responses.

### Query serialization

Query handling should be explicit and stable:

- skip `undefined` values
- serialize `null` as the literal string `null`
- repeat keys for arrays by default, for example `tags=a&tags=b`

Repeated keys are the least surprising default.

### Hook order

Hook ordering should be deterministic and documented. For v1:

- client or default hooks run first
- request-level hooks run second

That gives request-level hooks the final chance to override earlier behavior.

### Relative URL behavior

- relative request inputs require `baseURL`
- if `baseURL` is absent, relative inputs fail with `ConfigError`

### URL override behavior

If a `beforeRequest` hook replaces the URL:

- the replacement must be a fully resolved absolute URL
- relative replacement URLs fail with `ConfigError`
- the replacement fully overrides the previously resolved URL, including query parameters
- the library does not reapply `baseURL` or re-merge query parameters after override

## Internal normalized config

This type would likely stay internal, but it is still useful to define because it describes the fully resolved shape the request pipeline operates on after defaults are merged and validated.

```ts
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
```

## Error model

The error model is a major part of the package value. It should clearly distinguish transport failure, timeout, HTTP failure, parse failure, and configuration misuse.

### Error semantics

The package documentation should explicitly guarantee these mappings:

- network failure => `NetworkError`
- timeout => `TimeoutError`
- external abort => `AbortRequestError`
- non-2xx response => `HttpError`
- parse failure => `ParseError`
- invalid usage => `ConfigError`

This is a meaningful ergonomic improvement over raw `fetch`, where these cases are less uniform and require more caller-side interpretation.

### Base error

```ts
export class HttpClientError extends Error {
  readonly code: string
  readonly cause?: unknown

  constructor(message: string, code: string, cause?: unknown) {
    super(message)
    this.name = new.target.name
    this.code = code
    this.cause = cause
  }
}
```

### Specific errors

#### `ConfigError`

Used for invalid client usage, such as:

- `body` and `json` both being set
- a negative timeout
- an invalid method
- an invalid base URL

```ts
export class ConfigError extends HttpClientError {
  constructor(message: string, cause?: unknown) {
    super(message, 'CONFIG_ERROR', cause)
  }
}
```

#### `NetworkError`

Used for fetch or transport-level failures.

```ts
export class NetworkError extends HttpClientError {
  constructor(message = 'Network request failed', cause?: unknown) {
    super(message, 'NETWORK_ERROR', cause)
  }
}
```

#### `TimeoutError`

Used for timeout-triggered aborts.

```ts
export class TimeoutError extends HttpClientError {
  readonly timeout: number

  constructor(timeout: number, cause?: unknown) {
    super(`Request timed out after ${timeout}ms`, 'TIMEOUT_ERROR', cause)
    this.timeout = timeout
  }
}
```

#### `AbortRequestError`

Used for caller-initiated aborts that are not timeouts.

```ts
export class AbortRequestError extends HttpClientError {
  constructor(message = 'Request was aborted', cause?: unknown) {
    super(message, 'ABORT_ERROR', cause)
  }
}
```

#### `HttpError`

Used for non-2xx responses.

```ts
export class HttpError extends HttpClientError {
  readonly status: number
  readonly statusText: string
  readonly response: Response
  readonly request?: Request
  readonly bodyText?: string

  constructor(params: {
    status: number
    statusText: string
    response: Response
    request?: Request
    bodyText?: string
  }) {
    super(`HTTP ${params.status} ${params.statusText}`, 'HTTP_ERROR')
    this.status = params.status
    this.statusText = params.statusText
    this.response = params.response
    this.request = params.request
    this.bodyText = params.bodyText
  }
}
```

#### `ParseError`

Used for response parsing failures, especially JSON.

```ts
export class ParseError extends HttpClientError {
  readonly response: Response
  readonly responseType: ResponseType
  readonly bodyText?: string

  constructor(params: {
    response: Response
    responseType: ResponseType
    bodyText?: string
    cause?: unknown
  }) {
    super(
      `Failed to parse response as ${params.responseType}`,
      'PARSE_ERROR',
      params.cause
    )
    this.response = params.response
    this.responseType = params.responseType
    this.bodyText = params.bodyText
  }
}
```

## Functions

### `createClient(defaults?: ClientDefaults): HttpClient`

Creates a reusable client instance with shared defaults such as `baseURL`, headers, timeout, and hooks.

### `request<T = unknown>(input: string | URL, options?: RequestOptions): Promise<T | Response | undefined>`

Performs a one-off request without creating a client.

In `json` mode, empty response bodies yield `undefined`.

## Client methods

```ts
interface HttpClient {
  request<T = unknown>(input: string | URL, options?: RequestOptions): Promise<T | Response | undefined>

  get<T = unknown>(input: string | URL, options?: Omit<RequestOptions, 'method'>): Promise<T | Response | undefined>
  post<T = unknown>(input: string | URL, options?: Omit<RequestOptions, 'method'>): Promise<T | Response | undefined>
  put<T = unknown>(input: string | URL, options?: Omit<RequestOptions, 'method'>): Promise<T | Response | undefined>
  patch<T = unknown>(input: string | URL, options?: Omit<RequestOptions, 'method'>): Promise<T | Response | undefined>
  delete<T = unknown>(input: string | URL, options?: Omit<RequestOptions, 'method'>): Promise<T | Response | undefined>
  head<T = unknown>(input: string | URL, options?: Omit<RequestOptions, 'method'>): Promise<T | Response | undefined>
  options<T = unknown>(input: string | URL, options?: Omit<RequestOptions, 'method'>): Promise<T | Response | undefined>

  extend(defaults: ClientDefaults): HttpClient
}
```

`extend()` is worth including in v1. It keeps the base client reusable while allowing narrow specialization for auth, service-specific headers, or per-feature defaults.

```ts
const api = createClient({ baseURL: 'https://api.example.com' })
const authed = api.extend({
  headers: { Authorization: 'Bearer token' },
})
```

## Primary usage

### Direct request style

```ts
const user = await request<User>('https://api.example.com/users/123', {
  responseType: 'json',
  timeout: 5000,
})
```

### Client style

```ts
const api = createClient({
  baseURL: 'https://api.example.com',
  timeout: 5000,
  headers: {
    Accept: 'application/json',
  },
})

const user = await api.get<User>('/users/123')
```

### JSON body convenience

```ts
const created = await api.post<User>('/users', {
  json: {
    name: 'Brian',
    role: 'admin',
  },
})
```

### Query params

```ts
const results = await api.get<SearchResponse>('/search', {
  query: {
    q: 'http client',
    tags: ['ts', 'fetch'],
    page: 1,
  },
})
```

### Raw response access

```ts
const response = await api.get('/download/report', {
  responseType: 'raw',
})
```

### Hooks

```ts
const api = createClient({
  hooks: {
    beforeRequest: [
      async (ctx) => {
        const token = await getToken()
        ctx.headers.set('Authorization', `Bearer ${token}`)
      },
    ],
    afterResponse: [
      async (ctx) => {
        if (ctx.response.status === 401) {
          // central auth handling
        }
      },
    ],
    onError: [
      async (ctx) => {
        console.error(ctx.error)
      },
    ],
  },
})
```

We can refer to https://github.com/axios/axios for ideas, but the implementation should stay smaller, more explicit, and closer to native `fetch`.
