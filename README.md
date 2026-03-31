# clearfetch

A dependency-free, fetch-native HTTP client for modern JavaScript and TypeScript runtimes.

## Usage

### One-off request

```ts
import { request } from 'clearfetch'

const user = await request<{ id: string; name: string }>(
  'https://api.example.com/users/123',
)
```

### Reusable client

```ts
import { createClient } from 'clearfetch'

const api = createClient({
  baseURL: 'https://api.example.com',
  headers: {
    Accept: 'application/json',
  },
  timeout: 5_000,
})

const user = await api.get<{ id: string; name: string }>('/users/123')
```

### Extended client defaults

```ts
const authed = api.extend({
  headers: {
    Authorization: 'Bearer token',
  },
})

const profile = await authed.get('/me')
```

### Hooks

```ts
const api = createClient({
  hooks: {
    beforeRequest: [
      async (context) => {
        context.headers.set('x-client', 'clearfetch')
      },
    ],
    afterResponse: [
      async (context) => {
        console.log(context.response.status)
      },
    ],
    onError: [
      async (context) => {
        console.error(context.error)
      },
    ],
  },
})
```

### Error handling

```ts
import { HttpError, ParseError, TimeoutError } from 'clearfetch'

try {
  await api.get('/users/123')
} catch (error) {
  if (error instanceof HttpError) {
    console.error(error.status, error.bodyText)
  } else if (error instanceof TimeoutError) {
    console.error(error.timeout)
  } else if (error instanceof ParseError) {
    console.error(error.bodyText)
  }
}
```

## Behavior notes

- Non-2xx responses throw `HttpError`.
- JSON mode returns `undefined` for empty response bodies.
- Relative request inputs require `baseURL`.
- `beforeRequest` may override the URL only with a final absolute URL.
- Retry support is opt-in and conservative by default.

## Development

- `npm install`: install development dependencies
- `npm run build`: compile the package into `dist/`
- `npm run lint`: run TypeScript static checks
- `npm test`: run the test suite

## Status

The repository is currently in an implementation bootstrap phase. Design and API direction are documented in `PURPOSE.md`, `DESIGN.md`, and `suggestions.md`.
