import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const rootDir = process.cwd()
const tscPath = path.join(rootDir, 'node_modules', '.bin', 'tsc')

const { stdout } = await execFileAsync('npm', ['pack', '--json'], {
  cwd: rootDir,
})
const [packResult] = JSON.parse(stdout)
const tarballPath = path.join(rootDir, packResult.filename)

assertPackedFiles(packResult.files)

const packageName = '@gavoryn/clearfetch'
const tempDir = await mkdtemp(path.join(os.tmpdir(), 'clearfetch-pack-'))

try {
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
      '  request,',
      '  type HttpClient,',
      '  type RequestOptions,',
      `} from '${packageName}'`,
      '',
      "const rawPromise: Promise<Response> = request('https://api.example.com', { responseType: 'raw' })",
      'void rawPromise',
      '',
      "const requestOptions: RequestOptions = { headers: { Accept: 'application/json' } }",
      'void requestOptions',
      '',
      "const client: HttpClient = createClient({ baseURL: 'https://api.example.com' })",
      'const jsonPromise: Promise<{ ok: boolean } | undefined> = client.get<{ ok: boolean }>(\'/users\')',
      'void jsonPromise',
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
} finally {
  await rm(tempDir, { recursive: true, force: true })
  await rm(tarballPath, { force: true })
}

console.log('packed artifact smoke checks passed')

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
}

function shellEscape(value) {
  return `'${value.replaceAll("'", "'\\''")}'`
}
