import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { executeRequest } from '../dist/internal/execute-request.js'
import {
  createBeforeRequestContext,
  createBeforeRequestContextFromSnapshot,
  snapshotBeforeRequestContext,
} from '../dist/internal/normalize-request.js'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packageMetadata = JSON.parse(
  await readFile(path.join(rootDir, 'package.json'), 'utf8'),
)
const options = parseArguments(process.argv.slice(2))
const configuration = options.smoke
  ? { sampleCount: 1, targetSampleMs: 5, warmupCount: 0 }
  : { sampleCount: 20, targetSampleMs: 50, warmupCount: 3 }
const scenarios = createScenarios()
const results = []
let sink = 0

for (const scenario of scenarios) {
  const batchSize = await calibrateBatchSize(
    scenario,
    configuration.targetSampleMs,
  )

  for (let index = 0; index < configuration.warmupCount; index += 1) {
    await measureBatch(scenario, batchSize)
  }

  const samplesNs = []
  for (let index = 0; index < configuration.sampleCount; index += 1) {
    const elapsedNs = await measureBatch(scenario, batchSize)
    samplesNs.push(elapsedNs / batchSize)
  }

  const sortedSamples = [...samplesNs].sort((left, right) => left - right)
  const medianNs = median(sortedSamples)
  results.push({
    id: scenario.id,
    group: scenario.group,
    description: scenario.description,
    batchSize,
    medianNs,
    p95Ns: percentile(sortedSamples, 0.95),
    operationsPerSecond: 1_000_000_000 / medianNs,
    samplesNs,
  })
}

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  package: {
    name: packageMetadata.name,
    version: packageMetadata.version,
  },
  source: readGitState(),
  environment: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpu: os.cpus()[0]?.model ?? 'unknown',
  },
  configuration: {
    mode: options.smoke ? 'smoke' : 'benchmark',
    ...configuration,
  },
  scenarios: results,
}

let baseline
if (options.baselinePath !== undefined) {
  baseline = JSON.parse(
    await readFile(path.resolve(rootDir, options.baselinePath), 'utf8'),
  )
  validateBaseline(baseline)
}

if (options.outputPath !== undefined) {
  const outputPath = path.resolve(rootDir, options.outputPath)
  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
}

if (options.json) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
} else {
  printReport(report, baseline)
  if (options.outputPath !== undefined) {
    console.log(`\nRecorded benchmark report at ${options.outputPath}`)
  }
}

// Keep scenario results observable without including logging in timed regions.
if (!Number.isFinite(sink)) {
  throw new Error('benchmark sink became invalid')
}

function createScenarios() {
  const query100 = createLargeQuery(100)
  const query1000 = createLargeQuery(1_000)
  const retryOptions = {
    attempts: 3,
    backoffMs: 0,
    maxBackoffMs: 0,
    multiplier: 1,
    retryOnMethods: ['POST'],
    retryOnStatuses: [503],
  }
  const retryContext = createBeforeRequestContext(
    'https://example.test/items',
    {},
    {
      method: 'POST',
      body: 'benchmark',
      query: query1000,
      retry: retryOptions,
    },
  )
  const retrySnapshot = snapshotBeforeRequestContext(retryContext)
  const oneMiBString = 'x'.repeat(1024 * 1024)
  const oneMiBBuffer = new ArrayBuffer(1024 * 1024)
  const oneMiBFormData = new FormData()
  oneMiBFormData.append(
    'file',
    new Blob([new Uint8Array(1024 * 1024)]),
    'benchmark.bin',
  )
  oneMiBFormData.append('label', 'benchmark')

  return [
    createSyncScenario({
      id: 'query.create.100',
      group: 'large-query',
      description: 'create request context with 100 mixed query keys',
      maxBatchSize: 10_000,
      run: () => createQueryContext(query100),
    }),
    createSyncScenario({
      id: 'query.create.1000',
      group: 'large-query',
      description: 'create request context with 1,000 mixed query keys',
      maxBatchSize: 2_000,
      run: () => createQueryContext(query1000),
    }),
    createSyncScenario({
      id: 'retry-context.rebuild.query-1000',
      group: 'retry-context',
      description: 'rebuild attempt context from a 1,000-key query snapshot',
      maxBatchSize: 10_000,
      run: () => {
        const context = createBeforeRequestContextFromSnapshot(retrySnapshot, 2)
        return context.hookContext.options.attempt
      },
    }),
    createResponseHookScenario(0),
    createResponseHookScenario(1),
    createResponseHookScenario(3),
    createRetryBodyInitialScenario(
      'string-1m-control',
      oneMiBString,
      retryOptions,
    ),
    createRetryBodyRebuildScenario(
      'string-1m-control',
      oneMiBString,
      retryOptions,
    ),
    createRetryBodyInitialScenario(
      'arraybuffer-1m',
      oneMiBBuffer,
      retryOptions,
    ),
    createRetryBodyRebuildScenario(
      'arraybuffer-1m',
      oneMiBBuffer,
      retryOptions,
    ),
    createRetryBodyInitialScenario(
      'formdata-1m',
      oneMiBFormData,
      retryOptions,
    ),
    createRetryBodyRebuildScenario(
      'formdata-1m',
      oneMiBFormData,
      retryOptions,
    ),
  ]
}

