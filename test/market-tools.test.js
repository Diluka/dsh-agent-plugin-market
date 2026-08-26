import assert from 'node:assert/strict'
import test from 'node:test'

import { createMarketTools, registerMarketTools } from '../lib/market-tools.js'

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
        whenToUse: null,
        globalEnabled: false,
        workspaceOverride: null,
        enabled: false,
      }],
      plugins: [{
        name: 'plugin',
        installed: true,
        globalEnabled: true,
        workspaceOverride: null,
        enabled: true,
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
          whenToUse: null,
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
        description: '可选。精确工作区 ID；省略时自动使用当前会话 cwd 对应的工作区。',
      },
    },
  })
  assert.deepEqual(toolByName(tools, 'agent_market_set_plugin').parameters.required, ['market_id', 'plugin_name', 'mode'])
  assert.deepEqual(toolByName(tools, 'agent_market_set_skill').parameters.required, ['full_name', 'mode'])
})

test('market info uses the current workspace cwd when possible', async () => {
  const service = serviceFor()
  const info = toolByName(toolsFor(service), 'agent_market_info')

  const value = await info.execute({}, exec('/repo/src'))

  assert.equal(value.scope.kind, 'workspace')
  assert.deepEqual(value.currentWorkspace, workspace)
  assert.deepEqual(service.calls[0], ['getState', { workspaceId: 'repo' }])
})

test('market tools reject home cwd even when a tool remains visible', async () => {
  const info = toolByName(toolsFor(), 'agent_market_info')

  await assert.rejects(
    () => info.execute({}, exec('/home/me')),
    /home 路径不支持插件市场工具/,
  )
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
