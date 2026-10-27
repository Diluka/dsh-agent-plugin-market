/// <reference path="../types/host.d.ts" />
import { hookApprovalState, hookFingerprint, hookStorageKey, isPluginRelativePath, withPluginHookEnvironment } from './codex-hooks.js'
import { errorMessage } from './util.js'

/** @typedef {{fingerprint: string, fibers: import('@deepseek-ai/cordis').Fiber[]}} ActiveCodexHookRecord */

// Keep this adapter protocol-specific; a Claude bridge can live beside it.
/** @param {CodexHookManagerOptions} options */
export function createCodexHookManager({ ctx, fs, bridge, runtime }) {
  const { generatedHooksDir, hookDataDir, marketsDir } = runtime.paths
  /** @type {Map<string, ActiveCodexHookRecord>} */
  const hookFibers = new Map()
  /** @type {Map<string, string>} */
  const hookRuntimeErrors = new Map()
  const suspendedHookMarkets = new Set()
  let hookReconcile = Promise.resolve()
  let hooksDisposed = false

  /**
   * @param {string} pluginDir
   * @param {string} relativePath
   * @returns {Promise<
   *   | {status: 'ok', config: Record<string, unknown>, source: string, pluginRoot: string}
   *   | {status: 'missing'}
   *   | {status: 'error', error: string}
   * >}
   */
  async function readPluginHookFile(pluginDir, relativePath) {
    if (!isPluginRelativePath(relativePath)) return { status: 'error', error: 'hooks path must stay inside the plugin root' }
    const inputPath = pluginDir + '/' + relativePath
    const pathInfo = await fs.lstat(inputPath)
    if (!pathInfo) return { status: 'missing' }
    if (pathInfo.type === 'symlink') return { status: 'error', error: 'hooks path must not be a symlink' }
    const root = await fs.resolve(pluginDir)
    const target = await fs.resolve(inputPath)
    if (!fs.contains(root, target)) return { status: 'error', error: 'hooks path escapes the plugin root' }
    const info = await fs.stat(target)
    if (!info) return { status: 'missing' }
    if (info.type !== 'file') return { status: 'error', error: 'hooks path must point to a JSON file' }
    const text = await fs.readText(target)
    try {
      const config = JSON.parse(text)
      if (!config || typeof config !== 'object' || Array.isArray(config)) {
        return { status: 'error', error: 'hooks JSON must contain an object' }
      }
      return { status: 'ok', config, source: relativePath, pluginRoot: root.displayPath }
    } catch (e) {
      return { status: 'error', error: 'hooks JSON is invalid: ' + errorMessage(e) }
    }
  }

  /**
   * @param {string} marketDir
   * @param {string} pluginDir
   * @param {PluginMeta} meta
   * @returns {Promise<CodexHookInspectResult>}
   */
  async function inspectCodexHooks(marketDir, pluginDir, meta) {
    const codexHooks = meta.codexHooks
    if (!codexHooks) return { found: false, declared: false, configs: [], error: null }
    const marketTarget = await fs.resolve(marketDir)
    const pluginTarget = await fs.resolve(pluginDir)
    if (!fs.contains(marketTarget, pluginTarget)) {
      return { found: false, declared: codexHooks.declared, configs: [], error: 'plugin source escapes the market root' }
    }
    if (codexHooks.errors.length) {
      return { found: false, declared: codexHooks.declared, configs: [], error: codexHooks.errors.join('; ') }
    }

    /** @type {CodexHookConfigEntry[]} */
    const configs = []
    let pluginRoot = ''
    for (const source of codexHooks.sources) {
      if (source.kind === 'inline') {
        configs.push({ source: 'inline', config: source.config })
        continue
      }
      const file = await readPluginHookFile(pluginDir, source.path)
      if (file.status === 'missing') {
        if (!codexHooks.declared) continue
        return { found: false, declared: true, configs: [], error: 'declared hooks file is missing: ' + source.path }
      }
      if (file.status === 'error') return { found: false, declared: codexHooks.declared, configs: [], error: file.error }
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

  /**
   * @param {CodexHookInspectResult} hookInfo
   * @returns {hookInfo is MountableCodexHookInfo}
   */
  function isMountableHookInfo(hookInfo) {
    return hookInfo.found === true && typeof hookInfo.fingerprint === 'string' && typeof hookInfo.pluginRoot === 'string'
  }

  /**
   * @param {MarketConfig} cfg
   * @param {InstalledPlugin} inst
   * @returns {Promise<{suspended: boolean, hookInfo: MountableCodexHookInfo | null}>}
   */
  async function inspectInstalledHookInfo(cfg, inst) {
    const market = cfg.markets.find((m) => m.id === inst.marketId)
    if (!market) return { suspended: false, hookInfo: null }
    if (suspendedHookMarkets.has(market.id)) return { suspended: true, hookInfo: null }
    const marketDir = marketsDir + '/' + market.id
    const mp = await runtime.parseMarketplace(marketDir, market.repo)
    const entry = mp && mp.plugins.find((item) => item.name === inst.pluginName)
    if (!entry || entry.unsupported) return { suspended: false, hookInfo: null }
    const pluginDir = await runtime.resolveDirectoryWithin(marketDir, entry.source)
    if (!pluginDir) return { suspended: false, hookInfo: null }
    const hookInfo = await inspectCodexHooks(marketDir, pluginDir, await runtime.readPluginMeta(pluginDir, entry))
    return { suspended: false, hookInfo: isMountableHookInfo(hookInfo) ? hookInfo : null }
  }

  /** @param {MarketConfig} cfg */
  async function approvedHookConfigs(cfg) {
    let next = cfg
    /** @type {Map<string, MountableCodexHookInfo>} */
    const desired = new Map()
    for (const [key, approval] of Object.entries(cfg.hookApprovals)) {
      const inst = cfg.installed[key]
      const remove = () => {
        if (next === cfg) next = { ...cfg, hookApprovals: { ...cfg.hookApprovals } }
        delete next.hookApprovals[key]
        hookRuntimeErrors.delete(key)
      }
      if (!approval || typeof approval !== 'object' || typeof approval.fingerprint !== 'string' || !inst || typeof inst !== 'object') {
        remove()
        continue
      }
      const current = await inspectInstalledHookInfo(cfg, inst)
      if (current.suspended) continue
      if (!current.hookInfo) {
        remove()
        continue
      }
      if (hookApprovalState(current.hookInfo, approval).approved) desired.set(key, current.hookInfo)
      else hookRuntimeErrors.delete(key)
    }
    if (next !== cfg) await runtime.saveConfig(next)
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
      console.error('[agent-plugin-market] hook disposal failed for ' + key + ': ' + errorMessage(e))
    })))
  }

  /**
   * @param {string} key
   * @param {MountableCodexHookInfo} hookInfo
   */
  async function mountHookFibers(key, hookInfo) {
    if (!bridge) return
    await disposeHookFibers(key)
    const storageKey = hookStorageKey(key)
    const pluginData = hookDataDir + '/' + storageKey
    await runtime.ensureDir(generatedHooksDir)
    await runtime.ensureDir(pluginData)

    /** @type {ActiveCodexHookRecord['fibers']} */
    const fibers = []
    try {
      for (let index = 0; index < hookInfo.configs.length; index++) {
        const generatedPath = generatedHooksDir + '/' + storageKey + '-' + index + '.json'
        const generatedTarget = await fs.resolve(generatedPath)
        const config = withPluginHookEnvironment(hookInfo.configs[index].config, {
          pluginRoot: hookInfo.pluginRoot,
          pluginData,
        })
        await fs.writeText(generatedTarget, JSON.stringify(config, null, 2), undefined, undefined, {
          mode: 'workspace-write',
          workspaceRoot: generatedHooksDir,
        })
        if (hooksDisposed) throw new Error('hook manager is stopping')
        const fiber = ctx.plugin(bridge, { configPath: generatedTarget.displayPath })
        await fiber
        fibers.push(fiber)
      }
      hookFibers.set(key, { fingerprint: hookInfo.fingerprint, fibers })
      hookRuntimeErrors.delete(key)
    } catch (e) {
      await Promise.all(fibers.map((fiber) => Promise.resolve().then(() => fiber.dispose()).catch(() => {})))
      hookRuntimeErrors.set(key, errorMessage(e))
    }
  }

  /**
   * Dispose changed or removed mounts first, then mount new or changed desired hooks.
   *
   * @param {Map<string, MountableCodexHookInfo>} desired
   * @param {Map<string, ActiveCodexHookRecord>} active
   */
  function planReconciliation(desired, active) {
    /** @type {string[]} */
    const disposeKeys = []
    /** @type {Array<{key: string, hookInfo: MountableCodexHookInfo}>} */
    const mounts = []
    for (const [key, activeHook] of active) {
      const desiredHook = desired.get(key)
      if (!desiredHook || desiredHook.fingerprint !== activeHook.fingerprint) disposeKeys.push(key)
    }
    for (const [key, desiredHook] of desired) {
      const activeHook = active.get(key)
      if (!activeHook || desiredHook.fingerprint !== activeHook.fingerprint) mounts.push({ key, hookInfo: desiredHook })
    }
    return { disposeKeys, mounts }
  }

  async function reconcileNow() {
    if (hooksDisposed) return
    const desired = await approvedHookConfigs(await runtime.loadConfig())
    if (!bridge) {
      await Promise.all([...hookFibers.keys()].map(disposeHookFibers))
      return
    }
    const plan = planReconciliation(desired, hookFibers)
    for (const key of plan.disposeKeys) await disposeHookFibers(key)
    for (const { key, hookInfo } of plan.mounts) await mountHookFibers(key, hookInfo)
  }

  function reconcile() {
    hookReconcile = hookReconcile.catch(() => {}).then(reconcileNow)
    return hookReconcile
  }

  function start() {
    ctx.effect(() => {
      reconcile().catch((e) => console.error('[agent-plugin-market] initial hook registration failed: ' + errorMessage(e)))
      return async () => {
        hooksDisposed = true
        await Promise.all([...hookFibers.keys()].map(disposeHookFibers))
      }
    })
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

  return {
    available: !!bridge,
    start,
    reconcile,
    inspectCodexHooks,
    disposeHookFibers,
    suspendMarket,
    resumeMarket,
    isActive,
    runtimeError,
    clearRuntimeError,
  }
}
