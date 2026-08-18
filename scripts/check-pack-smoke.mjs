import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const rootDir = process.cwd()
const tscPath = path.join(rootDir, 'node_modules', 'typescript', 'bin', 'tsc')
const retainTarball = process.argv.includes('--retain')
const unexpectedArguments = process.argv.slice(2).filter((argument) => argument !== '--retain')
const MAX_PACKED_BYTES = 50_000
const MAX_UNPACKED_BYTES = 175_000
const MAX_PACKED_FILES = 65

if (unexpectedArguments.length > 0) {
  throw new Error(`unexpected arguments: ${unexpectedArguments.join(', ')}`)
}

const { stdout } = await execFileAsync('npm', ['pack', '--json', '--ignore-scripts'], {
  cwd: rootDir,
})
const packResult = selectPackResult(JSON.parse(stdout))
const tarballPath = path.join(rootDir, packResult.filename)
const packageName = '@gavoryn/clearfetch'
let tempDir
let tarballRetained = false

try {
  assertPackedFiles(packResult.files)
  assertPackedSize(packResult)

  tempDir = await mkdtemp(path.join(os.tmpdir(), 'clearfetch-pack-'))
  const importSmokeFile = path.join(tempDir, 'smoke-import.mjs')
  await writeFile(
    importSmokeFile,
    [
      `import * as mod from '${packageName}'`,
      '',
      'const expectedFunctionExports = [',
      "  'AbortRequestError',",
      "  'ConfigError',",
      "  'HttpClientError',",
      "  'HttpError',",
      "  'NetworkError',",
      "  'ParseError',",
      "  'TimeoutError',",
      "  'createClient',",
      "  'isHttpClientError',",
      "  'isHttpError',",
      "  'redactHeaders',",
      "  'request',",
      ']',
      '',
      'for (const exportName of expectedFunctionExports) {',
      "  if (typeof mod[exportName] !== 'function') {",
      "    throw new Error(`missing ${exportName} export`)",
      '  }',
      '}',
      '',
      'const abortError = new mod.AbortRequestError()',
      "if (!mod.isHttpClientError(abortError)) throw new Error('error predicate rejected public error')",
      '',
    ].join('\n'),
    'utf8',
  )

  const subpathSmokeFile = path.join(tempDir, 'smoke-subpath.mjs')
  await writeFile(
    subpathSmokeFile,
    [
      `const packageName = '${packageName}'`,
      '',
      'try {',
      "  await import(`${packageName}/internal/normalize-error`)",
      "  throw new Error('internal subpath unexpectedly resolved')",
      '} catch (error) {',
      "  if (error?.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') {",
      '    throw error',
      '  }',
      '}',
      '',
    ].join('\n'),
    'utf8',
  )

  const smokeFile = path.join(tempDir, 'smoke.ts')
  await writeFile(
    smokeFile,
    [
      'import {',
      '  AbortRequestError,',
      '  ConfigError,',
      '  HttpClientError,',
      '  HttpError,',
      '  NetworkError,',
      '  ParseError,',
      '  TimeoutError,',
      '  createClient,',
      '  isHttpClientError,',
      '  isHttpError,',
      '  redactHeaders,',
      '  request,',
      '  type HttpClient,',
      '  type QueryInput,',
      '  type RedactHeadersOptions,',
      '  type RequestOptions,',
      `} from '${packageName}'`,
      '',
      "const rawPromise: Promise<Response> = request('https://api.example.com', { responseType: 'raw' })",
      'void rawPromise',
      '',
      "const requestOptions: RequestOptions = { headers: { Accept: 'application/json' } }",
      'void requestOptions',
      '',
      "const queryInput: QueryInput = new URLSearchParams('tag=a&tag=b')",
      'void queryInput',
      '',
      'const redactionOptions: RedactHeadersOptions = {',
      "  headerNames: ['authorization'],",
      '}',
      'void redactionOptions',
      '',
      "const safeHeaders = redactHeaders({ Authorization: 'secret' })",
      "if (safeHeaders.get('authorization') !== '[redacted]') {",
      "  throw new Error('redactHeaders did not redact Authorization')",
      '}',
      '',
      "const client: HttpClient = createClient({ baseURL: 'https://api.example.com' })",
      'const jsonPromise: Promise<{ ok: boolean } | undefined> = client.get<{ ok: boolean }>(\'/users\')',
      'void jsonPromise',
      '',
      "const textClient = createClient({ baseURL: 'https://api.example.com', responseType: 'text' })",
      "const defaultTextPromise: Promise<string> = textClient.get('/health')",
      'void defaultTextPromise',
      '',
      "const rawClient = textClient.extend({ responseType: 'raw' })",
      "const defaultRawPromise: Promise<Response> = rawClient.get('/download')",
      'void defaultRawPromise',
      '',
      "const explicitJsonPromise: Promise<{ ok: boolean } | undefined> = textClient.get<{ ok: boolean }>('/users', { responseType: 'json' })",
      'void explicitJsonPromise',
      '',
      '// @ts-expect-error an explicit client mode requires a matching runtime default',
      "createClient<'text'>()",
      '',
      '// @ts-expect-error an explicit extended mode requires a matching runtime default',
      "textClient.extend<'raw'>({})",
      '',
      'async function smokeRequestBodies() {',
      "  await request('https://api.example.com/create', {",
      "    method: 'POST',",
      '    json: { ok: true },',
      '  })',
      '',
      "  await client.post('/create', {",
      '    json: { ok: true },',
      '  })',
      '}',
      'void smokeRequestBodies',
      '',
      'const publicErrors = [',
      "  new AbortRequestError('aborted'),",
      "  new ConfigError('bad config'),",
      "  new HttpClientError('base', 'BASE_ERROR'),",
      '  new HttpError({',
      '    status: 404,',
      "    statusText: 'Not Found',",
      "    response: new Response('missing', { status: 404, statusText: 'Not Found' }),",
      '  }),',
      "  new NetworkError('failed'),",
      '  new ParseError({',
      "    response: new Response('not json'),",
      "    responseType: 'json',",
      '  }),',
      '  new TimeoutError(100),',
      ']',
      '',
      'for (const error of publicErrors) {',
      "  if (!isHttpClientError(error)) throw new Error('public error was not recognized')",
      '}',
      '',
      "const httpError = publicErrors.find((error) => error instanceof HttpError)",
      'if (!(httpError instanceof HttpError) || !isHttpError(httpError)) {',
      "  throw new Error('isHttpError did not recognize HttpError')",
      '}',
      '',
    ].join('\n'),
    'utf8',
  )

  await writeFile(
    path.join(tempDir, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          lib: ['ES2022', 'DOM', 'DOM.Iterable'],
          strict: true,
          noEmit: true,
          skipLibCheck: true,
        },
        include: ['smoke.ts'],
      },
      null,
      2,
    ),
    'utf8',
  )

  await execFileAsync(
    '/bin/bash',
    [
      '-lc',
      [
        'npm init -y >/dev/null',
        `npm install --ignore-scripts ${shellEscape(tarballPath)} >/dev/null`,
        'node smoke-import.mjs',
        'node smoke-subpath.mjs',
        `${shellEscape(tscPath)} -p tsconfig.json`,
      ].join(' && '),
    ],
    { cwd: tempDir },
  )

  if (retainTarball) {
    const artifactDir = path.join(rootDir, 'release-artifact')
    const artifactPath = path.join(artifactDir, packResult.filename)
    await rm(artifactDir, { recursive: true, force: true })
    await mkdir(artifactDir)
    await rename(tarballPath, artifactPath)
    tarballRetained = true
    console.log(`retained verified tarball at ${artifactPath}`)
  }
} finally {
  if (tempDir !== undefined) {
    await rm(tempDir, { recursive: true, force: true })
  }
  if (!tarballRetained) {
    await rm(tarballPath, { force: true })
  }
}

