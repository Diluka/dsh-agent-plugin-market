import assert from 'node:assert/strict'
import test from 'node:test'

import {
  codexHookSources,
  hookApprovalState,
  hookFingerprint,
  hookStorageKey,
  isPluginRelativePath,
  withPluginHookEnvironment,
} from '../lib/codex-hooks.js'

test('accepts only plugin-root-relative hook paths', () => {
  assert.equal(isPluginRelativePath('./hooks/hooks.json'), true)
  for (const value of [
    'hooks/hooks.json',
    './',
    './hooks/../hooks.json',
    './hooks//hooks.json',
    './hooks\\hooks.json',
    './hooks/\u0000hooks.json',
    null,
  ]) {
    assert.equal(isPluginRelativePath(value), false)
  }
})

test('normalizes declared and default Codex hook sources', () => {
  assert.deepEqual(codexHookSources({ name: 'plugin' }), {
    declared: false,
    sources: [{ kind: 'path', path: './hooks/hooks.json' }],
    errors: [],
  })
  assert.deepEqual(codexHookSources({
    hooks: ['./hooks/first.json', { hooks: {} }, '../outside.json', 42],
  }), {
    declared: true,
    sources: [
      { kind: 'path', path: './hooks/first.json' },
      { kind: 'inline', config: { hooks: {} } },
    ],
    errors: [
      'hooks path must be a plugin-root-relative path beginning with ./',
      'hooks entries must be paths or JSON objects',
    ],
  })
})

test('creates stable identifiers and requires an exact hook approval fingerprint', () => {
  const value = { sources: [{ source: 'inline', config: { hooks: {} } }] }
  const fingerprint = hookFingerprint(value)

  assert.equal(fingerprint, hookFingerprint(value))
  assert.notEqual(fingerprint, hookFingerprint({ sources: [] }))
  assert.equal(hookStorageKey('market/plugin name'), 'market_2Fplugin_20name')
  assert.deepEqual(hookApprovalState({ found: true, fingerprint }, { fingerprint }), {
    approved: true,
    needsApproval: false,
  })
  assert.deepEqual(hookApprovalState({ found: true, fingerprint }, { fingerprint: 'stale' }), {
    approved: false,
    needsApproval: true,
  })
  assert.deepEqual(hookApprovalState({ found: false, fingerprint }, { fingerprint }), {
    approved: false,
    needsApproval: false,
  })
})

test('injects shell-safe hook environment without mutating source config', () => {
  const input = {
    hooks: {
      PostToolUse: [{
        hooks: [
          { type: 'command', command: 'echo "$PLUGIN_ROOT"' },
          { type: 'prompt', prompt: 'do not run' },
          { command: 'echo default-command' },
        ],
      }],
    },
  }
  const output = withPluginHookEnvironment(input, {
    pluginRoot: "/tmp/o'brien",
    pluginData: '/tmp/data',
  })
  const prefix = "export PLUGIN_ROOT='/tmp/o'\\''brien'; export PLUGIN_DATA='/tmp/data'; export CLAUDE_PLUGIN_ROOT='/tmp/o'\\''brien'; export CLAUDE_PLUGIN_DATA='/tmp/data';\n"

  assert.notEqual(output, input)
  assert.equal(input.hooks.PostToolUse[0].hooks[0].command, 'echo "$PLUGIN_ROOT"')
  assert.equal(output.hooks.PostToolUse[0].hooks[0].command, prefix + 'echo "$PLUGIN_ROOT"')
  assert.equal(output.hooks.PostToolUse[0].hooks[1].prompt, 'do not run')
  assert.equal(output.hooks.PostToolUse[0].hooks[2].command, prefix + 'echo default-command')
})
