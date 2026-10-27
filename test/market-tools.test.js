import assert from 'node:assert/strict'
import test from 'node:test'

import { createMarketTools, marketToolsPrompt, registerMarketTools } from '../lib/market-tools.js'

const workspace = { id: 'repo', title: 'Repo', path: '/repo' }
const workspaces = {
  list: () => [workspace],
  get: (id) => id === workspace.id ? workspace : undefined,
}
const runtime = {
  isHomeWorkspace: (cwd) => cwd === '/home/me',
}

function marketState(scope = { kind: 'workspace', id: workspace.id, title: workspace.title, path: workspace.path, overrideCount: 0 }) {
  return {
    hooksBridge: { available: false, installCommand: 'install hooks' },
    scope,
    workspaces: [workspace],
    markets: [{
      id: 'market',
      name: 'Market',
      repo: 'file:///market',
      description: '',
      refType: 'default',
      ref: null,
      manifestFound: true,
      standaloneSkills: [{
        name: 'solo',
        fullName: 'market/standalone-skills/solo',
        description: 'solo skill',
        globalEnabled: false,
        workspaceOverride: null,
        enabled: false,
      }],
      plugins: [{
        name: 'plugin',
        installed: true,
        activationState: 'enabled',
        unsupported: false,
        sourceType: 'local',
        title: 'Plugin',
        description: 'plugin description',
        error: null,
        hooks: null,
        skills: [{
          name: 'owned',
          fullName: 'market/plugin/owned',
          description: 'owned skill',
          globalEnabled: true,
          workspaceOverride: null,
          enabled: true,
        }],
      }],
    }],
  }
}

function serviceFor(overrides = {}) {
  const calls = []
  return {
    calls,
    async getState(args = {}) {
      calls.push(['getState', args])
      if (args.workspaceId) return marketState()
      return marketState({ kind: 'global' })
    },
    async setWorkspacePluginEnabled(args) {
      calls.push(['setWorkspacePluginEnabled', args])
      return { ok: true }
    },
    async setWorkspaceSkillEnabled(args) {
      calls.push(['setWorkspaceSkillEnabled', args])
      return { ok: true }
    },
    ...overrides,
  }
}

function toolsFor(service = serviceFor()) {
  return createMarketTools({ service, runtime, workspaces })
}

function toolByName(tools, name) {
  const tool = tools.find((item) => item.name === name)
  assert.ok(tool, 'missing tool ' + name)
  return tool
}

function exec(cwd) {
  return { agent: { session: { header: { cwd } } } }
}

test('market tools expose raw object-root parameter schemas', () => {
  const tools = toolsFor()

  assert.deepEqual(toolByName(tools, 'agent_market_info').parameters, {
    type: 'object',
    additionalProperties: false,
    properties: {
      workspace_id: {
        type: 'string',
        description: '可选。精确工作区 ID；省略时使用当前会话 cwd 对应的工作区，无法匹配则返回全局视图。',
      },
    },
  })
  assert.deepEqual(tools.map((tool) => tool.name), ['agent_market_info', 'agent_market_set_plugin', 'agent_market_set_skill'])
  const plugin = toolByName(tools, 'agent_market_set_plugin')
  const skill = toolByName(tools, 'agent_market_set_skill')
  assert.deepEqual(plugin.parameters.required, ['market_id', 'plugin_name', 'mode'])
  assert.deepEqual(skill.parameters.required, ['full_name', 'mode'])
  assert.deepEqual(Object.keys(plugin.parameters.properties), ['market_id', 'plugin_name', 'mode', 'workspace_id'])
  assert.deepEqual(Object.keys(skill.parameters.properties), ['full_name', 'mode', 'workspace_id'])
  for (const tool of [plugin, skill]) {
    assert.equal(tool.parameters.type, 'object')
    assert.equal(tool.parameters.additionalProperties, false)
    assert.deepEqual(tool.parameters.properties.mode.enum, ['inherit', 'enabled', 'disabled'])
  }
  assert.match(plugin.description, /全部技能/)
  assert.match(plugin.parameters.properties.mode.description, /全开.*全关.*清除该插件全部子技能覆盖/)
  assert.match(skill.description, /其他技能保持原实际状态/)
  assert.match(skill.parameters.properties.mode.description, /全局实际状态/)
})

