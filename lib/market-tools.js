/// <reference path="../types/host.d.ts" />

const OVERRIDE_MODES = new Set(['inherit', 'enabled', 'disabled'])
const STATE_TOOL = 'agent_market_info'
const PLUGIN_TOOL = 'agent_market_set_plugin'
const SKILL_TOOL = 'agent_market_set_skill'
const MARKET_TOOL_NAMES = [STATE_TOOL, PLUGIN_TOOL, SKILL_TOOL]
const HOME_WORKSPACE_ERROR = 'home 路径不支持插件市场工具；请从具体工作区会话中使用市场工具'

const OBJECT_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: true,
}

/**
 * @param {Record<string, unknown>} properties
 * @param {string[]} [required]
 */
function parameterSchema(properties, required = []) {
  return {
    type: 'object',
    additionalProperties: false,
    properties,
    ...(required.length ? { required } : {}),
  }
}

/**
 * @param {Array<{path: string}>} workspaces
 * @param {string | undefined} cwd
 */
export function workspacePathForCwd(workspaces, cwd) {
  if (typeof cwd !== 'string' || !cwd) return undefined
  let best = ''
  for (const workspace of workspaces) {
    const raw = workspace && typeof workspace.path === 'string' ? workspace.path : ''
    const root = raw === '/' ? raw : raw.replace(/\/+$/, '')
    if (!root) continue
    if ((cwd === root || root === '/' || cwd.startsWith(root + '/')) && root.length > best.length) best = root
  }
  return best || cwd
}

/** @param {unknown} value */
function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? /** @type {Record<string, unknown>} */ (value) : {}
}

/** @param {unknown} value */
function maybeString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

/** @param {unknown} value */
function overrideMode(value) {
  if (typeof value === 'string' && OVERRIDE_MODES.has(value)) return /** @type {WorkspaceOverrideMode} */ (value)
  throw new Error('mode 必须为 inherit、enabled 或 disabled')
}

/** @param {boolean | null} value */
function overrideLabel(value) {
  if (value === true) return 'enabled'
  if (value === false) return 'disabled'
  return 'inherit'
}

/** @param {boolean} value */
function enabledLabel(value) {
  return value ? 'enabled' : 'disabled'
}

/**
 * @param {string} title
 * @param {'read' | 'other'} kind
 * @param {string | undefined} [rawInput]
 * @returns {HostToolCallView}
 */
function present(title, kind, rawInput) {
  return { card: 'generic', title, kind, ...(rawInput === undefined ? {} : { rawInput }) }
}

/**
 * @param {HostWorkspaceView[]} workspaces
 * @param {string | undefined} cwd
 */
function workspaceForCwd(workspaces, cwd) {
  const root = workspacePathForCwd(workspaces, cwd)
  if (!root) return undefined
  return workspaces.find((workspace) => workspace.path === root)
}

/**
 * @param {HostWorkspaceProvider} workspaces
 * @param {string} id
 */
function workspaceById(workspaces, id) {
  const workspace = workspaces.get(id)
  if (!workspace) throw new Error('工作区不存在或已移除: ' + id)
  return workspace
}

/**
 * @param {MarketRuntime} runtime
 * @param {string | undefined} cwd
 */
function isHomeCwd(runtime, cwd) {
  return typeof cwd === 'string' && !!cwd && typeof runtime.isHomeWorkspace === 'function' && runtime.isHomeWorkspace(cwd)
}

/** @param {HostAgent | undefined} agent */
function agentCwd(agent) {
  return typeof agent?.session?.header?.cwd === 'string' ? agent.session.header.cwd : undefined
}

/**
 * @param {MarketRuntime} runtime
 * @param {HostAgent | undefined} agent
 */
function assertAgentCanUseMarketTools(runtime, agent) {
  if (isHomeCwd(runtime, agentCwd(agent))) throw new Error(HOME_WORKSPACE_ERROR)
}

/**
 * @param {HostWorkspaceProvider} workspaces
 * @param {MarketRuntime} runtime
 * @param {Record<string, unknown>} args
 * @param {HostToolRunContext} exec
 * @param {boolean} required
 */
