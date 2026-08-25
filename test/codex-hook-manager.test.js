import assert from 'node:assert/strict'
import { posix as path } from 'node:path'
import test from 'node:test'

import { createCodexHookManager } from '../lib/codex-hook-manager.js'
import { hookFingerprint } from '../lib/codex-hooks.js'

function currentContent(content) {
  return content && typeof content === 'object' && Object.prototype.hasOwnProperty.call(content, 'current') ? content.current : content
}

function hookFileFs(content, writes = []) {
  const hookPath = '/markets/market/hooks/hooks.json'
  const normalize = (value) => path.normalize(String(value || '/'))
  const targetPath = (target) => normalize(typeof target === 'string' ? target : target.displayPath)
  return {
    async resolve(value) {
      const displayPath = normalize(value)
      return { displayPath, targetKey: displayPath }
    },
    async lstat(target) {
      if (targetPath(target) === hookPath && currentContent(content) !== null) return { type: 'file' }
      return null
    },
    async stat(target) {
      if (targetPath(target) === hookPath && currentContent(content) !== null) return { type: 'file' }
      return null
    },
    async readText(target) {
      assert.equal(targetPath(target), hookPath)
      return currentContent(content)
    },
    async writeText(target, value) {
      writes.push({ path: targetPath(target), value })
    },
    contains(parent, child) {
      const parentPath = targetPath(parent)
      const childPath = targetPath(child)
      return childPath === parentPath || childPath.startsWith(parentPath + '/')
    },
  }
}

function managerFixture({ hookContent, approvalFingerprint, bridge = null, plugin = () => ({ config: {}, dispose() {} }) }) {
  let config = {
    markets: [{ id: 'market', repo: 'example/market' }],
    installed: { 'market/plugin': { marketId: 'market', pluginName: 'plugin' } },
    disabledSkills: {},
    enabledStandaloneSkills: {},
    hookApprovals: approvalFingerprint ? { 'market/plugin': { fingerprint: approvalFingerprint } } : {},
  }
  const writes = []
  const saves = []
  const runtime = {
    paths: { generatedHooksDir: '/generated-hooks', hookDataDir: '/hook-data', marketsDir: '/markets' },
    async loadConfig() { return config },
    async saveConfig(next) {
      config = next
      saves.push(next)
    },
    async parseMarketplace() {
      return { plugins: [{ name: 'plugin', source: '.', unsupported: false }] }
    },
    async resolveDirectoryWithin() { return '/markets/market' },
    async readPluginMeta() {
      return {
        title: 'plugin',
        description: '',
        skillSources: [],
        hookConfigs: { codex: { declared: false, sources: [{ kind: 'path', path: './hooks/hooks.json' }], errors: [] } },
      }
    },
    async ensureDir() {},
  }
  const ctx = {
    registry: { get: () => ({ fibers: [] }) },
    plugin,
  }
  const manager = createCodexHookManager({
    ctx,
    fs: hookFileFs(hookContent, writes),
    bridge,
    runtime,
  })
  return { get config() { return config }, manager, saves, writes }
}

test('reconcile revokes approval when the approved hooks config disappears', async () => {
  const fixture = managerFixture({ hookContent: null, approvalFingerprint: 'approved' })

  await fixture.manager.reconcile()

  assert.deepEqual(fixture.config.hookApprovals, {})
  assert.equal(fixture.saves.length, 1)
})

test('reconcile keeps approval when an unchanged hooks config fails to mount', async () => {
  const hookConfig = { hooks: { PostToolUse: [] } }
  const fingerprint = hookFingerprint({ sources: [{ source: './hooks/hooks.json', config: hookConfig }] })
  const bridge = function bridge() {}
  const fixture = managerFixture({
    hookContent: JSON.stringify(hookConfig),
    approvalFingerprint: fingerprint,
    bridge,
    plugin: () => Promise.reject(new Error('bridge api changed')),
  })

  await fixture.manager.reconcile()

  assert.deepEqual(fixture.config.hookApprovals, { 'market/plugin': { fingerprint } })
  assert.equal(fixture.manager.isActive('market/plugin'), false)
  assert.equal(fixture.manager.runtimeError('market/plugin'), 'bridge api changed')
})

test('reconcile clears stale mount errors when the hooks fingerprint changes', async () => {
  const firstConfig = { hooks: { PostToolUse: [] } }
  const secondConfig = { hooks: { PreToolUse: [] } }
  const firstFingerprint = hookFingerprint({ sources: [{ source: './hooks/hooks.json', config: firstConfig }] })
  const hookContent = { current: JSON.stringify(firstConfig) }
  const bridge = function bridge() {}
  const fixture = managerFixture({
    hookContent,
    approvalFingerprint: firstFingerprint,
    bridge,
    plugin: () => Promise.reject(new Error('old bridge error')),
  })

  await fixture.manager.reconcile()
  assert.equal(fixture.manager.runtimeError('market/plugin'), 'old bridge error')

  hookContent.current = JSON.stringify(secondConfig)
  await fixture.manager.reconcile()

  assert.deepEqual(fixture.config.hookApprovals, { 'market/plugin': { fingerprint: firstFingerprint } })
  assert.equal(fixture.manager.isActive('market/plugin'), false)
  assert.equal(fixture.manager.runtimeError('market/plugin'), null)
})
