import { codexHookSources } from './codex-hooks.js'

// Filesystem-backed market and skill discovery for the Host plugin.
export function marketPluginKey(marketId, pluginName) {
  return marketId + '/' + pluginName
}

export function createMarketRuntime({ fs, subprocess, dshHome }) {
  const baseDir = dshHome + '/agent-plugin-market'
  const marketsDir = baseDir + '/markets'
  const configPath = baseDir + '/config.json'
  const generatedHooksDir = baseDir + '/generated-hooks'
  const hookDataDir = baseDir + '/hook-data'

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

  async function prepare() {
    await ensureDir(baseDir)
    await ensureDir(marketsDir)
  }

  async function readTextIfExists(path) {
    const target = await fs.resolve(path)
    const info = await fs.stat(target)
    if (!info) return null
    return await fs.readText(target)
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

  async function readJsonFileWithin(parentDir, childPath) {
    const safePath = await resolvePathWithin(parentDir, childPath)
    if (!safePath) return null
    const text = await readTextIfExists(safePath)
    if (text === null) return null
    try { return JSON.parse(text) } catch (e) { return null }
  }

  async function loadConfig() {
    const text = await readTextIfExists(configPath)
    if (text === null) return { markets: [], installed: {}, disabledSkills: {}, enabledStandaloneSkills: {}, hookApprovals: {} }
    try {
      const cfg = JSON.parse(text)
      return {
        markets: Array.isArray(cfg.markets) ? cfg.markets : [],
        installed: cfg.installed && typeof cfg.installed === 'object' ? cfg.installed : {},
        disabledSkills: cfg.disabledSkills && typeof cfg.disabledSkills === 'object' ? cfg.disabledSkills : {},
        enabledStandaloneSkills: cfg.enabledStandaloneSkills && typeof cfg.enabledStandaloneSkills === 'object' ? cfg.enabledStandaloneSkills : {},
        hookApprovals: cfg.hookApprovals && typeof cfg.hookApprovals === 'object' ? cfg.hookApprovals : {},
      }
    } catch (e) {
      return { markets: [], installed: {}, disabledSkills: {}, enabledStandaloneSkills: {}, hookApprovals: {} }
    }
  }

  async function saveConfig(cfg) {
    const target = await fs.resolve(configPath)
    await fs.writeText(target, JSON.stringify(cfg, null, 2))
  }

  const MARKET_MANIFESTS = ['.agents/plugins/marketplace.json', '.claude-plugin/marketplace.json', '.cursor-plugin/marketplace.json', '.github/plugin/marketplace.json', 'marketplace.json']
  const PLUGIN_MANIFESTS = [
    { path: '.codex-plugin/plugin.json', kind: 'codex' },
    { path: '.claude-plugin/plugin.json', kind: 'claude' },
    { path: 'plugin.json', kind: 'generic' },
  ]

  function textValue(value) {
    return typeof value === 'string' ? value.trim() : ''
  }

  function canonicalGitRepo(repo) {
    const value = String(repo || '').trim().replace(/^git\+/, '').replace(/\/+$/, '')
    const scp = /^git@([^:]+):(.+)$/.exec(value)
    const source = scp
      ? scp[1] + '/' + scp[2]
      : value.replace(/^[A-Za-z][A-Za-z0-9+.-]*:\/\/(?:[^@/]+@)?/, '')
    return source.replace(/^\/+/, '').replace(/\.git$/i, '').toLowerCase()
  }

  function isCurrentMarketRepo(url, marketRepo) {
    const source = canonicalGitRepo(url)
    return !!source && source === canonicalGitRepo(marketRepo)
  }

  function normalizePluginEntry(entry, marketRepo) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
    const name = textValue(entry.name)
    if (!name) return null
    const metadata = { description: textValue(entry.description) }
    if (typeof entry.source === 'string' && entry.source.trim()) {
      return { name, source: entry.source.trim(), unsupported: false, ...metadata }
    }
    if (entry.source && typeof entry.source === 'object' && !Array.isArray(entry.source)) {
      const s = entry.source
      if (s.source === 'local' && typeof s.path === 'string' && s.path.trim()) {
        return { name, source: s.path.trim(), unsupported: false, ...metadata }
      }
      if (s.source === 'url' && typeof s.url === 'string' && isCurrentMarketRepo(s.url, marketRepo)) {
        return { name, source: '.', unsupported: false, ...metadata }
      }
      return { name, source: '', unsupported: true, sourceType: String(s.source || 'unknown'), ...metadata }
    }
    return { name, source: '', unsupported: false, ...metadata }
  }

  async function parseMarketplace(marketDir, marketRepo) {
    for (const rel of MARKET_MANIFESTS) {
      const manifest = await readJsonFileWithin(marketDir, rel)
      if (manifest && !Array.isArray(manifest) && Array.isArray(manifest.plugins)) {
        const metadata = manifest.metadata && typeof manifest.metadata === 'object' && !Array.isArray(manifest.metadata)
          ? manifest.metadata
          : {}
        return {
          name: textValue(manifest.name),
          description: textValue(metadata.description) || textValue(manifest.description),
          plugins: manifest.plugins.map((entry) => normalizePluginEntry(entry, marketRepo)).filter(Boolean),
        }
      }
    }
    return null
  }

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

  function genericSkillSources(manifest) {
    const paths = []
    if (typeof manifest.skills === 'string' && manifest.skills.trim()) {
      paths.push(manifest.skills.trim())
    } else if (Array.isArray(manifest.skills)) {
      for (const path of manifest.skills) if (typeof path === 'string' && path.trim()) paths.push(path.trim())
    } else if (manifest.skills && typeof manifest.skills === 'object') {
      const declared = manifest.skills.paths
      if (typeof declared === 'string' && declared.trim()) paths.push(declared.trim())
      else if (Array.isArray(declared)) {
        for (const path of declared) if (typeof path === 'string' && path.trim()) paths.push(path.trim())
      }
    }
    return uniqueSkillSources((paths.length ? paths : ['skills']).map((path) => ({ root: 'plugin', path })))
  }

  function awesomeCopilotSkillSources(manifest) {
    const extensions = manifest.extensions
    const composition = extensions && typeof extensions === 'object' && !Array.isArray(extensions)
      ? extensions['com.github.awesome-copilot']
      : null
    if (!composition || typeof composition !== 'object' || Array.isArray(composition) || !Object.prototype.hasOwnProperty.call(composition, 'skills')) {
      return null
    }
    if (!Array.isArray(composition.skills)) return []
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

  function fallbackPluginMeta(fallback) {
    if (fallback && typeof fallback === 'object' && !Array.isArray(fallback)) return fallback
    return { name: textValue(fallback) }
  }

  // Hook configurations stay protocol-keyed so future bridges add a sibling entry.
  function hookConfigsForManifest(manifest, kind) {
    return { codex: kind === 'codex' ? codexHookSources(manifest) : null }
  }

  async function readPluginMeta(pluginDir, fallback) {
    const fallbackMeta = fallbackPluginMeta(fallback)
    for (const candidate of PLUGIN_MANIFESTS) {
      const manifest = await readJsonFileWithin(pluginDir, candidate.path)
      if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) continue
      const iface = manifest.interface && typeof manifest.interface === 'object' && !Array.isArray(manifest.interface) ? manifest.interface : {}
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

  function enabledSkills(cfg, skills) {
    return skills.filter((skill) => !(cfg.disabledSkills && cfg.disabledSkills[skill.fullName]))
  }

  function enabledStandaloneSkills(cfg, skills) {
    return skills.filter((skill) => !!(cfg.enabledStandaloneSkills && cfg.enabledStandaloneSkills[skill.fullName]))
  }

  function sameFsTarget(left, right) {
    return left.targetKey === right.targetKey
  }

  function skillDocumentKey(item) {
    const data = item.doc.data
    const whenToUse = data.whenToUse !== undefined ? data.whenToUse : data.when_to_use
    return [data.name, data.description, whenToUse, item.doc.content].map((value) => String(value || '').trim()).join('\u0000')
  }

  async function scanSkillsInDir(skillsDir) {
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

  async function scanSkillSourceItems(market, pluginDir, sources) {
    const marketDir = marketsDir + '/' + market.id
    const items = []
    for (const source of sources) {
      const rootDir = source.root === 'market' ? marketDir : pluginDir
      const skillsDir = await resolveDirectoryWithin(rootDir, source.path)
      if (!skillsDir) continue
      items.push(...await scanSkillsInDir(skillsDir))
    }
    return items
  }

  async function scanPluginSkills(market, entry, pluginDir, meta) {
    return finalizeSkills(await scanSkillSourceItems(market, pluginDir, meta.skillSources), market.id, entry.name)
  }

  async function scanStandaloneSkills(market, marketplace) {
    const marketDir = marketsDir + '/' + market.id
    const skillsDir = await resolveDirectoryWithin(marketDir, 'skills')
    if (!skillsDir) return []

    const referencedTargets = []
    const referencedDocuments = new Set()
    const plugins = marketplace && Array.isArray(marketplace.plugins) ? marketplace.plugins : []
    for (const entry of plugins) {
      if (entry.unsupported) continue
      const pluginDir = await resolveDirectoryWithin(marketDir, entry.source)
      if (!pluginDir) continue
      const meta = await readPluginMeta(pluginDir, entry)
      for (const item of await scanSkillSourceItems(market, pluginDir, meta.skillSources)) {
        const target = await fs.resolve(item.skillPath)
        if (!referencedTargets.some((candidate) => sameFsTarget(candidate, target))) referencedTargets.push(target)
        referencedDocuments.add(skillDocumentKey(item))
      }
    }

    const standaloneItems = []
    for (const item of await scanSkillsInDir(skillsDir)) {
      const target = await fs.resolve(item.skillPath)
      if (!referencedTargets.some((candidate) => sameFsTarget(candidate, target)) && !referencedDocuments.has(skillDocumentKey(item))) standaloneItems.push(item)
    }
    return finalizeSkills(standaloneItems, market.id, STANDALONE_SKILL_OWNER)
  }

  async function scanInstalledPluginSkills(cfg, market, entry) {
    const marketDir = marketsDir + '/' + market.id
    const pluginDir = await resolveDirectoryWithin(marketDir, entry.source)
    if (!pluginDir) return []
    const meta = await readPluginMeta(pluginDir, entry)
    return enabledSkills(cfg, await scanPluginSkills(market, entry, pluginDir, meta))
  }

  async function collectSkills() {
    const cfg = await loadConfig()
    const result = []
    for (const key of Object.keys(cfg.installed)) {
      const inst = cfg.installed[key]
      if (!inst || typeof inst !== 'object') continue
      const market = cfg.markets.find((m) => m.id === inst.marketId)
      if (!market) continue
      const mp = await parseMarketplace(marketsDir + '/' + market.id, market.repo)
      if (!mp) continue
      const entry = mp.plugins.find((p) => p.name === inst.pluginName)
      if (!entry || entry.unsupported) continue
      result.push(...await scanInstalledPluginSkills(cfg, market, entry))
    }
    for (const market of cfg.markets) {
      if (!market || typeof market !== 'object' || !market.id) continue
      const mp = await parseMarketplace(marketsDir + '/' + market.id, market.repo)
      result.push(...enabledStandaloneSkills(cfg, await scanStandaloneSkills(market, mp)))
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
    resolveDirectoryWithin,
    parseMarketplace,
    readPluginMeta,
    readSkillFileWithin,
    scanPluginSkills,
    scanStandaloneSkills,
    collectSkills,
  }
}
