# Release Policy

## Release flow

Releases should be cut only from `main` after CI is green.

Expected flow:

1. Prepare the version with `npm version X.Y.Z --no-git-tag-version` and promote the matching changelog entry out of `Unreleased`.
2. Merge reviewed changes into `main`.
3. Confirm `CI` and dependency review checks are passing, including the package guardrails.
4. Optionally run the `Release` workflow manually to exercise the non-publishing dry-run path.
5. Create an annotated release tag in the form `vX.Y.Z`.
6. Push the tag to GitHub.
7. Let the `Release` workflow verify and upload one exact tarball, publish that artifact to npm, and create or verify the matching GitHub Release record.
8. Confirm npm and GitHub Releases show the same current version.

Local `npm publish` should not be used for normal releases.

The tag must match the package version exactly, for example package version
`1.2.3` must be released from tag `v1.2.3`. If a workflow rerun finds that exact
package version already published, it requires npm `dist.integrity` to match the
verified tarball byte-for-byte before it skips publishing and continues to the
GitHub Release record.

Before publishing, the workflow also verifies that the release tag is annotated
and that its commit is reachable from `origin/main`.

Post-release verification:

```bash
npm view @gavoryn/clearfetch version --registry=https://registry.npmjs.org
npm view @gavoryn/clearfetch dist.integrity --registry=https://registry.npmjs.org
gh release list --limit 5 --json tagName,name,isDraft,isPrerelease,isLatest,createdAt,publishedAt
```

## Release dry-run

The `Release` workflow supports a manual, non-publishing validation path through
GitHub Actions `workflow_dispatch`.

That dry-run path should verify:

- lockfile validation before a lifecycle-script-free install
- lint, test, build, and minimum-TypeScript compatibility steps
- dependency advisory, registry-signature, and attestation checks
- package metadata with `npm run check:package-metadata`
- packed artifact behavior with `npm run check:pack-smoke -- --retain`
- exact-artifact publishability with `npm run check:publish-dry-run -- release-artifact/*.tgz`, which uses the public npm registry explicitly, dry-runs unpublished versions, and compares byte integrity for an existing version
- upload of the verified tarball as a short-lived immutable workflow artifact

Manual dispatch never runs either privileged job. Tag-triggered publication
downloads the artifact by its immutable artifact ID, verifies its SHA-512
integrity again, compares the same integrity with npm after publication, and
requires verified SLSA provenance for the expected repository, workflow, tag,
and commit.

Use the dry-run path before relying on a first release or after making workflow
changes that affect packaging or publishing.

Before committing release preparation, run the local confidence bundle:

```bash
npm ci --ignore-scripts --no-audit --registry=https://registry.npmjs.org
npm run check:lockfile
npm run lint
npm test
npm run test:browser-like
npm run test:browser-real
npm run test:types-compat
npm run build
npm run check:dependency-audit
npm run check:dependency-signatures
npm run check:package-metadata
npm run check:pack-smoke -- --retain
npm run check:publish-dry-run -- release-artifact/*.tgz
git diff --check
```

## Repository protections

The repository should enforce the following protections on `main` and any future release-bearing branches:

- require pull requests before merging
- require the `CI` workflow to pass
- require the dependency review workflow to pass for pull requests
- block force pushes
- block branch deletion
- require full commit SHA pins for GitHub Actions
- restrict Actions to the GitHub-owned actions in use plus the pinned workflow linter
- enable secret push protection; enable validity checks and non-provider patterns when the repository plan supports them
- keep published releases immutable
- keep GitHub private vulnerability reporting enabled
- keep the `npm` environment and npm trusted publisher configuration aligned with `.github/workflows/release.yml`
- restrict the `npm` environment to release tags matching `v*`

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

When npm package administration is available, maintainers should also disable
traditional publish tokens. Staged publishing with a separate 2FA approval is a
strong additional option, but it must be adopted together with a deliberate
workflow change to `npm stage publish`; enabling it only in npm settings would
break the current release path.

## GitHub Actions configuration

The release workflow assumes:

- GitHub Actions is enabled for the repository
- an environment named `npm` exists
- the npm package has a matching trusted publisher configured on npmjs.com
- maintainers review changes to workflow files with the same care as runtime code

The release workflow separates authority across three jobs:

- `verify-release` has read-only repository access, disables dependency lifecycle scripts and caching, runs all package and dependency checks, and uploads the exact smoke-tested tarball
- `publish` has no checkout or development dependencies and receives only `id-token: write`; it downloads, re-verifies, and publishes the exact tarball, then verifies npm signatures and the expected provenance identity
- `github-release` receives only `contents: write` and creates or verifies the GitHub Release after npm publication succeeds

No job holds both npm publication authority and repository-write authority.
When trusted publishing is configured, npm binds provenance to the public
repository and workflow identity. Because tarball publication may omit npm
`gitHead`, release reruns use `dist.integrity` for byte identity and provenance
for the source-workflow association.

## Runtime and security expectations

The release process must preserve the package’s public claims:

- no runtime dependencies
- no lifecycle scripts
- no built-in telemetry
- no hidden network behavior beyond the caller's request
- package compatibility starting at Node.js `18+`, with security support limited to upstream-supported Node.js release lines
- modern browsers with the native web platform APIs documented in `README.md`
- TypeScript `5.0+` for the published declaration surface
