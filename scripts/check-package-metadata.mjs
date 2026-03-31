import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const rootDir = process.cwd()
const packageJson = JSON.parse(
  await readFile(path.join(rootDir, 'package.json'), 'utf8'),
)

assertNoRuntimeDependencies(packageJson)
assertPublishWhitelist(packageJson)
await assertPublishedEntrypointsExist(rootDir, packageJson)

console.log('package metadata checks passed')

function assertNoRuntimeDependencies(packageConfig) {
  const dependencies = packageConfig.dependencies
  if (dependencies !== undefined && Object.keys(dependencies).length > 0) {
    throw new Error('runtime dependencies must remain empty')
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
