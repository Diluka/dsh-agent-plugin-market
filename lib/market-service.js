/// <reference path="../types/host.d.ts" />
import { createRequire } from 'node:module'
import { hookApprovalState } from './codex-hooks.js'
import {
  addMarketToConfig,
  clearPluginSkillOverrides,
  emptyWorkspaceConfig,
  installPluginInConfig,
  pluginSkillEnabled,
  removeMarketFromConfig,
  setMarketRefInConfig,
  setPluginSkillsEnabledInConfig,
  setSkillEnabledInConfig,
  setStandaloneSkillsEnabledInConfig,
  setWorkspacePluginSkillOverride,
  setWorkspacePluginSkillStatesInConfig,
  setWorkspaceStandaloneSkillOverride,
  standaloneSkillEnabled,
  uninstallPluginFromConfig,
  workspaceOverride,
  workspaceOverrideCount,
} from './market-config.js'
import { marketPluginKey } from './market-runtime.js'
import { errorMessage } from './util.js'

// This required peer belongs to the running DSH cohort, not the build target.
const { version: dshVersion } = createRequire(import.meta.url)('@deepseek-ai/dsh-home-paths/package.json')
export const HOOKS_BRIDGE_INSTALL_COMMAND = `pnpm --dir "$DSH_PROFILE_DIR" add @deepseek-ai/dsh-hooks-codex@${dshVersion} @deepseek-ai/dsh-hook-protocol@${dshVersion}`
const HOOKS_BRIDGE_UNAVAILABLE_ERROR = 'Codex hooks bridge 不可用；请先在目标 profile 中安装依赖：' + HOOKS_BRIDGE_INSTALL_COMMAND + '，然后重启 DSH'

