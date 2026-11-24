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
import test, { type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const checkPackSmokePath = fileURLToPath(
  new URL('../scripts/check-pack-smoke.mjs', import.meta.url),
)

test('retaining a verified tarball preserves existing artifacts and root tarballs', {
  timeout: 60_000,
}, async (t) => {
  const fixtureDir = await createBuiltFixture(t)
  const artifactDir = path.join(fixtureDir, 'release-artifact')
  await mkdir(artifactDir)
  const priorArtifact = path.join(artifactDir, 'prior-candidate.tgz')
  await writeFile(priorArtifact, 'prior candidate bytes')
  const manifest = JSON.parse(await readFile(path.join(fixtureDir, 'package.json'), 'utf8'))
  const filename = `${manifest.name.replace(/^@/, '').replace('/', '-')}-${manifest.version}.tgz`
  const existingRootTarball = path.join(fixtureDir, filename)
  await writeFile(existingRootTarball, 'existing root tarball bytes')

  await execFileAsync(process.execPath, [checkPackSmokePath, '--retain'], {
    cwd: fixtureDir,
  })
  assert.equal(await readFile(priorArtifact, 'utf8'), 'prior candidate bytes')
  const tarballs = (await readdir(artifactDir)).filter((name) => name !== 'prior-candidate.tgz')
  assert.equal(tarballs.length, 1)
  const retainedPath = path.join(artifactDir, tarballs[0]!)
  const { stdout: packedFiles } = await execFileAsync('tar', ['-tzf', retainedPath])
  assert.doesNotMatch(packedFiles, /^package\/dist\/internal\/[^\n]+\.d\.ts$/m)
  assert.doesNotMatch(packedFiles, /^package\/dist\/(?:types|internal\/normalized-request-options)\.js(?:\.map)?$/m)
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
  assert.deepEqual((await readdir(fixtureDir)).filter((name) => name.endsWith('.tgz')), [filename])
  assert.equal(await readFile(existingRootTarball, 'utf8'), 'existing root tarball bytes')
})

for (const { label, excluded, expected } of [
  {
    label: 'required runtime module',
    excluded: ['dist/internal/retry-policy.js', 'dist/internal/retry-policy.js.map'],
    expected: /ERR_MODULE_NOT_FOUND/,
  },
  {
    label: 'runtime source map',
    excluded: ['dist/index.js.map'],
    expected: /missing source map for packed runtime file: dist\/index\.js/,
  },
]) {
  test(`check-pack-smoke rejects an excluded ${label}`, { timeout: 60_000 }, async (t) => {
    const fixtureDir = await createBuiltFixture(t)
    const manifestPath = path.join(fixtureDir, 'package.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    manifest.files.push(...excluded.map((filePath) => `!${filePath}`))
    await writeFile(manifestPath, JSON.stringify(manifest))

    await assert.rejects(
      execFileAsync(process.execPath, [checkPackSmokePath], { cwd: fixtureDir }),
      (error) => {
        assert.ok(error !== null && typeof error === 'object')
        assert.ok('stdout' in error && 'stderr' in error)
        assert.match(`${error.stdout}\n${error.stderr}`, expected)
        return true
      },
    )
    assert.deepEqual((await readdir(fixtureDir)).filter((name) => name.endsWith('.tgz')), [])
  })
}

test('check-pack-smoke rejects public declarations that need excluded internal types', { timeout: 60_000 }, async (t) => {
  const fixtureDir = await createBuiltFixture(t)
  const entryPath = path.join(fixtureDir, 'dist/index.d.ts')
  await writeFile(
    path.join(fixtureDir, 'dist/internal/packaging-dependency.d.ts'),
    'export interface PackagingDependency { value: string }\n',
  )
  await writeFile(
    entryPath,
    `${await readFile(entryPath, 'utf8')}\nexport type { PackagingDependency } from './internal/packaging-dependency.js';\n`,
  )

  await assert.rejects(
    execFileAsync(process.execPath, [checkPackSmokePath], { cwd: fixtureDir }),
    (error) => {
      assert.ok(error !== null && typeof error === 'object' && 'stdout' in error && 'stderr' in error)
      assert.match(`${error.stdout}\n${error.stderr}`, /TS2307.*packaging-dependency\.js/)
      return true
    },
  )
})

test('check-pack-smoke rejects an invalid runtime source map', { timeout: 60_000 }, async (t) => {
  const fixtureDir = await createBuiltFixture(t)
  const mapPath = path.join(fixtureDir, 'dist/index.js.map')
  const sourceMap = JSON.parse(await readFile(mapPath, 'utf8'))
  sourceMap.file = 'wrong.js'
  await writeFile(mapPath, JSON.stringify(sourceMap))

  await assert.rejects(
    execFileAsync(process.execPath, [checkPackSmokePath], { cwd: fixtureDir }),
    (error) => typeof error === 'object' && error !== null && 'stderr' in error &&
      String(error.stderr).includes('invalid packed source map: dist/index.js.map'),
  )
})

async function createBuiltFixture(t: TestContext): Promise<string> {
  const rootDir = fileURLToPath(new URL('../', import.meta.url))
  const fixtureDir = await mkdtemp(path.join(os.tmpdir(), 'clearfetch-pack-fixture-'))
  t.after(() => rm(fixtureDir, { recursive: true, force: true }))
  await cp(path.join(rootDir, 'src'), path.join(fixtureDir, 'src'), { recursive: true })
  for (const file of ['package.json', 'tsconfig.json', 'tsconfig.build.json']) {
    await copyFile(path.join(rootDir, file), path.join(fixtureDir, file))
  }
  await symlink(path.join(rootDir, 'node_modules'), path.join(fixtureDir, 'node_modules'), 'junction')
  await execFileAsync(process.execPath, [
    path.join(rootDir, 'node_modules/typescript/bin/tsc'),
    '-p', 'tsconfig.build.json',
  ], { cwd: fixtureDir })
  return fixtureDir
}

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
