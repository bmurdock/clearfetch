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

The development and release path adds several supply-chain controls without
changing the consumer package:

- every locked package must resolve from the public npm registry with SHA-512 integrity
- CI installs dependencies with lifecycle scripts disabled
- the minimum supported TypeScript compiler is an exact lockfile dependency, not a dynamically downloaded tool
- dependency advisories, registry signatures, and attestations are checked in CI, on a weekly schedule, and before release
- GitHub Actions are pinned to full commit SHAs and checkout credentials are not persisted
- release verification hands one smoke-tested tarball to an OIDC-only publish job and verifies the registry provenance identifies the expected workflow, tag, and commit
- npm publication authority and GitHub Release write authority are held by separate jobs

These controls limit opportunities to execute or replace unreviewed tooling.
They do not prove that reviewed source is benign: integrity verifies bytes,
signatures verify registry identity, provenance binds a published artifact to a
workflow, and audits cover only known advisories. Maintainers must still review
dependency, lockfile, workflow, and release-policy changes as security-sensitive
code.
