# Security Policy

## Supported runtimes

Security support is currently scoped to the actively supported runtime targets for this project:

- Node.js `18.x` and newer
- modern browsers with native `fetch`, `Request`, `Response`, `Headers`, `URL`, and `AbortController`

Legacy runtimes, polyfill-driven environments, and unsupported platform shims are out of scope.

## Reporting a vulnerability

Please do not open a public GitHub issue for a suspected security vulnerability.

Instead, report the issue privately to the maintainer through GitHub security reporting when available. If a private reporting channel is not configured yet, contact the maintainer directly and include:

- a short description of the issue
- the affected versions or commit range if known
- reproduction details or a proof of concept
- any suggested remediation if available

## Disclosure policy

The goal is coordinated disclosure:

- acknowledge receipt promptly
- confirm severity and impact
- prepare and validate a fix before public disclosure when feasible
- publish remediation guidance once a fix or mitigation is ready

## Security posture

This package is intentionally designed to reduce attack surface:

- zero runtime dependencies
- no lifecycle scripts
- no built-in telemetry
- no hidden network behavior beyond the caller's request
- a narrow public API and explicit runtime support policy

These choices reduce risk, but they do not eliminate the need for careful review, secure release practices, and responsible disclosure.
