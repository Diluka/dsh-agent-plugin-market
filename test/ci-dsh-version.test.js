import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import { evaluatePluginCompatibility } from '@deepseek-ai/dsh-app-boot'

const require = createRequire(import.meta.url)
const { hooks } = require('../.github/pin-dsh.cjs')
const { buildTargets } = require('../.github/resolve-dsh-matrix.cjs')
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')
const dshVersion = manifest.devDependencies['@deepseek-ai/dsh-agent']

// The declared support range and the currently published channel versions.
const range = '>=0.2.1-alpha.2 <=0.2.1-rc.4'
const earliest = '0.2.1-alpha.2'
const latest = '0.2.1-rc.2'
const next = '0.2.1-rc.4'

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

test('DSH development dependencies share one pinned cohort at the newest supported release', () => {
  assert.equal(dshVersion, next)
  assert.match(dshVersion, /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/)
  for (const [name, version] of Object.entries(manifest.devDependencies)) {
    if (name.startsWith('@deepseek-ai/dsh-')) assert.equal(version, dshVersion, name)
  }
  // A bounded range: the oldest naturally compatible release through the newest verified one.
  assert.equal(manifest.engines.dsh, range)
  // The package version stays plain SemVer and must not encode the DSH target.
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/)
})

test('CI resolves a deduplicated smoke matrix and enforces the declared range', () => {
  assert.match(workflow, /node \.github\/resolve-dsh-matrix\.cjs/)
  assert.match(workflow, /target: \$\{\{ fromJSON\(needs\.resolve-dsh\.outputs\.targets\) \}\}/)
  assert.match(workflow, /DSH_VERSION: \$\{\{ matrix\.target\.version \}\}/)
  // The pinned development preflight fails a smoke job for an out-of-range channel.
  assert.match(workflow, /evaluatePluginCompatibility\(manifest, \{\}, process\.env\.DSH_VERSION\)/)
  assert.match(workflow, /profile-hooks: \[\s*absent,\s*present\s*\]/)
  // The smoke job runs and installs the tested release, not an unpinned CLI.
  assert.match(workflow, /pnpm dlx "@deepseek-ai\/dsh@\$DSH_VERSION"/)
  assert.match(workflow, /@deepseek-ai\/dsh-hooks-codex@\$DSH_VERSION/)
})

test('buildTargets expands the declared minimum and both release channels', () => {
  assert.deepEqual(buildTargets(range, { latest, next }), [
    { label: 'minimum', version: earliest },
    { label: 'latest', version: latest },
    { label: 'next', version: next },
  ])
})

test('buildTargets runs a version once when targets coincide', () => {
  // Both channels on one version: one smoke target, keeping the first label.
  assert.deepEqual(buildTargets(range, { latest: next, next }), [
    { label: 'minimum', version: earliest },
    { label: 'latest', version: next },
  ])
  // A channel matching the declared minimum is not repeated.
  assert.deepEqual(buildTargets(range, { latest, next: earliest }), [
    { label: 'minimum', version: earliest },
    { label: 'latest', version: latest },
  ])
})

test('buildTargets rejects missing tags, invalid versions, and unbounded ranges', () => {
  assert.throws(() => buildTargets(range, { latest }), /invalid DSH next version/)
  assert.throws(() => buildTargets('>=0.2.1-alpha.2', { latest, next }), /bounded inclusive range/)
  assert.throws(() => buildTargets('^0.2.1', { latest, next }), /bounded inclusive range/)
  for (const invalid of ['latest', '0.2.1-rc.04', '9007199254740992.0.0']) {
    assert.throws(() => buildTargets(range, { latest: invalid, next }), /invalid DSH latest version/)
  }
  assert.throws(
    () => buildTargets('>=0.2.1-alpha.02 <=0.2.1-rc.4', { latest, next }),
    /invalid DSH minimum version/,
  )
})

test('the pinned development preflight enforces the declared range boundaries', () => {
  // This only checks the range preflight contract used by CI; it does not claim
  // per-version E2E verification of every release inside the range.
  for (const version of [earliest, latest, next]) {
    assert.equal(evaluatePluginCompatibility(manifest, {}, version), undefined, version)
  }
  // SemVer prereleases between the bounds participate even when never published.
  assert.equal(evaluatePluginCompatibility(manifest, {}, '0.2.1-beta.1'), undefined)
  for (const version of ['0.2.1-alpha.1', '0.2.1-rc.5', '0.2.1', '0.3.0']) {
    assert.ok(evaluatePluginCompatibility(manifest, {}, version), version)
  }
})

test('the smoke profile mounts the plugin bundle without adding the optional bridge', () => {
  const bundles = JSON.parse(workflow.match(/"bundles":\s*(\[[^\n]*\])/)?.[1] || 'null')
  assert.deepEqual(bundles, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-agent-plugin-market'])
  // The tested CLI initializes its own profile before the manifest is written.
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