console.log('packed artifact smoke checks passed')

function selectPackResult(output) {
  const candidates = Array.isArray(output)
    ? output
    : [output, ...(isRecord(output) ? Object.values(output) : [])]
  const packResult = candidates.find((candidate) => {
    return (
      isRecord(candidate) &&
      typeof candidate.filename === 'string' &&
      Array.isArray(candidate.files)
    )
  })

  if (packResult === undefined) {
    throw new Error('npm pack did not return a usable package result')
  }

  return packResult
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function assertPackedFiles(files) {
  const unexpectedFiles = files
    .map((entry) => entry.path)
    .filter((filePath) => {
      return (
        !filePath.startsWith('dist/') &&
        filePath !== 'LICENSE' &&
        filePath !== 'README.md' &&
        filePath !== 'package.json'
      )
    })

  if (unexpectedFiles.length > 0) {
    throw new Error(`unexpected files in packed artifact: ${unexpectedFiles.join(', ')}`)
  }

  const declarationMaps = files
    .map((entry) => entry.path)
    .filter((filePath) => filePath.endsWith('.d.ts.map'))
  if (declarationMaps.length > 0) {
    throw new Error(
      `declaration maps must not ship without their TypeScript sources: ${declarationMaps.join(', ')}`,
    )
  }
}

function assertPackedSize(packResult) {
  if (!Number.isFinite(packResult.size) || !Number.isFinite(packResult.unpackedSize)) {
    throw new Error('npm pack did not report finite packed and unpacked byte counts')
  }

  const fileCount = packResult.files.length
  const violations = []

  if (packResult.size > MAX_PACKED_BYTES) {
    violations.push(`packed bytes ${packResult.size} > ${MAX_PACKED_BYTES}`)
  }
  if (packResult.unpackedSize > MAX_UNPACKED_BYTES) {
    violations.push(
      `unpacked bytes ${packResult.unpackedSize} > ${MAX_UNPACKED_BYTES}`,
    )
  }
  if (fileCount > MAX_PACKED_FILES) {
    violations.push(`file count ${fileCount} > ${MAX_PACKED_FILES}`)
  }

  if (violations.length > 0) {
    throw new Error(`packed artifact exceeds its size budget: ${violations.join('; ')}`)
  }
}

function shellEscape(value) {
  return `'${value.replaceAll("'", "'\\''")}'`
}
