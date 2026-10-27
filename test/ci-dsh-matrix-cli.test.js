import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const resolver = fileURLToPath(new URL('../.github/resolve-dsh-matrix.cjs', import.meta.url))

test('resolver CLI reads both tags once and publishes their exact matrix', (t) => {
  const tempRoot = realpathSync(tmpdir())
  const fixture = realpathSync(mkdtempSync(join(tempRoot, 'dsh-matrix-cli-')))
  t.after(() => {
    assert.equal(realpathSync(fixture), fixture)
    assert.equal(dirname(fixture), tempRoot)
    rmSync(fixture, { recursive: true })
  })
  // Use bounds unlike the repository's manifest to verify that the CLI reads its cwd.
  writeFileSync(join(fixture, 'package.json'), JSON.stringify({ engines: { dsh: '>=0.2.1-alpha.3 <=0.2.1-rc.3' } }))
  const preload = join(fixture, 'mock-npm.cjs')
  writeFileSync(preload, `
const { appendFileSync } = require('node:fs')
require('node:child_process').execFileSync = (command, args) => {
  appendFileSync(process.env.MOCK_NPM_CALLS, JSON.stringify({ command, args }) + '\\n')
  if (process.env.MOCK_NPM_FAILURE === '1') throw new Error('registry unavailable')
  return process.env.MOCK_NPM_TAGS
}
`)

  const cases = [
    {
      tags: { latest: '0.2.1-rc.2', next: '0.2.1-rc.4' },
      expected: [
        { label: 'minimum', version: '0.2.1-alpha.3' },
        { label: 'maximum', version: '0.2.1-rc.3' },
        { label: 'latest', version: '0.2.1-rc.2' },
        { label: 'next', version: '0.2.1-rc.4' },
      ],
    },
    {
      tags: { latest: '0.2.1-rc.3', next: '0.2.1-rc.3' },
      expected: [
        { label: 'minimum', version: '0.2.1-alpha.3' },
        { label: 'latest', version: '0.2.1-rc.3' },
        { label: 'next', version: '0.2.1-rc.3' },
      ],
    },
    {
      tags: { latest: '0.2.1-alpha.3', next: '0.2.1-rc.3' },
      expected: [
        { label: 'latest', version: '0.2.1-alpha.3' },
        { label: 'next', version: '0.2.1-rc.3' },
      ],
    },
  ]

  for (const [index, example] of cases.entries()) {
    const output = join(fixture, `output-${index}`)
    const calls = join(fixture, `calls-${index}`)
    const result = spawnSync(process.execPath, ['--require', preload, resolver], {
      cwd: fixture,
      encoding: 'utf8',
      env: { ...process.env, NODE_OPTIONS: '', GITHUB_OUTPUT: output, MOCK_NPM_CALLS: calls, MOCK_NPM_TAGS: JSON.stringify(example.tags), MOCK_NPM_FAILURE: '0' },
    })
    assert.equal(result.status, 0, result.stderr)
    const invocations = readFileSync(calls, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
    assert.deepEqual(invocations, [{ command: 'npm', args: ['view', '@deepseek-ai/dsh', 'dist-tags', '--json', '--prefer-online'] }])
    const line = readFileSync(output, 'utf8').trim()
    assert.ok(line.startsWith('targets='))
    assert.deepEqual(JSON.parse(line.slice('targets='.length)), example.expected)
  }

  const validTags = '{"latest":"0.2.1-rc.2","next":"0.2.1-rc.4"}'
  const failures = [
    { name: 'registry', tags: '{}', error: /registry unavailable/, failNpm: '1' },
    { name: 'missing-next', tags: '{"latest":"0.2.1-rc.2"}', error: /invalid DSH next version/, failNpm: '0' },
    { name: 'invalid-json', tags: '{invalid', error: /SyntaxError/, failNpm: '0' },
    { name: 'missing-output', tags: validTags, error: /GITHUB_OUTPUT is required/, failNpm: '0', destination: '' },
    { name: 'output-error', tags: validTags, error: /EISDIR|EACCES|EPERM/, failNpm: '0', destination: fixture },
  ]
  for (const example of failures) {
    const output = join(fixture, `output-${example.name}`)
    const result = spawnSync(process.execPath, ['--require', preload, resolver], {
      cwd: fixture,
      encoding: 'utf8',
      env: { ...process.env, NODE_OPTIONS: '', GITHUB_OUTPUT: example.destination ?? output, MOCK_NPM_CALLS: join(fixture, `calls-${example.name}`), MOCK_NPM_TAGS: example.tags, MOCK_NPM_FAILURE: example.failNpm },
    })
    assert.notEqual(result.status, 0, example.name)
    assert.match(result.stderr, example.error)
    assert.equal(existsSync(output), false, example.name)
  }

  writeFileSync(join(fixture, 'package.json'), JSON.stringify({ engines: { dsh: '>=0.2.1-alpha.3' } }))
  const rangeOutput = join(fixture, 'output-invalid-range')
  const invalidRange = spawnSync(process.execPath, ['--require', preload, resolver], {
    cwd: fixture,
    encoding: 'utf8',
    env: { ...process.env, NODE_OPTIONS: '', GITHUB_OUTPUT: rangeOutput, MOCK_NPM_CALLS: join(fixture, 'calls-invalid-range'), MOCK_NPM_TAGS: validTags, MOCK_NPM_FAILURE: '0' },
  })
  assert.notEqual(invalidRange.status, 0)
  assert.match(invalidRange.stderr, /bounded inclusive range/)
  assert.equal(existsSync(rangeOutput), false)
})