test('model guidance describes automatic inheritance rather than promising explicit matching overrides', () => {
  const prompt = marketToolsPrompt(runtime, exec('/repo').agent)
  assert.match(prompt, /agent_market_info.*agent_market_set_plugin.*agent_market_set_skill/)
  assert.match(prompt, /matching global effective values automatically inherit; only differences are saved/)
  assert.match(prompt, /never change global settings, install\/uninstall plugins, or authorize hooks/)
  assert.doesNotMatch(prompt, /enabled\/disabled override/)
  assert.equal(marketToolsPrompt(runtime, exec('/home/me').agent), '')
})

test('market info uses the current workspace cwd when possible', async () => {
  const service = serviceFor()
  const info = toolByName(toolsFor(service), 'agent_market_info')

  const value = await info.execute({}, exec('/repo/src'))

  assert.equal(value.scope.kind, 'workspace')
  assert.deepEqual(value.currentWorkspace, workspace)
  assert.deepEqual(service.calls[0], ['getState', { workspaceId: 'repo' }])
})

for (const [name, args] of [
  ['agent_market_info', {}],
  ['agent_market_set_plugin', { market_id: 'market', plugin_name: 'plugin', mode: 'enabled' }],
  ['agent_market_set_skill', { full_name: 'market/plugin/owned', mode: 'enabled' }],
]) {
  test(`home sessions cannot invoke ${name}, even with an explicit workspace`, async () => {
    const service = serviceFor()
    const tool = toolByName(toolsFor(service), name)
    for (const input of [args, { ...args, workspace_id: 'repo' }]) {
      await assert.rejects(() => tool.execute(input, exec('/home/me')), /home 路径不支持插件市场工具/)
    }
    assert.deepEqual(service.calls, [])
  })
}

for (const [name, args] of [
  ['agent_market_set_plugin', { market_id: 'market', plugin_name: 'plugin', mode: 'disabled' }],
  ['agent_market_set_skill', { full_name: 'market/plugin/owned', mode: 'disabled' }],
]) {
  test(`${name} never falls back to a global write when cwd has no workspace`, async () => {
    const service = serviceFor()
    const tool = toolByName(toolsFor(service), name)
    await assert.rejects(() => tool.execute(args, exec('/unregistered')), /未匹配到已注册工作区/)
    assert.deepEqual(service.calls, [])
  })
}

test('unmatched cwd falls back to global only for read-only market info', async () => {
  const service = serviceFor()
  const info = toolByName(toolsFor(service), 'agent_market_info')
  const value = await info.execute({}, exec('/unregistered'))
  assert.equal(value.scope.kind, 'global')
  assert.deepEqual(service.calls, [['getState', {}]])
})

test('plugin tool writes only a workspace override', async () => {
  const service = serviceFor()
  const setPlugin = toolByName(toolsFor(service), 'agent_market_set_plugin')

  const value = await setPlugin.execute({ market_id: 'market', plugin_name: 'plugin', mode: 'disabled' }, exec('/repo'))

  assert.equal(value.kind, 'plugin-change')
  assert.equal(value.workspaceId, 'repo')
  assert.deepEqual(service.calls[1], ['setWorkspacePluginEnabled', {
    workspaceId: 'repo',
    marketId: 'market',
    pluginName: 'plugin',
    mode: 'disabled',
  }])
})

test('skill tool detects standalone skills before writing workspace overrides', async () => {
  const service = serviceFor()
  const setSkill = toolByName(toolsFor(service), 'agent_market_set_skill')

  const value = await setSkill.execute({ full_name: 'market/standalone-skills/solo', mode: 'enabled' }, exec('/repo'))

  assert.equal(value.kind, 'skill-change')
  assert.equal(value.standalone, true)
  assert.deepEqual(service.calls[1], ['setWorkspaceSkillEnabled', {
    workspaceId: 'repo',
    fullName: 'market/standalone-skills/solo',
    standalone: true,
    mode: 'enabled',
  }])
})

