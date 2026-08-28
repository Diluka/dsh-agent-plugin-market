/// <reference path="../types/host.d.ts" />
import { codexHookSources } from './codex-hooks.js'
import {
  emptyWorkspaceConfig,
  normalizeWorkspaceConfig,
  pluginSkillEnabled,
  standaloneSkillEnabled,
  workspaceOverride,
} from './market-config.js'

/** @typedef {{doc: SkillDocument, skillPath: string, skillDir: string}} SkillDocumentItem */
/** @typedef {{name?: string, description?: string}} PluginMetaFallback */
/** @typedef {Record<string, string | number | boolean>} SkillFrontMatter */

/**
 * Builds the stable configuration key for one market plugin.
 *
 * @param {string} marketId
 * @param {string} pluginName
 */
export function marketPluginKey(marketId, pluginName) {
  return marketId + '/' + pluginName
}

/**
 * @param {MarketRuntimeOptions} options
 */
export function createMarketRuntime({ fs, subprocess, dshHome }) {
  const baseDir = dshHome + '/agent-plugin-market'
  const marketsDir = baseDir + '/markets'
  const configPath = baseDir + '/config.json'
  const generatedHooksDir = baseDir + '/generated-hooks'
  const hookDataDir = baseDir + '/hook-data'
  const homeWorkspacePath = homePathForDshHome(dshHome)

  /**
   * @param {unknown} value
   * @returns {value is Record<string, unknown>}
   */
  function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
  }

  /** @param {unknown} value */
  function normalizeAbsolutePath(value) {
    const text = String(value || '').replace(/\\/g, '/').replace(/\/+$/, '')
    return text || '/'
  }

  /** @param {string} home */
  function homePathForDshHome(home) {
    const normalized = normalizeAbsolutePath(home)
    const marker = normalized.indexOf('/.dsh')
    return marker > 0 ? normalized.slice(0, marker) : null
  }

  /** @param {unknown} cwd */
  function isHomeWorkspace(cwd) {
    return homeWorkspacePath !== null && normalizeAbsolutePath(cwd) === homeWorkspacePath
  }

  /**
   * @param {string[]} argv
   * @param {string} cwd
   */
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

  /** @param {string} dir */
  async function ensureDir(dir) {
    await runProc(['mkdir', '-p', dir], dshHome)
  }

  async function prepare() {
    await ensureDir(baseDir)
    await ensureDir(marketsDir)
  }

  /** @param {string} path */
  async function readTextIfExists(path) {
    const target = await fs.resolve(path)
    const info = await fs.stat(target)
    if (!info) return null
    return await fs.readText(target)
  }

  /** @param {string} dir */
  async function listDirEntries(dir) {
    const target = await fs.resolve(dir)
    const info = await fs.stat(target)
    if (!info) return []
    try { return await fs.listDir(target) } catch { return [] }
  }

  /**
   * @param {string} parentDir
   * @param {string} childPath
   */
  async function resolvePathWithin(parentDir, childPath) {
    const parent = await fs.resolve(parentDir)
    const child = await fs.resolve(parentDir + '/' + String(childPath || ''))
    return fs.contains(parent, child) ? child.displayPath : null
  }

  /**
   * @param {string} parentDir
   * @param {string} childPath
   */
  async function resolveDirectoryWithin(parentDir, childPath) {
    const childPathResolved = await resolvePathWithin(parentDir, childPath)
    if (!childPathResolved) return null
    const child = await fs.resolve(childPathResolved)
    const info = await fs.stat(child)
    return info && info.type === 'directory' ? child.displayPath : null
  }

  /**
   * Untrusted manifest JSON remains intentionally dynamic at this boundary.
   *
   * @param {string} parentDir
   * @param {string} childPath
   * @returns {Promise<unknown | null>}
   */
  async function readJsonFileWithin(parentDir, childPath) {
    const safePath = await resolvePathWithin(parentDir, childPath)
    if (!safePath) return null
    const text = await readTextIfExists(safePath)
    if (text === null) return null
    try { return JSON.parse(text) } catch { return null }
  }

  /**
   * @returns {Promise<MarketConfig>}
   */
  async function loadConfig() {
    const text = await readTextIfExists(configPath)
    if (text === null) return { markets: [], installed: {}, disabledSkills: {}, enabledStandaloneSkills: {}, hookApprovals: {} }
    try {
      const parsed = /** @type {unknown} */ (JSON.parse(text))
      const cfg = isRecord(parsed) ? parsed : {}
      return {
        markets: Array.isArray(cfg.markets) ? /** @type {MarketEntry[]} */ (cfg.markets) : [],
        installed: isRecord(cfg.installed) ? /** @type {Record<string, InstalledPlugin>} */ (cfg.installed) : {},
        disabledSkills: isRecord(cfg.disabledSkills) ? /** @type {Record<string, boolean>} */ (cfg.disabledSkills) : {},
        enabledStandaloneSkills: isRecord(cfg.enabledStandaloneSkills) ? /** @type {Record<string, boolean>} */ (cfg.enabledStandaloneSkills) : {},
        hookApprovals: isRecord(cfg.hookApprovals) ? /** @type {Record<string, HookApproval>} */ (cfg.hookApprovals) : {},
      }
    } catch {
      return { markets: [], installed: {}, disabledSkills: {}, enabledStandaloneSkills: {}, hookApprovals: {} }
    }
  }

  /** @param {MarketConfig} cfg */
  async function saveConfig(cfg) {
    const target = await fs.resolve(configPath)
    await fs.writeText(target, JSON.stringify(cfg, null, 2))
  }

  /**
   * Resolve a workspace-local config only when every existing path component
   * remains below the registered workspace root. The `.dsh` directory itself
   * may not be a symlink, so a workspace config cannot escape through it.
   *
   * @param {string | null | undefined} cwd
   * @returns {Promise<{rootPath: string, directoryPath: string, configPath: string} | null>}
   */
  async function resolveWorkspaceConfig(cwd) {
    if (typeof cwd !== 'string' || !cwd.trim()) return null
    const root = await fs.resolve(cwd)
    const rootInfo = await fs.stat(root)
    if (!rootInfo || rootInfo.type !== 'directory') return null
    const rootPath = root.displayPath
    if (isHomeWorkspace(rootPath)) return null
    const directoryPath = await resolvePathWithin(rootPath, '.dsh')
    if (!directoryPath) return null
    const directoryInfo = await fs.lstat(directoryPath)
    if (directoryInfo && directoryInfo.type !== 'directory') return null
    const workspaceConfigPath = await resolvePathWithin(rootPath, '.dsh/agent-plugin-market.json')
    if (!workspaceConfigPath) return null
    const configInfo = await fs.lstat(workspaceConfigPath)
    if (configInfo && configInfo.type === 'symlink') return null
    if (configInfo && configInfo.type !== 'file') return null
    return { rootPath, directoryPath, configPath: workspaceConfigPath }
  }

  /** @param {string | null | undefined} cwd */
  async function loadWorkspaceConfig(cwd) {
    const location = await resolveWorkspaceConfig(cwd)
    if (!location) return emptyWorkspaceConfig()
    const text = await readTextIfExists(location.configPath)
    if (text === null) return emptyWorkspaceConfig()
    try { return normalizeWorkspaceConfig(JSON.parse(text)) } catch { return emptyWorkspaceConfig() }
  }

  /**
   * @param {string} cwd
   * @param {unknown} cfg
   */
  async function saveWorkspaceConfig(cwd, cfg) {
    const location = await resolveWorkspaceConfig(cwd)
    if (!location) throw new Error('工作区配置路径不可用')
    if (await fs.lstat(location.directoryPath)) {
      const directoryInfo = await fs.lstat(location.directoryPath)
      if (!directoryInfo || directoryInfo.type !== 'directory') throw new Error('工作区 .dsh 目录不可用')
    } else {
      await ensureDir(location.directoryPath)
    }
    const rechecked = await resolveWorkspaceConfig(cwd)
    if (!rechecked) throw new Error('工作区配置路径不可用')
    const target = await fs.resolve(rechecked.configPath)
    const existing = await fs.stat(target)
    if (existing && existing.type !== 'file') throw new Error('工作区配置文件不可用')
    if (existing && existing.version === undefined) throw new Error('工作区配置文件版本不可用')
    const expected = existing
      ? { kind: 'replaceIfVersion', version: existing.version }
      : { kind: 'createIfAbsent' }
    await fs.writeText(target, JSON.stringify(normalizeWorkspaceConfig(cfg), null, 2), expected, undefined, {
      mode: 'workspace-write',
      workspaceRoot: rechecked.rootPath,
    })
  }

  const MARKET_MANIFESTS = ['.agents/plugins/marketplace.json', '.claude-plugin/marketplace.json', '.cursor-plugin/marketplace.json', '.github/plugin/marketplace.json', 'marketplace.json']
  const PLUGIN_MANIFESTS = [
    { path: '.codex-plugin/plugin.json', kind: 'codex' },
    { path: '.claude-plugin/plugin.json', kind: 'claude' },
    { path: 'plugin.json', kind: 'generic' },
  ]

  /** @param {unknown} value */
  function textValue(value) {
    return typeof value === 'string' ? value.trim() : ''
  }

  /** @param {unknown} repo */
  function canonicalGitRepo(repo) {
    const value = String(repo || '').trim().replace(/^git\+/, '').replace(/\/+$/, '')
    const scp = /^git@([^:]+):(.+)$/.exec(value)
    const source = scp
      ? scp[1] + '/' + scp[2]
      : value.replace(/^[A-Za-z][A-Za-z0-9+.-]*:\/\/(?:[^@/]+@)?/, '')
    return source.replace(/^\/+/, '').replace(/\.git$/i, '').toLowerCase()
  }

  /**
   * @param {unknown} url
   * @param {unknown} marketRepo
   */
  function isCurrentMarketRepo(url, marketRepo) {
    const source = canonicalGitRepo(url)
    return !!source && source === canonicalGitRepo(marketRepo)
  }

  /**
   * @param {unknown} entry
   * @param {unknown} marketRepo
   */
  function normalizePluginEntry(entry, marketRepo) {
    if (!isRecord(entry)) return null
    const name = textValue(entry.name)
    if (!name) return null
    const metadata = { description: textValue(entry.description) }
    if (typeof entry.source === 'string' && entry.source.trim()) {
      return { name, source: entry.source.trim(), unsupported: false, ...metadata }
    }
    if (isRecord(entry.source)) {
      const source = entry.source
      if (source.source === 'local' && typeof source.path === 'string' && source.path.trim()) {
        return { name, source: source.path.trim(), unsupported: false, ...metadata }
      }
      if (source.source === 'url' && typeof source.url === 'string' && isCurrentMarketRepo(source.url, marketRepo)) {
        return { name, source: '.', unsupported: false, ...metadata }
      }
      return { name, source: '', unsupported: true, sourceType: String(source.source || 'unknown'), ...metadata }
    }
    return { name, source: '', unsupported: false, ...metadata }
  }

  /**
   * @param {string} marketDir
   * @param {string} marketRepo
   * @returns {Promise<Marketplace | null>}
   */
  async function parseMarketplace(marketDir, marketRepo) {
    for (const rel of MARKET_MANIFESTS) {
      const manifest = await readJsonFileWithin(marketDir, rel)
      if (isRecord(manifest) && Array.isArray(manifest.plugins)) {
        const metadata = isRecord(manifest.metadata) ? manifest.metadata : {}
        /** @type {MarketplacePlugin[]} */
        const plugins = []
        for (const entry of manifest.plugins) {
          const plugin = normalizePluginEntry(entry, marketRepo)
          if (plugin) plugins.push(plugin)
        }
        return {
          name: textValue(manifest.name),
          description: textValue(metadata.description) || textValue(manifest.description),
          plugins,
        }
      }
    }
    return null
  }

  /** @param {SkillSource[]} sources */
  function uniqueSkillSources(sources) {
    const seen = new Set()
    return sources.filter((source) => {
      if (!source || typeof source.path !== 'string' || !source.path.trim()) return false
      const key = source.root + ':' + source.path.replace(/\/+$/, '')
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }

  /** @param {unknown} manifest */
  function genericSkillSources(manifest) {
    const record = isRecord(manifest) ? manifest : {}
    /** @type {string[]} */
    const paths = []
    if (typeof record.skills === 'string' && record.skills.trim()) {
      paths.push(record.skills.trim())
    } else if (Array.isArray(record.skills)) {
      for (const path of record.skills) if (typeof path === 'string' && path.trim()) paths.push(path.trim())
    } else if (isRecord(record.skills)) {
      const declared = record.skills.paths
      if (typeof declared === 'string' && declared.trim()) paths.push(declared.trim())
      else if (Array.isArray(declared)) {
        for (const path of declared) if (typeof path === 'string' && path.trim()) paths.push(path.trim())
      }
    }
    return uniqueSkillSources((paths.length ? paths : ['skills']).map(/** @param {string} path @returns {SkillSource} */ (path) => ({ root: 'plugin', path })))
  }

  /**
   * @param {unknown} manifest
   * @returns {SkillSource[] | null}
   */
  function awesomeCopilotSkillSources(manifest) {
    const extensions = isRecord(manifest) ? manifest.extensions : null
    const composition = isRecord(extensions) ? extensions['com.github.awesome-copilot'] : null
    if (!isRecord(composition) || !Object.prototype.hasOwnProperty.call(composition, 'skills')) {
      return null
    }
    if (!Array.isArray(composition.skills)) return []
    /** @type {SkillSource[]} */
    const sources = []
    for (const entry of composition.skills) {
      if (typeof entry !== 'string') continue
      const path = entry.trim().replace(/\/+$/, '')
      if (path === './skills') {
        sources.push({ root: 'market', path: 'skills' })
        continue
      }
      if (!path.startsWith('./skills/')) continue
      const relative = path.slice(2)
      if (relative.split('/').some((part) => !part || part === '.' || part === '..')) continue
      sources.push({ root: 'market', path: relative })
    }
    return uniqueSkillSources(sources)
  }

  /** @param {PluginMetaFallback | string | null | undefined} fallback */
  function fallbackPluginMeta(fallback) {
    if (fallback && typeof fallback === 'object' && !Array.isArray(fallback)) return fallback
    return { name: textValue(fallback) }
  }

  // Hook configurations stay protocol-keyed so future bridges add a sibling entry.
  /**
   * @param {unknown} manifest
   * @param {string} kind
   * @returns {PluginMeta['hookConfigs']}
   */
  function hookConfigsForManifest(manifest, kind) {
    return { codex: kind === 'codex' ? codexHookSources(manifest) : null }
  }

  /**
   * @param {string} pluginDir
   * @param {PluginMetaFallback | string} fallback
   * @returns {Promise<PluginMeta>}
   */
  async function readPluginMeta(pluginDir, fallback) {
    const fallbackMeta = fallbackPluginMeta(fallback)
    for (const candidate of PLUGIN_MANIFESTS) {
      const manifest = await readJsonFileWithin(pluginDir, candidate.path)
      if (!isRecord(manifest)) continue
      const iface = isRecord(manifest.interface) ? manifest.interface : {}
      const name = textValue(manifest.name) || textValue(fallbackMeta.name)
      const awesomeSources = awesomeCopilotSkillSources(manifest)
      return {
        title: textValue(iface.displayName) || name,
        description: textValue(manifest.description) || textValue(iface.short_description) || textValue(iface.shortDescription) || textValue(fallbackMeta.description),
        skillSources: awesomeSources === null ? genericSkillSources(manifest) : awesomeSources,
        hookConfigs: hookConfigsForManifest(manifest, candidate.kind),
      }
    }
    return {
      title: textValue(fallbackMeta.name),
      description: textValue(fallbackMeta.description),
      skillSources: [{ root: 'plugin', path: 'skills' }],
      hookConfigs: { codex: null },
    }
  }

  /** @param {string} raw */
  function parseScalar(raw) {
    const v = raw.trim()
    if (v.length >= 2 && ((v[0] === '"' && v[v.length - 1] === '"') || (v[0] === "'" && v[v.length - 1] === "'"))) return v.slice(1, -1)
    if (v === 'true') return true
    if (v === 'false') return false
    if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v)
    return v
  }

  /**
   * @param {string} text
   * @returns {SkillDocument | null}
   */
  function parseSkillDoc(text) {
    const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text)
    if (!m) return null
    /** @type {SkillFrontMatter} */
    const data = {}
    /** @type {string | null} */
    let blockKey = null
    /** @type {string[]} */
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

  /**
   * @param {string} rootDir
   * @param {string} path
   * @returns {Promise<SkillDocument | null>}
   */
  async function readSkillFileWithin(rootDir, path) {
    const root = await fs.resolve(rootDir)
    const target = await fs.resolve(path)
    if (!fs.contains(root, target)) return null
    const info = await fs.stat(target)
    if (!info || info.type !== 'file') return null
    return parseSkillDoc(await fs.readText(target))
  }

  const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
  const STANDALONE_SKILL_OWNER = 'standalone-skills'

  /**
   * @param {SkillDocumentItem} item
   * @param {string} marketId
   * @param {string} pluginName
   * @returns {SkillInfo | null}
   */
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

  /**
   * @param {SkillDocumentItem[]} items
   * @param {string} marketId
   * @param {string} pluginName
   * @returns {SkillInfo[]}
   */
  function finalizeSkills(items, marketId, pluginName) {
    const result = []
    const seenPaths = new Set()
    const seenNames = new Set()
    for (const item of items) {
      const skill = finalizeSkill(item, marketId, pluginName)
      if (!skill || seenPaths.has(skill.path) || seenNames.has(skill.fullName)) continue
      seenPaths.add(skill.path)
      seenNames.add(skill.fullName)
      result.push(skill)
    }
    return result
  }

  /** @param {SkillDocumentItem} item */
  function skillDocumentKey(item) {
    const data = item.doc.data
    const whenToUse = data.whenToUse !== undefined ? data.whenToUse : data.when_to_use
    return [data.name, data.description, whenToUse, item.doc.content].map((value) => String(value || '').trim()).join('\u0000')
  }

  /**
   * @param {string} skillsDir
   * @returns {Promise<SkillDocumentItem[]>}
   */
  async function scanSkillsInDir(skillsDir) {
    /** @type {SkillDocumentItem[]} */
    const out = []
    const root = await fs.resolve(skillsDir)
    const entries = await listDirEntries(skillsDir)
    for (const entry of entries) {
      if (!fs.contains(root, entry.target)) continue
      if (entry.type === 'directory') {
        const skillPath = entry.target.displayPath + '/SKILL.md'
        const doc = await readSkillFileWithin(root.displayPath, skillPath)
        if (doc) out.push({ doc, skillDir: entry.target.displayPath, skillPath })
      } else if (entry.type === 'file' && /\.md$/i.test(entry.name)) {
        const doc = await readSkillFileWithin(root.displayPath, entry.target.displayPath)
        if (doc) out.push({ doc, skillDir: root.displayPath, skillPath: entry.target.displayPath })
      }
    }
    return out
  }

  /**
   * @param {MarketEntry} market
   * @param {string} pluginDir
   * @param {SkillSource[]} sources
   * @returns {Promise<SkillDocumentItem[]>}
   */
  async function scanSkillSourceItems(market, pluginDir, sources) {
    const marketDir = marketsDir + '/' + market.id
    /** @type {SkillDocumentItem[]} */
    const items = []
    for (const source of sources) {
      const rootDir = source.root === 'market' ? marketDir : pluginDir
      const skillsDir = await resolveDirectoryWithin(rootDir, source.path)
      if (!skillsDir) continue
      items.push(...await scanSkillsInDir(skillsDir))
    }
    return items
  }

  /**
   * @param {MarketEntry} market
   * @param {MarketplacePlugin} entry
   * @param {string} pluginDir
   * @param {PluginMeta} meta
   * @returns {Promise<SkillInfo[]>}
   */
  async function scanPluginSkills(market, entry, pluginDir, meta) {
    return finalizeSkills(await scanSkillSourceItems(market, pluginDir, meta.skillSources), market.id, entry.name)
  }

  /**
   * @param {MarketEntry} market
   * @param {Marketplace | null} marketplace
   * @returns {Promise<SkillInfo[]>}
   */
  async function scanStandaloneSkills(market, marketplace) {
    const marketDir = marketsDir + '/' + market.id
    const skillsDir = await resolveDirectoryWithin(marketDir, 'skills')
    if (!skillsDir) return []

    /** @type {Set<string>} */
    const referencedTargetKeys = new Set()
    const referencedDocuments = new Set()
    const plugins = marketplace && Array.isArray(marketplace.plugins) ? marketplace.plugins : []
    for (const entry of plugins) {
      if (entry.unsupported) continue
      const pluginDir = await resolveDirectoryWithin(marketDir, entry.source)
      if (!pluginDir) continue
      const meta = await readPluginMeta(pluginDir, entry)
      for (const item of await scanSkillSourceItems(market, pluginDir, meta.skillSources)) {
        const target = await fs.resolve(item.skillPath)
        referencedTargetKeys.add(target.targetKey)
        referencedDocuments.add(skillDocumentKey(item))
      }
    }

    const standaloneItems = []
    for (const item of await scanSkillsInDir(skillsDir)) {
      const target = await fs.resolve(item.skillPath)
      if (!referencedTargetKeys.has(target.targetKey) && !referencedDocuments.has(skillDocumentKey(item))) standaloneItems.push(item)
    }
    return finalizeSkills(standaloneItems, market.id, STANDALONE_SKILL_OWNER)
  }

  /**
   * @param {MarketConfig} cfg
   * @param {WorkspaceConfig} workspace
   * @param {MarketEntry} market
   * @param {MarketplacePlugin} entry
   */
  async function scanEffectivePluginSkills(cfg, workspace, market, entry) {
    const pluginKey = marketPluginKey(market.id, entry.name)
    if (workspaceOverride(workspace, 'plugins', pluginKey) === false) return []
    const marketDir = marketsDir + '/' + market.id
    const pluginDir = await resolveDirectoryWithin(marketDir, entry.source)
    if (!pluginDir) return []
    const meta = await readPluginMeta(pluginDir, entry)
    return (await scanPluginSkills(market, entry, pluginDir, meta))
      .filter((skill) => pluginSkillEnabled(cfg, workspace, pluginKey, skill.fullName))
  }

  /**
   * @param {{cwd?: string}} [options]
   * @returns {Promise<SkillInfo[]>}
   */
  async function collectSkills(options = {}) {
    const cfg = await loadConfig()
    const workspace = await loadWorkspaceConfig(options.cwd)
    const result = []
    for (const market of cfg.markets) {
      if (!market || typeof market !== 'object' || !market.id) continue
      const mp = await parseMarketplace(marketsDir + '/' + market.id, market.repo)
      if (mp) {
        for (const entry of mp.plugins) {
          if (entry.unsupported) continue
          result.push(...await scanEffectivePluginSkills(cfg, workspace, market, entry))
        }
      }
      result.push(...(await scanStandaloneSkills(market, mp))
        .filter((skill) => standaloneSkillEnabled(cfg, workspace, skill.fullName)))
    }
    return result
  }

  return {
    paths: { baseDir, marketsDir, configPath, generatedHooksDir, hookDataDir },
    prepare,
    runProc,
    ensureDir,
    loadConfig,
    saveConfig,
    isHomeWorkspace,
    resolveWorkspaceConfig,
    loadWorkspaceConfig,
    saveWorkspaceConfig,
    resolveDirectoryWithin,
    parseMarketplace,
    readPluginMeta,
    readSkillFileWithin,
    scanPluginSkills,
    scanStandaloneSkills,
    collectSkills,
  }
}