function createSyncScenario({
  id,
  group,
  description,
  maxBatchSize,
  run,
}) {
  return { id, group, description, maxBatchSize, run, async: false }
}

function createAsyncScenario({
  id,
  group,
  description,
  maxBatchSize,
  run,
}) {
  return { id, group, description, maxBatchSize, run, async: true }
}

function createQueryContext(query) {
  const context = createBeforeRequestContext(
    'https://example.test/items',
    {},
    { query },
  )
  return context.hookContext.url.search.length
}

function createResponseHookScenario(hookCount) {
  const payload = new Uint8Array(64 * 1024)
  const afterResponse = Array.from({ length: hookCount }, () =>
    async ({ response }) => {
      const body = await response.arrayBuffer()
      sink += body.byteLength
    })

  return createAsyncScenario({
    id: `response-hooks.body-64k.${hookCount}`,
    group: 'response-hooks',
    description: `parse a 64 KiB response with ${hookCount} body-reading hook${hookCount === 1 ? '' : 's'}`,
    maxBatchSize: 2_048,
    run: async () => {
      const result = await executeRequest(
        'https://example.test/data',
        {},
        {
          responseType: 'arrayBuffer',
          hooks: { afterResponse },
        },
        async () => new Response(payload),
      )
      return result.byteLength
    },
  })
}

function createRetryBodyInitialScenario(name, body, retry) {
  return createSyncScenario({
    id: `retry-body.initial.${name}`,
    group: 'retryable-body',
    description: `create retryable POST context with ${name}`,
    maxBatchSize: getRetryBodyMaxBatchSize(body),
    run: () => {
      const context = createBeforeRequestContext(
        'https://example.test/upload',
        {},
        { method: 'POST', body, retry },
      )
      return getBodySize(context.hookContext.body)
    },
  })
}

function createRetryBodyRebuildScenario(name, body, retry) {
  const context = createBeforeRequestContext(
    'https://example.test/upload',
    {},
    {
      method: 'POST',
      body,
      retry,
      hooks: { beforeRequest: [() => undefined] },
    },
  )
  const snapshot = snapshotBeforeRequestContext(context)

  return createSyncScenario({
    id: `retry-body.rebuild.${name}.with-hook`,
    group: 'retryable-body',
    description: `rebuild hooked retry context with ${name}`,
    maxBatchSize: getRetryBodyMaxBatchSize(body),
    run: () => {
      const rebuilt = createBeforeRequestContextFromSnapshot(snapshot, 2)
      return getBodySize(rebuilt.hookContext.body)
    },
  })
}

function getBodySize(body) {
  if (typeof body === 'string') {
    return body.length
  }
  if (body instanceof ArrayBuffer) {
    return body.byteLength
  }
  if (ArrayBuffer.isView(body)) {
    return body.byteLength
  }
  if (body instanceof FormData) {
    return [...body.entries()].length
  }
  if (body instanceof Blob) {
    return body.size
  }
  return body === null || body === undefined ? 0 : 1
}

function getRetryBodyMaxBatchSize(body) {
  // Bound copied binary bodies to avoid turning calibration into a memory
  // pressure test; cheap controls can safely run long enough to reduce noise.
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
    return 64
  }
  return 100_000
}

function createLargeQuery(size) {
  const query = {}
  for (let index = 0; index < size; index += 1) {
    switch (index % 5) {
      case 0:
        query[`key${index}`] = `value-${index}`
        break
      case 1:
        query[`key${index}`] = index
        break
      case 2:
        query[`key${index}`] = index % 2 === 0
        break
      case 3:
        query[`key${index}`] = [index, `value-${index}`, null]
        break
      default:
        query[`key${index}`] = undefined
    }
  }
  return query
}

async function calibrateBatchSize(scenario, targetSampleMs) {
  const targetNs = targetSampleMs * 1_000_000
  let batchSize = 1

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const elapsedNs = await measureBatch(scenario, batchSize)
    if (elapsedNs >= targetNs || batchSize >= scenario.maxBatchSize) {
      return batchSize
    }

    const multiplier = Math.min(
      10,
      Math.max(2, Math.ceil(targetNs / Math.max(elapsedNs, 1))),
    )
    batchSize = Math.min(scenario.maxBatchSize, batchSize * multiplier)
  }

  return batchSize
}

async function measureBatch(scenario, batchSize) {
  const startedAt = process.hrtime.bigint()
  if (scenario.async) {
    for (let index = 0; index < batchSize; index += 1) {
      sink += Number(await scenario.run())
    }
  } else {
    for (let index = 0; index < batchSize; index += 1) {
      sink += Number(scenario.run())
    }
  }
  return Number(process.hrtime.bigint() - startedAt)
}

