# PURPOSE

## Why this project exists

This package exists to provide a small, modern, secure, dependency-free HTTP client for JavaScript and TypeScript applications.

The platform already provides excellent primitives:
- `fetch`
- `Request`
- `Response`
- `Headers`
- `URL`
- `AbortController`

However, many teams still want a few ergonomic features on top of those primitives:
- a reusable client with shared defaults
- base URL handling
- query parameter serialization
- JSON request/response convenience
- timeout handling
- a consistent error model
- request/response hooks

Historically, libraries such as Axios filled that role well. But over time, the ecosystem changed:
- native `fetch` became broadly available
- Node gained native `fetch`
- supply-chain security became a more serious concern
- dependency minimization became more valuable
- many projects no longer needed a large third-party HTTP abstraction

This project is an attempt to preserve the useful parts of the "ergonomic HTTP client" experience while removing unnecessary complexity, reducing supply-chain risk, and keeping the implementation small enough to audit easily.

## Design goals

- Zero runtime dependencies
- Modern runtimes only
- Predictable, explicit behavior
- Small and inspectable codebase
- Strong TypeScript support
- Minimal but high-value feature set
- Safe defaults
- No hidden behavior, telemetry, or lifecycle scripts

## Non-goals

This project does not aim to:
- support very old browsers or legacy Node versions
- replace every HTTP client in every scenario
- implement a giant middleware ecosystem
- provide magical data transforms
- become a kitchen-sink networking framework
- hide how the web platform works

## Philosophy

This package should feel like:
- native `fetch`, but easier to use well

It should not feel like:
- a separate transport universe with its own rules

## Long-term standard

Every new feature must justify its existence in terms of:
- developer value
- security impact
- conceptual simplicity
- maintenance burden
- auditability

If a feature increases complexity more than it increases clarity or safety, it should not be added.
