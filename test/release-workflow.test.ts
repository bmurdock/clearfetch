import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  verifyProvenance,
  waitForAttestationDocument,
  waitForRegistryMetadata,
} from '../scripts/verify-release.mjs'

interface MockRegistryResponse {
  status: number
  body?: unknown
}

const releaseWorkflowURL = new URL('../.github/workflows/release.yml', import.meta.url)

test('release metadata verification retries transient propagation gaps', async () => {
  const harness = createRegistryHarness([
    { status: 404 },
    { status: 200, body: { dist: { integrity: 'sha512-expected' } } },
    {
      status: 200,
      body: {
        dist: {
          integrity: 'sha512-expected',
          attestations: { url: 'https://registry.example/attestation' },
        },
      },
    },
  ])

  const result = await waitForRegistryMetadata({
    packageName: '@gavoryn/clearfetch',
    packageVersion: '1.0.8',
    expectedIntegrity: 'sha512-expected',
    fetchImpl: harness.fetch,
    retryDelaysMs: [0, 0],
    sleepImpl: async () => {},
    logError: () => {},
  })

  assert.equal(result, 'https://registry.example/attestation')
  assert.equal(harness.fetchCalls(), 3)
})

test('release metadata verification treats integrity mismatches as terminal', async () => {
  const harness = createRegistryHarness([{
    status: 200,
    body: {
      dist: {
        integrity: 'sha512-wrong',
        attestations: { url: 'https://registry.example/attestation' },
      },
    },
  }])

  await assert.rejects(
    () => waitForRegistryMetadata({
      packageName: '@gavoryn/clearfetch',
      packageVersion: '1.0.8',
      expectedIntegrity: 'sha512-expected',
      fetchImpl: harness.fetch,
      retryDelaysMs: [],
    }),
    /Published integrity does not match the verified tarball/,
  )
  assert.equal(harness.fetchCalls(), 1)
})

test('release polling fetches have per-request deadlines', async () => {
  const requestedTimeouts: number[] = []
  const createTimeoutSignal = (timeoutMs: number) => {
    requestedTimeouts.push(timeoutMs)
    return new AbortController().signal
  }

  await waitForRegistryMetadata({
    packageName: '@gavoryn/clearfetch',
    packageVersion: '1.0.8',
    expectedIntegrity: 'sha512-expected',
    fetchImpl: async () => new Response(JSON.stringify({
      dist: {
        integrity: 'sha512-expected',
        attestations: { url: 'https://registry.example/attestation' },
      },
    })),
    retryDelaysMs: [],
    createTimeoutSignal,
  })
  await waitForAttestationDocument({
    attestationURL: 'https://registry.example/attestation',
    fetchImpl: async () => new Response('{}'),
    retryDelaysMs: [],
    createTimeoutSignal,
  })

  assert.deepEqual(requestedTimeouts, [5_000, 5_000])
})

test('release attestation verification retries transient propagation gaps', async () => {
  const harness = createRegistryHarness([
    { status: 404 },
    { status: 200, body: { attestations: [] } },
  ])

  const result = await waitForAttestationDocument({
    attestationURL: 'https://registry.example/attestation',
    fetchImpl: harness.fetch,
    retryDelaysMs: [0],
    sleepImpl: async () => {},
    logError: () => {},
  })

  assert.deepEqual(result, { attestations: [] })
  assert.equal(harness.fetchCalls(), 2)
})

test('release provenance verification binds artifact, workflow, tag, and commit', () => {
  const inputs = createProvenanceInputs()

  assert.doesNotThrow(() => verifyProvenance(inputs))
  assert.throws(
    () => verifyProvenance({ ...inputs, githubSha: 'wrong-commit' }),
    /SLSA provenance does not identify the release commit/,
  )
})

test('release workflow invokes the tested verification module', async () => {
  const workflow = await readFile(releaseWorkflowURL, 'utf8')

  assert.match(workflow, /node scripts\/verify-release\.mjs registry-metadata/)
  assert.match(workflow, /node scripts\/verify-release\.mjs attestation/)
})

function createRegistryHarness(responses: MockRegistryResponse[]) {
  let calls = 0
  return {
    fetch: async () => {
      const mock = responses[calls]
      calls += 1
      if (mock === undefined) {
        throw new Error('unexpected registry request')
      }
      return new Response(JSON.stringify(mock.body), { status: mock.status })
    },
    fetchCalls: () => calls,
  }
}

function createProvenanceInputs() {
  const packageName = '@gavoryn/clearfetch'
  const packageVersion = '1.0.8'
  const githubRepository = 'bmurdock/clearfetch'
  const githubSha = 'abc123'
  const tagName = 'v1.0.8'
  const digestBytes = Buffer.from('verified artifact')
  const packageIntegrity = `sha512-${digestBytes.toString('base64')}`
  const expectedRepository = `https://github.com/${githubRepository}`
  const expectedRef = `refs/tags/${tagName}`
  const statement = {
    subject: [{
      name: 'pkg:npm/%40gavoryn/clearfetch@1.0.8',
      digest: { sha512: digestBytes.toString('hex') },
    }],
    predicate: {
      buildDefinition: {
        externalParameters: {
          workflow: {
            repository: expectedRepository,
            path: '.github/workflows/release.yml',
            ref: expectedRef,
          },
        },
        resolvedDependencies: [{
          uri: `git+${expectedRepository}@${expectedRef}`,
          digest: { gitCommit: githubSha },
        }],
        internalParameters: {
          github: { event_name: 'push' },
        },
      },
    },
  }

  return {
    document: {
      attestations: [{
        predicateType: 'https://slsa.dev/provenance/v1',
        bundle: {
          dsseEnvelope: {
            payload: Buffer.from(JSON.stringify(statement)).toString('base64'),
          },
        },
      }],
    },
    packageIntegrity,
    packageName,
    packageVersion,
    githubRepository,
    githubSha,
    tagName,
  }
}
