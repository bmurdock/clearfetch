# DESIGN

## Overview

This document describes the design of this package: a dependency-free, fetch-native HTTP client for modern JavaScript and TypeScript runtimes.

The purpose of this package is not to replace the web platform. It exists to make the platform easier to use well by providing a small set of carefully chosen conveniences:

- reusable client instances with shared defaults
- base URL handling
- query parameter serialization
- JSON request/response ergonomics
- timeout support
- a consistent error model
- explicit request/response lifecycle hooks
- conservative retry support

The package is intentionally small in scope. It prioritizes:

- predictability
- auditability
- explicitness
- strong defaults
- minimal supply-chain risk

This document is the source of truth for architectural intent and behavioral guarantees.

---

## Design principles

### 1. Native first

This package is built on top of native platform primitives:

- `fetch`
- `Request`
- `Response`
- `Headers`
- `URL`
- `AbortController`

It should feel like native `fetch` with a disciplined convenience layer, not like a separate transport system with unrelated rules.

### 2. Zero runtime dependencies

The package must have zero runtime dependencies.

This is a core design constraint, not an aspirational goal. It reduces supply-chain risk, simplifies auditing, and keeps the implementation understandable.

Development dependencies are acceptable where necessary for building, linting, and testing, but runtime behavior must not depend on third-party packages.

### 3. Small, explicit surface area

The public API should remain intentionally small. New features must justify their existence in terms of:

- developer value
- conceptual simplicity
- maintenance burden
- security impact
- testability
- auditability

If a feature adds more complexity than clarity, it should not be added.

### 4. Predictable behavior over convenience magic

Convenience is valuable only when it remains understandable.

The library must avoid:

- hidden behavior
- surprising defaults
- ambiguous option interactions
- magical transformations
- silent fallbacks that conceal errors

It is better to be explicit and slightly stricter than to be flexible in ways that create uncertainty.

### 5. Modern runtimes only

This package targets modern environments with native `fetch` support.

It does not attempt to support older browsers or legacy Node.js environments through runtime shims or polyfills.

### 6. Secure by design

For this package, security primarily means:

- minimal attack surface
- no runtime dependencies
- no lifecycle scripts
- no hidden telemetry
- no dangerous defaults
- no implicit behavior that makes misuse easier
- a release process designed for trust and auditability

### 7. Strong TypeScript ergonomics

TypeScript support is part of the product.

The package should offer strong types for:

- request options
- client defaults
- hook contexts
- error classes
- response modes

Types should improve correctness and developer experience without pretending to provide guarantees the runtime cannot enforce.

---

## Scope

### In scope

Version 1 includes the following capabilities:

- one-off requests
- reusable client instances
- HTTP method helpers
- client extension via merged defaults
- base URL support
- deterministic header merging
- query parameter serialization
- JSON request convenience
- response parsing modes
- request timeouts
- explicit lifecycle hooks
- typed error hierarchy
- optional conservative retry support

### Out of scope

The following are explicitly out of scope for version 1:

- support for legacy runtimes without native `fetch`
- adapter systems
- plugin ecosystems in core
- upload progress abstractions
- download progress abstractions
- cookie jar management
- automatic caching
- transform pipelines
- broad serialization frameworks
- XSRF-specific magic
- automatic retries for unsafe methods by default
- polyfills or environment shims
- hidden diagnostics or telemetry

These features are excluded intentionally to preserve simplicity and clarity.

---

## Runtime model

### Supported environments

This package is designed for modern JavaScript runtimes that provide native `fetch` and related web platform APIs.

The minimum supported Node.js version should be declared in `package.json` under `engines`. The implementation should target only runtimes that satisfy that requirement.

### Module strategy

The package is designed as a modern module-first library. Export behavior must be explicit and restricted through `package.json` export maps.

The package should not expose internal implementation paths.

---

## Public API philosophy

The public API should be small and unsurprising.

The package exposes two primary entry points:

