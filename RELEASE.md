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

## npm account and token requirements

The npm account used to administer the package should require 2FA.

Publishing from CI should use an npm automation token stored as the `NPM_TOKEN` GitHub Actions secret for the `npm` environment. That token should have the minimum scope necessary for publishing this package.

## GitHub Actions configuration

The release workflow assumes:

- GitHub Actions is enabled for the repository
- an environment named `npm` exists
- the `npm` environment contains an `NPM_TOKEN` secret
- maintainers review changes to workflow files with the same care as runtime code

The release workflow uses `id-token: write` so npm provenance can be attached during publish.

## Runtime and security expectations

The release process must preserve the package’s public claims:

- no runtime dependencies
- no lifecycle scripts
- no built-in telemetry
- no hidden network behavior beyond the caller's request
- support limited to Node.js `18+` and modern browsers
