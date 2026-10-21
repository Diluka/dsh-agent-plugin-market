import assert from 'node:assert/strict'
import test from 'node:test'

import {
  addMarketToConfig,
  clearWorkspacePluginOverrides,
  emptyWorkspaceConfig,
  installPluginInConfig,
  normalizeWorkspaceConfig,
  pluginEnabled,
  pluginSkillEnabled,
  removeMarketFromConfig,
  setMarketRefInConfig,
  setPluginSkillsEnabledInConfig,
  setSkillEnabledInConfig,
  setStandaloneSkillsEnabledInConfig,
  setWorkspacePluginOverride,
  setWorkspacePluginSkillOverride,
  setWorkspacePluginSkillStatesInConfig,
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

test('updating a market ref keeps related persisted state and can reset to default', () => {
  const original = configFixture()
  original.markets[0] = { id: 'one', name: 'One', repo: 'example/one', refType: 'branch', ref: 'dev' }

  const pinned = setMarketRefInConfig(original, { marketId: 'one', refType: 'tag', ref: 'v1.0.0', name: 'Renamed' })
  const reset = setMarketRefInConfig(pinned, { marketId: 'one', refType: 'default' })

  assert.deepEqual(original.markets[0], { id: 'one', name: 'One', repo: 'example/one', refType: 'branch', ref: 'dev' })
  assert.deepEqual(pinned.markets[0], { id: 'one', name: 'Renamed', repo: 'example/one', refType: 'tag', ref: 'v1.0.0' })
  assert.deepEqual(reset.markets[0], { id: 'one', name: 'Renamed', repo: 'example/one' })
  assert.deepEqual(reset.installed, original.installed)
  assert.deepEqual(reset.disabledSkills, original.disabledSkills)
  assert.deepEqual(reset.enabledStandaloneSkills, original.enabledStandaloneSkills)
  assert.deepEqual(reset.hookApprovals, original.hookApprovals)
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

for (const { key, ownSkills, otherKey, otherSkills } of [
  { key: 'm/p', ownSkills: ['m/p/a', 'm/p/q'], otherKey: 'm/p/q', otherSkills: ['m/p/q/b'] },
  { key: 'm/p/q', ownSkills: ['m/p/q/b'], otherKey: 'm/p', otherSkills: ['m/p/a', 'm/p/q'] },
]) {
  test(`exact plugin owner cleanup preserves slash-related plugin keys: ${key}`, () => {
    const flags = Object.fromEntries([...ownSkills, ...otherSkills, 'other/p/a'].map((name) => [name, false]))
    const workspace = {
      version: 1,
      plugins: { [key]: false, [otherKey]: true },
      pluginSkills: flags,
      standaloneSkills: { 'm/standalone-skills/keep': true },
    }
    const snapshot = structuredClone(workspace)
    const expectedFlags = { ...flags }
    for (const name of ownSkills) delete expectedFlags[name]
    assert.deepEqual(clearWorkspacePluginOverrides(workspace, key), {
      ...workspace, plugins: { [otherKey]: true }, pluginSkills: expectedFlags,
    })
    assert.deepEqual(workspace, snapshot)

    const global = {
      markets: [{ id: 'm', repo: 'example/market' }],
      installed: {
        [key]: { marketId: 'm', pluginName: key.slice(2) },
        [otherKey]: { marketId: 'm', pluginName: otherKey.slice(2) },
      },
      disabledSkills: Object.fromEntries(Object.keys(flags).map((name) => [name, true])),
      enabledStandaloneSkills: { 'm/standalone-skills/keep': true },
      hookApprovals: { [key]: { fingerprint: 'own' }, [otherKey]: { fingerprint: 'other' } },
    }
    const globalBefore = structuredClone(global)
    const uninstalled = uninstallPluginFromConfig(global, key)
    assert.deepEqual(uninstalled.disabledSkills, Object.fromEntries(Object.keys(expectedFlags).map((name) => [name, true])))
    assert.deepEqual(uninstalled.installed, { [otherKey]: global.installed[otherKey] })
    assert.deepEqual(uninstalled.hookApprovals, { [otherKey]: global.hookApprovals[otherKey] })
    assert.deepEqual(uninstalled.enabledStandaloneSkills, global.enabledStandaloneSkills)
    assert.deepEqual(global, globalBefore)
  })
}

test('market-wide removal still clears all slash-named plugins belonging to that market', () => {
  const original = configFixture()
  original.installed['one/plugin/nested'] = { marketId: 'one', pluginName: 'plugin/nested' }
  original.disabledSkills['one/plugin/nested/skill'] = true
  original.hookApprovals['one/plugin/nested'] = { fingerprint: 'nested' }
  const next = removeMarketFromConfig(original, 'one')
  assert.deepEqual(next.disabledSkills, { 'two/plugin/skill': true })
  assert.deepEqual(next.hookApprovals, { 'two/plugin': { fingerprint: 'two' } })
  assert.deepEqual(next.installed, { 'two/plugin': original.installed['two/plugin'] })
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

test('plugin skill workspace override wins over an uninstalled plugin base', () => {
  const global = {
    markets: [],
    installed: {},
    disabledSkills: { 'one/plugin/skill': false },
    enabledStandaloneSkills: {},
    hookApprovals: {},
  }
  const pluginKey = 'one/plugin'
  const fullName = 'one/plugin/skill'
  const inherited = emptyWorkspaceConfig()
  const enabled = setWorkspacePluginSkillOverride(emptyWorkspaceConfig(), fullName, 'enabled')
  const disabled = setWorkspacePluginSkillOverride(emptyWorkspaceConfig(), fullName, 'disabled')
  const pluginDisabled = setWorkspacePluginOverride(setWorkspacePluginSkillOverride(emptyWorkspaceConfig(), fullName, 'enabled'), pluginKey, 'disabled')

  assert.equal(pluginEnabled(global, inherited, pluginKey), false)
  assert.equal(pluginSkillEnabled(global, inherited, pluginKey, fullName), false)
  assert.equal(pluginSkillEnabled(global, enabled, pluginKey, fullName), true)
  assert.equal(pluginSkillEnabled(global, disabled, pluginKey, fullName), false)
  assert.equal(pluginSkillEnabled(global, pluginDisabled, pluginKey, fullName), false)
})

test('plugin batch activation only changes the scanned disabled skills, not installation or hooks', () => {
  const original = configFixture()
  const snapshot = structuredClone(original)
  const skills = [{ fullName: 'one/plugin/skill' }, { fullName: 'one/plugin/other' }]
  const disabled = setPluginSkillsEnabledInConfig(original, skills, false)
  const enabled = setPluginSkillsEnabledInConfig(disabled, skills, true)

  assert.deepEqual(disabled.disabledSkills, {
    'one/plugin/skill': true, 'one/plugin/other': true, 'two/plugin/skill': true,
  })
  assert.deepEqual(enabled.disabledSkills, { 'two/plugin/skill': true })
  for (const config of [disabled, enabled]) {
    assert.deepEqual(config.installed, original.installed)
    assert.deepEqual(config.hookApprovals, original.hookApprovals)
    assert.deepEqual(config.enabledStandaloneSkills, original.enabledStandaloneSkills)
  }
  assert.deepEqual(original, snapshot)
})

test('workspace group serialization removes legacy gates and stores only actual global differences', () => {
  const global = configFixture()
  const key = 'one/plugin'
  const workspace = {
    version: 1,
    plugins: { [key]: false, 'two/plugin': true, 'one/plugin-extra': false },
    pluginSkills: {
      'one/plugin/skill': true, 'one/plugin/other': false, 'one/plugin/stale': true,
      'two/plugin/skill': true, 'one/plugin-extra/keep': true,
    },
    standaloneSkills: { 'one/standalone-skills/skill': false },
  }
  const snapshot = structuredClone(workspace)
  const desired = [{ fullName: 'one/plugin/skill', enabled: false }, { fullName: 'one/plugin/other', enabled: false }]
  const next = setWorkspacePluginSkillStatesInConfig(global, workspace, key, desired)

  assert.deepEqual(next, {
    version: 1,
    plugins: { 'two/plugin': true, 'one/plugin-extra': false },
    pluginSkills: { 'one/plugin/other': false, 'two/plugin/skill': true, 'one/plugin-extra/keep': true },
    standaloneSkills: workspace.standaloneSkills,
  })
  assert.equal(pluginSkillEnabled(global, next, key, 'one/plugin/skill'), false)
  assert.equal(pluginSkillEnabled(global, next, key, 'one/plugin/other'), false)
  assert.deepEqual(workspace, snapshot)

  const matching = setWorkspacePluginSkillStatesInConfig(global, next, key, [
    { fullName: 'one/plugin/skill', enabled: false }, { fullName: 'one/plugin/other', enabled: true },
  ])
  assert.deepEqual(matching, clearWorkspacePluginOverrides(workspace, key))
  const changedGlobal = setPluginSkillsEnabledInConfig(global, desired, false)
  assert.equal(pluginSkillEnabled(changedGlobal, matching, key, 'one/plugin/other'), false)
})

test('workspace normalization compares against uninstalled global effective false, not raw skill defaults', () => {
  const global = configFixture()
  delete global.installed['one/plugin']
  const states = [
    { fullName: 'one/plugin/skill', enabled: false },
    { fullName: 'one/plugin/other', enabled: false },
  ]
  const current = setWorkspacePluginOverride(emptyWorkspaceConfig(), 'one/plugin', 'enabled')
  const matching = setWorkspacePluginSkillStatesInConfig(global, current, 'one/plugin', states)
  assert.deepEqual(matching, emptyWorkspaceConfig())

  const enabled = setWorkspacePluginSkillStatesInConfig(global, current, 'one/plugin', [
    states[0], { fullName: 'one/plugin/other', enabled: true },
  ])
  assert.deepEqual(enabled, { ...emptyWorkspaceConfig(), pluginSkills: { 'one/plugin/other': true } })
  assert.equal(pluginSkillEnabled(global, enabled, 'one/plugin', 'one/plugin/other'), true)
  assert.equal(global.installed['one/plugin'], undefined)
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
