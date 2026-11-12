import assert from 'node:assert/strict'
import test from 'node:test'
import { buildTargets } from '../.github/resolve-dsh-matrix.cjs'
import pinDsh from '../.github/pin-dsh.cjs'

const range = '>=0.2.1-alpha.2'

test('CI pins DSH cohorts while preserving published framework ranges', (t) => {
  const previous = process.env.DSH_VERSION
  t.after(() => {
    if (previous === undefined) delete process.env.DSH_VERSION
    else process.env.DSH_VERSION = previous
  })
  process.env.DSH_VERSION = '0.2.1-alpha.2'
  const pkg = {
    dependencies: { '@deepseek-ai/dsh': '*', '@deepseek-ai/cordis': '~4.0.5-alpha.1' },
    peerDependencies: { '@deepseek-ai/dsh-settings': '*', '@deepseek-ai/schemastery': '~3.18.0' },
  }

  assert.equal(pinDsh.hooks.readPackage(pkg), pkg)
  assert.deepEqual(pkg, {
    dependencies: { '@deepseek-ai/dsh': '0.2.1-alpha.2', '@deepseek-ai/cordis': '~4.0.5-alpha.1' },
    peerDependencies: { '@deepseek-ai/dsh-settings': '0.2.1-alpha.2', '@deepseek-ai/schemastery': '~3.18.0' },
  })
})

test('CI resolves the minimum and future channel versions without an upper bound', () => {
  assert.deepEqual(buildTargets(range, { latest: '0.3.0', next: '1.0.0-beta.1' }), [
    { label: 'minimum', version: '0.2.1-alpha.2' },
    { label: 'latest', version: '0.3.0' },
    { label: 'next', version: '1.0.0-beta.1' },
  ])
})

test('CI deduplicates the minimum, latest, and next by version', () => {
  assert.deepEqual(buildTargets(range, { latest: '0.2.1-alpha.2', next: '0.2.1-alpha.2' }), [
    { label: 'minimum', version: '0.2.1-alpha.2' },
  ])
  assert.deepEqual(buildTargets(range, { latest: '0.2.2-rc.1', next: '0.2.2-rc.1' }), [
    { label: 'minimum', version: '0.2.1-alpha.2' },
    { label: 'latest', version: '0.2.2-rc.1' },
  ])
})

test('CI rejects malformed minima, bounded ranges, and invalid channel versions', () => {
  const tags = { latest: '0.2.2-rc.1', next: '0.2.2-rc.2' }
  for (const invalid of ['', '0.2.1-alpha.2', '>=0.2.1-alpha.2 <=0.2.2-rc.2', '>=nope']) {
    assert.throws(() => buildTargets(invalid, tags), /engines\.dsh|invalid DSH minimum version/)
  }
  assert.throws(() => buildTargets(range, { latest: '0.2.2', next: 'not-a-version' }), /invalid DSH next version/)
})
