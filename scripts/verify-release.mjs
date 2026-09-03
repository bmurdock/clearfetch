import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const REQUEST_TIMEOUT_MS = 5_000
const TRANSIENT_STATUSES = new Set([404, 408, 425, 429, 500, 502, 503, 504])

class TerminalRegistryError extends Error {}
class TerminalAttestationError extends Error {}

export async function waitForRegistryMetadata({
  packageName,
  packageVersion,
  expectedIntegrity,
  fetchImpl = fetch,
  retryDelaysMs = [1_000, 2_000, 4_000, 8_000, 8_000, 8_000, 8_000],
  sleepImpl = sleep,
  createTimeoutSignal = (timeoutMs) => AbortSignal.timeout(timeoutMs),
  logError = console.error,
}) {
  const registryURL = new URL(
    `${encodeURIComponent(packageName)}/${encodeURIComponent(packageVersion)}`,
    'https://registry.npmjs.org/',
  )
  let lastTransientFailure = 'registry metadata was not available'

  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    try {
      const response = await fetchImpl(registryURL, {
        headers: { accept: 'application/json' },
        signal: createTimeoutSignal(REQUEST_TIMEOUT_MS),
      })

      if (!response.ok) {
        if (!TRANSIENT_STATUSES.has(response.status)) {
          throw new TerminalRegistryError(
            `npm registry metadata request failed with ${response.status}`,
          )
        }
        lastTransientFailure = `npm registry returned ${response.status}`
      } else {
        const metadata = await response.json()
        const integrity = metadata.dist?.integrity
        const attestationURL = metadata.dist?.attestations?.url

        if (integrity !== undefined && integrity !== expectedIntegrity) {
          throw new TerminalRegistryError(
            'Published integrity does not match the verified tarball',
          )
        }

        if (
          integrity === expectedIntegrity &&
          typeof attestationURL === 'string'
        ) {
          return attestationURL
        }

        lastTransientFailure = integrity === undefined
          ? 'published integrity is not visible yet'
          : 'published attestation URL is not visible yet'
      }
    } catch (error) {
      if (error instanceof TerminalRegistryError) {
        throw error
      }
      lastTransientFailure = error instanceof Error ? error.message : String(error)
    }

    if (attempt === retryDelaysMs.length) {
      break
    }

    const delayMs = retryDelaysMs[attempt]
    logError(
      `${lastTransientFailure}; retrying npm metadata in ${delayMs}ms`,
    )
    await sleepImpl(delayMs)
  }

  throw new Error(`npm metadata did not become ready: ${lastTransientFailure}`)
}

export async function waitForAttestationDocument({
  attestationURL,
  fetchImpl = fetch,
  retryDelaysMs = [1_000, 2_000, 4_000, 8_000],
  sleepImpl = sleep,
  createTimeoutSignal = (timeoutMs) => AbortSignal.timeout(timeoutMs),
  logError = console.error,
}) {
  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    try {
      const response = await fetchImpl(attestationURL, {
        signal: createTimeoutSignal(REQUEST_TIMEOUT_MS),
      })
      if (response.ok) {
        return response.json()
      }
      if (!TRANSIENT_STATUSES.has(response.status)) {
        throw new TerminalAttestationError(
          `npm attestation request failed with ${response.status}`,
        )
      }
      logError(`npm attestation returned ${response.status}`)
    } catch (error) {
      if (error instanceof TerminalAttestationError) {
        throw error
      }
      logError(error instanceof Error ? error.message : String(error))
    }

    if (attempt === retryDelaysMs.length) {
      break
    }

    const delayMs = retryDelaysMs[attempt]
    logError(`retrying npm attestation in ${delayMs}ms`)
    await sleepImpl(delayMs)
  }

  throw new Error('npm attestation did not become available')
}

export function verifyProvenance({
  document,
  packageIntegrity,
  packageName,
  packageVersion,
  githubRepository,
  githubSha,
  tagName,
}) {
  const provenance = document.attestations?.find(
    (entry) => entry.predicateType === 'https://slsa.dev/provenance/v1',
  )
  if (provenance === undefined) {
    throw new Error('published package has no SLSA provenance attestation')
  }

  const statement = JSON.parse(
    Buffer.from(provenance.bundle.dsseEnvelope.payload, 'base64').toString('utf8'),
  )
  const expectedDigest = Buffer.from(
    packageIntegrity.slice('sha512-'.length),
    'base64',
  ).toString('hex')
  const expectedSubject = `pkg:npm/${packageName.replace(/^@/, '%40')}@${packageVersion}`
  const subject = statement.subject?.find((entry) => entry.name === expectedSubject)
  if (subject?.digest?.sha512 !== expectedDigest) {
    throw new Error('SLSA subject does not match the published package bytes')
  }

  const workflow = statement.predicate?.buildDefinition?.externalParameters?.workflow
  const expectedRepository = `https://github.com/${githubRepository}`
  const expectedRef = `refs/tags/${tagName}`
  if (
    workflow?.repository !== expectedRepository ||
    workflow?.path !== '.github/workflows/release.yml' ||
    workflow?.ref !== expectedRef
  ) {
    throw new Error('SLSA provenance does not identify the expected release workflow')
  }

  const expectedSource = `git+${expectedRepository}@${expectedRef}`
  const source = statement.predicate?.buildDefinition?.resolvedDependencies?.find(
    (entry) => entry.uri === expectedSource,
  )
  if (source?.digest?.gitCommit !== githubSha) {
    throw new Error('SLSA provenance does not identify the release commit')
  }

  if (
    statement.predicate?.buildDefinition?.internalParameters?.github?.event_name !== 'push'
  ) {
    throw new Error('SLSA provenance was not produced by a tag push')
  }
}

async function runCommand(command) {
  if (command === 'registry-metadata') {
    const attestationURL = await waitForRegistryMetadata({
      packageName: process.env.PACKAGE_NAME,
      packageVersion: process.env.PACKAGE_VERSION,
      expectedIntegrity: process.env.EXPECTED_INTEGRITY,
    })
    console.log(attestationURL)
    return
  }

  if (command === 'attestation') {
    const document = await waitForAttestationDocument({
      attestationURL: process.env.ATTESTATION_URL,
    })
    verifyProvenance({
      document,
      packageIntegrity: process.env.PACKAGE_INTEGRITY,
      packageName: process.env.PACKAGE_NAME,
      packageVersion: process.env.PACKAGE_VERSION,
      githubRepository: process.env.GITHUB_REPOSITORY,
      githubSha: process.env.GITHUB_SHA,
      tagName: process.env.TAG_NAME,
    })
    console.log('npm provenance matches the expected artifact, workflow, tag, and commit')
    return
  }

  throw new Error(`Unknown release verification command: ${String(command)}`)
}

function sleep(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs))
}

const isMain = process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  await runCommand(process.argv[2])
}