- a one-off request function
- a reusable client factory

Conceptually:

- `request()` is for direct, stateless use
- `createClient()` is for shared defaults and repeated calls

The client produced by `createClient()` should support:

- `request()`
- `get()`
- `post()`
- `put()`
- `patch()`
- `delete()`
- `head()`
- `options()`
- `extend()`

### API goals

The public API should:

- be easy to learn in one sitting
- map closely to native fetch semantics
- avoid an oversized configuration object with poorly defined interactions
- remain stable over time

### API non-goals

The public API should not:

- attempt feature parity with Axios
- expose internal machinery unnecessarily
- create multiple competing ways to do the same thing
- hide important platform behavior behind vague abstractions

---

## Core abstractions

### Request function

The request function is the core execution path.

Responsibilities:

- validate request options
- resolve the final URL
- merge headers
- normalize the request body
- apply timeout and abort semantics
- construct a `Request`
- run lifecycle hooks
- perform the network call using `fetch`
- classify failures consistently
- parse the response according to configured behavior

### Client instance

A client instance represents a reusable set of defaults.

Responsibilities:

- store shared defaults
- expose HTTP method helpers
- merge request-level options with client defaults deterministically
- allow safe extension through `extend()`

A client instance should be lightweight and immutable in behavior from the perspective of consumers. Mutating shared defaults after creation should be avoided.

### Hooks

Hooks are explicit lifecycle points for cross-cutting behavior.

Supported lifecycle points:

- `beforeRequest`
- `afterResponse`
- `onError`

Hooks provide limited, well-defined extension points without turning the package into a general middleware framework.

### Errors

Errors are a first-class part of the design.

The package must distinguish clearly between:

- invalid configuration
- network failure
- timeout
- external abort
- HTTP failure
- parse failure

This distinction is important for correctness, observability, and developer ergonomics.

---

## Request lifecycle

The request lifecycle is defined as follows:

1. Merge client defaults and request-level options
2. Validate the resulting configuration
3. Resolve the final URL
4. Build final headers
5. Normalize the request body
6. Execute `beforeRequest` hooks
7. Create the final `Request`
8. Apply timeout and abort configuration
9. Perform `fetch`
10. Execute `afterResponse` hooks
11. Classify non-success HTTP responses
12. Parse the response according to `responseType`
13. Return parsed result or raw `Response`
14. On failure, normalize the error and execute `onError` hooks
15. Re-throw the normalized error

This order is intentional and should remain stable unless there is a strong reason to change it.

---

## Configuration model

### General philosophy

Configuration should be explicit, narrow, and validated.

The library should prefer a small number of clear options over a large number of loosely interacting options.

### Request options

The request configuration supports only the options needed for the core use cases. These include:

- HTTP method
- headers
- query parameters
- raw body
- JSON body helper
- timeout
- signal
- response type
- retry configuration
- optional request-scoped hooks
- optional custom JSON parser

### Client defaults

Client defaults may include:

- base URL
- default headers
- default timeout
- default response type
- default retry behavior
- default hooks
- default JSON parser

### Validation rules

Validation must occur before the request is executed.

Invalid configurations must fail fast with a configuration error.

Examples of invalid configurations include:

- both `body` and `json` provided
- negative timeout
- malformed base URL
- unsupported response type
- invalid retry values

Strict validation is desirable. Silent coercion should be avoided unless it is trivial and unsurprising.

---

## Merge semantics

Merge behavior is one of the most important parts of the design. It must be deterministic and well documented.

### Defaults precedence

When merging client defaults and request-level options:

- request-level options override client defaults
- request-scoped hooks are appended after client hooks
- request headers override default headers when keys collide

This allows shared defaults while preserving per-request control.

### Header merging

Headers are merged deterministically using the platform `Headers` model.

Rules:

- client default headers are applied first
- request-specific headers are applied second
- later values replace earlier values for the same normalized header name

