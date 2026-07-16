import { readFile } from 'node:fs/promises'

const lockfile = JSON.parse(await readFile('package-lock.json', 'utf8'))
const registryOrigin = 'https://registry.npmjs.org'
const allowedInstallScriptPackages = new Set([
  'node_modules/esbuild',
  'node_modules/fsevents',
  'node_modules/playwright/node_modules/fsevents',
])
const observedInstallScriptPackages = new Set()

if (lockfile.lockfileVersion !== 3) {
  throw new Error(`package-lock.json must use lockfileVersion 3, found ${lockfile.lockfileVersion}`)
}

if (lockfile.packages === null || typeof lockfile.packages !== 'object') {
  throw new Error('package-lock.json must contain a packages object')
}

for (const [packagePath, packageEntry] of Object.entries(lockfile.packages)) {
  if (packagePath === '') {
    continue
  }

  if (packageEntry === null || typeof packageEntry !== 'object') {
    throw new Error(`lockfile entry ${packagePath} must be an object`)
  }

  if (packageEntry.link === true) {
    throw new Error(`lockfile entry ${packagePath} must not be a local link`)
  }

  let resolved
  try {
    resolved = new URL(packageEntry.resolved)
  } catch {
    throw new Error(`lockfile entry ${packagePath} must have a valid resolved URL`)
  }

  if (
    resolved.origin !== registryOrigin ||
    resolved.username !== '' ||
    resolved.password !== ''
  ) {
    throw new Error(`lockfile entry ${packagePath} must resolve from ${registryOrigin}`)
  }

  if (
    typeof packageEntry.integrity !== 'string' ||
    !packageEntry.integrity.startsWith('sha512-')
  ) {
    throw new Error(`lockfile entry ${packagePath} must have sha512 integrity`)
  }

  if (packageEntry.dev !== true) {
    throw new Error(`lockfile entry ${packagePath} must remain development-only`)
  }

  if (packageEntry.hasInstallScript === true) {
    observedInstallScriptPackages.add(packagePath)
    if (!allowedInstallScriptPackages.has(packagePath)) {
      throw new Error(`lockfile entry ${packagePath} adds an unreviewed install script`)
    }
  }
}

for (const packagePath of allowedInstallScriptPackages) {
  if (!observedInstallScriptPackages.has(packagePath)) {
    throw new Error(`install-script allowlist entry ${packagePath} is stale`)
  }
}

console.log('lockfile origin, integrity, and install-script checks passed')
