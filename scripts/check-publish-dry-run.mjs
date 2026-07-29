import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const registry = 'https://registry.npmjs.org'
const allowExisting = process.argv.includes('--allow-existing')
const tarballArgument = process.argv
  .slice(2)
  .find((argument) => !argument.startsWith('--'))
const packageConfig = JSON.parse(await readFile('package.json', 'utf8'))
const packageSpec = `${packageConfig.name}@${packageConfig.version}`
const published = await getPublishedMetadata(packageSpec)
const tarballIntegrity = tarballArgument === undefined
  ? undefined
  : await calculateIntegrity(tarballArgument)
const tarballConfig = tarballArgument === undefined
  ? undefined
  : await getTarballPackageConfig(tarballArgument)

if (
  tarballConfig !== undefined &&
  (tarballConfig.name !== packageConfig.name ||
    tarballConfig.version !== packageConfig.version)
) {
  throw new Error(
    `tarball identity ${String(tarballConfig.name)}@${String(tarballConfig.version)} does not match workspace ${packageSpec}`,
  )
}

if (published === undefined) {
  const publishTarget = tarballArgument === undefined
    ? '.'
    : path.resolve(tarballArgument)
  const { stderr, stdout } = await execFileAsync(
    'npm',
    [
      'publish',
      publishTarget,
      '--dry-run',
      '--ignore-scripts',
      `--registry=${registry}`,
    ],
    { maxBuffer: 10 * 1024 * 1024 },
  )
  process.stdout.write(stdout)
  process.stderr.write(stderr)
  console.log(`publish dry-run passed for unpublished version ${packageSpec}`)
} else if (tarballIntegrity !== undefined) {
  if (published['dist.integrity'] !== tarballIntegrity) {
    throw new Error(
      `published integrity ${String(published['dist.integrity'])} does not match verified tarball ${tarballIntegrity}`,
    )
  }

  console.log(`${packageSpec} is already published with the verified tarball bytes`)
} else if (allowExisting) {
  console.log(`${packageSpec} is already published; non-publishing validation skipped`)
} else {
  throw new Error(
    `${packageSpec} is already published; pass a verified tarball to compare integrity or use --allow-existing for non-publishing validation`,
  )
}

async function getPublishedMetadata(packageSpec) {
  try {
    const { stdout } = await execFileAsync(
      'npm',
      [
        'view',
        packageSpec,
        'version',
        'dist.integrity',
        '--json',
        `--registry=${registry}`,
      ],
      { maxBuffer: 1024 * 1024 },
    )
    return JSON.parse(stdout)
  } catch (error) {
    if (isNotFoundError(error)) {
      return undefined
    }
    throw error
  }
}

async function calculateIntegrity(tarballPath) {
  const tarball = await readFile(path.resolve(tarballPath))
  return `sha512-${createHash('sha512').update(tarball).digest('base64')}`
}

async function getTarballPackageConfig(tarballPath) {
  const { stdout } = await execFileAsync(
    'tar',
    ['-xOf', path.resolve(tarballPath), 'package/package.json'],
    { maxBuffer: 1024 * 1024 },
  )
  return JSON.parse(stdout)
}

function isNotFoundError(error) {
  if (typeof error !== 'object' || error === null) {
    return false
  }

  const stderr = 'stderr' in error ? String(error.stderr) : ''
  return stderr.includes('E404') || stderr.includes('is not in this registry')
}
