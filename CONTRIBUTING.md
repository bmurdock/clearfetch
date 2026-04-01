# Contributing

Thanks for the interest in improving `clearfetch`.

## Before opening a pull request

- read [PURPOSE.md](./PURPOSE.md) and [DESIGN.md](./DESIGN.md)
- keep the package small, explicit, and dependency-free at runtime
- avoid adding features that broaden scope without a clear payoff
- open an issue first for non-trivial changes

## Development

- `npm install`
- `npm run lint`
- `npm test`
- `npm run build`
- `npm run check:package-metadata`
- `npm run check:pack-smoke`

Changes should keep the public API, docs, tests, and runtime behavior aligned.

## Pull requests

- make the scope narrow and intentional
- include tests for behavior changes
- update docs when public behavior changes
- link the relevant issue when possible

## Security

Do not open public issues for suspected vulnerabilities. Follow [SECURITY.md](./SECURITY.md) instead.
