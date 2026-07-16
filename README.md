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

### Query parameters

```ts
import { createClient } from '@gavoryn/clearfetch'

const api = createClient({
  baseURL: 'https://api.example.com',
})

const users = await api.get('/users', {
  query: {
    active: true,
    tag: ['admin', 'editor'],
  },
})

const ordered = await api.get('/users', {
  query: new URLSearchParams('tag=admin&page=1&tag=editor'),
})
```

Use an object for ordinary query parameters. Use native `URLSearchParams` when duplicate-key ordering matters.

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
- rejects values when `JSON.stringify()` returns `undefined` or throws `TypeError` with `ConfigError`; other caller-owned exceptions encountered during serialization, including from `toJSON()` or property access, propagate as-is

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

Request-level options override client defaults. Request headers replace matching
client header values, while client hooks run before request hooks and each hook
list retains its definition order.

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

Retries are disabled by default. When enabled, they are intentionally conservative. Streaming request bodies are rejected when the request method is eligible for multiple attempts.
They are a convenience for bounded retry cases, not a general resilience framework.
Retried `FormData` preserves field values and file contents, names, and media
types, but native multipart boundary encoding is not guaranteed to be
byte-for-byte identical between attempts. Pre-serialize a body when exact bytes
are part of an application signature or idempotency scheme.

### Abort a request

```ts
import {
  AbortRequestError,
  createClient,
} from '@gavoryn/clearfetch'

const controller = new AbortController()
const api = createClient({
  baseURL: 'https://api.example.com',
})

const promise = api.get('/reports/current', {
  signal: controller.signal,
})

controller.abort(new Error('user cancelled'))

try {
  await promise
} catch (error) {
  if (error instanceof AbortRequestError) {
    console.error('Request cancelled', error.cause)
  }
}
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

`beforeRequest` hook failures, request-normalization failures, retry rebuild
failures, and request-construction failures propagate as-is and are observable
through `onError` before being re-thrown. Retry-backoff aborts are normalized to
`AbortRequestError`, passed through `onError`, and re-thrown. `afterResponse`
hooks receive a cloned `Response`, so reading the body there does not consume
the response used for normal parsing or `HttpError` creation.

Hook scope is intentionally narrow:

- `beforeRequest` may mutate headers and may replace the URL with a final absolute URL
- `afterResponse` and `onError` are observational only apart from throwing
- `context.options` is read-only hook metadata, not a supported mutation surface

Client hooks run before request hooks. Within each client or request hook list,
hooks run in definition order.

Cloned `afterResponse` inspection is intended for ordinary API payloads, not large streaming or heavy binary workflows.

#### Safe diagnostic header logging

clearfetch has no built-in logging or telemetry. Applications that log request
diagnostics can use `redactHeaders()` to copy headers and replace common
sensitive values before writing application-owned diagnostics.
By default, it redacts exact case-insensitive matches for `authorization`,
`cookie`, `set-cookie`, `proxy-authorization`, `x-api-key`, and `api-key`.

```ts
import { createClient, redactHeaders } from '@gavoryn/clearfetch'

const api = createClient({
  hooks: {
    beforeRequest: [
      (context) => {
        const safeHeaders = redactHeaders(context.headers)
        console.log(Object.fromEntries(safeHeaders))
      },
    ],
  },
})
```

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

const textApi = createClient({
  baseURL: 'https://api.example.com',
  responseType: 'text',
})

const typedHealth: string = await textApi.get('/health')
const jsonStatus = await textApi.get<{ ok: boolean }>('/status', {
  responseType: 'json',
})
```

Client-level `responseType` defaults are reflected in the returned client type.
A request-level `responseType` still overrides the client default.

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

Because successful empty JSON bodies resolve as `undefined`, handle that case
before runtime validation when an endpoint may return no content:

```ts
const data = await api.get<unknown>('/users/123')
if (data === undefined) {
  throw new Error('Expected a response body')
}
const user = User.parse(data)
```

## Behavior notes

- Non-2xx responses throw `HttpError`.
- `HttpError.bodyText` capture is bounded and may be truncated for very large payloads.
- `ParseError.bodyText` capture is also bounded and may be truncated for very large invalid JSON payloads.
- `HttpError.response` remains available for status, headers, and metadata, but its body may already be consumed or canceled by diagnostic `bodyText` capture.
- JSON mode returns `undefined` for empty response bodies.
- In JSON mode, successful empty bodies resolve as `T | undefined`.
- No default timeout is applied. Requests run until completion or external abort unless `timeout` is configured.
- Invalid request configuration, including invalid hook lists, fails fast with `ConfigError`.
- Hook, request-normalization, retry rebuild, and request-construction failures are not wrapped as `NetworkError`.
- `afterResponse` receives a cloned `Response` for safe inspection.
- Relative request inputs require `baseURL`.
- `beforeRequest` may override the URL only with a final absolute URL.
- `beforeRequest` may mutate headers, but hook option metadata is read-only.
- Retry support is opt-in and conservative by default.
- Streaming request bodies are rejected only when the request method is eligible for multiple attempts.
- The `json` helper serializes request bodies and sets `Content-Type: application/json` when absent.
- `body` and `json` cannot be used together.
- TypeScript rejects common invalid option combinations such as `body` plus `json`, and request bodies on `GET`/`HEAD` request shapes. Runtime validation still protects JavaScript callers.
- The package performs no telemetry or hidden network activity beyond the caller's request.

## Advanced behavior notes