/** @param {MarketServiceOptions} options */
export function createMarketService({ runtime, hooks, onSkillsChanged, workspaces = { list: () => [], get: () => undefined } }) {
  const { marketsDir } = runtime.paths

  /** @param {unknown} value */
  function workspaceOverrideMode(value) {
    if (value === 'inherit' || value === 'enabled' || value === 'disabled') return value
    throw new Error('工作区覆盖状态必须为 inherit、enabled 或 disabled')
  }

  /** @param {unknown} value */
  function marketInputRefType(value) {
    if (value === 'branch' || value === 'tag' || value === 'commit') return value
    return 'default'
  }

  /**
   * @param {{refType?: unknown, ref?: unknown}} args
   * @returns {{refType: MarketInputRefType, ref: string}}
   */
  function marketInputRef(args) {
    const refType = marketInputRefType(args.refType)
    const ref = String(args.ref || '').trim()
    if (refType !== 'default' && !ref) {
      throw new Error(refType === 'branch' ? '请填写分支名' : refType === 'tag' ? '请填写标签名' : '请填写 commit id')
    }
    return { refType, ref: refType === 'default' ? '' : ref }
  }

  /**
   * @param {string} repo
   * @param {MarketInputRefType} refType
   * @param {string} ref
   * @param {string} targetId
   */
  async function cloneMarketCheckout(repo, refType, ref, targetId) {
    if (refType === 'default') {
      await runtime.runProc(['git', 'clone', '--depth', '1', repo, targetId], marketsDir)
    } else if (refType === 'branch') {
      await runtime.runProc(['git', 'clone', '--depth', '1', '--branch', ref, repo, targetId], marketsDir)
    } else if (refType === 'tag') {
      await runtime.runProc(['git', 'clone', '--depth', '1', '--branch', ref, repo, targetId], marketsDir)
    } else {
      await runtime.runProc(['git', 'clone', repo, targetId], marketsDir)
      await runtime.runProc(['git', '-C', targetId, 'checkout', ref], marketsDir)
    }
  }

  /**
   * @param {string} id
   * @param {string} repo
   */
  async function inspectMarketCheckout(id, repo) {
    const marketDir = marketsDir + '/' + id
    const marketplace = await runtime.parseMarketplace(marketDir, repo)
    const standaloneSkills = await runtime.scanStandaloneSkills({ id, repo }, marketplace)
    if (!marketplace && standaloneSkills.length === 0) {
      throw new Error('未找到 marketplace.json，且仓库根 skills/ 目录中没有可用技能')
    }
    return { marketplace, standaloneSkills }
  }

  /** @param {{path: string}} workspace */
  function workspaceConfigurable(workspace) {
    return !runtime.isHomeWorkspace(workspace.path)
  }

  /** @param {unknown} args */
  function workspaceIdFor(args) {
    const input = args && typeof args === 'object' ? /** @type {{workspaceId?: unknown}} */ (args) : {}
    return typeof input.workspaceId === 'string' ? input.workspaceId.trim() : ''
  }

  /** @param {unknown} args */
  function workspaceFor(args) {
    const id = workspaceIdFor(args)
    if (!id) throw new Error('缺少工作区标识')
    const workspace = workspaces.get(id)
    if (!workspace || !workspaceConfigurable(workspace)) throw new Error('工作区不存在或已移除')
    return workspace
  }

  /**
   * @param {unknown} args
   * @returns {Promise<{workspace: HostWorkspaceView | null, config: WorkspaceConfig}>}
   */
  async function scopeFor(args) {
    if (!workspaceIdFor(args)) return { workspace: null, config: emptyWorkspaceConfig() }
    const workspace = workspaceFor(args)
    return { workspace, config: await runtime.loadWorkspaceConfig(workspace.path) }
  }

  /**
   * @param {{repo: string, refType?: MarketInputRefType, ref?: string}} args
   */
  async function addMarket(args) {
    const repo = String(args.repo || '').trim()
    if (!repo) throw new Error('仓库地址不能为空')
    const { refType, ref } = marketInputRef(args)
    await runtime.ensureDir(marketsDir)
    const slug = repo.replace(/\.git$/, '').split(/[/:]/).filter(Boolean).pop() || 'market'
    const id = slug.replace(/[^A-Za-z0-9._-]/g, '-') + '-' + Math.random().toString(36).slice(2, 6)
    try {
      await cloneMarketCheckout(repo, refType, ref, id)
    } catch (e) {
      await runtime.runProc(['rm', '-rf', id], marketsDir).catch(() => {})
      throw e
    }
    let inspected
    try {
      inspected = await inspectMarketCheckout(id, repo)
    } catch (e) {
      await runtime.runProc(['rm', '-rf', id], marketsDir).catch(() => {})
      throw e
    }
    let cfg
    try {
      /** @type {MarketEntry} */
      const entry = { id, name: (inspected.marketplace && inspected.marketplace.name) || slug, repo, addedAt: Date.now() }
      if (refType !== 'default') {
        entry.refType = refType
        entry.ref = ref
      }
      cfg = addMarketToConfig(await runtime.loadConfig(), entry)
      await runtime.saveConfig(cfg)
      await hooks.reconcile()
      onSkillsChanged()
      return { id, name: (inspected.marketplace && inspected.marketplace.name) || slug, repo, refType, ref: refType !== 'default' ? ref : null }
    } catch (e) {
      if (cfg) await runtime.saveConfig(removeMarketFromConfig(cfg, id)).catch(() => {})
      await runtime.runProc(['rm', '-rf', id], marketsDir).catch(() => {})
      throw e
    }
  }

  // Suspend hook fibers while Git mutates the market checkout; approval validity is fingerprint-based.
  /**
   * @param {MarketEntry} market
   */
  async function pullMarket(market) {
    const dir = marketsDir + '/' + market.id
    if (market.refType === 'tag' || market.refType === 'commit') {
      return { skipped: true, reason: '固定引用（' + market.refType + '），无需更新' }
    }

    hooks.suspendMarket(market.id)
    try {
      await hooks.reconcile()
      const before = (await runtime.runProc(['git', '-C', dir, 'rev-parse', 'HEAD'], marketsDir)).trim()
      await runtime.runProc(['git', '-C', dir, 'pull', '--ff-only'], marketsDir)
      const after = (await runtime.runProc(['git', '-C', dir, 'rev-parse', 'HEAD'], marketsDir)).trim()
      return { updated: before !== after }
    } finally {
      hooks.resumeMarket(market.id)
      await hooks.reconcile()
    }
  }

  /** @param {{marketId: string}} args */
  async function updateMarket(args) {
    const cfg = await runtime.loadConfig()
    const market = cfg.markets.find((m) => m.id === String(args.marketId || ''))
    if (!market) throw new Error('市场不存在: ' + args.marketId)
    const result = await pullMarket(market)
    onSkillsChanged()
    return result
  }

  /**
   * @param {{marketId: string, refType?: MarketInputRefType, ref?: string}} args
   */
  async function setMarketRef(args) {
    const marketId = String(args.marketId || '').trim()
    if (!marketId) throw new Error('缺少市场标识')
    const { refType, ref } = marketInputRef(args)
    const cfg = await runtime.loadConfig()
    const market = cfg.markets.find((item) => item.id === marketId)
    if (!market) throw new Error('市场不存在: ' + marketId)
    const currentRefType = market.refType || 'default'
    const currentRef = currentRefType === 'default' ? '' : String(market.ref || '')
    if (currentRefType === refType && currentRef === ref) {
      return { id: marketId, refType, ref: refType === 'default' ? null : ref, skipped: true, reason: '市场引用未变化' }
    }

    await runtime.ensureDir(marketsDir)
    const suffix = Math.random().toString(36).slice(2, 8)
    const nextId = marketId + '.next-' + suffix
    const backupId = marketId + '.backup-' + suffix
    /** @type {{marketplace: Marketplace | null}} */
    let inspected
    let suspended = false
    let movedCurrent = false
    let installedNext = false
    let result = null
    try {
      await runtime.runProc(['rm', '-rf', nextId, backupId], marketsDir).catch(() => {})
      await cloneMarketCheckout(market.repo, refType, ref, nextId)
      inspected = await inspectMarketCheckout(nextId, market.repo)
      const nextConfig = setMarketRefInConfig(cfg, {
        marketId,
        refType,
        ref,
        name: (inspected.marketplace && inspected.marketplace.name) || market.name,
      })

      hooks.suspendMarket(marketId)
      suspended = true
      await hooks.reconcile()
      if (await runtime.resolveDirectoryWithin(marketsDir, marketId)) {
        await runtime.runProc(['mv', marketId, backupId], marketsDir)
        movedCurrent = true
      }
      await runtime.runProc(['mv', nextId, marketId], marketsDir)
      installedNext = true
      await runtime.saveConfig(nextConfig)
      if (movedCurrent) await runtime.runProc(['rm', '-rf', backupId], marketsDir).catch(() => {})
      result = { id: marketId, refType, ref: refType === 'default' ? null : ref }
      return result
    } catch (e) {
      if (installedNext) await runtime.runProc(['rm', '-rf', marketId], marketsDir).catch(() => {})
      if (movedCurrent) await runtime.runProc(['mv', backupId, marketId], marketsDir).catch(() => {})
      await runtime.runProc(['rm', '-rf', nextId, backupId], marketsDir).catch(() => {})
      throw e
    } finally {
      if (suspended) {
        hooks.resumeMarket(marketId)
        await hooks.reconcile()
      }
      if (result) onSkillsChanged()
    }
  }

  /** @param {{marketId: string}} args */
  async function removeMarket(args) {
    const cfg = await runtime.loadConfig()
    const id = String(args.marketId || '')
    const market = cfg.markets.find((m) => m.id === id)
    if (!market) throw new Error('市场不存在: ' + id)
    await runtime.saveConfig(removeMarketFromConfig(cfg, id))
    await hooks.reconcile()
    await runtime.runProc(['rm', '-rf', marketsDir + '/' + id], marketsDir).catch(() => {})
    onSkillsChanged()
    return { removed: true }
  }

  /** @param {{marketId: string, pluginName: string}} args */
  async function installPlugin(args) {
    const marketId = String(args.marketId || '')
    const pluginName = String(args.pluginName || '')
    if (!marketId || !pluginName) throw new Error('缺少市场或插件标识')
    const key = marketPluginKey(marketId, pluginName)
    const cfg = installPluginInConfig(await runtime.loadConfig(), key, {
      marketId,
      pluginName,
      installedAt: Date.now(),
    })
    await runtime.saveConfig(cfg)
    await hooks.reconcile()
    onSkillsChanged()
    return { installed: true }
  }

  /** @param {{marketId: string, pluginName: string}} args */
  async function uninstallPlugin(args) {
    const marketId = String(args.marketId || '')
    const pluginName = String(args.pluginName || '')
    const key = marketPluginKey(marketId, pluginName)
    await runtime.saveConfig(uninstallPluginFromConfig(await runtime.loadConfig(), key))
    await hooks.reconcile()
    onSkillsChanged()
    return { removed: true }
  }

  /** @param {{fullName: string, enabled: boolean, standalone?: boolean}} args */
  async function setSkillEnabled(args) {
    const fullName = String(args.fullName || '')
    const enabled = !!args.enabled
    if (!fullName) throw new Error('缺少技能标识')
    await runtime.saveConfig(setSkillEnabledInConfig(await runtime.loadConfig(), {
      fullName,
      enabled,
      standalone: !!args.standalone,
    }))
    onSkillsChanged()
    return { fullName, enabled }
  }

  /** @param {{marketId: string, enabled: boolean}} args */
  async function setStandaloneSkillsEnabled(args) {
    const marketId = String(args.marketId || '')
    const enabled = !!args.enabled
    const cfg = await runtime.loadConfig()
    const market = cfg.markets.find((item) => item.id === marketId)
    if (!market) throw new Error('市场不存在: ' + marketId)
    const marketDir = marketsDir + '/' + marketId
    const marketplace = await runtime.parseMarketplace(marketDir, market.repo)
    const skills = await runtime.scanStandaloneSkills(market, marketplace)
    await runtime.saveConfig(setStandaloneSkillsEnabledInConfig(cfg, skills, enabled))
    onSkillsChanged()
    return { marketId, enabled, count: skills.length }
  }

  /**
   * Scan every supported source sharing the key before any state is changed.
   * Strict scans must finish even if an earlier source already found a target.
   *
   * @param {MarketConfig} cfg
   * @param {string} marketId
   * @param {string} pluginName
   */
  async function scanPluginGroup(cfg, marketId, pluginName) {
    const key = marketPluginKey(marketId, pluginName)
    const market = cfg.markets.find((item) => item.id === marketId)
    if (!market) throw new Error('市场不存在: ' + marketId)
    const marketDir = marketsDir + '/' + market.id
    const marketplace = await runtime.parseMarketplace(marketDir, market.repo)
    const entries = marketplace && marketplace.plugins.filter((item) => !item.unsupported && marketPluginKey(market.id, item.name) === key)
    if (!entries || entries.length === 0) throw new Error('插件不存在或来源不受支持，未更改配置')
    /** @type {Map<string, SkillInfo>} */
    const skills = new Map()
    for (const entry of entries) {
      const pluginDir = await runtime.resolveDirectoryWithin(marketDir, entry.source)
      if (!pluginDir) throw new Error('插件路径不存在或不在市场目录中')
      const meta = await runtime.readPluginMeta(pluginDir, entry)
      for (const skill of await runtime.scanPluginSkills(market, entry, pluginDir, meta, { strict: true })) {
        if (!skills.has(skill.fullName)) skills.set(skill.fullName, skill)
      }
    }
    return { key, skills: [...skills.values()] }
  }

  /** @param {{marketId: string, pluginName: string, enabled: boolean, workspaceId?: string}} args */
  async function setPluginSkillsEnabled(args) {
    const marketId = String(args.marketId || '')
    const pluginName = String(args.pluginName || '')
    if (!marketId || !pluginName) throw new Error('缺少市场或插件标识')
    if (typeof args.enabled !== 'boolean') throw new Error('技能启用状态必须为 boolean')
    const enabled = args.enabled
    const cfg = await runtime.loadConfig()
    const { workspace, config: current } = await scopeFor(args)
    if (!workspace && !cfg.installed[marketPluginKey(marketId, pluginName)]) throw new Error('请先安装插件再切换技能')
    const { key, skills } = await scanPluginGroup(cfg, marketId, pluginName)
    if (workspace) {
      const states = skills.map((skill) => ({ fullName: skill.fullName, enabled }))
      await runtime.saveWorkspaceConfig(workspace.path, setWorkspacePluginSkillStatesInConfig(cfg, current, key, states))
    } else {
      await runtime.saveConfig(setPluginSkillsEnabledInConfig(cfg, skills, enabled))
    }
    onSkillsChanged()
    return { ...(workspace ? { workspaceId: workspace.id } : {}), key, enabled, count: skills.length }
  }

  /** @param {{workspaceId: string, marketId: string, pluginName: string, mode: 'inherit' | 'enabled' | 'disabled'}} args */
  async function setWorkspacePluginEnabled(args) {
    const workspace = workspaceFor(args)
    const marketId = String(args.marketId || '')
    const pluginName = String(args.pluginName || '')
    if (!marketId || !pluginName) throw new Error('缺少市场或插件标识')
    const mode = workspaceOverrideMode(args.mode)
    const key = marketPluginKey(marketId, pluginName)
    if (mode === 'inherit') {
      // The group reset clears every child override so the plugin follows global state.
      await runtime.saveWorkspaceConfig(workspace.path, clearPluginSkillOverrides(await runtime.loadWorkspaceConfig(workspace.path), key))
      onSkillsChanged()
    } else {
      await setPluginSkillsEnabled({ workspaceId: workspace.id, marketId, pluginName, enabled: mode === 'enabled' })
    }
    return { workspaceId: workspace.id, key, mode }
  }

  /** @param {{workspaceId: string, fullName: string, standalone?: boolean, mode: 'inherit' | 'enabled' | 'disabled'}} args */
  async function setWorkspaceSkillEnabled(args) {
    const workspace = workspaceFor(args)
    const fullName = String(args.fullName || '')
    if (!fullName) throw new Error('缺少技能标识')
    const mode = workspaceOverrideMode(args.mode)
    const cfg = await runtime.loadConfig()
    const current = await runtime.loadWorkspaceConfig(workspace.path)
    let globalEnabled
    if (args.standalone) {
      globalEnabled = standaloneSkillEnabled(cfg, null, fullName)
    } else {
      const pluginKey = fullName.slice(0, fullName.lastIndexOf('/'))
      const separator = pluginKey.indexOf('/')
      const { key, skills } = await scanPluginGroup(cfg, pluginKey.slice(0, separator), pluginKey.slice(separator + 1))
      if (!skills.some((skill) => skill.fullName === fullName)) throw new Error('技能不存在，未更改工作区配置')
      globalEnabled = pluginSkillEnabled(cfg, null, key, fullName)
    }
    const enabled = mode === 'inherit' ? globalEnabled : mode === 'enabled'
    const override = enabled === globalEnabled ? 'inherit' : enabled ? 'enabled' : 'disabled'
    const next = args.standalone
      ? setWorkspaceStandaloneSkillOverride(current, fullName, override)
      : setWorkspacePluginSkillOverride(current, fullName, override)
    await runtime.saveWorkspaceConfig(workspace.path, next)
    onSkillsChanged()
    return { workspaceId: workspace.id, fullName, mode }
  }

  /** @param {{marketId: string, pluginName: string, enabled: boolean}} args */
  async function setPluginHooksEnabled(args) {
    const marketId = String(args.marketId || '')
    const pluginName = String(args.pluginName || '')
    const enabled = !!args.enabled
    const key = marketPluginKey(marketId, pluginName)
    const cfg = await runtime.loadConfig()

    if (!enabled) {
      delete cfg.hookApprovals[key]
      hooks.clearRuntimeError(key)
      await runtime.saveConfig(cfg)
      await hooks.disposeHookFibers(key)
      await hooks.reconcile()
      onSkillsChanged()
      return { key, enabled: false, active: false }
    }

    if (!hooks.available) throw new Error(HOOKS_BRIDGE_UNAVAILABLE_ERROR)
    if (!cfg.installed[key]) throw new Error('请先安装插件再启用 hooks')
    const market = cfg.markets.find((item) => item.id === marketId)
    if (!market) throw new Error('市场不存在: ' + marketId)
    const marketplace = await runtime.parseMarketplace(marketsDir + '/' + marketId, market.repo)
    const entry = marketplace && marketplace.plugins.find((item) => item.name === pluginName)
    if (!entry || entry.unsupported) throw new Error('插件不存在或来源不受支持')
    const marketDir = marketsDir + '/' + marketId
    const pluginDir = await runtime.resolveDirectoryWithin(marketDir, entry.source)
    if (!pluginDir) throw new Error('插件路径不在市场目录中')
    const hookInfo = await hooks.inspectCodexHooks(marketDir, pluginDir, await runtime.readPluginMeta(pluginDir, entry))
    if (!hookInfo.found) throw new Error(hookInfo.error || '未发现可用的 Codex hooks 配置')

    cfg.hookApprovals[key] = { fingerprint: hookInfo.fingerprint, approvedAt: Date.now() }
    await runtime.saveConfig(cfg)
    await hooks.reconcile()
    onSkillsChanged()
    return { key, enabled: true, active: hooks.isActive(key), error: hooks.runtimeError(key) }
  }

  /**
   * @param {{workspaceId?: string}} [args]
   * @returns {Promise<HostMarketState>}
   */
  async function getState(args = {}) {
    await hooks.reconcile()
    const cfg = await runtime.loadConfig()
    const { workspace, config: workspaceConfig } = await scopeFor(args)
    /**
     * @param {SkillInfo} skill
     * @param {'pluginSkills' | 'standaloneSkills'} group
     * @param {boolean} globalEnabled
     * @param {boolean} enabled
     */
    const buildSkillView = (skill, group, globalEnabled, enabled) => {
      const override = workspaceOverride(workspaceConfig, group, skill.fullName)
      return {
        name: skill.skillName,
        fullName: skill.fullName,
        description: skill.description,
        globalEnabled,
        workspaceOverride: override === undefined ? null : override,
        enabled,
      }
    }
    /**
     * @param {SkillInfo} skill
     * @param {string} pluginKey
     */
    const skillView = (skill, pluginKey) => buildSkillView(
      skill,
      'pluginSkills',
      pluginSkillEnabled(cfg, null, pluginKey, skill.fullName),
      pluginSkillEnabled(cfg, workspaceConfig, pluginKey, skill.fullName),
    )
    /** @param {SkillInfo} skill */
    const standaloneSkillView = (skill) => buildSkillView(
      skill,
      'standaloneSkills',
      !!cfg.enabledStandaloneSkills[skill.fullName],
      standaloneSkillEnabled(cfg, workspaceConfig, skill.fullName),
    )
    /** @type {HostMarketStateMarket[]} */
    const markets = []
    for (const market of cfg.markets) {
      const marketDir = marketsDir + '/' + market.id
      const mp = await runtime.parseMarketplace(marketDir, market.repo)
      const standaloneSkills = (await runtime.scanStandaloneSkills(market, mp)).map(standaloneSkillView)
      /** @type {HostMarketStatePlugin[]} */
      const plugins = []
      /** @type {Map<string, HostMarketStatePlugin>} */
      const supportedViews = new Map()
      if (mp) {
        for (const entry of mp.plugins) {
          const key = marketPluginKey(market.id, entry.name)
          const existing = entry.unsupported ? undefined : supportedViews.get(key)
          /** @type {HostMarketStatePlugin} */
          const view = existing || {
            name: entry.name,
            installed: !!cfg.installed[key],
            activationState: 'disabled',
            unsupported: entry.unsupported || false,
            sourceType: entry.sourceType || 'local',
            title: entry.name,
            description: entry.description || '',
            error: null,
            skills: [],
            hooks: null,
          }
          if (!existing) {
            plugins.push(view)
            if (!entry.unsupported) supportedViews.set(key, view)
          }
          if (!entry.unsupported) {
            try {
              const pluginDir = await runtime.resolveDirectoryWithin(marketDir, entry.source)
              if (!pluginDir) throw new Error('插件路径不在市场目录中')
              const meta = await runtime.readPluginMeta(pluginDir, entry)
              if (!existing) {
                view.title = meta.title || entry.name
                view.description = meta.description
              }
              // Skill sources may share a key, but hook authority still belongs
              // to the first manifest entry, as in installation/reconciliation.
              if (meta.codexHooks && mp.plugins.find((item) => item.name === entry.name) === entry) {
                const hookInfo = await hooks.inspectCodexHooks(marketDir, pluginDir, meta)
                const approval = hookApprovalState(hookInfo, cfg.hookApprovals[key])
                view.hooks = {
                  available: hooks.available,
                  found: hookInfo.found,
                  count: hookInfo.configs.length,
                  enabled: approval.approved,
                  active: hooks.isActive(key),
                  needsApproval: approval.needsApproval,
                  error: hookInfo.error || hooks.runtimeError(key),
                }
              }
              const seen = new Set(view.skills.map((skill) => skill.fullName))
              for (const sk of await runtime.scanPluginSkills(market, entry, pluginDir, meta)) {
                if (seen.has(sk.fullName)) continue
                seen.add(sk.fullName)
                view.skills.push(skillView(sk, key))
              }
            } catch (e) {
              view.error = [view.error, errorMessage(e)].filter(Boolean).join('; ')
            }
          }
        }
      }
      for (const view of plugins) {
        const enabledCount = view.skills.filter((skill) => skill.enabled).length
        view.activationState = enabledCount === 0 ? 'disabled' : enabledCount === view.skills.length ? 'enabled' : 'partial'
      }
      markets.push({ id: market.id, name: market.name, repo: market.repo, description: mp ? mp.description : '', refType: market.refType || 'default', ref: market.ref || null, manifestFound: !!mp, standaloneSkills, plugins })
    }
    const workspaceViews = workspaces.list()
      .filter((item) => workspaceConfigurable(item))
      .map((item) => ({ id: item.id, title: item.title, path: item.path }))
    return {
      hooksBridge: {
        available: hooks.available,
        installCommand: HOOKS_BRIDGE_INSTALL_COMMAND,
      },
      scope: workspace
        ? { kind: 'workspace', id: workspace.id, title: workspace.title, path: workspace.path, overrideCount: workspaceOverrideCount(workspaceConfig) }
        : { kind: 'global' },
      workspaces: workspaceViews,
      markets,
    }
  }

  /** @param {HostContext} ctx */
  function registerAutoUpdate(ctx) {
    ctx.effect(() => {
      let cancelled = false
      ;(async () => {
        try {
          const cfg = await runtime.loadConfig()
          for (const market of cfg.markets) {
            if (cancelled) break
            try {
              const result = await pullMarket(market)
              console.log('[agent-plugin-market] auto update ' + market.id + ': ' + (result.skipped ? result.reason : 'ok'))
            } catch (e) {
              console.error('[agent-plugin-market] auto update failed for ' + market.id + ': ' + errorMessage(e))
            }
          }
          if (!cancelled) onSkillsChanged()
        } catch (e) {
          console.error('[agent-plugin-market] auto update error: ' + errorMessage(e))
        }
      })()
      return () => { cancelled = true }
    })
  }

  return {
    addMarket,
    updateMarket,
    setMarketRef,
    removeMarket,
    installPlugin,
    uninstallPlugin,
    setSkillEnabled,
    setPluginSkillsEnabled,
    setStandaloneSkillsEnabled,
    setWorkspacePluginEnabled,
    setWorkspaceSkillEnabled,
    setPluginHooksEnabled,
    getState,
    registerAutoUpdate,
  }
}
