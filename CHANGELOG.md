# Changelog

Entries describe repository versions. For current releases, completion requires
the matching `vX.Y.Z` tag to publish to npm and a GitHub Release to exist.
Versions `1.0.0` and `1.0.1` predate the GitHub Release record requirement;
their npm publications and Git tags remain the historical release evidence.

## Unreleased

- validate all supplied client defaults during `createClient()` and `extend()`
  construction, including malformed string base URLs and invalid scalar default
  values
- consolidate reusable-client response-mode overloads so all client methods
  preserve explicit `json`, `text`, `blob`, `arrayBuffer`, and `raw` return
  types in the declaration surface
- bound non-2xx diagnostic body reads by size and time, preserve valid Unicode
  while truncating, and keep stalled error bodies from delaying `HttpError`
  classification indefinitely
- classify asynchronous custom JSON parser rejections as `ParseError` and keep
  timeout or external-abort signals authoritative while a parser is pending
- reject invalid request abort signals with `ConfigError` while preserving
  cross-realm native signal support
- retry post-publish npm integrity and attestation visibility checks during
  bounded registry propagation windows
- clean up root tarballs when packed-artifact assertions fail

## 1.0.7

- reject timeout and retry-delay values above the maximum reliable platform timer delay and preserve timeout classification through `afterResponse` hooks
- reject invalid option/default containers, headers, and nested retry values with `ConfigError` instead of silently inheriting defaults or leaking platform errors
- accept absolute `URL` replacements created in another browser realm from `beforeRequest` hooks and snapshot cross-realm `baseURL` defaults
- snapshot accessor-backed query values once so request URLs and hook metadata cannot diverge
- snapshot retry inputs and serialize JSON once so every eligible attempt replays stable request values without copying bodies for excluded methods
- preserve retryable `FormData` file contents and metadata, reject files that cannot be cloned safely, and limit stream rejection to methods with multiple effective attempts
- clarify that retried multipart bodies preserve values but do not guarantee byte-identical boundary encoding
- reflect client-level response type defaults in TypeScript return types, including extended clients, and deprecate the internal `NormalizedRequestOptions` export
- route aborts during retry backoff through `onError` before rethrowing
- give every `afterResponse` hook an independently readable response clone and cancel abandoned bodies on hook failure or before retry
- keep internal execution options out of the public `beforeRequest` hook context
- preserve special query keys such as `__proto__` as ordinary own properties in retry and hook snapshots
- reject invalid query containers and JSON values for which `JSON.stringify` returns `undefined` or throws `TypeError` with `ConfigError`
- recognize `URLSearchParams`, `ArrayBuffer`, `FormData`, and request streams across browser realm boundaries
- isolate browser-only dependencies from the Node.js compatibility suite, add real Chromium cross-realm coverage, and verify published declarations with TypeScript 5.0
- split query serialization and web-platform value handling into focused internal modules
- omit declaration maps that reference unshipped source files and enforce packed artifact size budgets
- add Node.js 26 compatibility coverage plus workflow concurrency and timeout limits
- require release tags to be annotated and reachable from `main` before publishing
- keep release verification rerunnable when the package version already exists for the same commit
- distinguish Node.js package compatibility from upstream-backed security support
- lock all executed TypeScript compilers and validate dependency origins, integrity, and install-script scope before installation
- disable dependency lifecycle scripts and persisted checkout credentials throughout CI and release automation
- audit advisories, registry signatures, and attestations in CI, before release, and on a weekly schedule
- publish the exact smoke-tested tarball from an OIDC-only job, verify its registry provenance, and isolate GitHub Release write authority in a separate job

## 1.0.6

- validate hook configuration consistently for client defaults and request options
- report invalid methods and hook lists as `ConfigError` instead of raw runtime errors
- route request normalization and retry rebuild failures through `onError` before rethrowing
- cap retained `ParseError.bodyText` diagnostics for large invalid JSON responses

## 1.0.5

- add `redactHeaders()` for safe application-owned diagnostics without built-in logging
- have the release workflow create or verify GitHub Release records after npm publish
- expose retry attempt and serialized query metadata to hooks through `context.options`
- allow native `URLSearchParams` as `query` input while preserving duplicate-key ordering
- tighten public TypeScript request option shapes for body/json and GET/HEAD misuse

## 1.0.4

Failure-observability, retry-timeout, diagnostic, and package-guardrail hardening.

Highlights:

- route hook and request-construction failures through `onError` before re-throwing them as-is
- clarify that retry backoff waits do not consume per-attempt timeout windows
- bound `HttpError.bodyText` capture for large error payloads
- avoid decoding oversized streamed error-body chunks before truncation and cancel truncated error streams
- expand package metadata checks across runtime dependency fields
- extend packed-artifact smoke coverage for public errors and blocked internal subpaths
- document the refined hook, timeout, retry, and `HttpError.response` body behavior

## 1.0.3

Abort classification and release-guardrail hardening.

Highlights:

- preserve custom external abort reasons as `AbortRequestError.cause`
- keep external aborts from being reclassified as timeouts when they win the race
- preserve custom abort reasons during retry backoff cancellation
- document advanced timeout, abort, retry, and hook URL behavior
- replace the dependency-review placeholder with enforced dependency review
- expand release and package smoke checks for metadata, exports, types, and blocked internal subpaths
- block package lifecycle scripts in package metadata validation

## 1.0.2

Internal efficiency and maintainability release.

Highlights:

- avoid unnecessary response cloning when no `afterResponse` hooks are registered
- retry eligible HTTP responses before reading error bodies
- reuse initial request normalization and per-attempt hook option snapshots where possible
- reduce request execution complexity by extracting retry policy, timeout control, client defaults, and hook option handling into focused helpers
- expand regression coverage for retries, hooks, timeout behavior, abort behavior, and fetch test helpers

## 1.0.1

Documentation and release follow-up.

Highlights:

- document retry usage, runtime validation, and explicit no-default-timeout behavior
- add clearer positioning around when to use clearfetch and when not to
- add examples for JSON bodies, raw body payloads, aborting requests, and text or raw responses
- migrate the release workflow and release policy toward npm trusted publishing
- small internal TypeScript cleanup with no behavior change

## 1.0.0

Initial stable release.

Highlights:

- dependency-free runtime built on native `fetch`
- one-off `request()` and reusable `createClient()` APIs
- typed errors for configuration, network, timeout, abort, HTTP, and parse failures
- deterministic URL, header, query, and JSON request handling
- conservative opt-in retries
- constrained lifecycle hooks with explicit mutation boundaries
- ESM-only package with TypeScript types, CI validation, and package smoke checks
