# clearfetch

A dependency-free, fetch-native HTTP client for modern JavaScript and TypeScript runtimes.

```bash
npm install @gavoryn/clearfetch
```

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

### Error handling

```ts
import {
  HttpError,
  ParseError,
  TimeoutError,
  createClient,
} from '@gavoryn/clearfetch'

const api = createClient({
  baseURL: 'https://api.example.com',
})

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

const data = await api.get<unknown>('/users/123')
const user = User.parse(data)
```

If you need end-to-end runtime safety, validate parsed data with a schema library such as Zod or Valibot after the request resolves.

## Behavior notes

- Non-2xx responses throw `HttpError`.
- JSON mode returns `undefined` for empty response bodies.
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
