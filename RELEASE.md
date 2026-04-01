# Release Policy

## Release flow

Releases should be cut only from `main` after CI is green.

Expected flow:

1. Merge reviewed changes into `main`.
2. Confirm `CI` and dependency review checks are passing.
3. Optionally run the `Release` workflow manually to exercise the non-publishing dry-run path.
4. Create an annotated release tag in the form `vX.Y.Z`.
5. Push the tag to GitHub.
6. Let the `Release` GitHub Actions workflow publish the package.

Local `npm publish` should not be used for normal releases.

## Release dry-run

The `Release` workflow supports a manual, non-publishing validation path through
GitHub Actions `workflow_dispatch`.

That dry-run path should verify:

- install, lint, test, and build steps
- package creation with `npm pack`
- publishability with `npm publish --dry-run`

Use the dry-run path before relying on a first release or after making workflow
changes that affect packaging or publishing.

## Repository protections

The repository should enforce the following protections on `main` and any future release-bearing branches:

- require pull requests before merging
- require the `CI` workflow to pass
- require the dependency review workflow to pass for pull requests
- block force pushes
- block branch deletion

## Tag policy

Release tags should be annotated and should be signed when practical.

If signed tags are not yet mandatory for every maintainer environment, they should still be treated as the target policy for official releases.

## npm account and trusted publishing requirements

The npm account used to administer the package should require 2FA.

Publishing from CI should use npm trusted publishing through GitHub Actions OIDC, not a long-lived write token.

The npm package settings for `@gavoryn/clearfetch` should define a trusted publisher with:

- organization or user: `bmurdock`
- repository: `clearfetch`
- workflow filename: `release.yml`
- environment name: `npm`

## GitHub Actions configuration

The release workflow assumes:

- GitHub Actions is enabled for the repository
- an environment named `npm` exists
- the npm package has a matching trusted publisher configured on npmjs.com
- maintainers review changes to workflow files with the same care as runtime code

The release workflow uses `id-token: write` so npm can exchange the workflow identity for publish access. When trusted publishing is configured, npm also generates provenance automatically for public packages from public repositories.

## Runtime and security expectations

The release process must preserve the package’s public claims:

- no runtime dependencies
- no lifecycle scripts
- no built-in telemetry
- no hidden network behavior beyond the caller's request
- support limited to Node.js `18+` and modern browsers
