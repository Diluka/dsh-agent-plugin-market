import { hookApprovalState, hookFingerprint, hookStorageKey, isPluginRelativePath, withPluginHookEnvironment } from './codex-hooks.js'
import { planHookReconciliation } from './hook-reconcile-plan.js'
import { marketPluginKey } from './market-runtime.js'

// Keep this adapter protocol-specific; a Claude bridge can live beside it.
/**
 * @param {{ctx: import('@deepseek-ai/cordis').Context, fs: {lstat: (path: string) => Promise<{type: string} | null>, resolve: (path: string) => Promise<{displayPath: string, targetKey: string}>, contains: (parent: object, child: object) => boolean, stat: (target: object) => Promise<{type: string} | null>, readText: (target: object) => Promise<string>, writeText: (target: object, content: string) => Promise<void>}, bridge: unknown | null, runtime: ReturnType<typeof import('./market-runtime.js').createMarketRuntime>}} options
 */
export function createCodexHookManager({ ctx, fs, bridge, runtime }) {
  const { generatedHooksDir, hookDataDir, marketsDir } = runtime.paths
  const hookFibers = new Map()
  const hookRuntimeErrors = new Map()
  const suspendedHookMarkets = new Set()
  let hookReconcile = Promise.resolve()
  let hooksDisposed = false

  /**
   * @param {string} pluginDir
   * @param {string} relativePath
   * @returns {Promise<{error?: string, missing?: boolean, config?: Record<string, unknown>, source?: string, pluginRoot?: string}>}
   */
  async function readPluginHookFile(pluginDir, relativePath) {
    if (!isPluginRelativePath(relativePath)) return { error: 'hooks path must stay inside the plugin root' }
    const inputPath = pluginDir + '/' + relativePath
    const pathInfo = await fs.lstat(inputPath)
    if (!pathInfo) return { missing: true }
    if (pathInfo.type === 'symlink') return { error: 'hooks path must not be a symlink' }
    const root = await fs.resolve(pluginDir)
    const target = await fs.resolve(inputPath)
    if (!fs.contains(root, target)) return { error: 'hooks path escapes the plugin root' }
    const info = await fs.stat(target)
    if (!info) return { missing: true }
    if (info.type !== 'file') return { error: 'hooks path must point to a JSON file' }
    const text = await fs.readText(target)
    try {
      const config = JSON.parse(text)
      if (!config || typeof config !== 'object' || Array.isArray(config)) {
        return { error: 'hooks JSON must contain an object' }
      }
      return { config, source: relativePath, pluginRoot: root.displayPath }
    } catch (e) {
      return { error: 'hooks JSON is invalid: ' + String((e && e.message) || e) }
    }
  }

  /**
   * @param {string} marketDir
   * @param {string} pluginDir
   * @param {{hookConfigs?: {codex?: {declared: boolean, errors: string[], sources: Array<{kind: string, path?: string, config?: Record<string, unknown>}>}}}} meta
   * @returns {Promise<{found: boolean, declared: boolean, configs: Array<{source: string, config: Record<string, unknown>}>, fingerprint?: string, pluginRoot?: string, error: string | null}>}
   */
  async function inspectCodexHooks(marketDir, pluginDir, meta) {
    const codexHooks = meta.hookConfigs && meta.hookConfigs.codex
    if (!codexHooks) return { found: false, declared: false, configs: [], error: null }
    const marketTarget = await fs.resolve(marketDir)
    const pluginTarget = await fs.resolve(pluginDir)
    if (!fs.contains(marketTarget, pluginTarget)) {
      return { found: false, declared: codexHooks.declared, configs: [], error: 'plugin source escapes the market root' }
    }
    if (codexHooks.errors.length) {
      return { found: false, declared: codexHooks.declared, configs: [], error: codexHooks.errors.join('; ') }
    }

    const configs = []
    let pluginRoot = ''
    for (const source of codexHooks.sources) {
      if (source.kind === 'inline') {
        configs.push({ source: 'inline', config: source.config })
        continue
      }
      const file = await readPluginHookFile(pluginDir, source.path)
      if (file.missing && !codexHooks.declared) continue
      if (file.missing) {
        return { found: false, declared: true, configs: [], error: 'declared hooks file is missing: ' + source.path }
      }
      if (file.error) return { found: false, declared: codexHooks.declared, configs: [], error: file.error }
      pluginRoot = file.pluginRoot
      configs.push({ source: file.source, config: file.config })
    }

    if (!configs.length) {
      return {
        found: false,
        declared: codexHooks.declared,
        configs: [],
        error: codexHooks.declared ? 'manifest declares no usable hooks configuration' : null,
      }
    }

    if (!pluginRoot) pluginRoot = pluginTarget.displayPath
    const fingerprint = hookFingerprint({
      sources: configs.map((item) => ({ source: item.source, config: item.config })),
    })
    return { found: true, declared: codexHooks.declared, configs, fingerprint, pluginRoot, error: null }
  }

  async function approvedHookConfigs(cfg) {
    const desired = new Map()
    for (const inst of Object.values(cfg.installed)) {
      if (!inst || typeof inst !== 'object') continue
      const market = cfg.markets.find((m) => m.id === inst.marketId)
      if (!market || suspendedHookMarkets.has(market.id)) continue
      const mp = await runtime.parseMarketplace(marketsDir + '/' + market.id, market.repo)
      const entry = mp && mp.plugins.find((item) => item.name === inst.pluginName)
      if (!entry || entry.unsupported) continue
      const key = marketPluginKey(market.id, entry.name)
      const marketDir = marketsDir + '/' + market.id
      const pluginDir = await runtime.resolveDirectoryWithin(marketDir, entry.source)
      if (!pluginDir) continue
      const hookInfo = await inspectCodexHooks(marketDir, pluginDir, await runtime.readPluginMeta(pluginDir, entry))
      if (!hookApprovalState(hookInfo, cfg.hookApprovals[key]).approved) continue
      desired.set(key, hookInfo)
    }
    return desired
  }

  /** @param {string} key */
  async function disposeHookFibers(key) {
    const active = hookFibers.get(key)
    hookFibers.delete(key)
    const fibers = new Set(active ? active.fibers : [])
    if (bridge) {
      // Sweep bridge fibers orphaned by a failed or reentrant mount.
      const prefix = generatedHooksDir + '/' + hookStorageKey(key) + '-'
      const registry = ctx.registry.get(bridge)
      for (const fiber of registry ? registry.fibers : []) {
        const configPath = fiber.config && fiber.config.configPath
        if (typeof configPath === 'string' && configPath.startsWith(prefix)) fibers.add(fiber)
      }
    }
    await Promise.all([...fibers].map((fiber) => Promise.resolve().then(() => fiber.dispose()).catch((e) => {
      console.error('[agent-plugin-market] hook disposal failed for ' + key + ': ' + String((e && e.message) || e))
    })))
  }

  /**
   * @param {string} key
   * @param {{configs: Array<{config: Record<string, unknown>}>, fingerprint: string, pluginRoot: string}} hookInfo
   */
  async function mountHookFibers(key, hookInfo) {
    if (!bridge) return
    await disposeHookFibers(key)
    const storageKey = hookStorageKey(key)
    const pluginData = hookDataDir + '/' + storageKey
    await runtime.ensureDir(generatedHooksDir)
    await runtime.ensureDir(pluginData)

    const fibers = []
    try {
      for (let index = 0; index < hookInfo.configs.length; index++) {
        const generatedPath = generatedHooksDir + '/' + storageKey + '-' + index + '.json'
        const generatedTarget = await fs.resolve(generatedPath)
        const config = withPluginHookEnvironment(hookInfo.configs[index].config, {
          pluginRoot: hookInfo.pluginRoot,
          pluginData,
        })
        await fs.writeText(generatedTarget, JSON.stringify(config, null, 2))
        if (hooksDisposed) throw new Error('hook manager is stopping')
        const fiber = ctx.plugin(bridge, { configPath: generatedTarget.displayPath })
        await fiber
        fibers.push(fiber)
      }
      hookFibers.set(key, { fingerprint: hookInfo.fingerprint, fibers })
      hookRuntimeErrors.delete(key)
    } catch (e) {
      await Promise.all(fibers.map((fiber) => Promise.resolve().then(() => fiber.dispose()).catch(() => {})))
      hookRuntimeErrors.set(key, String((e && e.message) || e))
    }
  }

  async function reconcileNow() {
    if (hooksDisposed) return
    if (!bridge) {
      await Promise.all([...hookFibers.keys()].map(disposeHookFibers))
      return
    }
    const cfg = await runtime.loadConfig()
    const desired = await approvedHookConfigs(cfg)
    const plan = planHookReconciliation(desired, hookFibers)
    for (const key of plan.disposeKeys) await disposeHookFibers(key)
    for (const { key, hookInfo } of plan.mounts) await mountHookFibers(key, hookInfo)
  }

  function reconcile() {
    hookReconcile = hookReconcile.catch(() => {}).then(reconcileNow)
    return hookReconcile
  }

  function start() {
    ctx.effect(() => {
      reconcile().catch((e) => console.error('[agent-plugin-market] initial hook registration failed: ' + String((e && e.message) || e)))
      return async () => {
        hooksDisposed = true
        await Promise.all([...hookFibers.keys()].map(disposeHookFibers))
      }
    })
  }

  /** @param {string} marketId */
  function activeKeysForMarket(marketId) {
    return new Set([...hookFibers.keys()].filter((key) => key.startsWith(marketId + '/')))
  }

  /** @param {string} marketId */
  function suspendMarket(marketId) {
    suspendedHookMarkets.add(marketId)
  }

  /** @param {string} marketId */
  function resumeMarket(marketId) {
    suspendedHookMarkets.delete(marketId)
  }

  /** @param {string} key */
  function isActive(key) {
    return hookFibers.has(key)
  }

  /** @param {string} key */
  function runtimeError(key) {
    return hookRuntimeErrors.get(key) || null
  }

  /** @param {string} key */
  function clearRuntimeError(key) {
    hookRuntimeErrors.delete(key)
  }

  /** @param {string} marketId */
  async function revokeMarketHookApprovals(marketId) {
    const cfg = await runtime.loadConfig()
    let changed = false
    for (const key of Object.keys(cfg.hookApprovals)) {
      if (!key.startsWith(marketId + '/')) continue
      delete cfg.hookApprovals[key]
      changed = true
    }
    if (changed) await runtime.saveConfig(cfg)
  }

  /**
   * @param {{id: string, repo: string}} market
   * @param {ReadonlySet<string>} activeKeys
   */
  async function restoreActiveMarketHookApprovals(market, activeKeys) {
    if (!activeKeys.size) return
    const cfg = await runtime.loadConfig()
    const marketDir = marketsDir + '/' + market.id
    const marketplace = await runtime.parseMarketplace(marketDir, market.repo)
    if (!marketplace) return

    let changed = false
    for (const key of activeKeys) {
      const installed = cfg.installed[key]
      if (!installed || typeof installed !== 'object' || installed.marketId !== market.id) continue
      const entry = marketplace.plugins.find((item) => item.name === installed.pluginName)
      if (!entry || entry.unsupported) continue
      const pluginDir = await runtime.resolveDirectoryWithin(marketDir, entry.source)
      if (!pluginDir) continue
      const hookInfo = await inspectCodexHooks(marketDir, pluginDir, await runtime.readPluginMeta(pluginDir, entry))
      if (!hookInfo.found) continue
      cfg.hookApprovals[key] = { fingerprint: hookInfo.fingerprint, approvedAt: Date.now() }
      changed = true
    }
    if (changed) await runtime.saveConfig(cfg)
  }

  return {
    available: !!bridge,
    start,
    reconcile,
    inspectCodexHooks,
    disposeHookFibers,
    activeKeysForMarket,
    suspendMarket,
    resumeMarket,
    isActive,
    runtimeError,
    clearRuntimeError,
    revokeMarketHookApprovals,
    restoreActiveMarketHookApprovals,
  }
}
