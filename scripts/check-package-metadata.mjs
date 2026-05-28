import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const rootDir = process.cwd()
const packageJson = JSON.parse(
  await readFile(path.join(rootDir, 'package.json'), 'utf8'),
)

assertNoRuntimeDependencies(packageJson)
assertNoLifecycleScripts(packageJson)
assertPublishWhitelist(packageJson)
await assertPublishedEntrypointsExist(rootDir, packageJson)

console.log('package metadata checks passed')

function assertNoRuntimeDependencies(packageConfig) {
  const dependencyFields = [
    'dependencies',
    'optionalDependencies',
    'peerDependencies',
    'bundleDependencies',
    'bundledDependencies',
  ]

  for (const fieldName of dependencyFields) {
    if (!hasEntries(packageConfig[fieldName])) {
      continue
    }

    throw new Error(`runtime dependency field \`${fieldName}\` must remain empty`)
  }
}

function hasEntries(value) {
  if (Array.isArray(value)) {
    return value.length > 0
  }

  if (value !== null && typeof value === 'object') {
    return Object.keys(value).length > 0
  }

  return false
}

function assertNoLifecycleScripts(packageConfig) {
  const lifecycleScripts = [
    'preinstall',
    'install',
    'postinstall',
    'prepare',
    'prepack',
    'postpack',
    'prepublish',
    'prepublishOnly',
  ]
  const scripts = packageConfig.scripts

  if (scripts === undefined) {
    return
  }

  for (const scriptName of lifecycleScripts) {
    if (Object.hasOwn(scripts, scriptName)) {
      throw new Error(`lifecycle script \`${scriptName}\` is not allowed`)
    }
  }
}

function assertPublishWhitelist(packageConfig) {
  const files = packageConfig.files
  if (!Array.isArray(files) || files.length !== 1 || files[0] !== 'dist') {
    throw new Error('`files` must whitelist only the built dist/ directory')
  }

  if (typeof packageConfig.main !== 'string' || !packageConfig.main.startsWith('./dist/')) {
    throw new Error('`main` must point at a built file under dist/')
  }

  if (typeof packageConfig.types !== 'string' || !packageConfig.types.startsWith('./dist/')) {
    throw new Error('`types` must point at a built declaration under dist/')
  }

  const rootExport = packageConfig.exports?.['.']
  if (rootExport === undefined || typeof rootExport !== 'object') {
    throw new Error('root export map is required')
  }

  if (
    typeof rootExport.import !== 'string' ||
    !rootExport.import.startsWith('./dist/')
  ) {
    throw new Error('root import export must point at dist/')
  }

  if (
    typeof rootExport.types !== 'string' ||
    !rootExport.types.startsWith('./dist/')
  ) {
    throw new Error('root types export must point at dist/')
  }
}

async function assertPublishedEntrypointsExist(rootDir, packageConfig) {
  const requiredPaths = [
    packageConfig.main,
    packageConfig.types,
    packageConfig.exports['.'].import,
    packageConfig.exports['.'].types,
  ]

  for (const relativePath of requiredPaths) {
    await access(path.join(rootDir, relativePath))
  }
}
