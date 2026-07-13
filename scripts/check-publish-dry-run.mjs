import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import process from 'node:process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const registry = 'https://registry.npmjs.org'
const allowExisting = process.argv.includes('--allow-existing')
const packageConfig = JSON.parse(await readFile('package.json', 'utf8'))
const packageSpec = `${packageConfig.name}@${packageConfig.version}`
const published = await getPublishedMetadata(packageSpec)

if (published === undefined) {
  const { stderr, stdout } = await execFileAsync(
    'npm',
    ['publish', '--dry-run', `--registry=${registry}`],
    { maxBuffer: 10 * 1024 * 1024 },
  )
  process.stdout.write(stdout)
  process.stderr.write(stderr)
  console.log(`publish dry-run passed for unpublished version ${packageSpec}`)
} else {
  if (allowExisting) {
    console.log(
      `${packageSpec} is already published; publish dry-run skipped for manual validation`,
    )
    process.exit(0)
  }

  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'])
  const currentGitHead = stdout.trim()

  if (published.gitHead !== currentGitHead) {
    throw new Error(
      `published gitHead ${String(published.gitHead)} does not match current commit ${currentGitHead}`,
    )
  }

  console.log(
    `${packageSpec} is already published from the current commit; publish dry-run skipped`,
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
        'gitHead',
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

function isNotFoundError(error) {
  if (typeof error !== 'object' || error === null) {
    return false
  }

  const stderr = 'stderr' in error ? String(error.stderr) : ''
  return stderr.includes('E404') || stderr.includes('is not in this registry')
}
