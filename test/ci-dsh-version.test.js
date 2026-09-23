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
  withVersion('0.1.5-rc.2', () => {
    const pkg = {
      name: 'fixture',
      dependencies: { '@deepseek-ai/dsh': '^0.1.5-rc.1', '@deepseek-ai/dsh-web-app': '^0.1.5-rc.2', '@deepseek-ai/cordis': '^4.0.2' },
      optionalDependencies: { '@deepseek-ai/dsh-hooks-codex': '*' },
      peerDependencies: { '@deepseek-ai/dsh-system-prompt': '*', '@deepseek-ai/schemastery': '*', 'dsh-agent-plugin-market': '*' },
      peerDependenciesMeta: { '@deepseek-ai/dsh-hooks-codex': { optional: true } },
      devDependencies: { '@deepseek-ai/dsh-tools': '^0.1.5-rc.1', '@deepseek-ai/dshfake': '1.0.0' },
    }
    assert.equal(hooks.readPackage(pkg), pkg)
    assert.equal(pkg.dependencies['@deepseek-ai/dsh'], '0.1.5-rc.2')
    assert.equal(pkg.dependencies['@deepseek-ai/dsh-web-app'], '0.1.5-rc.2')
    assert.equal(pkg.optionalDependencies['@deepseek-ai/dsh-hooks-codex'], '0.1.5-rc.2')
    assert.equal(pkg.peerDependencies['@deepseek-ai/dsh-system-prompt'], '0.1.5-rc.2')
    assert.equal(pkg.devDependencies['@deepseek-ai/dsh-tools'], '0.1.5-rc.2')
    assert.equal(pkg.dependencies['@deepseek-ai/cordis'], '^4.0.2')
    assert.equal(pkg.peerDependencies['@deepseek-ai/schemastery'], '*')
    assert.equal(pkg.peerDependencies['dsh-agent-plugin-market'], '*')
    assert.equal(pkg.devDependencies['@deepseek-ai/dshfake'], '1.0.0')
    assert.equal(pkg.peerDependenciesMeta['@deepseek-ai/dsh-hooks-codex'].optional, true)
    assert.deepEqual(hooks.readPackage({ name: 'empty' }), { name: 'empty' })
  })
})

test('CI pinning requires an explicit release version', () => {
  withVersion(undefined, () => assert.throws(() => hooks.readPackage({}), /DSH_VERSION is required/))
})
