import assert from 'node:assert/strict'
import test from 'node:test'

import {
  addMarketToConfig,
  emptyWorkspaceConfig,
  installPluginInConfig,
  normalizeWorkspaceConfig,
  pluginEnabled,
  pluginSkillEnabled,
  removeMarketFromConfig,
  setSkillEnabledInConfig,
  setStandaloneSkillsEnabledInConfig,
  setWorkspacePluginOverride,
  setWorkspacePluginSkillOverride,
  setWorkspaceStandaloneSkillOverride,
  standaloneSkillEnabled,
  uninstallPluginFromConfig,
  workspaceOverride,
  workspaceOverrideCount,
} from '../lib/market-config.js'

function configFixture() {
  return {
    markets: [{ id: 'one' }, { id: 'two' }],
    installed: {
      'one/plugin': { marketId: 'one', pluginName: 'plugin' },
      'two/plugin': { marketId: 'two', pluginName: 'plugin' },
    },
    disabledSkills: {
      'one/plugin/skill': true,
      'two/plugin/skill': true,
    },
    enabledStandaloneSkills: {
      'one/standalone-skills/skill': true,
      'two/standalone-skills/skill': true,
    },
    hookApprovals: {
      'one/plugin': { fingerprint: 'one' },
      'two/plugin': { fingerprint: 'two' },
    },
  }
}

test('adds a market and installs a plugin without mutating the previous config', () => {
  const original = configFixture()
  const withMarket = addMarketToConfig(original, { id: 'three' })
  const installed = installPluginInConfig(withMarket, 'three/plugin', {
    marketId: 'three',
    pluginName: 'plugin',
  })

  assert.deepEqual(original.markets, [{ id: 'one' }, { id: 'two' }])
  assert.equal(original.installed['three/plugin'], undefined)
  assert.deepEqual(installed.markets.map((market) => market.id), ['one', 'two', 'three'])
  assert.deepEqual(installed.installed['three/plugin'], {
    marketId: 'three',
    pluginName: 'plugin',
  })

  const repeated = installPluginInConfig(installed, 'three/plugin', { marketId: 'three', pluginName: 'other' })
  assert.equal(repeated.installed['three/plugin'].pluginName, 'plugin')
})

test('removing a market clears only its related persisted state', () => {
  const original = configFixture()
  const next = removeMarketFromConfig(original, 'one')

  assert.deepEqual(next.markets, [{ id: 'two' }])
  assert.deepEqual(next.installed, {
    'two/plugin': { marketId: 'two', pluginName: 'plugin' },
  })
  assert.deepEqual(next.disabledSkills, { 'two/plugin/skill': true })
  assert.deepEqual(next.enabledStandaloneSkills, { 'two/standalone-skills/skill': true })
  assert.deepEqual(next.hookApprovals, { 'two/plugin': { fingerprint: 'two' } })
  assert.deepEqual(original.markets, [{ id: 'one' }, { id: 'two' }])
})

test('uninstalling a plugin clears its approval and disabled skills only', () => {
  const next = uninstallPluginFromConfig(configFixture(), 'one/plugin')

  assert.equal(next.installed['one/plugin'], undefined)
  assert.equal(next.hookApprovals['one/plugin'], undefined)
  assert.equal(next.disabledSkills['one/plugin/skill'], undefined)
  assert.deepEqual(next.installed['two/plugin'], { marketId: 'two', pluginName: 'plugin' })
  assert.deepEqual(next.hookApprovals['two/plugin'], { fingerprint: 'two' })
  assert.equal(next.disabledSkills['two/plugin/skill'], true)
})

test('skill toggles preserve opposite default states and batch scope', () => {
  const original = configFixture()
  const pluginEnabled = setSkillEnabledInConfig(original, {
    fullName: 'one/plugin/skill',
    enabled: true,
    standalone: false,
  })
  const standaloneEnabled = setSkillEnabledInConfig(pluginEnabled, {
    fullName: 'one/standalone-skills/new-skill',
    enabled: true,
    standalone: true,
  })
  const batchDisabled = setStandaloneSkillsEnabledInConfig(standaloneEnabled, [
    { fullName: 'one/standalone-skills/skill' },
    { fullName: 'one/standalone-skills/new-skill' },
  ], false)

  assert.equal(pluginEnabled.disabledSkills['one/plugin/skill'], undefined)
  assert.equal(standaloneEnabled.enabledStandaloneSkills['one/standalone-skills/new-skill'], true)
  assert.equal(batchDisabled.enabledStandaloneSkills['one/standalone-skills/skill'], undefined)
  assert.equal(batchDisabled.enabledStandaloneSkills['one/standalone-skills/new-skill'], undefined)
  assert.equal(batchDisabled.enabledStandaloneSkills['two/standalone-skills/skill'], true)
})

test('workspace overrides take precedence while sparse values inherit global defaults', () => {
  const global = configFixture()
  const pluginKey = 'one/plugin'
  const pluginSkill = 'one/plugin/skill'
  const standaloneSkill = 'one/standalone-skills/skill'
  const inherited = emptyWorkspaceConfig()
  const workspace = setWorkspaceStandaloneSkillOverride(
    setWorkspacePluginSkillOverride(
      setWorkspacePluginOverride(inherited, pluginKey, 'disabled'),
      pluginSkill,
      'enabled',
    ),
    standaloneSkill,
    'enabled',
  )

  assert.equal(pluginEnabled(global, inherited, pluginKey), true)
  assert.equal(pluginSkillEnabled(global, inherited, pluginKey, pluginSkill), false)
  assert.equal(standaloneSkillEnabled(global, inherited, standaloneSkill), true)
  assert.equal(pluginEnabled(global, workspace, pluginKey), false)
  assert.equal(pluginSkillEnabled(global, workspace, pluginKey, pluginSkill), false)
  assert.equal(standaloneSkillEnabled(global, workspace, standaloneSkill), true)
  assert.equal(workspaceOverride(workspace, 'plugins', pluginKey), false)
  assert.equal(workspaceOverrideCount(workspace), 3)
})

test('workspace override reset follows later global changes without mutating global config', () => {
  const global = configFixture()
  const pluginKey = 'one/plugin'
  const fullName = 'one/plugin/skill'
  const workspace = setWorkspacePluginSkillOverride(emptyWorkspaceConfig(), fullName, 'enabled')
  const inherited = setWorkspacePluginSkillOverride(workspace, fullName, 'inherit')
  const changedGlobal = setSkillEnabledInConfig(global, { fullName, enabled: true, standalone: false })

  assert.equal(pluginSkillEnabled(global, workspace, pluginKey, fullName), true)
  assert.equal(workspaceOverride(inherited, 'pluginSkills', fullName), undefined)
  assert.equal(pluginSkillEnabled(changedGlobal, inherited, pluginKey, fullName), true)
  assert.equal(global.disabledSkills[fullName], true)
})

test('workspace config parser keeps only known boolean overrides', () => {
  const parsed = normalizeWorkspaceConfig({
    version: 999,
    plugins: { valid: true, invalid: 'true' },
    pluginSkills: null,
    standaloneSkills: { disabled: false, nested: {} },
    ignored: { value: true },
  })

  assert.deepEqual(parsed, {
    version: 1,
    plugins: { valid: true },
    pluginSkills: {},
    standaloneSkills: { disabled: false },
  })
})
