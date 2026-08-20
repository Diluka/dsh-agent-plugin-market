// dsh-agent-plugin-market —— Host 半端（静态 cordis 插件形态）
// 供 `dsh plugin --profile web add github:Diluka/dsh-agent-plugin-market` 安装；
// 与动态版（会话内 cordis_define）逻辑同源。RPC 通过 ctx.webServer 提供
// HTTP 路由（POST /agent-plugin-market/api/<name>），Client 用 fetch 调用。

import * as codexHooks from '@deepseek-ai/dsh-hooks-codex'
import { codexHookSources, hookFingerprint, hookStorageKey, isPluginRelativePath, withPluginHookEnvironment } from './codex-hooks.js'

export const inject = ['skills', 'fs', 'settings', 'subprocess']

export async function apply(ctx) {
  const { skills, fs, settings, subprocess } = ctx
  const webServer = ctx.get('webServer')

  // ---------- 基础路径：从 settings 文档路径推导 DSH home ----------
  const docPath = await settings.prepareDocument()
  const sepIdx = Math.max(docPath.lastIndexOf('/'), docPath.lastIndexOf('\\'))
  const dshHome = sepIdx > 0 ? docPath.slice(0, sepIdx) : docPath
  const baseDir = dshHome + '/agent-plugin-market'
  const marketsDir = baseDir + '/markets'
  const configPath = baseDir + '/config.json'
  const generatedHooksDir = baseDir + '/generated-hooks'
  const hookDataDir = baseDir + '/hook-data'

  // ---------- 子进程 ----------
  async function runProc(argv, cwd) {
    const handle = subprocess.spawn({
      argv,
      cwd,
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: 2 * 1024 * 1024 },
        stderr: { maxBytes: 2 * 1024 * 1024 },
      },
      graceMs: 30000,
      env: {
        GIT_TERMINAL_PROMPT: '0',
        GIT_SSH_COMMAND: 'ssh -o BatchMode=yes -o ConnectTimeout=15',
      },
    })
    const outcome = await handle.done
    const out = handle.collected.stdout ? handle.collected.stdout.readFrom(0).text : ''
    const err = handle.collected.stderr ? handle.collected.stderr.readFrom(0).text : ''
    if (outcome.exitCode !== 0) {
      throw new Error((err || out || 'process failed').trim().slice(0, 600))
    }
    return out
  }
  async function ensureDir(dir) {
    await runProc(['mkdir', '-p', dir], dshHome)
  }
  await ensureDir(baseDir)
  await ensureDir(marketsDir)

  // ---------- 文件辅助 ----------
  async function readTextIfExists(path) {
    const target = await fs.resolve(path)
    const info = await fs.stat(target)
    if (!info) return null
    return await fs.readText(target)
  }
  async function readJsonFile(path) {
    const text = await readTextIfExists(path)
    if (text === null) return null
    try { return JSON.parse(text) } catch (e) { return null }
  }
  async function listDirEntries(dir) {
    const target = await fs.resolve(dir)
    const info = await fs.stat(target)
    if (!info) return []
    try { return await fs.listDir(target) } catch (e) { return [] }
  }
  async function resolvePathWithin(parentDir, childPath) {
    const parent = await fs.resolve(parentDir)
    const child = await fs.resolve(parentDir + '/' + String(childPath || ''))
    return fs.contains(parent, child) ? child.displayPath : null
  }
  async function resolveDirectoryWithin(parentDir, childPath) {
    const childPathResolved = await resolvePathWithin(parentDir, childPath)
    if (!childPathResolved) return null
    const child = await fs.resolve(childPathResolved)
    const info = await fs.stat(child)
    return info && info.type === 'directory' ? child.displayPath : null
  }

  // ---------- 配置 ----------
  async function loadConfig() {
    const text = await readTextIfExists(configPath)
    if (text === null) return { markets: [], installed: {}, disabledSkills: {}, hookApprovals: {} }
    try {
      const cfg = JSON.parse(text)
      return {
        markets: Array.isArray(cfg.markets) ? cfg.markets : [],
        installed: cfg.installed && typeof cfg.installed === 'object' ? cfg.installed : {},
        disabledSkills: cfg.disabledSkills && typeof cfg.disabledSkills === 'object' ? cfg.disabledSkills : {},
        hookApprovals: cfg.hookApprovals && typeof cfg.hookApprovals === 'object' ? cfg.hookApprovals : {},
      }
    } catch (e) {
      return { markets: [], installed: {}, disabledSkills: {}, hookApprovals: {} }
    }
  }
  async function saveConfig(cfg) {
    const target = await fs.resolve(configPath)
    await fs.writeText(target, JSON.stringify(cfg, null, 2))
  }

  // ---------- 市场 / 插件清单解析（兼容 Codex/Claude） ----------
  const MARKET_MANIFESTS = ['.agents/plugins/marketplace.json', '.claude-plugin/marketplace.json', '.cursor-plugin/marketplace.json', 'marketplace.json']
  const PLUGIN_MANIFESTS = [
    { path: '.codex-plugin/plugin.json', kind: 'codex' },
    { path: '.claude-plugin/plugin.json', kind: 'claude' },
    { path: 'plugin.json', kind: 'generic' },
  ]

  function normalizePluginEntry(entry) {
    if (!entry || typeof entry !== 'object') return null
    const name = String(entry.name || '').trim()
    if (!name) return null
    if (typeof entry.source === 'string' && entry.source.trim()) {
      return { name, source: entry.source.trim(), unsupported: false }
    }
    if (entry.source && typeof entry.source === 'object') {
      const s = entry.source
      if (s.source === 'local' && typeof s.path === 'string' && s.path.trim()) {
        return { name, source: s.path.trim(), unsupported: false }
      }
      return { name, source: '', unsupported: true, sourceType: String(s.source || 'unknown') }
    }
    return { name, source: '', unsupported: false }
  }

  async function parseMarketplace(marketDir) {
    for (const rel of MARKET_MANIFESTS) {
      const manifest = await readJsonFile(marketDir + '/' + rel)
      if (manifest && Array.isArray(manifest.plugins)) {
        return {
          name: String(manifest.name || ''),
          plugins: manifest.plugins.map(normalizePluginEntry).filter(Boolean),
        }
      }
    }
    return null
  }

  async function readPluginMeta(pluginDir, fallbackName) {
    for (const candidate of PLUGIN_MANIFESTS) {
      const manifest = await readJsonFile(pluginDir + '/' + candidate.path)
      if (!manifest || typeof manifest !== 'object') continue
      let skillsRel = 'skills'
      if (typeof manifest.skills === 'string' && manifest.skills.trim()) {
        skillsRel = manifest.skills.trim()
      } else if (manifest.skills && typeof manifest.skills === 'object') {
        const paths = manifest.skills.paths
        if (typeof paths === 'string' && paths.trim()) skillsRel = paths.trim()
        else if (Array.isArray(paths) && typeof paths[0] === 'string' && paths[0].trim()) skillsRel = paths[0].trim()
      }
      const iface = manifest.interface && typeof manifest.interface === 'object' ? manifest.interface : {}
      const name = String(manifest.name || '').trim() || fallbackName || ''
      return {
        title: String(iface.displayName || name || fallbackName || ''),
        description: String(manifest.description || iface.short_description || iface.shortDescription || ''),
        skillsRel,
        version: typeof manifest.version === 'string' ? manifest.version : '',
        codexHooks: candidate.kind === 'codex' ? codexHookSources(manifest) : null,
      }
    }
    return { title: fallbackName || '', description: '', skillsRel: 'skills', version: '', codexHooks: null }
  }

  // ---------- SKILL.md 解析（极简 YAML frontmatter） ----------
  function parseScalar(raw) {
    const v = raw.trim()
    if (v.length >= 2 && ((v[0] === '"' && v[v.length - 1] === '"') || (v[0] === "'" && v[v.length - 1] === "'"))) return v.slice(1, -1)
    if (v === 'true') return true
    if (v === 'false') return false
    if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v)
    return v
  }
  function parseSkillDoc(text) {
    const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text)
    if (!m) return null
    const data = {}
    let blockKey = null
    let blockLines = []
    const flush = () => {
      if (blockKey !== null) {
        data[blockKey] = blockLines.join('\n').trim()
        blockKey = null
        blockLines = []
      }
    }
    for (const line of m[1].split(/\r?\n/)) {
      if (blockKey !== null) {
        if (line === '' || /^\s/.test(line)) {
          blockLines.push(line.replace(/^[ \t]+/, ''))
          continue
        }
        flush()
      }
      const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
      if (!kv) continue
      const raw = kv[2].trim()
      if (raw === '|' || raw === '>' || raw === '|-' || raw === '>-') {
        blockKey = kv[1]
        continue
      }
      data[kv[1]] = parseScalar(raw)
    }
    flush()
    const content = text.slice(m[0].length).replace(/^\s*\r?\n/, '')
    return { data, content }
  }
  async function readSkillFile(path) {
    const text = await readTextIfExists(path)
    if (text === null) return null
    return parseSkillDoc(text)
  }

  const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
  function finalizeSkill(item, marketId, pluginName) {
    const name = String(item.doc.data.name || '').trim()
    if (!SKILL_NAME_RE.test(name)) return null
    const description = String(item.doc.data.description || '').trim()
    if (!description) return null
    const whenToUse = item.doc.data.whenToUse !== undefined ? item.doc.data.whenToUse : item.doc.data.when_to_use
    return {
      skillName: name,
      description,
      whenToUse: typeof whenToUse === 'string' && whenToUse.trim() ? whenToUse.trim() : null,
      fullName: marketId + '/' + pluginName + '/' + name,
      path: item.skillPath,
      resourceDir: item.skillDir,
    }
  }

  async function scanSkillsInDir(skillsDir) {
    const out = []
    const entries = await listDirEntries(skillsDir)
    for (const entry of entries) {
      if (entry.type === 'directory') {
        const doc = await readSkillFile(entry.target.displayPath + '/SKILL.md')
        if (doc) out.push({ doc, skillDir: entry.target.displayPath, skillPath: entry.target.displayPath + '/SKILL.md' })
      } else if (entry.type === 'file' && /\.md$/i.test(entry.name)) {
        const doc = await readSkillFile(entry.target.displayPath)
        if (doc) out.push({ doc, skillDir: skillsDir, skillPath: entry.target.displayPath })
      }
    }
    return out
  }

  async function scanInstalledPluginSkills(cfg, market, entry) {
    const marketDir = marketsDir + '/' + market.id
    const pluginDir = await resolveDirectoryWithin(marketDir, entry.source)
    if (!pluginDir) return []
    const meta = await readPluginMeta(pluginDir, entry.name)
    const skillsDir = await resolvePathWithin(pluginDir, meta.skillsRel)
    if (!skillsDir) return []
    const items = await scanSkillsInDir(skillsDir)
    const result = []
    for (const item of items) {
      const sk = finalizeSkill(item, market.id, entry.name)
      if (!sk) continue
      if (cfg.disabledSkills && cfg.disabledSkills[sk.fullName]) continue
      result.push(sk)
    }
    return result
  }

  async function collectSkills() {
    const cfg = await loadConfig()
    const result = []
    for (const key of Object.keys(cfg.installed)) {
      const inst = cfg.installed[key]
      if (!inst || typeof inst !== 'object') continue
      const market = cfg.markets.find((m) => m.id === inst.marketId)
      if (!market) continue
      const mp = await parseMarketplace(marketsDir + '/' + market.id)
      if (!mp) continue
      const entry = mp.plugins.find((p) => p.name === inst.pluginName)
      if (!entry || entry.unsupported) continue
      result.push(...await scanInstalledPluginSkills(cfg, market, entry))
    }
    return result
  }

  // ---------- Codex hooks: discovery, approval, and scoped bridge fibers ----------
  function marketPluginKey(marketId, pluginName) {
    return marketId + '/' + pluginName
  }

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

  async function inspectCodexHooks(marketDir, pluginDir, meta) {
    if (!meta.codexHooks) return { found: false, declared: false, configs: [], error: null }
    const marketTarget = await fs.resolve(marketDir)
    const pluginTarget = await fs.resolve(pluginDir)
    if (!fs.contains(marketTarget, pluginTarget)) {
      return { found: false, declared: meta.codexHooks.declared, configs: [], error: 'plugin source escapes the market root' }
    }
    if (meta.codexHooks.errors.length) {
      return { found: false, declared: meta.codexHooks.declared, configs: [], error: meta.codexHooks.errors.join('; ') }
    }

    const configs = []
    let pluginRoot = ''
    for (const source of meta.codexHooks.sources) {
      if (source.kind === 'inline') {
        configs.push({ source: 'inline', config: source.config })
        continue
      }
      const file = await readPluginHookFile(pluginDir, source.path)
      if (file.missing && !meta.codexHooks.declared) continue
      if (file.missing) {
        return { found: false, declared: true, configs: [], error: 'declared hooks file is missing: ' + source.path }
      }
      if (file.error) return { found: false, declared: meta.codexHooks.declared, configs: [], error: file.error }
      pluginRoot = file.pluginRoot
      configs.push({ source: file.source, config: file.config })
    }

    if (!configs.length) {
      return {
        found: false,
        declared: meta.codexHooks.declared,
        configs: [],
        error: meta.codexHooks.declared ? 'manifest declares no usable hooks configuration' : null,
      }
    }

    if (!pluginRoot) pluginRoot = pluginTarget.displayPath
    const fingerprint = hookFingerprint({
      sources: configs.map((item) => ({ source: item.source, config: item.config })),
    })
    return { found: true, declared: meta.codexHooks.declared, configs, fingerprint, pluginRoot, error: null }
  }

  const hookFibers = new Map()
  const hookRuntimeErrors = new Map()
  const suspendedHookMarkets = new Set()
  let hookReconcile = Promise.resolve()
  let hooksDisposed = false

  async function approvedHookConfigs(cfg) {
    const desired = new Map()
    for (const inst of Object.values(cfg.installed)) {
      if (!inst || typeof inst !== 'object') continue
      const market = cfg.markets.find((m) => m.id === inst.marketId)
      if (!market || suspendedHookMarkets.has(market.id)) continue
      const mp = await parseMarketplace(marketsDir + '/' + market.id)
      const entry = mp && mp.plugins.find((item) => item.name === inst.pluginName)
      if (!entry || entry.unsupported) continue
      const key = marketPluginKey(market.id, entry.name)
      const marketDir = marketsDir + '/' + market.id
      const pluginDir = await resolveDirectoryWithin(marketDir, entry.source)
      if (!pluginDir) continue
      const hookInfo = await inspectCodexHooks(marketDir, pluginDir, await readPluginMeta(pluginDir, entry.name))
      const approval = cfg.hookApprovals[key]
      if (!hookInfo.found || !approval || approval.fingerprint !== hookInfo.fingerprint) continue
      desired.set(key, hookInfo)
    }
    return desired
  }

  async function disposeHookFibers(key) {
    const active = hookFibers.get(key)
    if (!active) return
    hookFibers.delete(key)
    await Promise.all(active.fibers.map((fiber) => fiber.dispose().catch((e) => {
      console.error('[agent-plugin-market] hook disposal failed for ' + key + ': ' + String((e && e.message) || e))
    })))
  }

  async function mountHookFibers(key, hookInfo) {
    const storageKey = hookStorageKey(key)
    const pluginData = hookDataDir + '/' + storageKey
    await ensureDir(generatedHooksDir)
    await ensureDir(pluginData)

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
        const fiber = ctx.plugin(codexHooks, { configPath: generatedTarget.displayPath })
        await fiber
        fibers.push(fiber)
      }
      hookFibers.set(key, { fingerprint: hookInfo.fingerprint, fibers })
      hookRuntimeErrors.delete(key)
    } catch (e) {
      await Promise.all(fibers.map((fiber) => fiber.dispose().catch(() => {})))
      hookRuntimeErrors.set(key, String((e && e.message) || e))
    }
  }

  async function reconcileCodexHooksNow() {
    if (hooksDisposed) return
    const cfg = await loadConfig()
    const desired = await approvedHookConfigs(cfg)
    for (const [key, active] of hookFibers) {
      const next = desired.get(key)
      if (!next || next.fingerprint !== active.fingerprint) await disposeHookFibers(key)
    }
    for (const [key, hookInfo] of desired) {
      const active = hookFibers.get(key)
      if (active && active.fingerprint === hookInfo.fingerprint) continue
      await mountHookFibers(key, hookInfo)
    }
  }

  function reconcileCodexHooks() {
    hookReconcile = hookReconcile.catch(() => {}).then(reconcileCodexHooksNow)
    return hookReconcile
  }

  ctx.effect(() => {
    reconcileCodexHooks().catch((e) => console.error('[agent-plugin-market] initial hook registration failed: ' + String((e && e.message) || e)))
    return async () => {
      hooksDisposed = true
      await Promise.all([...hookFibers.keys()].map(disposeHookFibers))
    }
  })

  // ---------- 技能 provider ----------
  let invalidate = () => {}
  ctx.effect(() => skills.registerProvider((control) => {
    invalidate = () => { try { control.invalidate() } catch (e) {} }
    return {
      name: 'agent-plugin-market',
      async list() {
        const out = []
        for (const sk of await collectSkills()) {
          out.push({
            name: sk.skillName,
            description: sk.description,
            ...(sk.whenToUse ? { whenToUse: sk.whenToUse } : {}),
            invocation: { modelInvocable: true, userInvocable: true },
            source: 'custom',
            provider: 'agent-plugin-market',
            rank: 800,
            locator: { path: sk.path },
            resourceBase: { kind: 'directory', path: sk.resourceDir },
            path: sk.path,
          })
        }
        return out
      },
      async get(candidate) {
        const doc = await readSkillFile(candidate.locator.path)
        if (!doc) return undefined
        return {
          name: candidate.name,
          description: candidate.description,
          ...(candidate.whenToUse ? { whenToUse: candidate.whenToUse } : {}),
          invocation: candidate.invocation,
          source: candidate.source,
          provider: candidate.provider,
          resourceBase: candidate.resourceBase,
          path: candidate.path,
          content: doc.content,
        }
      },
    }
  }))

  // ---------- 业务操作 ----------
  async function addMarket(args) {
    const repo = String(args.repo || '').trim()
    if (!repo) throw new Error('仓库地址不能为空')
    const refType = ['branch', 'tag', 'commit'].includes(args.refType) ? args.refType : 'default'
    const ref = String(args.ref || '').trim()
    if (refType !== 'default' && !ref) {
      throw new Error(refType === 'branch' ? '请填写分支名' : refType === 'tag' ? '请填写标签名' : '请填写 commit id')
    }
    await ensureDir(marketsDir)
    const slug = repo.replace(/\.git$/, '').split(/[\/:]/).filter(Boolean).pop() || 'market'
    const id = slug.replace(/[^A-Za-z0-9._-]/g, '-') + '-' + Math.random().toString(36).slice(2, 6)
    try {
      if (refType === 'default') {
        await runProc(['git', 'clone', '--depth', '1', repo, id], marketsDir)
      } else if (refType === 'branch') {
        await runProc(['git', 'clone', '--depth', '1', '--branch', ref, repo, id], marketsDir)
      } else if (refType === 'tag') {
        await runProc(['git', 'clone', '--depth', '1', '--branch', ref, repo, id], marketsDir)
      } else {
        await runProc(['git', 'clone', repo, id], marketsDir)
        await runProc(['git', '-C', id, 'checkout', ref], marketsDir)
      }
    } catch (e) {
      await runProc(['rm', '-rf', id], marketsDir).catch(() => {})
      throw e
    }
    const mp = await parseMarketplace(marketsDir + '/' + id)
    if (!mp) {
      await runProc(['rm', '-rf', id], marketsDir).catch(() => {})
      throw new Error('未在仓库中找到 marketplace.json（查找 .agents/plugins/、.claude-plugin/、.cursor-plugin/ 或仓库根）')
    }
    const cfg = await loadConfig()
    const entry = { id, name: mp.name || slug, repo, addedAt: Date.now() }
    if (refType !== 'default') {
      entry.refType = refType
      entry.ref = ref
    }
    cfg.markets.push(entry)
    await saveConfig(cfg)
    await reconcileCodexHooks()
    invalidate()
    return { id, name: mp.name || slug, repo, refType, ref: refType !== 'default' ? ref : null }
  }

  async function revokeMarketHookApprovals(marketId) {
    const cfg = await loadConfig()
    let changed = false
    for (const key of Object.keys(cfg.hookApprovals)) {
      if (!key.startsWith(marketId + '/')) continue
      delete cfg.hookApprovals[key]
      changed = true
    }
    if (changed) await saveConfig(cfg)
  }

  // Pulling a mutable market revokes hook trust if any repository content changed.
  async function pullMarket(market) {
    const dir = marketsDir + '/' + market.id
    if (market.refType === 'tag' || market.refType === 'commit') {
      return { skipped: true, reason: '固定引用（' + market.refType + '），无需更新' }
    }

    let resumeHooks = true
    suspendedHookMarkets.add(market.id)
    try {
      await reconcileCodexHooks()
      const before = (await runProc(['git', '-C', dir, 'rev-parse', 'HEAD'], marketsDir)).trim()
      await runProc(['git', '-C', dir, 'pull', '--ff-only'], marketsDir)
      const after = (await runProc(['git', '-C', dir, 'rev-parse', 'HEAD'], marketsDir)).trim()
      const updated = before !== after
      if (updated) await revokeMarketHookApprovals(market.id)
      return { updated }
    } catch (e) {
      try {
        await revokeMarketHookApprovals(market.id)
      } catch (revokeError) {
        resumeHooks = false
        console.error('[agent-plugin-market] keeping hooks suspended after failed pull for ' + market.id + ': ' + String((revokeError && revokeError.message) || revokeError))
      }
      throw e
    } finally {
      if (resumeHooks) {
        suspendedHookMarkets.delete(market.id)
        await reconcileCodexHooks()
      }
    }
  }

  async function updateMarket(args) {
    const cfg = await loadConfig()
    const market = cfg.markets.find((m) => m.id === String(args.marketId || ''))
    if (!market) throw new Error('市场不存在: ' + args.marketId)
    const result = await pullMarket(market)
    await reconcileCodexHooks()
    invalidate()
    return result
  }

  async function removeMarket(args) {
    const cfg = await loadConfig()
    const id = String(args.marketId || '')
    const market = cfg.markets.find((m) => m.id === id)
    if (!market) throw new Error('市场不存在: ' + id)
    cfg.markets = cfg.markets.filter((m) => m.id !== id)
    for (const key of Object.keys(cfg.installed)) {
      if (cfg.installed[key] && cfg.installed[key].marketId === id) delete cfg.installed[key]
    }
    for (const key of Object.keys(cfg.disabledSkills)) {
      if (key.startsWith(id + '/')) delete cfg.disabledSkills[key]
    }
    for (const key of Object.keys(cfg.hookApprovals)) {
      if (key.startsWith(id + '/')) delete cfg.hookApprovals[key]
    }
    await saveConfig(cfg)
    await reconcileCodexHooks()
    await runProc(['rm', '-rf', marketsDir + '/' + id], marketsDir).catch(() => {})
    invalidate()
    return { removed: true }
  }

  async function installPlugin(args) {
    const marketId = String(args.marketId || '')
    const pluginName = String(args.pluginName || '')
    if (!marketId || !pluginName) throw new Error('缺少市场或插件标识')
    const cfg = await loadConfig()
    const key = marketPluginKey(marketId, pluginName)
    if (!cfg.installed[key]) cfg.installed[key] = { marketId, pluginName, installedAt: Date.now() }
    await saveConfig(cfg)
    await reconcileCodexHooks()
    invalidate()
    return { installed: true }
  }

  async function uninstallPlugin(args) {
    const marketId = String(args.marketId || '')
    const pluginName = String(args.pluginName || '')
    const cfg = await loadConfig()
    const key = marketPluginKey(marketId, pluginName)
    delete cfg.installed[key]
    delete cfg.hookApprovals[key]
    for (const sk of Object.keys(cfg.disabledSkills)) {
      if (sk.startsWith(key + '/')) delete cfg.disabledSkills[sk]
    }
    await saveConfig(cfg)
    await reconcileCodexHooks()
    invalidate()
    return { removed: true }
  }

  async function setSkillEnabled(args) {
    const fullName = String(args.fullName || '')
    const enabled = !!args.enabled
    if (!fullName) throw new Error('缺少技能标识')
    const cfg = await loadConfig()
    if (enabled) delete cfg.disabledSkills[fullName]
    else cfg.disabledSkills[fullName] = true
    await saveConfig(cfg)
    invalidate()
    return { fullName, enabled }
  }

  async function setPluginHooksEnabled(args) {
    const marketId = String(args.marketId || '')
    const pluginName = String(args.pluginName || '')
    const enabled = !!args.enabled
    const key = marketPluginKey(marketId, pluginName)
    const cfg = await loadConfig()

    if (!enabled) {
      delete cfg.hookApprovals[key]
      hookRuntimeErrors.delete(key)
      await saveConfig(cfg)
      await reconcileCodexHooks()
      invalidate()
      return { key, enabled: false, active: false }
    }

    if (!cfg.installed[key]) throw new Error('请先安装插件再启用 hooks')
    const market = cfg.markets.find((item) => item.id === marketId)
    if (!market) throw new Error('市场不存在: ' + marketId)
    const marketplace = await parseMarketplace(marketsDir + '/' + marketId)
    const entry = marketplace && marketplace.plugins.find((item) => item.name === pluginName)
    if (!entry || entry.unsupported) throw new Error('插件不存在或来源不受支持')
    const marketDir = marketsDir + '/' + marketId
    const pluginDir = await resolveDirectoryWithin(marketDir, entry.source)
    if (!pluginDir) throw new Error('插件路径不在市场目录中')
    const hookInfo = await inspectCodexHooks(marketDir, pluginDir, await readPluginMeta(pluginDir, pluginName))
    if (!hookInfo.found) throw new Error(hookInfo.error || '未发现可用的 Codex hooks 配置')

    cfg.hookApprovals[key] = { fingerprint: hookInfo.fingerprint, approvedAt: Date.now() }
    await saveConfig(cfg)
    await reconcileCodexHooks()
    invalidate()
    return { key, enabled: true, active: hookFibers.has(key), error: hookRuntimeErrors.get(key) || null }
  }

  async function getState() {
    await reconcileCodexHooks()
    const cfg = await loadConfig()
    const markets = []
    for (const market of cfg.markets) {
      const marketDir = marketsDir + '/' + market.id
      const mp = await parseMarketplace(marketDir)
      const plugins = []
      if (mp) {
        for (const entry of mp.plugins) {
          const view = {
            name: entry.name,
            installed: !!(cfg.installed[market.id + '/' + entry.name]),
            unsupported: entry.unsupported || false,
            sourceType: entry.sourceType || 'local',
            title: entry.name,
            description: '',
            version: '',
            error: null,
            skills: [],
            hooks: null,
          }
          if (!entry.unsupported) {
            try {
              const pluginDir = await resolveDirectoryWithin(marketDir, entry.source)
               if (!pluginDir) throw new Error('插件路径不在市场目录中')
              const meta = await readPluginMeta(pluginDir, entry.name)
              view.title = meta.title || entry.name
              view.description = meta.description
              view.version = meta.version
               if (meta.codexHooks) {
                 const hookInfo = await inspectCodexHooks(marketDir, pluginDir, meta)
                 const key = marketPluginKey(market.id, entry.name)
                 const approval = cfg.hookApprovals[key]
                 view.hooks = {
                   found: hookInfo.found,
                   count: hookInfo.configs.length,
                   enabled: !!(hookInfo.found && approval && approval.fingerprint === hookInfo.fingerprint),
                   active: hookFibers.has(key),
                   needsApproval: !!(hookInfo.found && approval && approval.fingerprint !== hookInfo.fingerprint),
                   error: hookInfo.error || hookRuntimeErrors.get(key) || null,
                 }
               }
              const skillsDir = await resolvePathWithin(pluginDir, meta.skillsRel)
               if (!skillsDir) throw new Error('技能目录不在插件目录中')
               const items = await scanSkillsInDir(skillsDir)
              for (const item of items) {
                const sk = finalizeSkill(item, market.id, entry.name)
                if (!sk) continue
                view.skills.push({
                  name: sk.skillName,
                  fullName: sk.fullName,
                  description: sk.description,
                  whenToUse: sk.whenToUse,
                  enabled: !(cfg.disabledSkills && cfg.disabledSkills[sk.fullName]),
                })
              }
            } catch (e) {
              view.error = String((e && e.message) || e)
            }
          }
          plugins.push(view)
        }
      }
      markets.push({ id: market.id, name: market.name, repo: market.repo, refType: market.refType || 'default', ref: market.ref || null, manifestFound: !!mp, plugins })
    }
    return { markets }
  }

  // ---------- 启动时自动更新所有市场（容错，不阻塞启动） ----------
  ctx.effect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const cfg = await loadConfig()
        for (const market of cfg.markets) {
          if (cancelled) break
          try {
            const r = await pullMarket(market)
            console.log('[agent-plugin-market] auto update ' + market.id + ': ' + (r.skipped ? r.reason : 'ok'))
          } catch (e) {
            console.error('[agent-plugin-market] auto update failed for ' + market.id + ': ' + String((e && e.message) || e))
          }
        }
        if (!cancelled) {
          await reconcileCodexHooks()
          invalidate()
        }
      } catch (e) {
        console.error('[agent-plugin-market] auto update error: ' + String((e && e.message) || e))
      }
    })()
    return () => { cancelled = true }
  })

  // ---------- 私有 RPC：webServer 路由（POST /agent-plugin-market/api/<name>，JSON in/out）----------
  function registerRoute(name, handler) {
    if (!webServer) return
    webServer.register({
      kind: 'exact',
      path: '/agent-plugin-market/api/' + name,
      handler: async (req, res) => {
        let body = ''
        try {
          for await (const chunk of req) body += chunk
        } catch (e) { /* 忽略读流错误 */ }
        let args = {}
        try { args = body ? JSON.parse(body) : {} } catch (e) { args = {} }
        let result
        try {
          result = await handler(args)
        } catch (e) {
          result = { ok: false, error: String(e && e.message || e).slice(0, 600) }
        }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify(result))
      },
    })
  }

  registerRoute('get-state', async () => ({ ok: true, data: await getState() }))
  registerRoute('add-market', async (args) => ({ ok: true, data: await addMarket(args) }))
  registerRoute('update-market', async (args) => ({ ok: true, data: await updateMarket(args) }))
  registerRoute('remove-market', async (args) => ({ ok: true, data: await removeMarket(args) }))
  registerRoute('install-plugin', async (args) => ({ ok: true, data: await installPlugin(args) }))
  registerRoute('uninstall-plugin', async (args) => ({ ok: true, data: await uninstallPlugin(args) }))
  registerRoute('set-skill-enabled', async (args) => ({ ok: true, data: await setSkillEnabled(args) }))
  registerRoute('set-plugin-hooks-enabled', async (args) => ({ ok: true, data: await setPluginHooksEnabled(args) }))
}