The package should rely on the behavior of `Headers` for normalization wherever practical rather than implementing its own ad hoc casing logic.

### Hook merging

Hooks are merged by concatenation, not replacement.

Order:

- client hooks first
- request hooks second

This allows request-level hooks to override or refine behavior established by client-level hooks.

### Retry merging

Retry configuration follows the same precedence model:

- request-level retry configuration overrides client-level retry configuration

If retry is explicitly disabled at request level, request-level disablement wins.

### Base URL behavior

If a request input is an absolute URL, it must not be modified by `baseURL`.

If a request input is relative and `baseURL` is provided, the final URL is resolved against that base using the `URL` constructor.

The package should not implement custom URL concatenation logic beyond what is needed to produce correct and predictable results.

---

## URL and query serialization

### URL resolution

The final request URL is determined by combining:

- the request input
- optional `baseURL`
- optional query parameters

Rules:

- absolute request input takes precedence over `baseURL`
- relative request input is resolved against `baseURL`
- if no `baseURL` exists, relative request input is invalid and must fail with `ConfigError`

### Query serialization philosophy

Query serialization should be conservative and easy to understand.

Supported values:

- string
- number
- boolean
- null
- arrays of the above
- `undefined` as “omit the key”

Unsupported structures, such as deeply nested objects, are intentionally out of scope for v1.

### Serialization rules

Default rules:

- `undefined` values are omitted
- scalar values produce a single key-value pair
- array values produce repeated keys
- values are serialized via string conversion in a predictable way
- `null` is serialized as the literal string `null`

Recommended default for arrays:

- `tags: ['a', 'b']` becomes `tags=a&tags=b`

This is widely understood and avoids introducing custom query conventions by default.

### Non-goal: deep object flattening

The package should not automatically flatten complex object graphs into query strings.

This introduces ambiguity and almost always leads to disagreement about “correct” behavior. Consumers who need specialized query encoding can pre-serialize it themselves.

---

## Request body handling

### Raw body

The `body` option allows callers to pass a valid fetch-compatible body directly.

The package should not reinterpret or transform raw bodies except where strictly necessary to construct the request.

### JSON body convenience

The `json` option exists to reduce boilerplate for the most common request-body use case.

Rules:

- `json` and `body` are mutually exclusive
- when `json` is provided, the package serializes it with `JSON.stringify`
- if `Content-Type` is not already set, it is set to `application/json`

The package should not perform schema validation or content introspection beyond what is necessary for consistent behavior.

### GET and HEAD bodies

As a general rule, bodies on `GET` and `HEAD` requests should be rejected or strongly constrained in v1.

Even though some systems tolerate them, they are unusual and frequently confusing. The package should prefer conservative behavior unless there is a compelling reason otherwise.

---

## Response parsing

### Response types

The package supports explicit response parsing modes:

- `json`
- `text`
- `blob`
- `arrayBuffer`
- `raw`

### Default response type

The default response type should be `json` unless explicitly changed. This reflects the most common modern use case and offers practical convenience.

This default must be clearly documented because it differs from raw fetch semantics.

### JSON parsing behavior

When parsing JSON:

1. Read response text
2. Parse using the configured JSON parser
3. Return parsed value
4. Throw a parse error if parsing fails

The package must not silently fall back from JSON to text.

Silent fallback hides data problems and makes failures harder to reason about.

### Empty-body JSON behavior

When `responseType` is `json`, an empty response body yields `undefined`.

For this purpose, a response body is considered empty if reading it yields an empty string.

This applies to `204`, `205`, and `304` responses and to other successful responses whose body is empty.

As a result, JSON responses are typed as `T | undefined` rather than `T` alone.

### Raw response behavior

When `responseType` is `raw`, the original `Response` object is returned.

This is important for advanced consumers and serves as an escape hatch when the convenience layer should get out of the way.

### Non-success responses

Non-2xx responses must throw an `HttpError` before response parsing is returned to the consumer in the normal success path.