- Timeout windows are per attempt when retries are enabled. A configured `timeout` is not a total deadline across all retry attempts.
- External abort signals surface as `AbortRequestError`, including when the signal was aborted with a custom reason.
- External abort beats timeout if it happens first; timeout beats external abort if the timeout fires first.
- Timeout aborts surface as `TimeoutError`.
- External abort reasons are preserved as `AbortRequestError.cause` when the platform exposes them.
- Retry backoff waits are abortable.
- Retry attempts reuse a snapshot of the initially normalized URL, headers, retry policy, and request body. JSON bodies are serialized once before the first attempt.
- Retryable `FormData` file values that the current runtime cannot clone safely are rejected instead of being coerced into different payloads.
- Retried `FormData` preserves semantic values but does not guarantee byte-identical multipart boundaries across attempts.
- Timeout windows start after `beforeRequest` hooks complete.
- Retry backoff waits do not consume per-attempt timeout windows.
- If `beforeRequest` replaces `context.url`, that replacement is final. Previously resolved `baseURL` and query parameters are not reapplied to the replacement URL.
- Hook metadata includes `context.options.attempt` and `context.options.maxAttempts`. Non-retried requests report attempt `1` and max attempts `1`.
- When `query` serializes to a non-empty string, hook metadata includes `context.options.queryString` without a leading `?`. Existing search parameters from the input URL remain visible on `context.url`.

## Important limitations by design

- The package stays close to native `fetch` rather than inventing a separate transport model.
- Hooks are intentionally narrower than axios-style interceptors.
- Retries are conservative and explicit, not aggressive or automatic.
- The package is ESM-only and targets modern runtimes only.
- The public API is intentionally small; missing features are often deliberate non-goals, not incomplete work.

## Supported runtimes

clearfetch currently supports:

- Node.js `18.x` and newer for package compatibility
- modern browsers with native `fetch`, `Request`, `Response`, `Headers`, `URL`, and `AbortController`
- TypeScript `5.0` and newer for the published declaration surface

The package is ESM-only and does not target legacy runtimes or polyfill-driven environments.
Features that accept `Blob`, `File`, `FormData`, `URLSearchParams`, or
`ReadableStream` require the corresponding native platform implementation.
For security-sensitive use, run clearfetch on a Node.js release line that is
still [supported upstream](https://nodejs.org/en/about/previous-releases); EOL
Node.js releases do not receive upstream security fixes.

## Security

- The package includes no built-in telemetry.
- The package performs no hidden network activity beyond the caller's request.
- Vulnerability reports should follow the policy in [SECURITY.md](./SECURITY.md).

## Release and CI

- CI lints GitHub Actions workflows before merge.
- CI runs lint, test, and build checks across the declared Node.js compatibility matrix, including Node.js `26`.
- CI also runs a lightweight browser-like test path using `happy-dom` on Node.js `24`.
- CI runs a focused real-Chromium test for native values created in another browser realm.
- CI verifies the published declaration surface with TypeScript `5.0`.
- Dependency review is enforced for pull requests and supports manual base/head validation.
- CI rejects non-registry lockfile sources, missing SHA-512 integrity, and unreviewed install scripts before dependency installation.
- Automated installs disable dependency lifecycle scripts, and a weekly read-only audit checks advisories, registry signatures, and attestations.
- The release workflow supports a non-publishing dry-run path via manual dispatch.
- npm publishing now uses npm trusted publishing from GitHub Actions instead of a long-lived publish token.
- The release workflow publishes the exact smoke-tested tarball with provenance from an OIDC-only job; a separate write-only job creates or verifies the matching GitHub Release record.
- Normal releases are expected to publish from GitHub Actions, not from local machines.
- Release and repository protection policy is documented in [RELEASE.md](./RELEASE.md).

## Package surface

The public package surface is intentionally narrow:

- the root export provides the supported runtime API and public types
- internal implementation modules are not part of the supported import contract
- the deprecated `NormalizedRequestOptions` type remains exported only for compatibility and is planned for removal in the next major version
- the package includes no lifecycle scripts and is intended to publish only built `dist/` artifacts
- JavaScript source maps remain available for mapped stack traces; declaration maps are omitted because TypeScript source files are not shipped
- packed and unpacked artifact sizes and file counts are guarded by deliberate budgets

## Development

- `npm ci --ignore-scripts --registry=https://registry.npmjs.org`: install locked development dependencies without lifecycle scripts
- `npm run build`: compile the package into `dist/`
- `npm run check:lockfile`: validate lockfile origins, integrity, development-only scope, and the reviewed install-script allowlist
- `npm run check:dependency-audit`: fail on moderate-or-higher known dependency advisories
- `npm run check:dependency-signatures`: verify installed-package registry signatures and attestations
- `npm run check:package-metadata`: validate publish metadata and zero-runtime-dependency posture
- `npm run check:pack-smoke`: smoke-test the packed tarball from a clean temporary install
- `npm run check:publish-dry-run`: dry-run unpublished workspace versions; pass a retained `.tgz` to compare exact registry integrity for an existing version, or use `-- --allow-existing` only for non-publishing validation
- `npm run lint`: run TypeScript static checks
- `npm test`: run the test suite
- `npm run test:browser-like`: run browser-like package entrypoint coverage with `happy-dom`
- `npm run test:browser-real`: build and run focused cross-realm coverage in Chromium; run `node node_modules/playwright/cli.js install chromium` once before the first local invocation
- `npm run test:types-compat`: build and compile a consumer fixture with the minimum supported TypeScript version

## Status

`clearfetch` is published as `@gavoryn/clearfetch`. The `main` branch may be
ahead of the latest npm package until a matching release tag runs the Release
workflow. Check npm and GitHub Releases for the currently published version.
Project goals and behavior are documented in `PURPOSE.md` and `DESIGN.md`.
