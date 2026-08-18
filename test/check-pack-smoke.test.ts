import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import {
  mkdir,
  mkdtemp,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const checkPackSmokePath = fileURLToPath(
  new URL('../scripts/check-pack-smoke.mjs', import.meta.url),
)

test('check-pack-smoke removes the tarball when package assertions fail', async () => {
  const fixtureDir = await mkdtemp(
    path.join(os.tmpdir(), 'clearfetch-pack-failure-'),
  )

  try {
    await mkdir(path.join(fixtureDir, 'dist'))
    await writeFile(
      path.join(fixtureDir, 'package.json'),
      JSON.stringify({
        name: 'clearfetch-pack-failure-fixture',
        version: '1.0.0',
        files: ['dist', 'unexpected.txt'],
      }),
      'utf8',
    )
    await writeFile(
      path.join(fixtureDir, 'dist', 'index.js'),
      'export {}\n',
      'utf8',
    )
    await writeFile(
      path.join(fixtureDir, 'unexpected.txt'),
      'unexpected package content\n',
      'utf8',
    )

    await assert.rejects(
      () =>
        execFileAsync(process.execPath, [checkPackSmokePath], {
          cwd: fixtureDir,
        }),
      (error) =>
        typeof error === 'object' &&
        error !== null &&
        'stderr' in error &&
        String(error.stderr).includes('unexpected files in packed artifact'),
    )

    const fixtureFiles = await readdir(fixtureDir)
    assert.deepEqual(
      fixtureFiles.filter((fileName) => fileName.endsWith('.tgz')),
      [],
    )
  } finally {
    await rm(fixtureDir, { recursive: true, force: true })
  }
})
