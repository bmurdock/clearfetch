# Migrating to 2.0.0

Version 2.0.0 corrects the public client types and removes a deprecated internal
metadata type. This guide compares 2.0.0 with 1.0.9; the changelog records older
1.x changes separately. A version entry describes source changes, not proof of
publication. Check npm and GitHub Releases before upgrading.

## Update client annotations

Plain `HttpClient` means a client with a JSON default. In 1.0.9, a non-JSON client
could incorrectly satisfy that type. Version 2 rejects that assignment.

Before (accepted in 1.0.9):

```ts
import { createClient, type HttpClient } from '@gavoryn/clearfetch'

const api: HttpClient = createClient({ responseType: 'text' })
```

After:

```ts
import { createClient, type HttpClient } from '@gavoryn/clearfetch'

const api: HttpClient<'text'> = createClient({ responseType: 'text' })
const health: string = await api.get('https://api.example.com/health')
```

You can also omit the annotation and let `createClient()` infer it. Apply the
same change to function parameters, return types, stored clients, and clients
created by `extend()`. Use `'raw'`, `'blob'`, or `'arrayBuffer'` for those defaults.
JSON clients can continue to use plain `HttpClient`.

When the default mode is only known at runtime, keep that uncertainty in the
type:

```ts
import {
  createClient,
  type ClientDefaults,
  type HttpClient,
  type ResponseType,
} from '@gavoryn/clearfetch'

function makeClient(defaults: ClientDefaults): HttpClient<ResponseType> {
  return createClient(defaults)
}
```

A request-level literal `responseType` still selects a precise result type.
Forwarded `RequestOptions` values are supported, but their results are broad
when the response mode is unknown. Supply an explicit mode when the caller
requires one shape:

```ts
import { request, type RequestOptions } from '@gavoryn/clearfetch'

async function readText(url: string, options: RequestOptions): Promise<string> {
  return request(url, { ...options, responseType: 'text' })
}
```

Generic JSON types describe expected data; they do not validate the server's
response. Empty successful JSON bodies still return `undefined`.

## Replace the removed metadata type

`NormalizedRequestOptions` is no longer a public export. It described internal
execution state and was deprecated in 1.x. Choose the type for the boundary you
actually use:

| Consumer code | Public type |
| --- | --- |
| Options passed to a request | `RequestOptions` |
| Defaults passed to `createClient()` or `extend()` | `ClientDefaults` |
| Read-only options observed inside hooks | `HookRequestOptions` |

These types are not identical replacements. Remove assumptions about internal
normalization and do not import internal subpaths. Prefer contextual inference
for hook parameters:

```ts
import { createClient, type HookRequestOptions } from '@gavoryn/clearfetch'

function observeAttempt(options: HookRequestOptions): void {
  console.log(options.attempt, options.maxAttempts)
}

const api = createClient({
  hooks: {
    beforeRequest: [context => observeAttempt(context.options)],
  },
})
```

## Review cancellation behavior

The fixes in 2.0.0 can change when your hooks run and which error you receive:

- An already-aborted caller signal skips `beforeRequest`. Aborting during a
  pending `beforeRequest` exits the wait and prevents later hooks and fetch.
- Timeout or caller cancellation exits a pending `afterResponse` wait and
  prevents later response hooks. Late hook rejections are observed.
- Aborting with a clearfetch error as the reason produces `AbortRequestError`,
  with that original reason as `cause`.
- Valid client `onError` hooks still observe malformed request options or hook
  configuration, even when request-level hooks cannot be used.

Cancellation cannot stop work already started by your hook. Make that work
cooperate with cancellation where appropriate. Error observers remain awaited:
a pending `onError` hook delays rejection, and a throwing observer replaces the
error delivered to the caller.

## Own raw response body consumption

In raw mode, the attempt timeout ends when clearfetch returns the original
`Response`. Version 2 keeps the caller's signal connected to subsequent body
reads, including reads through a retained reader. Use a caller-owned signal and
keep any application deadline active until body consumption finishes:

```ts
import { request } from '@gavoryn/clearfetch'

const controller = new AbortController()
const deadline = setTimeout(() => controller.abort(), 5_000)
try {
  const response = await request('https://api.example.com/download', {
    responseType: 'raw',
    signal: controller.signal,
  })
  const text = await response.text()
  console.log(text)
} finally {
  clearTimeout(deadline)
}
```

Failures during a body read after return use native errors and do not invoke
clearfetch's `onError` hooks. Handle those errors around the body read. Raw mode
still throws `HttpError` for non-2xx responses.

## Preserve existing diagnostic and timeout assumptions

These behaviors already existed in 1.0.9 and are not new 2.0.0 changes:

- `HttpError.bodyText` is the diagnostic payload. Capture is bounded and may be
  partial or absent. The retained response is useful for status and headers;
  its body may have been consumed or canceled.
- No timeout is applied by default. Configured timeouts start after each
  attempt's `beforeRequest` hooks and exclude retry backoff. They are not a
  total deadline across attempts or raw-body consumption.
- Client defaults are validated during `createClient()` and `extend()`.
- Retries remain opt-in. Runtime dependencies remain zero.

The package remains ESM-only, with Node.js 18+ package compatibility and the
existing TypeScript 5.0 through 7.x declaration support. Security-sensitive
applications should use an upstream-supported Node.js release line.

## Verify the upgrade

1. Update client annotations and remove imports of `NormalizedRequestOptions`.
2. Compile your application and check dynamic-mode result handling.
3. Exercise cancellation during hooks and raw-body reads in your runtime.
4. Check error observers and code that branches on cancellation errors.

If you must defer migration, keep your application on its previously verified
1.x version. Do not repoint release tags or replace an already published package.
