# Repository Guidelines

## Project Structure & Module Organization

This repository is currently documentation-first. The root contains:

- `PURPOSE.md`: product intent, design goals, and non-goals
- `DESIGN.md`: source of truth for architectural and behavioral rules
- `suggestions.md`: draft public API and type sketches derived from the design
- `.gitignore`: ignore rules for local development artifacts

When implementation begins, keep runtime code under `src/` and tests under `test/` or `src/**/*.test.ts`. Place small fixtures next to the tests that use them. Avoid adding build output, generated files, or large assets to the repository root.

## Build, Test, and Development Commands

There is no build pipeline yet. When adding one, expose the standard commands through `package.json`:

- `npm install`: install dependencies
- `npm run build`: compile the library for distribution
- `npm test`: run the automated test suite
- `npm run lint`: check formatting and static rules

Contributors should prefer commands that work in a clean checkout and do not depend on globally installed tools.

## Coding Style & Naming Conventions

Use TypeScript for library code and keep the package dependency-light, consistent with `PURPOSE.md`. Prefer 2-space indentation, small modules, explicit exports, and platform-native APIs over wrappers. Use:

- `camelCase` for variables and functions
- `PascalCase` for types, classes, and error names
- `kebab-case` for file names such as `http-error.ts`

If formatting or linting is introduced, wire it into `npm run lint` and keep the configuration checked in.

## Testing Guidelines

Add tests with every behavior change. Favor focused unit tests around request building, error handling, timeouts, and hook behavior. Name test files after the module they cover, for example `src/request.test.ts` or `test/create-client.test.ts`. Include edge cases for native `fetch` integration and abort behavior.

## Commit & Pull Request Guidelines

Current history uses short, imperative commit subjects, for example: `Add initial project purpose and API notes`. Keep subjects specific and under roughly 72 characters.

Pull requests should include:

- a short description of the change
- the motivation or linked issue
- notes on testing performed
- API examples when behavior changes affect consumers

## Security & Configuration Tips

This project aims to stay easy to audit. Do not add runtime dependencies, telemetry, or lifecycle scripts without a clear justification in the PR.