function resolveWorkspace(workspaces, runtime, args, exec, required) {
  assertAgentCanUseMarketTools(runtime, exec.agent)
  const requested = maybeString(args.workspace_id)
  if (requested) return workspaceById(workspaces, requested)
  const workspace = workspaceForCwd(workspaces.list(), agentCwd(exec.agent))
  if (workspace || !required) return workspace
  throw new Error('当前会话 cwd 未匹配到已注册工作区；先调用 ' + STATE_TOOL + ' 查看 workspace_id，或从目标工作区会话中调用此工具')
}

/**
 * @param {HostMarketState} state
 * @param {string} marketId
 */
function findMarket(state, marketId) {
  const market = state.markets.find((item) => item.id === marketId)
  if (!market) throw new Error('市场不存在: ' + marketId)
  return market
}

/**
 * @param {HostMarketState} state
 * @param {string} marketId
 * @param {string} pluginName
 */
function findPlugin(state, marketId, pluginName) {
  const market = findMarket(state, marketId)
  const plugin = market.plugins.find((item) => item.name === pluginName)
  if (!plugin) throw new Error('插件不存在: ' + marketId + '/' + pluginName)
  return { market, plugin }
}

/**
 * @param {HostMarketState} state
 * @param {string} fullName
 */
function findSkill(state, fullName) {
  for (const market of state.markets) {
    const standalone = market.standaloneSkills.find((skill) => skill.fullName === fullName)
    if (standalone) return { market, plugin: null, skill: standalone, standalone: true }
    for (const plugin of market.plugins) {
      const skill = plugin.skills.find((item) => item.fullName === fullName)
      if (skill) return { market, plugin, skill, standalone: false }
    }
  }
  throw new Error('技能不存在: ' + fullName)
}

/**
 * @param {HostMarketState} state
 * @param {HostWorkspaceView | undefined} workspace
 */
function stateValue(state, workspace) {
  return {
    kind: 'market-state',
    ...(workspace ? { currentWorkspace: workspace } : {}),
    ...state,
  }
}

/**
 * @param {HostMarketState} state
 */
function renderState(state) {
  const lines = []
  if (state.scope.kind === 'workspace') {
    lines.push('作用域: workspace ' + state.scope.id + ' (' + state.scope.title + ') ' + state.scope.path + ', overrides=' + state.scope.overrideCount)
  } else {
    lines.push('作用域: global')
  }
  lines.push('可用工作区: ' + (state.workspaces.length ? state.workspaces.map((workspace) => workspace.id + '=' + workspace.path).join(', ') : '无'))
  lines.push('Hooks bridge: ' + (state.hooksBridge.available ? 'available' : 'unavailable') + '; installCommand=' + state.hooksBridge.installCommand)
  if (state.markets.length === 0) {
    lines.push('市场: 无')
    return lines.join('\n')
  }
  for (const market of state.markets) {
    lines.push('市场 ' + market.id + ': ' + (market.name || market.id) + ' repo=' + market.repo + ' ref=' + market.refType + (market.ref ? ':' + market.ref : '') + ' manifest=' + String(market.manifestFound))
    if (market.standaloneSkills.length) {
      lines.push('  独立技能: ' + market.standaloneSkills.map((skill) => skill.fullName + '=' + enabledLabel(skill.enabled) + ' global=' + enabledLabel(skill.globalEnabled) + ' override=' + overrideLabel(skill.workspaceOverride)).join('; '))
    }
    for (const plugin of market.plugins) {
      const key = market.id + '/' + plugin.name
      const flags = [
        'effective=' + enabledLabel(plugin.enabled),
        'installed=' + String(plugin.installed),
        'override=' + overrideLabel(plugin.workspaceOverride),
        'source=' + plugin.sourceType,
      ]
      if (plugin.unsupported) flags.push('unsupported=true')
      if (plugin.error) flags.push('error=' + plugin.error)
      if (plugin.hooks) flags.push('hooks=' + (plugin.hooks.active ? 'active' : plugin.hooks.enabled ? 'approved' : plugin.hooks.found ? 'found' : 'none'))
      lines.push('  插件 ' + key + ': ' + (plugin.title || plugin.name) + ' (' + flags.join(', ') + ')')
      if (plugin.description) lines.push('    描述: ' + plugin.description)
      if (plugin.skills.length) {
        lines.push('    技能: ' + plugin.skills.map((skill) => skill.fullName + '=' + enabledLabel(skill.enabled) + ' global=' + enabledLabel(skill.globalEnabled) + ' override=' + overrideLabel(skill.workspaceOverride)).join('; '))
      }
    }
  }
  return lines.join('\n')
}

