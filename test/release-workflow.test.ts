import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const releaseWorkflowPath = fileURLToPath(
  new URL('../.github/workflows/release.yml', import.meta.url),
)

interface MockRegistryResponse {
  status: number
  body?: unknown
}

test('release metadata verification retries transient propagation gaps', async () => {
  const result = await runRegistryMetadataVerification([
    { status: 404 },
    {
      status: 200,
      body: { dist: { integrity: 'sha512-expected' } },
    },
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

  assert.equal(result.stdout.trim(), 'https://registry.example/attestation')
  assert.match(result.stderr, /__fetches__=3/)
})

test('release metadata verification treats integrity mismatches as terminal', async () => {
  await assert.rejects(
    () =>
      runRegistryMetadataVerification([
        {
          status: 200,
          body: {
            dist: {
              integrity: 'sha512-wrong',
              attestations: { url: 'https://registry.example/attestation' },
            },
          },
        },
      ]),
    (error) =>
      typeof error === 'object' &&
      error !== null &&
      'stderr' in error &&
      String(error.stderr).includes(
        'Published integrity does not match the verified tarball',
      ) &&
      String(error.stderr).includes('__fetches__=1'),
  )
})

test('release polling fetches have per-request deadlines', async () => {
  const workflow = await readFile(releaseWorkflowPath, 'utf8')

  for (const marker of [
    '          const packageName = process.env.PACKAGE_NAME',
    '          const retryDelaysMs = [1_000, 2_000, 4_000, 8_000]',
  ]) {
    const start = workflow.indexOf(marker)
    assert.notEqual(start, -1, `release polling block is missing: ${marker}`)

    const end = workflow.indexOf('\n          NODE', start)
    assert.notEqual(end, -1, `release polling block is unterminated: ${marker}`)

    assert.match(
      workflow.slice(start, end),
      /signal:\s*AbortSignal\.timeout\([\d_]+\)/,
    )
  }
})

async function runRegistryMetadataVerification(
  responses: MockRegistryResponse[],
) {
  const workflow = await readFile(releaseWorkflowPath, 'utf8')
  const startMarker = '          const packageName = process.env.PACKAGE_NAME'
  const start = workflow.indexOf(startMarker)
  assert.notEqual(start, -1, 'release metadata verification block is missing')

  const end = workflow.indexOf('\n          NODE', start)
  assert.notEqual(end, -1, 'release metadata verification block is unterminated')

  const source = workflow
    .slice(start, end)
    .replace(/^ {10}/gm, '')
  const harness = [
    `const mockResponses = ${JSON.stringify(responses)}`,
    'let fetchCalls = 0',
    "process.on('exit', () => console.error(`__fetches__=${fetchCalls}`))",
    'globalThis.fetch = async () => {',
    '  const mock = mockResponses[fetchCalls]',
    '  fetchCalls += 1',
    "  if (mock === undefined) throw new Error('unexpected registry request')",
    '  return new Response(JSON.stringify(mock.body), { status: mock.status })',
    '}',
    'globalThis.setTimeout = (callback) => {',
    '  queueMicrotask(callback)',
    '  return 0',
    '}',
    source,
  ].join('\n')

  return execFileAsync(
    process.execPath,
    ['--input-type=module', '--eval', harness],
    {
      env: {
        ...process.env,
        EXPECTED_INTEGRITY: 'sha512-expected',
        PACKAGE_NAME: '@gavoryn/clearfetch',
        PACKAGE_VERSION: '1.0.7',
      },
    },
  )
}
