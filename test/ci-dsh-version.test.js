import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

const { hooks } = createRequire(import.meta.url)('../.github/pin-dsh.cjs')

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

test('CI pins the entire DSH dependency cohort without changing unrelated packages', () => {
  withVersion('0.1.7-rc.1', () => {
    const pkg = {
      name: 'fixture',
      dependencies: { '@deepseek-ai/dsh': '^0.1.7-rc.1', '@deepseek-ai/dsh-web-app': '^0.1.7-rc.1', '@deepseek-ai/cordis': '^4.0.4', 'js-yaml': '^4.2.0' },
      optionalDependencies: { '@deepseek-ai/dsh-hooks-codex': '*' },
      peerDependencies: { '@deepseek-ai/dsh-system-prompt': '*', '@deepseek-ai/schemastery': '*', 'dsh-agent-plugin-market': '*' },
      peerDependenciesMeta: { '@deepseek-ai/dsh-hooks-codex': { optional: true } },
      devDependencies: { '@deepseek-ai/dsh-tools': '^0.1.7-rc.1', '@deepseek-ai/dshfake': '1.0.0' },
    }
    assert.equal(hooks.readPackage(pkg), pkg)
    assert.equal(pkg.dependencies['@deepseek-ai/dsh'], '0.1.7-rc.1')
    assert.equal(pkg.dependencies['@deepseek-ai/dsh-web-app'], '0.1.7-rc.1')
    assert.equal(pkg.optionalDependencies['@deepseek-ai/dsh-hooks-codex'], '0.1.7-rc.1')
    assert.equal(pkg.peerDependencies['@deepseek-ai/dsh-system-prompt'], '0.1.7-rc.1')
    assert.equal(pkg.devDependencies['@deepseek-ai/dsh-tools'], '0.1.7-rc.1')
    assert.equal(pkg.dependencies['@deepseek-ai/cordis'], '4.0.4')
    assert.equal(pkg.dependencies['js-yaml'], '^4.2.0')
    assert.equal(pkg.peerDependencies['@deepseek-ai/schemastery'], '3.18.4')
    assert.equal(pkg.peerDependencies['dsh-agent-plugin-market'], '*')
    assert.equal(pkg.devDependencies['@deepseek-ai/dshfake'], '1.0.0')
    assert.equal(pkg.peerDependenciesMeta['@deepseek-ai/dsh-hooks-codex'].optional, true)
    assert.deepEqual(hooks.readPackage({ name: 'empty' }), { name: 'empty' })
  })
})

test('CI pins the compatible Cordis companions used by DSH 0.1.7-rc.1', () => {
  withVersion('0.1.7-rc.1', () => {
    const expected = {
      '@deepseek-ai/cordis': '4.0.4',
      '@deepseek-ai/cordis-plugin-group': '1.0.4',
      '@deepseek-ai/cordis-plugin-hmr': '1.0.19',
      '@deepseek-ai/cordis-plugin-include': '1.0.9',
      '@deepseek-ai/cordis-plugin-loader': '1.0.5',
      '@deepseek-ai/cordis-plugin-timer': '1.1.6',
      '@deepseek-ai/cosmokit': '1.8.5',
      '@deepseek-ai/schemastery': '3.18.4',
    }
    const pkg = { dependencies: Object.fromEntries(Object.keys(expected).map(name => [name, '*'])) }
    assert.deepEqual(hooks.readPackage(pkg).dependencies, expected)
  })
})

test('CI pinning requires an explicit release version', () => {
  withVersion(undefined, () => assert.throws(() => hooks.readPackage({}), /DSH_VERSION is required/))
})
