import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import { evaluatePluginCompatibility } from '@deepseek-ai/dsh-app-boot'

const { hooks } = createRequire(import.meta.url)('../.github/pin-dsh.cjs')
const { buildTargets } = createRequire(import.meta.url)('../.github/resolve-dsh-matrix.cjs')
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const dshVersion = manifest.devDependencies['@deepseek-ai/dsh-agent']
// Published releases in the currently declared bounded compatibility range.
const supportedVersions = [
  '0.2.1-alpha.2', '0.2.1-alpha.3', '0.2.1-alpha.4', '0.2.1-alpha.5',
  '0.2.1-rc.1', '0.2.1-rc.2', '0.2.1-rc.3', '0.2.1-rc.4',
]

function withVersion(version, run) {
  const previous = process.env.DSH_VERSION
  if (version === undefined) delete process.env.DSH_VERSION
  else process.env.DSH_VERSION = version
  try { run() }
  finally {
    if (previous === undefined) delete process.env.DSH_VERSION
    else process.env.DSH_VERSION = previous
  }
}

test('development dependencies target a pinned cohort and CI covers boundaries and channels', () => {
  // The selected npm next release is an independent target, not derived from the manifest.
  assert.equal(dshVersion, '0.2.1-rc.4')
  assert.match(dshVersion, /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/)
  for (const [name, version] of Object.entries(manifest.devDependencies)) {
    if (name.startsWith('@deepseek-ai/dsh-')) assert.equal(version, dshVersion, name)
  }
  // The range is bounded to the verified oldest and newest releases.
  assert.equal(manifest.engines.dsh, '>=0.2.1-alpha.2 <=0.2.1-rc.4')
  assert.ok(supportedVersions.includes(dshVersion))
  // The package version stays plain SemVer and must not encode the DSH target.
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/)
  const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')
  assert.equal(workflow.match(/^ {2}DSH_VERSION: (\S+)$/m)?.[1], dshVersion)
  assert.match(workflow, /node \.github\/resolve-dsh-matrix\.cjs/)
  assert.match(workflow, /needs: resolve-dsh/)
  assert.match(workflow, /target: \$\{\{ fromJSON\(needs\.resolve-dsh\.outputs\.targets\) \}\}/)
  assert.match(workflow, /evaluatePluginCompatibility\(manifest, \{\}, process\.env\.DSH_VERSION\)/)
  const hooksModes = workflow.match(/^ {8}profile-hooks: \[([^\]]+)\]$/m)?.[1].split(',').map(value => value.trim())
  assert.deepEqual(hooksModes, ['absent', 'present'])
  assert.match(workflow, /DSH_VERSION: \$\{\{ matrix\.target\.version \}\}/)
  assert.match(workflow, /@deepseek-ai\/dsh-hooks-codex@\$DSH_VERSION/)
  assert.match(workflow, /@deepseek-ai\/dsh-hook-protocol@\$DSH_VERSION/)
})

test('the CI matrix covers the range endpoints and each release channel', () => {
  assert.deepEqual(buildTargets('>=0.2.1-alpha.2 <=0.2.1-rc.4', {
    latest: '0.2.1-rc.2', next: '0.2.1-rc.4',
  }), [
    { label: 'minimum', version: '0.2.1-alpha.2' },
    { label: 'latest', version: '0.2.1-rc.2' },
    { label: 'next', version: '0.2.1-rc.4' },
  ])
})

test('the matrix retains the supported maximum when next moves beyond it', () => {
  assert.deepEqual(buildTargets('>=0.2.1-alpha.2 <=0.2.1-rc.4', {
    latest: '0.2.1-rc.2', next: '0.2.1-rc.5',
  }), [
    { label: 'minimum', version: '0.2.1-alpha.2' },
    { label: 'maximum', version: '0.2.1-rc.4' },
    { label: 'latest', version: '0.2.1-rc.2' },
    { label: 'next', version: '0.2.1-rc.5' },
  ])
})