/** @param {unknown} value */
function renderValue(value) {
  const data = record(value)
  if (data.kind === 'market-state') return renderState(/** @type {HostMarketState} */ (/** @type {unknown} */ (value)))
  if (data.kind === 'plugin-change') {
    const plugin = /** @type {HostMarketStatePlugin} */ (data.plugin)
    return '工作区 ' + data.workspaceId + ' 的插件 ' + data.key + ' 已设置为 ' + data.mode + '; 当前有效状态=' + enabledLabel(plugin.enabled)
  }
  if (data.kind === 'skill-change') {
    const skill = /** @type {HostMarketStateSkill} */ (data.skill)
    return '工作区 ' + data.workspaceId + ' 的技能 ' + skill.fullName + ' 已设置为 ' + data.mode + '; 当前有效状态=' + enabledLabel(skill.enabled)
  }
  return JSON.stringify(value, null, 2)
}

/** @returns {HostToolOutputDefinition} */
function objectOutput() {
  return {
    schema: OBJECT_OUTPUT_SCHEMA,
    render: (_args, value) => [{ type: 'text', text: renderValue(value) }],
  }
}

/** @param {unknown} error */
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * @param {HostAgent | undefined} agent
 * @param {MarketRuntime} runtime
 * @param {Map<HostAgent, () => void>} disposers
 */
function restrictHomeAgentTools(agent, runtime, disposers) {
  if (!agent || disposers.has(agent) || !isHomeCwd(runtime, agentCwd(agent))) return
  const scopedTools = agent.ctx && agent.ctx.tools
  if (!scopedTools || typeof scopedTools.restrict !== 'function') return
  try {
    disposers.set(agent, scopedTools.restrict({ deny: MARKET_TOOL_NAMES }))
  } catch (e) {
    console.warn('[agent-plugin-market] failed to restrict market tools for home-path agent: ' + errorMessage(e))
  }
}

/**
 * @param {HostAgent | undefined} agent
 * @param {Map<HostAgent, () => void>} disposers
 */
function clearAgentRestriction(agent, disposers) {
  if (!agent) return
  const dispose = disposers.get(agent)
  if (!dispose) return
  disposers.delete(agent)
  try { dispose() } catch { /* agent-scoped restriction may already be gone */ }
}

/**
 * @param {HostContext} ctx
 * @param {{service: MarketService, runtime: MarketRuntime, workspaces: HostWorkspaceProvider}} options
 */
export function registerMarketTools(ctx, options) {
  for (const tool of createMarketTools(options)) ctx.tools.register(tool)
  /** @type {Map<HostAgent, () => void>} */
  const disposers = new Map()
  ctx.effect(() => () => {
    for (const agent of Array.from(disposers.keys())) clearAgentRestriction(agent, disposers)
  })
  const agents = ctx.get('agents')
  if (agents && typeof agents.list === 'function') {
    for (const agent of agents.list()) restrictHomeAgentTools(agent, options.runtime, disposers)
  }
  const eventCtx = /** @type {{on(name: string, listener: (payload: {agent?: HostAgent}) => void): unknown}} */ (ctx)
  eventCtx.on('agent/created', (payload) => restrictHomeAgentTools(payload.agent, options.runtime, disposers))
  eventCtx.on('agent/disposed', (payload) => clearAgentRestriction(payload.agent, disposers))
}

/**
 * @param {{service: MarketService, runtime: MarketRuntime, workspaces: HostWorkspaceProvider}} options
 * @returns {HostToolDefinition[]}
 */
