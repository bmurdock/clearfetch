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

const packageName = '@bmurdock/clearfetch'
const tempDir = await mkdtemp(path.join(os.tmpdir(), 'clearfetch-pack-'))

try {
  const importSmokeFile = path.join(tempDir, 'smoke-import.mjs')
  await writeFile(
    importSmokeFile,
    [
      `import * as mod from '${packageName}'`,
      '',
      "if (typeof mod.request !== 'function') throw new Error('missing request export')",
      "if (typeof mod.createClient !== 'function') throw new Error('missing createClient export')",
      '',
    ].join('\n'),
    'utf8',
  )

  const smokeFile = path.join(tempDir, 'smoke.ts')
  await writeFile(
    smokeFile,
    [
      `import { createClient, request } from '${packageName}'`,
      '',
      "const rawPromise: Promise<Response> = request('https://api.example.com', { responseType: 'raw' })",
      'void rawPromise',
      '',
      "const client = createClient({ baseURL: 'https://api.example.com' })",
      'const jsonPromise: Promise<{ ok: boolean } | undefined> = client.get<{ ok: boolean }>(\'/users\')',
      'void jsonPromise',
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