test('both release channels remain separate when their versions coincide', () => {
  assert.deepEqual(buildTargets('>=0.2.1-alpha.2 <=0.2.1-rc.4', {
    latest: '0.2.1-rc.4', next: '0.2.1-rc.4',
  }), [
    { label: 'minimum', version: '0.2.1-alpha.2' },
    { label: 'latest', version: '0.2.1-rc.4' },
    { label: 'next', version: '0.2.1-rc.4' },
  ])
})

test('channels reuse both endpoints without merging each other', () => {
  assert.deepEqual(buildTargets('>=0.2.1-alpha.2 <=0.2.1-rc.4', {
    latest: '0.2.1-alpha.2', next: '0.2.1-rc.4',
  }), [
    { label: 'latest', version: '0.2.1-alpha.2' },
    { label: 'next', version: '0.2.1-rc.4' },
  ])
  assert.deepEqual(buildTargets('>=0.2.1-alpha.2 <=0.2.1-rc.4', {
    latest: '0.2.1-rc.2', next: '0.2.1-rc.2',
  }), [
    { label: 'minimum', version: '0.2.1-alpha.2' },
    { label: 'maximum', version: '0.2.1-rc.4' },
    { label: 'latest', version: '0.2.1-rc.2' },
    { label: 'next', version: '0.2.1-rc.2' },
  ])
})

test('the matrix rejects missing tags, invalid versions, and unsupported ranges', () => {
  assert.throws(() => buildTargets('>=0.2.1-alpha.2 <=0.2.1-rc.4', { latest: '0.2.1-rc.2' }), /invalid DSH next version/)
  assert.throws(() => buildTargets('>=0.2.1-alpha.2', { latest: '0.2.1-rc.2', next: '0.2.1-rc.4' }), /bounded inclusive range/)
  for (const latest of ['latest', '0.2.1-rc.04', '9007199254740992.0.0']) {
    assert.throws(() => buildTargets('>=0.2.1-alpha.2 <=0.2.1-rc.4', { latest, next: '0.2.1-rc.4' }), /invalid DSH latest version/)
  }
})

test('pinned development preflight accepts published releases and rejects versions outside the range', () => {
  for (const version of supportedVersions) {
    assert.equal(evaluatePluginCompatibility(manifest, {}, version), undefined, version)
  }
  for (const version of ['0.1.6-alpha.2', '0.1.7-alpha.1', '0.1.7-rc.2', '0.2.0-rc.2', '0.2.1-alpha.1', '0.2.1-rc.4.0', '0.2.1-rc.5', '0.2.1', '0.3.0']) {
    assert.ok(evaluatePluginCompatibility(manifest, {}, version), version)
  }
})

test('bounded prerelease ranges include intermediate versions even if unpublished', () => {
  for (const version of ['0.2.1-alpha.6', '0.2.1-beta.1', '0.2.1-rc.0', '0.2.1-rc.3.1', '0.2.1-rc.4+build.1']) {
    assert.equal(evaluatePluginCompatibility(manifest, {}, version), undefined, version)
  }
})

test('installed DSH development packages and their required peers use the target cohort', () => {
  const require = createRequire(import.meta.url)
  for (const name of Object.keys(manifest.devDependencies)) {
    if (!name.startsWith('@deepseek-ai/dsh-')) continue
    const path = require.resolve(name + '/package.json')
    const installed = JSON.parse(readFileSync(path, 'utf8'))
    assert.equal(installed.version, dshVersion, name)
    const packageRequire = createRequire(path)
    for (const peer of Object.keys(installed.peerDependencies || {})) {
      if (!peer.startsWith('@deepseek-ai/dsh-') || installed.peerDependenciesMeta?.[peer]?.optional) continue
      const peerManifest = JSON.parse(readFileSync(packageRequire.resolve(peer + '/package.json'), 'utf8'))
      assert.equal(peerManifest.version, dshVersion, name + ' peer ' + peer)
    }
  }
})