This is a deliberate divergence from native fetch behavior and a major part of the package’s value proposition.

---

## Error model

### Philosophy

Errors should be:

- typed
- informative
- consistent
- suitable for control flow
- suitable for logging and debugging

The package must normalize low-level platform behavior into a small, explicit error model.

### Error categories

#### Configuration error

Represents invalid library usage or invalid request configuration.

Examples:

- mutually exclusive options
- invalid timeout
- malformed URL inputs where configuration is at fault

#### Network error

Represents transport failure where a response was not successfully received.

Examples:

- DNS resolution failure
- connection failure
- TLS negotiation failure
- generic fetch rejection not attributable to timeout or explicit abort

#### Timeout error

Represents a request aborted because the configured timeout elapsed.

This must be distinguishable from an externally triggered abort.

#### Abort error

Represents an externally canceled request through an abort signal.

This distinction matters because timeouts and user-initiated cancellation often imply different remediation paths.

#### HTTP error

Represents a non-2xx HTTP response.

It should carry:

- status code
- status text
- response object
- request object when available
- optionally captured response body text where helpful and safe

#### Parse error

Represents failure to parse a successful response according to the selected response type.

Most commonly this will be JSON parse failure.

### Error normalization

The library must normalize platform-level errors consistently.

Normalization rules must distinguish:

- timeout-triggered aborts
- caller-triggered aborts
- fetch transport failures
- configuration failures inside library code

### Error transparency

Where practical, original causes should be preserved.

The package should carry `cause` information when supported and appropriate, but the public contract should rely on the package’s own error classes rather than raw platform error shapes.

---

## Timeout and abort semantics

### Timeout model

Timeouts are implemented using `AbortController`.

A timeout means:

- the package creates an internal abort controller
- the controller aborts once the configured timeout elapses
- timeout expiration produces a `TimeoutError`

### External abort model

If the caller provides an external `AbortSignal`, that signal must be respected.

If the external signal aborts first, the request must fail with an abort error rather than a timeout error.

### Signal composition

If both timeout and external abort are present, the package must compose them so that either can cancel the request.

Signal-composition behavior must be deterministic and well tested.

### Cleanup

Timers created for timeouts must always be cleaned up, including in successful requests and early failures.

This is both a correctness and resource-management requirement.

---

## Hook system

### Purpose

Hooks provide a small and explicit mechanism for cross-cutting behavior such as:

- authentication header injection
- logging
- metrics
- centralized response handling
- structured error reporting

Hooks are not intended to become a general-purpose middleware framework.

### Supported hooks

#### `beforeRequest`

Runs after request normalization but before final `Request` construction and network execution.

Permitted uses:

- set or modify headers
- inspect resolved URL and request configuration
- apply last-mile request policy
- replace the request URL with a final absolute URL

#### `afterResponse`

Runs immediately after a response is received and before success parsing is returned to the consumer.

`afterResponse` always receives the raw `Response`, including non-2xx responses that may later be classified as `HttpError`.

Permitted uses:

- inspect status codes
- record metrics
- implement cross-cutting response handling

#### `onError`

Runs after an error has been normalized but before it is re-thrown to the caller.

`onError` receives normalized failures only after classification has occurred.

Permitted uses:

- logging
- telemetry emitted by the consuming application
- centralized error observation

The package itself must not emit telemetry.

### Hook ordering

Hook order must be stable and documented.

Order:

- client hooks first
- request hooks second

Within each list, hooks run in the order they are defined.

### Hook failures

If a hook throws, the request fails.

The package must not swallow hook errors silently.

This is consistent with the philosophy of explicit failure over hidden behavior.

### Hook mutability

`beforeRequest` may intentionally mutate the request context where documented, especially headers.

Hook mutation must remain constrained and explicit.

In particular:

- hooks may mutate headers
- hooks may replace the URL
- hooks may replace the body only if they preserve request validity
- hooks may not mutate hidden internal execution state such as retry bookkeeping

