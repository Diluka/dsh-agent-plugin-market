import { hookApprovalState } from './codex-hooks.js'
import {
  addMarketToConfig,
  installPluginInConfig,
  removeMarketFromConfig,
  setSkillEnabledInConfig,
  setStandaloneSkillsEnabledInConfig,
  uninstallPluginFromConfig,
} from './market-config.js'
import { marketPluginKey } from './market-runtime.js'

export const HOOKS_BRIDGE_INSTALL_COMMAND = 'dsh plugin --profile web add @deepseek-ai/dsh-hooks-codex @deepseek-ai/dsh-hook-protocol'
const HOOKS_BRIDGE_UNAVAILABLE_ERROR = 'Codex hooks bridge 不可用；请先安装 ' + HOOKS_BRIDGE_INSTALL_COMMAND + ' 并重启 DSH'

/**
 * @param {{runtime: ReturnType<typeof import('./market-runtime.js').createMarketRuntime>, hooks: ReturnType<typeof import('./codex-hook-manager.js').createCodexHookManager>, onSkillsChanged: () => void}} options
 */
export function createMarketService({ runtime, hooks, onSkillsChanged }) {
  const { marketsDir } = runtime.paths

  /**
   * @param {{repo: string, refType?: 'default' | 'branch' | 'tag' | 'commit', ref?: string}} args
   */
  async function addMarket(args) {
    const repo = String(args.repo || '').trim()
    if (!repo) throw new Error('仓库地址不能为空')
    const refType = ['branch', 'tag', 'commit'].includes(args.refType) ? args.refType : 'default'
    const ref = String(args.ref || '').trim()
    if (refType !== 'default' && !ref) {
      throw new Error(refType === 'branch' ? '请填写分支名' : refType === 'tag' ? '请填写标签名' : '请填写 commit id')
    }
    await runtime.ensureDir(marketsDir)
    const slug = repo.replace(/\.git$/, '').split(/[\/:]/).filter(Boolean).pop() || 'market'
    const id = slug.replace(/[^A-Za-z0-9._-]/g, '-') + '-' + Math.random().toString(36).slice(2, 6)
    try {
      if (refType === 'default') {
        await runtime.runProc(['git', 'clone', '--depth', '1', repo, id], marketsDir)
      } else if (refType === 'branch') {
        await runtime.runProc(['git', 'clone', '--depth', '1', '--branch', ref, repo, id], marketsDir)
      } else if (refType === 'tag') {
        await runtime.runProc(['git', 'clone', '--depth', '1', '--branch', ref, repo, id], marketsDir)
      } else {
        await runtime.runProc(['git', 'clone', repo, id], marketsDir)
        await runtime.runProc(['git', '-C', id, 'checkout', ref], marketsDir)
      }
    } catch (e) {
      await runtime.runProc(['rm', '-rf', id], marketsDir).catch(() => {})
      throw e
    }
    const marketDir = marketsDir + '/' + id
    let mp
    let standaloneSkills
    try {
      mp = await runtime.parseMarketplace(marketDir, repo)
      standaloneSkills = await runtime.scanStandaloneSkills({ id, repo }, mp)
    } catch (e) {
      await runtime.runProc(['rm', '-rf', id], marketsDir).catch(() => {})
      throw e
    }
    if (!mp && standaloneSkills.length === 0) {
      await runtime.runProc(['rm', '-rf', id], marketsDir).catch(() => {})
      throw new Error('未找到 marketplace.json，且仓库根 skills/ 目录中没有可用技能')
    }
    let cfg
    try {
      const entry = { id, name: (mp && mp.name) || slug, repo, addedAt: Date.now() }
      if (refType !== 'default') {
        entry.refType = refType
        entry.ref = ref
      }
      cfg = addMarketToConfig(await runtime.loadConfig(), entry)
      await runtime.saveConfig(cfg)
      await hooks.reconcile()
      onSkillsChanged()
      return { id, name: (mp && mp.name) || slug, repo, refType, ref: refType !== 'default' ? ref : null }
    } catch (e) {
      if (cfg) await runtime.saveConfig(removeMarketFromConfig(cfg, id)).catch(() => {})
      await runtime.runProc(['rm', '-rf', id], marketsDir).catch(() => {})
      throw e
    }
  }

  // Only hooks live before a market update retain their enabled state.
  /**
   * @param {{id: string, repo: string, refType?: 'branch' | 'tag' | 'commit'}} market
   */
  async function pullMarket(market) {
    const dir = marketsDir + '/' + market.id
    if (market.refType === 'tag' || market.refType === 'commit') {
      return { skipped: true, reason: '固定引用（' + market.refType + '），无需更新' }
    }

    await hooks.reconcile()
    const activeKeys = hooks.activeKeysForMarket(market.id)
    let resumeHooks = true
    hooks.suspendMarket(market.id)
    try {
      await hooks.reconcile()
      const before = (await runtime.runProc(['git', '-C', dir, 'rev-parse', 'HEAD'], marketsDir)).trim()
      await runtime.runProc(['git', '-C', dir, 'pull', '--ff-only'], marketsDir)
      const after = (await runtime.runProc(['git', '-C', dir, 'rev-parse', 'HEAD'], marketsDir)).trim()
      const updated = before !== after
      if (updated) {
        await hooks.revokeMarketHookApprovals(market.id)
        await hooks.restoreActiveMarketHookApprovals(market, activeKeys)
      }
      return { updated }
    } catch (e) {
      try {
        await hooks.revokeMarketHookApprovals(market.id)
      } catch (revokeError) {
        resumeHooks = false
        console.error('[agent-plugin-market] keeping hooks suspended after failed pull for ' + market.id + ': ' + String((revokeError && revokeError.message) || revokeError))
      }
      throw e
    } finally {
      if (resumeHooks) {
        hooks.resumeMarket(market.id)
        await hooks.reconcile()
      }
    }
  }

  /** @param {{marketId: string}} args */
  async function updateMarket(args) {
    const cfg = await runtime.loadConfig()
    const market = cfg.markets.find((m) => m.id === String(args.marketId || ''))
    if (!market) throw new Error('市场不存在: ' + args.marketId)
    const result = await pullMarket(market)
    await hooks.reconcile()
    onSkillsChanged()
    return result
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
   * @returns {Promise<{hooksBridge: {available: boolean, installCommand: string}, markets: object[]}>}
   */
  async function getState() {
    await hooks.reconcile()
    const cfg = await runtime.loadConfig()
    const skillView = (skill) => ({
      name: skill.skillName,
      fullName: skill.fullName,
      description: skill.description,
      whenToUse: skill.whenToUse,
      enabled: !(cfg.disabledSkills && cfg.disabledSkills[skill.fullName]),
    })
    const standaloneSkillView = (skill) => ({
      name: skill.skillName,
      fullName: skill.fullName,
      description: skill.description,
      whenToUse: skill.whenToUse,
      enabled: !!(cfg.enabledStandaloneSkills && cfg.enabledStandaloneSkills[skill.fullName]),
    })
    const markets = []
    for (const market of cfg.markets) {
      const marketDir = marketsDir + '/' + market.id
      const mp = await runtime.parseMarketplace(marketDir, market.repo)
      const standaloneSkills = (await runtime.scanStandaloneSkills(market, mp)).map(standaloneSkillView)
      const plugins = []
      if (mp) {
        for (const entry of mp.plugins) {
          const view = {
            name: entry.name,
            installed: !!(cfg.installed[market.id + '/' + entry.name]),
            unsupported: entry.unsupported || false,
            sourceType: entry.sourceType || 'local',
            title: entry.name,
            description: entry.description || '',
            error: null,
            skills: [],
            hooks: null,
          }
          if (!entry.unsupported) {
            try {
              const pluginDir = await runtime.resolveDirectoryWithin(marketDir, entry.source)
              if (!pluginDir) throw new Error('插件路径不在市场目录中')
              const meta = await runtime.readPluginMeta(pluginDir, entry)
              view.title = meta.title || entry.name
              view.description = meta.description
              if (meta.hookConfigs.codex) {
                const hookInfo = await hooks.inspectCodexHooks(marketDir, pluginDir, meta)
                const key = marketPluginKey(market.id, entry.name)
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
              for (const sk of await runtime.scanPluginSkills(market, entry, pluginDir, meta)) {
                view.skills.push(skillView(sk))
              }
            } catch (e) {
              view.error = String((e && e.message) || e)
            }
          }
          plugins.push(view)
        }
      }
      markets.push({ id: market.id, name: market.name, repo: market.repo, description: mp ? mp.description : '', refType: market.refType || 'default', ref: market.ref || null, manifestFound: !!mp, standaloneSkills, plugins })
    }
    return {
      hooksBridge: {
        available: hooks.available,
        installCommand: HOOKS_BRIDGE_INSTALL_COMMAND,
      },
      markets,
    }
  }

  /** @param {import('@deepseek-ai/cordis').Context} ctx */
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
              console.error('[agent-plugin-market] auto update failed for ' + market.id + ': ' + String((e && e.message) || e))
            }
          }
          if (!cancelled) {
            await hooks.reconcile()
            onSkillsChanged()
          }
        } catch (e) {
          console.error('[agent-plugin-market] auto update error: ' + String((e && e.message) || e))
        }
      })()
      return () => { cancelled = true }
    })
  }

  return {
    addMarket,
    updateMarket,
    removeMarket,
    installPlugin,
    uninstallPlugin,
    setSkillEnabled,
    setStandaloneSkillsEnabled,
    setPluginHooksEnabled,
    getState,
    registerAutoUpdate,
  }
}