function percentile(sortedSamples, percentileValue) {
  const index = Math.max(
    0,
    Math.ceil(sortedSamples.length * percentileValue) - 1,
  )
  return sortedSamples[index]
}

function median(sortedSamples) {
  const middle = Math.floor(sortedSamples.length / 2)
  if (sortedSamples.length % 2 === 1) {
    return sortedSamples[middle]
  }
  return (sortedSamples[middle - 1] + sortedSamples[middle]) / 2
}

function parseArguments(args) {
  const parsed = {
    baselinePath: undefined,
    json: false,
    outputPath: undefined,
    smoke: false,
  }

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--json') {
      parsed.json = true
    } else if (argument === '--smoke') {
      parsed.smoke = true
    } else if (argument === '--baseline' || argument === '--output') {
      const value = args[index + 1]
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`${argument} requires a path`)
      }
      if (argument === '--baseline') {
        parsed.baselinePath = value
      } else {
        parsed.outputPath = value
      }
      index += 1
    } else {
      throw new Error(`unknown benchmark argument: ${argument}`)
    }
  }

  return parsed
}

function readGitState() {
  try {
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: rootDir,
      encoding: 'utf8',
    }).trim()
    const dirty = execFileSync(
      'git',
      ['status', '--porcelain', '--untracked-files=normal'],
      { cwd: rootDir, encoding: 'utf8' },
    ).trim() !== ''
    return { commit, dirty }
  } catch {
    return { commit: null, dirty: null }
  }
}

function validateBaseline(candidate) {
  if (
    candidate === null ||
    typeof candidate !== 'object' ||
    candidate.schemaVersion !== 1 ||
    !Array.isArray(candidate.scenarios)
  ) {
    throw new Error('baseline is not a benchmark schema version 1 report')
  }

  const scenarioIds = new Set()
  for (const scenario of candidate.scenarios) {
    if (
      scenario === null ||
      typeof scenario !== 'object' ||
      typeof scenario.id !== 'string' ||
      typeof scenario.medianNs !== 'number' ||
      !Number.isFinite(scenario.medianNs) ||
      scenario.medianNs <= 0
    ) {
      throw new Error('baseline contains an invalid scenario result')
    }
    if (scenarioIds.has(scenario.id)) {
      throw new Error(`baseline contains duplicate scenario: ${scenario.id}`)
    }
    scenarioIds.add(scenario.id)
  }
}

function printReport(current, comparison) {
  console.log(
    `${current.package.name} ${current.package.version} benchmarks ` +
    `(${current.environment.node}, ${current.environment.platform}-${current.environment.arch})`,
  )
  console.log(
    `mode=${current.configuration.mode} warmups=${current.configuration.warmupCount} ` +
    `samples=${current.configuration.sampleCount} target=${current.configuration.targetSampleMs}ms`,
  )
  console.log(
    `source=${current.source.commit?.slice(0, 12) ?? 'unknown'} ` +
    `dirty=${current.source.dirty ?? 'unknown'}`,
  )

  if (comparison !== undefined && !sameEnvironment(current, comparison)) {
    console.warn('baseline environment differs; ratios are descriptive only')
  }
  if (comparison !== undefined && !sameConfiguration(current, comparison)) {
    console.warn('baseline sampling mode differs; ratios may be noisy')
  }

  const baselineById = new Map(
    comparison?.scenarios.map((scenario) => [scenario.id, scenario]) ?? [],
  )
  const rows = current.scenarios.map((scenario) => {
    const baselineScenario = baselineById.get(scenario.id)
    const ratio = baselineScenario === undefined
      ? '—'
      : `${(scenario.medianNs / baselineScenario.medianNs).toFixed(2)}x`
    return {
      scenario: scenario.id,
      median: formatDuration(scenario.medianNs),
      p95: formatDuration(scenario.p95Ns),
      'ops/s': formatCount(scenario.operationsPerSecond),
      baseline: ratio,
    }
  })
  console.table(rows)
  console.log('Timing values are observations only; this command enforces no thresholds.')
}

function sameEnvironment(left, right) {
  return (
    left.environment?.node === right.environment?.node &&
    left.environment?.platform === right.environment?.platform &&
    left.environment?.arch === right.environment?.arch &&
    left.environment?.cpu === right.environment?.cpu
  )
}

function sameConfiguration(left, right) {
  return (
    left.configuration?.mode === right.configuration?.mode &&
    left.configuration?.warmupCount === right.configuration?.warmupCount &&
    left.configuration?.sampleCount === right.configuration?.sampleCount &&
    left.configuration?.targetSampleMs === right.configuration?.targetSampleMs
  )
}

function formatDuration(nanoseconds) {
  if (nanoseconds < 1_000) {
    return `${nanoseconds.toFixed(0)} ns`
  }
  if (nanoseconds < 1_000_000) {
    return `${(nanoseconds / 1_000).toFixed(2)} µs`
  }
  return `${(nanoseconds / 1_000_000).toFixed(2)} ms`
}

function formatCount(value) {
  return Math.round(value).toLocaleString('en-US')
}