export function createMarketTools({ service, runtime, workspaces }) {
  return [
    {
      name: STATE_TOOL,
      description: '查看已添加的插件市场、插件、技能、hooks 和工作区覆盖状态；默认使用当前会话 cwd 对应的工作区作用域，无法匹配时返回全局视图。',
      parameters: parameterSchema({
        workspace_id: {
          type: 'string',
          description: '可选。精确工作区 ID；省略时自动使用当前会话 cwd 对应的工作区。',
        },
      }),
      output: objectOutput(),
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const input = record(args)
        const workspace = resolveWorkspace(workspaces, runtime, input, exec, false)
        return stateValue(await service.getState(workspace ? { workspaceId: workspace.id } : {}), workspace)
      },
      presentCall: () => present('查看插件市场状态', 'read'),
    },
    {
      name: PLUGIN_TOOL,
      description: '设置当前工作区中某个市场插件的启用模式。只写入工作区覆盖，不安装、不卸载、不修改全局市场。',
      parameters: parameterSchema({
        market_id: {
          type: 'string',
          description: '精确市场 ID，可从 agent_market_info 的“市场 <id>”读取。',
        },
        plugin_name: {
          type: 'string',
          description: '精确插件名，可从 agent_market_info 的“插件 <market>/<plugin>”读取。',
        },
        mode: {
          type: 'string',
          enum: ['inherit', 'enabled', 'disabled'],
          description: 'inherit 继承全局状态；enabled 仅此工作区启用；disabled 在此工作区禁用。',
        },
        workspace_id: {
          type: 'string',
          description: '可选。精确工作区 ID；省略时自动使用当前会话 cwd 对应的工作区。',
        },
      }, ['market_id', 'plugin_name', 'mode']),
      output: objectOutput(),
      async execute(args, exec) {
        const input = record(args)
        const marketId = maybeString(input.market_id)
        const pluginName = maybeString(input.plugin_name)
        const mode = overrideMode(input.mode)
        if (!marketId || !pluginName) throw new Error('缺少市场或插件标识')
        const workspace = resolveWorkspace(workspaces, runtime, input, exec, true)
        if (!workspace) throw new Error('当前会话 cwd 未匹配到已注册工作区')
        const state = await service.getState({ workspaceId: workspace.id })
        const current = findPlugin(state, marketId, pluginName)
        if (mode === 'enabled' && current.plugin.unsupported) throw new Error('插件不受支持，不能在工作区启用: ' + marketId + '/' + pluginName)
        await service.setWorkspacePluginEnabled({ workspaceId: workspace.id, marketId, pluginName, mode })
        const next = await service.getState({ workspaceId: workspace.id })
        return {
          kind: 'plugin-change',
          workspaceId: workspace.id,
          key: marketId + '/' + pluginName,
          mode,
          plugin: findPlugin(next, marketId, pluginName).plugin,
        }
      },
      presentCall: (args) => {
        const input = record(args)
        return present('设置工作区插件', 'other', maybeString(input.market_id) + '/' + maybeString(input.plugin_name) + ' -> ' + maybeString(input.mode))
      },
    },
    {
      name: SKILL_TOOL,
      description: '设置当前工作区中某个市场技能的启用模式。只写入工作区覆盖，不修改全局技能开关。',
      parameters: parameterSchema({
        full_name: {
          type: 'string',
          description: '精确技能全名，可从 agent_market_info 的“技能”列表读取。',
        },
        mode: {
          type: 'string',
          enum: ['inherit', 'enabled', 'disabled'],
          description: 'inherit 继承全局状态；enabled 仅此工作区启用；disabled 在此工作区禁用。',
        },
        workspace_id: {
          type: 'string',
          description: '可选。精确工作区 ID；省略时自动使用当前会话 cwd 对应的工作区。',
        },
      }, ['full_name', 'mode']),
      output: objectOutput(),
      async execute(args, exec) {
        const input = record(args)
        const fullName = maybeString(input.full_name)
        const mode = overrideMode(input.mode)
        if (!fullName) throw new Error('缺少技能标识')
        const workspace = resolveWorkspace(workspaces, runtime, input, exec, true)
        if (!workspace) throw new Error('当前会话 cwd 未匹配到已注册工作区')
        const state = await service.getState({ workspaceId: workspace.id })
        const target = findSkill(state, fullName)
        await service.setWorkspaceSkillEnabled({ workspaceId: workspace.id, fullName, standalone: target.standalone, mode })
        const next = await service.getState({ workspaceId: workspace.id })
        return {
          kind: 'skill-change',
          workspaceId: workspace.id,
          fullName,
          mode,
          standalone: target.standalone,
          pluginKey: target.plugin ? target.market.id + '/' + target.plugin.name : null,
          skill: findSkill(next, fullName).skill,
        }
      },
      presentCall: (args) => {
        const input = record(args)
        return present('设置工作区技能', 'other', maybeString(input.full_name) + ' -> ' + maybeString(input.mode))
      },
    },
  ]
}
