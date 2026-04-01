# clearfetch

A dependency-free, fetch-native HTTP client for modern JavaScript and TypeScript runtimes.

```bash
npm install @gavoryn/clearfetch
```

## Why clearfetch?

Use clearfetch when you want a thin layer over native `fetch`, not a separate transport abstraction.

Choose it when you want:

- reusable client defaults for `baseURL`, headers, timeout, retries, and hooks
- JSON request/response convenience without runtime dependencies
- predictable typed errors instead of repeating the same `fetch` boilerplate
- a small surface area that is easy to audit

## Not a fit if...

clearfetch is intentionally narrow. It is probably not the right client if you need:

- upload or download progress APIs
- interceptor-style response rewriting or a middleware ecosystem
- legacy CommonJS or old-runtime support
- automatic caching, cookie jars, XSRF helpers, or transport adapters
- a broader, older, more feature-rich abstraction like axios

Hooks are intentionally not axios-style interceptors.

## Usage

### One-off request

```ts
import { request } from '@gavoryn/clearfetch'

const user = await request<{ id: string; name: string }>(
  'https://api.example.com/users/123',
)
```

### Reusable client

```ts
import { createClient } from '@gavoryn/clearfetch'

const api = createClient({
  baseURL: 'https://api.example.com',
  headers: {
    Accept: 'application/json',
  },
  timeout: 5_000,
})

const user = await api.get<{ id: string; name: string }>('/users/123')
```

### JSON request bodies

```ts
import { createClient } from '@gavoryn/clearfetch'

const api = createClient({
  baseURL: 'https://api.example.com',
})

const created = await api.post<{ id: string }>('/users', {
  json: {
    name: 'Ada Lovelace',
    role: 'admin',
  },
})
```

If `json` is provided, clearfetch:

- serializes the value with `JSON.stringify()`
- sets `Content-Type: application/json` if it is not already present
- rejects the request with `ConfigError` if `body` is also provided

Use `body` directly only when you want to send a raw payload such as `FormData`, `URLSearchParams`, or pre-serialized text.

### Raw body payloads

```ts
import { createClient } from '@gavoryn/clearfetch'

const api = createClient({
  baseURL: 'https://api.example.com',
})

const form = new FormData()
form.set('avatar', fileInput.files[0])

await api.post('/profile/avatar', {
  body: form,
})
```

### Extended client defaults

```ts
import { createClient } from '@gavoryn/clearfetch'

const api = createClient({
  baseURL: 'https://api.example.com',
})

const authed = api.extend({
  headers: {
    Authorization: 'Bearer token',
  },
})

const profile = await authed.get('/me')
```

### Conservative retries

```ts
import { createClient } from '@gavoryn/clearfetch'

const api = createClient({
  baseURL: 'https://api.example.com',
  retry: {
    attempts: 3,
    backoffMs: 200,
    maxBackoffMs: 1_000,
    retryOnMethods: ['GET', 'HEAD'],
    retryOnStatuses: [429, 503],
  },
})

const response = await api.get('/status')
```

Retries are disabled by default. When enabled, they are intentionally conservative and do not allow streaming request bodies.
They are a convenience for bounded retry cases, not a general resilience framework.

### Abort a request

```ts
import { createClient } from '@gavoryn/clearfetch'

const controller = new AbortController()
const api = createClient({
  baseURL: 'https://api.example.com',
})

const promise = api.get('/reports/current', {
  signal: controller.signal,
})

controller.abort()

await promise
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

`beforeRequest` hook failures propagate as-is. `afterResponse` hooks receive a cloned
`Response`, so reading the body there does not consume the response used for normal
parsing or `HttpError` creation.

Hook scope is intentionally narrow:

- `beforeRequest` may mutate headers and may replace the URL with a final absolute URL
- `afterResponse` and `onError` are observational only apart from throwing
- `context.options` is read-only hook metadata, not a supported mutation surface

Cloned `afterResponse` inspection is intended for ordinary API payloads, not large streaming or heavy binary workflows.

### Error handling

```ts
import {
  HttpError,
  ParseError,
  TimeoutError,
  createClient,
  isHttpClientError,
} from '@gavoryn/clearfetch'

const api = createClient({
  baseURL: 'https://api.example.com',
})