If a `beforeRequest` hook replaces the URL, the replacement must be a fully resolved absolute URL. Relative replacement URLs are invalid and must fail with `ConfigError`.

When a hook replaces the URL, that replacement becomes the final URL for the request and overrides any previously resolved URL, including query parameters.

The library does not reapply `baseURL`, re-resolve relative paths, or merge query parameters after URL replacement.

---

## Retry design

### Philosophy

Retries are useful but dangerous when overly permissive.

The package must treat retry behavior conservatively.

Retries should be:

- explicit
- bounded
- predictable
- safe by default

### Default posture

Retries should be disabled by default unless a future release has a compelling reason to enable a narrowly safe default.

### Safe retry scenarios

When enabled, retries should default to safe cases such as:

- `GET`
- `HEAD`
- optionally `OPTIONS`
- transient network failure
- selected HTTP statuses such as `429`, `502`, `503`, `504`
- replayable request bodies only

### Unsafe scenarios

The package should not automatically retry unsafe methods such as `POST`, `PUT`, `PATCH`, or `DELETE` unless the caller explicitly configures that behavior.

Version 1 must also reject retry-enabled execution for streaming request bodies. Retries must not assume that all bodies can be replayed safely.

### Backoff behavior

Retry delays should use bounded exponential backoff.

The strategy should be simple, deterministic, and documented.

The package should avoid introducing jitter in v1 unless there is a clear need and documentation story for it.

### Timeout semantics with retries

Version 1 uses per-attempt timeout semantics.

This means:

- each retry attempt gets its own timeout window
- the timeout does not represent a single total deadline across all attempts

This is simpler to implement and reason about. If a future version introduces total deadline support, it must do so explicitly.

### Retry observability

Retry behavior should be visible to hook contexts where practical so consuming applications can log and understand repeated attempts.

### Retry classification

Version 1 retry decisions are based only on:

- request method
- normalized failure type
- HTTP status code

Response bodies are not inspected for retry classification in v1.

---

## Security posture

### Runtime security posture

The package’s runtime security posture is grounded in the following choices:

- zero runtime dependencies
- no lifecycle scripts
- no hidden network activity beyond the caller’s request
- no telemetry
- no dangerous convenience features by default
- no automatic retries for unsafe requests by default
- no custom protocol downgrades or transport hacks

### Sensitive data handling

The package must avoid logging or exposing sensitive headers automatically.

If helper utilities exist for diagnostics, they should support redaction of commonly sensitive header names such as:

- `Authorization`
- `Cookie`
- `Set-Cookie`
- API-key style headers

The core package itself should avoid built-in logging.

### Redirect behavior

Redirect handling should default to platform behavior unless explicitly exposed and documented.

The package must not introduce surprising redirect behavior on its own.

### SSRF awareness

This package cannot prevent server-side request forgery by itself, but it must not make SSRF risks worse through hidden host rewriting, DNS tricks, or automatic request mutation.

### Release security

Release hygiene is part of the product.

The repository and release process should include:

- protected branches
- CI-based publishing
- npm 2FA
- signed tags where practical
- strict package export maps
- files whitelisting in published package artifacts
- a `SECURITY.md` disclosure policy

---

## TypeScript design

### Principles

Types should improve ergonomics without making false promises.

This package should use types to:

- make common use cases pleasant
- prevent obvious misuse
- model supported configuration accurately
- expose rich hook and error types

### Generic response typing

Generic response typing is consumer-directed, not runtime-validated.

For example:

```ts
const user = await client.get<User>('/users/123')
```

This means “treat the parsed response as `User`,” not “the library has validated that the server returned a `User`.”

The documentation should be explicit about this distinction.

### Type strictness

Where possible, incompatible option combinations should be discouraged or prevented through types.

Examples:

* discourage simultaneous `body` and `json`
* constrain response-type values
* strongly type hook contexts and retry configuration

Runtime validation still remains necessary.

---