test('the smoke profile selects bundles without mounting the optional bridge library', () => {
  const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')
  const bundles = JSON.parse(workflow.match(/"bundles":\s*(\[[^\n]*\])/)?.[1] || 'null')
  assert.deepEqual(bundles, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-agent-plugin-market'])
  // The tested CLI initializes its own profile before the manifest is written.
  assert.match(workflow, /pnpm dlx "@deepseek-ai\/dsh@\$DSH_VERSION"/)
  const initialize = workflow.indexOf('dsh --profile web --dump-config')
  const manifestWrite = workflow.indexOf('cat > "$profile/package.json"')
  const install = workflow.indexOf('pnpm --dir "$profile" add')
  assert.ok(initialize >= 0 && manifestWrite > initialize && install > manifestWrite)
})

test('CI pins the entire DSH dependency cohort without changing unrelated packages', () => {
  withVersion(dshVersion, () => {
    const pkg = {
      name: 'fixture',
      dependencies: { '@deepseek-ai/dsh': '^0.2.0-rc.2', '@deepseek-ai/dsh-web-app': '^0.2.0-rc.2', '@deepseek-ai/cordis': '^4.0.5', 'js-yaml': '^4.2.0' },
      optionalDependencies: { '@deepseek-ai/dsh-hooks-codex': '*' },
      peerDependencies: { '@deepseek-ai/dsh-system-prompt': '*', '@deepseek-ai/schemastery': '*', 'dsh-agent-plugin-market': '*' },
      peerDependenciesMeta: { '@deepseek-ai/dsh-hooks-codex': { optional: true } },
      devDependencies: { '@deepseek-ai/dsh-tools': '^0.2.0-rc.2', '@deepseek-ai/dshfake': '1.0.0' },
    }
    assert.equal(hooks.readPackage(pkg), pkg)
    assert.equal(pkg.dependencies['@deepseek-ai/dsh'], dshVersion)
    assert.equal(pkg.dependencies['@deepseek-ai/dsh-web-app'], dshVersion)
    assert.equal(pkg.optionalDependencies['@deepseek-ai/dsh-hooks-codex'], dshVersion)
    assert.equal(pkg.peerDependencies['@deepseek-ai/dsh-system-prompt'], dshVersion)
    assert.equal(pkg.devDependencies['@deepseek-ai/dsh-tools'], dshVersion)
    assert.equal(pkg.dependencies['@deepseek-ai/cordis'], '4.0.5')
    assert.equal(pkg.dependencies['js-yaml'], '^4.2.0')
    assert.equal(pkg.peerDependencies['@deepseek-ai/schemastery'], '3.18.5')
    assert.equal(pkg.peerDependencies['dsh-agent-plugin-market'], '*')
    assert.equal(pkg.devDependencies['@deepseek-ai/dshfake'], '1.0.0')
    assert.equal(pkg.peerDependenciesMeta['@deepseek-ai/dsh-hooks-codex'].optional, true)
    assert.deepEqual(hooks.readPackage({ name: 'empty' }), { name: 'empty' })
  })
})

test('CI pins the compatible Cordis companions used by the target DSH cohort', () => {
  withVersion(dshVersion, () => {
    const expected = {
      '@deepseek-ai/cordis': '4.0.5',
      '@deepseek-ai/cordis-plugin-group': '1.0.5',
      '@deepseek-ai/cordis-plugin-include': '1.0.10',
      '@deepseek-ai/cordis-plugin-loader': '1.0.6',
      '@deepseek-ai/cordis-plugin-timer': '1.1.7',
      '@deepseek-ai/cosmokit': '1.8.6',
      '@deepseek-ai/schemastery': '3.18.5',
    }
    const pkg = { dependencies: Object.fromEntries(Object.keys(expected).map(name => [name, '*'])) }
    assert.deepEqual(hooks.readPackage(pkg).dependencies, expected)
  })
})

test('CI pinning requires an explicit release version', () => {
  withVersion(undefined, () => assert.throws(() => hooks.readPackage({}), /DSH_VERSION is required/))
})
