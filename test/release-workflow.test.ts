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
      retryDelaysMs: [0, 0],
      sleepImpl: async () => {},
      logError: () => {},
    }),
    /Published integrity does not match the verified tarball/,
  )
  assert.equal(harness.fetchCalls(), 1)
})

test('release polling fetches forward deadline signals and observe expiration', { timeout: 2_000 }, async () => {
  for (const phase of ['metadata', 'attestation'] as const) {
    const controller = new AbortController()
    const reason = new DOMException('deadline expired', 'TimeoutError')
    const requestedTimeouts: number[] = []
    let aborts = 0
    const options = {
      fetchImpl: async (_input: string | URL, init?: RequestInit) => {
        assert.equal(init?.signal, controller.signal)
        return new Promise<Response>((_resolve, reject) => {
          controller.signal.addEventListener('abort', () => {
            aborts += 1
            reject(controller.signal.reason)
          }, { once: true })
          queueMicrotask(() => controller.abort(reason))
        })
      },
      retryDelaysMs: [],
      createTimeoutSignal: (timeoutMs: number) => {
        requestedTimeouts.push(timeoutMs)
        return controller.signal
      },
      logError: () => {},
    }

    await assert.rejects(
      phase === 'metadata'
        ? waitForRegistryMetadata({
            ...options,
            packageName: '@gavoryn/clearfetch',
            packageVersion: '1.0.8',
            expectedIntegrity: 'sha512-expected',
          })
        : waitForAttestationDocument({
            ...options,
            attestationURL: 'https://registry.example/attestation',
          }),
      phase === 'metadata'
        ? /npm metadata did not become ready: deadline expired/
        : /npm attestation did not become available/,
    )
    assert.deepEqual(requestedTimeouts, [5_000])
    assert.equal(aborts, 1)
  }
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

test('release attestation verification retries successful responses with failed body reads', async () => {
  let fetchCalls = 0
  const delays: number[] = []
  const document = { attestations: [] }

  const result = await waitForAttestationDocument({
    attestationURL: 'https://registry.example/attestation',
    fetchImpl: async () => {
      fetchCalls += 1
      if (fetchCalls === 1) {
        return new Response(new ReadableStream({
          start(controller) {
            controller.error(new TypeError('response body connection reset'))
          },
        }))
      }
      return new Response(JSON.stringify(document))
    },
    retryDelaysMs: [17],
    sleepImpl: async (delay) => { delays.push(delay) },
    logError: () => {},
  })

  assert.deepEqual(result, document)
  assert.equal(fetchCalls, 2)
  assert.deepEqual(delays, [17])
})

test('release attestation body failures stop when the retry budget is exhausted', async () => {
  let fetchCalls = 0
  const delays: number[] = []

  await assert.rejects(
    () => waitForAttestationDocument({
      attestationURL: 'https://registry.example/attestation',
      fetchImpl: async () => {
        fetchCalls += 1
        return new Response(new ReadableStream({
          start(controller) {
            controller.error(new DOMException('body read timed out', 'TimeoutError'))
          },
        }))
      },
      retryDelaysMs: [11, 23],
      sleepImpl: async (delay) => { delays.push(delay) },
      logError: () => {},
    }),
    /npm attestation did not become available/,
  )

  assert.equal(fetchCalls, 3)
  assert.deepEqual(delays, [11, 23])
})

test('release provenance verification binds artifact, workflow, tag, and commit', () => {
  const inputs = createProvenanceInputs()

  assert.doesNotThrow(() => verifyProvenance(inputs))
  for (const [overrides, message] of [
    [{ packageIntegrity: 'sha512-d3Jvbmc=' }, /SLSA subject does not match/],
    [{ packageName: '@other/package' }, /SLSA subject does not match/],
    [{ packageVersion: '9.9.9' }, /SLSA subject does not match/],
    [{ githubRepository: 'other/repository' }, /expected release workflow/],
    [{ tagName: 'v9.9.9' }, /expected release workflow/],
    [{ githubSha: 'wrong-commit' }, /release commit/],
  ] as const) {
    assert.throws(() => verifyProvenance({ ...inputs, ...overrides }), message)
  }
  assert.throws(
    () => verifyProvenance(createProvenanceInputs({ workflowPath: '.github/workflows/other.yml' })),
    /expected release workflow/,
  )
  assert.throws(
    () => verifyProvenance(createProvenanceInputs({ eventName: 'workflow_dispatch' })),
    /not produced by a tag push/,
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

function createProvenanceInputs({
  workflowPath = '.github/workflows/release.yml',
  eventName = 'push',
} = {}) {
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
            path: workflowPath,
            ref: expectedRef,
          },
        },
        resolvedDependencies: [{
          uri: `git+${expectedRepository}@${expectedRef}`,
          digest: { gitCommit: githubSha },
        }],
        internalParameters: {
          github: { event_name: eventName },
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
