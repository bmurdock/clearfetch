# Contributing

Thanks for the interest in improving `clearfetch`.

## Before opening a pull request

- read [PURPOSE.md](./PURPOSE.md) and [DESIGN.md](./DESIGN.md)
- keep the package small, explicit, and dependency-free at runtime
- avoid adding features that broaden scope without a clear payoff
- open an issue first for non-trivial changes

## Development

- `npm ci --ignore-scripts --registry=https://registry.npmjs.org`
- `npm run lint`
- `npm test`
- `npm run test:browser-like`
- `node node_modules/playwright/cli.js install chromium` once before the first real-browser test
- `npm run test:browser-real`
- `npm run test:types-compat`
- `npm run build`
- `npm run check:lockfile`
- `npm run check:package-metadata`
- `npm run check:pack-smoke`
- `npm run check:publish-dry-run` for release-path changes

For dependency or lockfile changes, also run:

- `npm run check:dependency-audit`
- `npm run check:dependency-signatures`

Do not add a lockfile source outside the public npm registry or a new package
with an install script without an explicit security review. The automated
lockfile check deliberately fails those changes.

Changes should keep the public API, docs, tests, and runtime behavior aligned.

## Pull requests

- make the scope narrow and intentional
- include tests for behavior changes
- update docs when public behavior changes
- link the relevant issue when possible

## Security

Do not open public issues for suspected vulnerabilities. Follow [SECURITY.md](./SECURITY.md) instead.
