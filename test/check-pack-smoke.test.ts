import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import {
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
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

test('retaining a verified tarball preserves existing artifacts and refuses collisions', {
  timeout: 60_000,
}, async () => {
  const rootDir = fileURLToPath(new URL('../', import.meta.url))
  const fixtureDir = await mkdtemp(path.join(os.tmpdir(), 'clearfetch-pack-retain-'))
  try {
    await cp(path.join(rootDir, 'src'), path.join(fixtureDir, 'src'), { recursive: true })
    for (const file of ['package.json', 'tsconfig.json', 'tsconfig.build.json']) {
      await copyFile(path.join(rootDir, file), path.join(fixtureDir, file))
    }
    await symlink(path.join(rootDir, 'node_modules'), path.join(fixtureDir, 'node_modules'), 'junction')
    await execFileAsync(process.execPath, [
      path.join(rootDir, 'node_modules/typescript/bin/tsc'),
      '-p', 'tsconfig.build.json',
    ], { cwd: fixtureDir })

    const artifactDir = path.join(fixtureDir, 'release-artifact')
    await mkdir(artifactDir)
    const priorArtifact = path.join(artifactDir, 'prior-candidate.tgz')
    await writeFile(priorArtifact, 'prior candidate bytes')

    await execFileAsync(process.execPath, [checkPackSmokePath, '--retain'], {
      cwd: fixtureDir,
    })
    assert.equal(await readFile(priorArtifact, 'utf8'), 'prior candidate bytes')
    const tarballs = (await readdir(artifactDir)).filter((name) => name !== 'prior-candidate.tgz')
    assert.equal(tarballs.length, 1)
    const retainedPath = path.join(artifactDir, tarballs[0]!)
    await writeFile(retainedPath, 'existing candidate must not be replaced')

    await assert.rejects(
      execFileAsync(process.execPath, [checkPackSmokePath, '--retain'], {
        cwd: fixtureDir,
      }),
      (error) => typeof error === 'object' && error !== null &&
        'stderr' in error && String(error.stderr).includes('EEXIST'),
    )
    assert.equal(await readFile(retainedPath, 'utf8'), 'existing candidate must not be replaced')
    assert.equal(await readFile(priorArtifact, 'utf8'), 'prior candidate bytes')
    assert.deepEqual((await readdir(fixtureDir)).filter((name) => name.endsWith('.tgz')), [])
  } finally {
    await rm(fixtureDir, { recursive: true, force: true })
  }
})

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