try {
  await api.get('/users/123')
} catch (error) {
  if (!isHttpClientError(error)) {
    throw error
  } else if (error instanceof HttpError) {
    console.error(error.status, error.bodyText)
  } else if (error instanceof ParseError) {
    console.error(error.bodyText)
  } else if (error instanceof TimeoutError) {
    console.error(error.timeout)
  }
}
```

### Text and raw responses

```ts
import { createClient } from '@gavoryn/clearfetch'

const api = createClient({
  baseURL: 'https://api.example.com',
})

const health = await api.get('/health', {
  responseType: 'text',
})

const rawResponse = await api.get('/download', {
  responseType: 'raw',
})
```

### Runtime validation

TypeScript generics describe the expected response shape, but they do not validate response data at runtime.

```ts
import { z } from 'zod'
import { createClient } from '@gavoryn/clearfetch'

const User = z.object({
  id: z.string(),
  name: z.string(),
})

const api = createClient({
  baseURL: 'https://api.example.com',
})

const data: unknown = await api.get<unknown>('/users/123')
const user = User.parse(data)
```

If you need end-to-end runtime safety, validate parsed data with a schema library such as Zod or Valibot after the request resolves.

## Behavior notes

- Non-2xx responses throw `HttpError`.
- JSON mode returns `undefined` for empty response bodies.
- In JSON mode, successful empty bodies resolve as `T | undefined`.
- No default timeout is applied. Requests run until completion or external abort unless `timeout` is configured.
- Hook failures are not wrapped as `NetworkError`.
- `afterResponse` receives a cloned `Response` for safe inspection.
- Relative request inputs require `baseURL`.
- `beforeRequest` may override the URL only with a final absolute URL.
- `beforeRequest` may mutate headers, but hook option metadata is read-only.
- Retry support is opt-in and conservative by default.
- Retry support does not allow streaming request bodies.
- The `json` helper serializes request bodies and sets `Content-Type: application/json` when absent.
- `body` and `json` cannot be used together.
- The package performs no telemetry or hidden network activity beyond the caller's request.

## Important limitations by design

- The package stays close to native `fetch` rather than inventing a separate transport model.
- Hooks are intentionally narrower than axios-style interceptors.
- Retries are conservative and explicit, not aggressive or automatic.
- The package is ESM-only and targets modern runtimes only.
- The public API is intentionally small; missing features are often deliberate non-goals, not incomplete work.

## Supported runtimes

clearfetch currently supports:

- Node.js `18.x` and newer
- modern browsers with native `fetch`, `Request`, `Response`, `Headers`, `URL`, and `AbortController`

The package is ESM-only and does not target legacy runtimes or polyfill-driven environments.

## Security

- The package includes no built-in telemetry.
- The package performs no hidden network activity beyond the caller's request.
- Vulnerability reports should follow the policy in [SECURITY.md](./SECURITY.md).

## Release and CI

- CI lints GitHub Actions workflows before merge.
- CI runs lint, test, and build checks on supported Node.js versions.
- CI also runs a lightweight browser-like test path using `happy-dom` on Node.js `20`.
- Dependency review is configured for pull requests and manual validation, but requires the relevant GitHub security features to be enabled on the repository.
- The release workflow supports a non-publishing dry-run path via manual dispatch.
- npm publishing now uses npm trusted publishing from GitHub Actions instead of a long-lived publish token.
- Normal releases are expected to publish from GitHub Actions, not from local machines.
- Release and repository protection policy is documented in [RELEASE.md](./RELEASE.md).

## Package surface

The public package surface is intentionally narrow:

- the root export provides the supported runtime API and public types
- internal implementation modules are not part of the supported import contract
- the package includes no lifecycle scripts and is intended to publish only built `dist/` artifacts

## Development

- `npm install`: install development dependencies
- `npm run build`: compile the package into `dist/`
- `npm run check:package-metadata`: validate publish metadata and zero-runtime-dependency posture
- `npm run check:pack-smoke`: smoke-test the packed tarball from a clean temporary install
- `npm run lint`: run TypeScript static checks
- `npm test`: run the test suite

## Status

`clearfetch` is published as `@gavoryn/clearfetch`. Project goals and behavior are documented in `PURPOSE.md` and `DESIGN.md`.