for (const scenario of [
  { name: 'partial activation', activationState: 'partial', skills: [true, false], expected: 'partial', count: '1/2' },
  { name: 'activation state outranks the skill count', activationState: 'enabled', skills: [true, false], expected: 'enabled', count: '1/2' },
  { name: 'zero skills stay disabled', activationState: 'disabled', skills: [], expected: 'disabled', count: '0/0' },
]) {
  test(`market info renders Host activation state with an n/m skill count: ${scenario.name}`, async () => {
    const state = marketState()
    const plugin = state.markets[0].plugins[0]
    plugin.activationState = scenario.activationState
    const template = plugin.skills[0]
    plugin.skills = scenario.skills.map((enabled, index) => ({ ...template, name: 'skill-' + index, fullName: 'market/plugin/skill-' + index, enabled }))
    const service = serviceFor({ async getState() { return state } })
    const info = toolByName(toolsFor(service), 'agent_market_info')
    const value = await info.execute({}, exec('/repo'))
    const text = info.output.render({}, value)[0].text
    const line = text.split('\n').find((line) => line.includes('插件 market/plugin:'))
    assert.ok(line)
    assert.ok(line.includes('effective=' + scenario.expected + ', skills=' + scenario.count + ', installed=true'))
    assert.doesNotMatch(line, /parentOverride/)
    assert.equal(value.markets[0].plugins[0].installed, true)
  })
}

test('plugin-change output does not report a partially enabled group as fully on', async () => {
  const state = marketState()
  const plugin = state.markets[0].plugins[0]
  plugin.activationState = 'partial'
  plugin.skills.push({ ...plugin.skills[0], name: 'off', fullName: 'market/plugin/off', enabled: false })
  const service = serviceFor({ async getState() { return state } })
  const tool = toolByName(toolsFor(service), 'agent_market_set_plugin')
  const args = { market_id: 'market', plugin_name: 'plugin', mode: 'inherit' }
  const value = await tool.execute(args, exec('/repo'))
  const text = tool.output.render(args, value)[0].text
  assert.match(text, /当前有效状态=partial; 技能=1\/2/)
  assert.doesNotMatch(text, /当前有效状态=enabled/)
  assert.deepEqual(service.calls, [['setWorkspacePluginEnabled', {
    workspaceId: 'repo', marketId: 'market', pluginName: 'plugin', mode: 'inherit',
  }]])
})

test('matching-global skill-change output reports inherited storage despite an enabled request', async () => {
  const service = serviceFor()
  const tool = toolByName(toolsFor(service), 'agent_market_set_skill')
  const args = { full_name: 'market/plugin/owned', mode: 'enabled' }
  const value = await tool.execute(args, exec('/repo'))
  const text = tool.output.render(args, value)[0].text
  assert.match(text, /已按 enabled 设置; 当前有效状态=enabled; override=inherit/)
  assert.equal(value.skill.workspaceOverride, null)
  assert.deepEqual(service.calls[1], ['setWorkspaceSkillEnabled', {
    workspaceId: 'repo', fullName: 'market/plugin/owned', standalone: false, mode: 'enabled',
  }])
})

test('registering market tools hides them from home cwd agents when scoped restrictions are available', () => {
  const registered = []
  const denied = []
  const disposed = []
  const listeners = []
  const effects = []
  const homeAgent = {
    session: { header: { cwd: '/home/me' } },
    ctx: { tools: { restrict: (filter) => {
      denied.push(filter)
      return () => disposed.push(filter)
    } } },
  }
  const ctx = {
    tools: {
      register(tool) {
        registered.push(tool.name)
        return () => {}
      },
    },
    get(name) {
      if (name !== 'agents') return undefined
      return { list: () => [homeAgent] }
    },
    on(name, listener) {
      listeners.push({ name, listener })
      return () => {}
    },
    effect(callback) {
      effects.push(callback())
      return () => {}
    },
  }

  registerMarketTools(ctx, { service: serviceFor(), runtime, workspaces })

  assert.deepEqual(registered, ['agent_market_info', 'agent_market_set_plugin', 'agent_market_set_skill'])
  assert.deepEqual(denied, [{ deny: registered }])
  assert.equal(listeners[0].name, 'agent/created')
  assert.equal(listeners[1].name, 'agent/disposed')

  listeners[0].listener({
    agent: {
      session: { header: { cwd: '/repo' } },
      ctx: { tools: { restrict: (filter) => denied.push(filter) } },
    },
  })
  assert.equal(denied.length, 1)

  effects[0]()
  assert.deepEqual(disposed, [{ deny: registered }])
})
