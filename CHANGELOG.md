# Changelog

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
