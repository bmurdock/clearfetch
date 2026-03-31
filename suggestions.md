---

# Public API

The public API should be intentionally small.

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
  RequestMethod,
  ResponseType,
  QueryValue,
  QueryParams,
  RetryOptions,
  Hooks,
  BeforeRequestHook,
  AfterResponseHook,
  OnErrorHook,
  HttpClient,
} from './types'
```

---

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
        ctx.request.headers.set('Authorization', `Bearer ${token}`)
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

---


We can refer to https://github.com/axios/axios for ideas
