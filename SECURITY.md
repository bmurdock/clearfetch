# Security Policy

## Supported runtimes

Package compatibility starts at Node.js `18.x`, as declared in `package.json`.
Security support is narrower and applies only when clearfetch is used on a
Node.js release line that is still supported by the Node.js project:

- upstream-supported Node.js release lines
- modern browsers with native `fetch`, `Request`, `Response`, `Headers`, `URL`, and `AbortController`

See the [official Node.js release status](https://nodejs.org/en/about/previous-releases)
for the current lifecycle. Vulnerabilities caused by EOL Node.js releases,
legacy runtimes, polyfill-driven environments, and unsupported platform shims
are out of scope.

## Reporting a vulnerability

Please do not open a public GitHub issue for a suspected security vulnerability.

Instead, use GitHub's private vulnerability reporting for this repository:

1. Open the repository on GitHub.
2. Go to the `Security` tab.
3. Use the private vulnerability reporting flow to submit the report.

Please include:

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