## Non-goals and boundaries

This section is intentionally repetitive because it protects the package from scope drift.

This package does not aim to:

* become Axios-compatible
* support every runtime environment
* provide a plugin ecosystem in core
* serialize arbitrary complex objects automatically
* perform content negotiation magic
* hide the semantics of fetch
* auto-detect what developers “meant”
* retry unsafe requests silently
* include broad transport abstractions
* become a framework for application networking policy

When in doubt, the design should favor restraint.

---

## Internal architecture

### General structure

The implementation should be organized into small, focused modules.

Recommended internal responsibilities include:

* option validation
* URL construction
* header merging
* request construction
* timeout and signal composition
* hook execution
* fetch execution
* error normalization
* response parsing
* retry orchestration

### Architectural rule

Internal modules should remain boring and explicit.

Avoid:

* deep inheritance
* hidden mutable global state
* dynamic module loading
* internal plugin systems
* overly clever abstractions

A new maintainer should be able to understand the request flow quickly.

### Source layout

The source tree should reflect the request lifecycle and core concepts clearly. File organization should favor readability over theoretical purity.

---

## Behavioral invariants

The following invariants are part of the design contract.

### Request invariants

* request-level options override client defaults
* header merging is deterministic
* `json` and `body` are mutually exclusive
* invalid configuration fails before network execution
* timeout timers are always cleaned up
* absolute URLs are not rewritten by `baseURL`

### Response invariants

* non-2xx responses throw `HttpError`
* response parsing follows explicit `responseType`
* JSON parse failures throw `ParseError`
* `raw` returns the original `Response`

### Hook invariants

* client hooks run before request hooks
* hooks run in definition order
* hook failures are not swallowed
* `onError` runs after normalization and before re-throw

### Retry invariants

* retries are bounded
* retries are conservative
* retries are never silently applied to unsafe methods by default
* per-attempt timeout semantics are documented and stable

---

## Observability philosophy

The package should make observability possible without performing observability itself.

That means:

* hooks expose the right context for application-level logging and metrics
* errors carry meaningful metadata
* retry behavior is inspectable where practical

It does not mean:

* built-in logging
* built-in telemetry
* outbound reporting
* analytics

Consumers own observability. The package provides clean surfaces for it.

---

## Documentation requirements

Every behavior that differs meaningfully from native fetch must be documented clearly.

At minimum, the documentation must explain:

* default response parsing behavior
* non-2xx throwing behavior
* timeout semantics
* abort semantics
* retry semantics
* hook order
* header merge precedence
* query serialization rules
* `baseURL` resolution rules
* error classes and when each is thrown

Good documentation is part of the design, not an afterthought.

---

## Versioning philosophy

Changes to the following behaviors should be treated with high caution because they are semantically significant:

* merge precedence
* hook order
* retry defaults
* default response type
* non-2xx throwing behavior
* timeout semantics
* query serialization rules
* error classification

Any change to these areas is likely breaking or at least behaviorally important and should be evaluated accordingly.

The package should prefer stability over clever iteration once the core contract is established.

---

## Decision framework for future features

Before adding a feature, answer the following:

1. Does it solve a real, common problem?
2. Can it be explained simply?
3. Does it preserve native-first design?
4. Does it introduce hidden behavior?
5. Does it increase attack surface?
6. Does it require runtime dependencies?
7. Does it complicate types significantly?
8. Does it create new ambiguous interactions?
9. Can it be tested thoroughly?
10. Would a careful user expect this package to own this responsibility?

If the answers reveal significant complexity, the feature probably does not belong in core.

---

## Summary

This package is intentionally narrow.

Its purpose is to provide the most valuable conveniences of a modern HTTP client while remaining:

* dependency-free
* modern
* explicit
* secure by design
* easy to audit
* easy to maintain

The design should always favor:

* clarity over cleverness
* explicitness over magic
* restraint over scope creep
* trustworthiness over feature count

That philosophy is the product.
```
