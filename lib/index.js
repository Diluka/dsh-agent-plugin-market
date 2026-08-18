// dsh-agent-plugin-market —— Host 半端（静态 cordis 插件形态）
// 供 `dsh plugin --profile web add github:Diluka/dsh-agent-plugin-market` 安装；
// 与动态版（会话内 cordis_define）逻辑同源。RPC 通过 ctx.webServer 提供
// HTTP 路由（POST /agent-plugin-market/api/<name>），Client 用 fetch 调用。

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
      env: { GIT_TERMINAL_PROMPT: '0' },
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

  // ---------- 配置 ----------
  async function loadConfig() {
    const text = await readTextIfExists(configPath)
    if (text === null) return { markets: [], installed: {}, disabledSkills: {} }
    try {
      const cfg = JSON.parse(text)
      return {
        markets: Array.isArray(cfg.markets) ? cfg.markets : [],
        installed: cfg.installed && typeof cfg.installed === 'object' ? cfg.installed : {},
        disabledSkills: cfg.disabledSkills && typeof cfg.disabledSkills === 'object' ? cfg.disabledSkills : {},
      }
    } catch (e) {
      return { markets: [], installed: {}, disabledSkills: {} }
    }
  }
  async function saveConfig(cfg) {
    const target = await fs.resolve(configPath)
    await fs.writeText(target, JSON.stringify(cfg, null, 2))
  }

  // ---------- 市场 / 插件清单解析（兼容 Codex/Claude） ----------
  const MARKET_MANIFESTS = ['.agents/plugins/marketplace.json', '.claude-plugin/marketplace.json', '.cursor-plugin/marketplace.json', 'marketplace.json']
  const PLUGIN_MANIFESTS = ['.codex-plugin/plugin.json', '.claude-plugin/plugin.json', 'plugin.json']

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
    for (const rel of PLUGIN_MANIFESTS) {
      const manifest = await readJsonFile(pluginDir + '/' + rel)
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
      }
    }
    return { title: fallbackName || '', description: '', skillsRel: 'skills', version: '' }
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
    const pluginDir = marketsDir + '/' + market.id + '/' + entry.source
    const meta = await readPluginMeta(pluginDir, entry.name)
    const items = await scanSkillsInDir(pluginDir + '/' + meta.skillsRel)
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
    await ensureDir(marketsDir)
    const slug = repo.replace(/\.git$/, '').split(/[\/:]/).filter(Boolean).pop() || 'market'
    const id = slug.replace(/[^A-Za-z0-9._-]/g, '-') + '-' + Math.random().toString(36).slice(2, 6)
    try {
      await runProc(['git', 'clone', '--depth', '1', repo, id], marketsDir)
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
    cfg.markets.push({ id, name: mp.name || slug, repo, addedAt: Date.now() })
    await saveConfig(cfg)
    invalidate()
    return { id, name: mp.name || slug, repo }
  }

  async function updateMarket(args) {
    const cfg = await loadConfig()
    const market = cfg.markets.find((m) => m.id === String(args.marketId || ''))
    if (!market) throw new Error('市场不存在: ' + args.marketId)
    await runProc(['git', '-C', marketsDir + '/' + market.id, 'pull', '--ff-only'], marketsDir)
    invalidate()
    return { updated: true }
  }

  async function removeMarket(args) {
    const cfg = await loadConfig()
    const id = String(args.marketId || '')
    const market = cfg.markets.find((m) => m.id === id)
    if (!market) throw new Error('市场不存在: ' + id)
    await runProc(['rm', '-rf', marketsDir + '/' + id], marketsDir).catch(() => {})
    cfg.markets = cfg.markets.filter((m) => m.id !== id)
    for (const key of Object.keys(cfg.installed)) {
      if (cfg.installed[key] && cfg.installed[key].marketId === id) delete cfg.installed[key]
    }
    for (const key of Object.keys(cfg.disabledSkills)) {
      if (key.startsWith(id + '/')) delete cfg.disabledSkills[key]
    }
    await saveConfig(cfg)
    invalidate()
    return { removed: true }
  }

  async function installPlugin(args) {
    const marketId = String(args.marketId || '')
    const pluginName = String(args.pluginName || '')
    if (!marketId || !pluginName) throw new Error('缺少市场或插件标识')
    const cfg = await loadConfig()
    const key = marketId + '/' + pluginName
    if (!cfg.installed[key]) cfg.installed[key] = { marketId, pluginName, installedAt: Date.now() }
    await saveConfig(cfg)
    invalidate()
    return { installed: true }
  }

  async function uninstallPlugin(args) {
    const marketId = String(args.marketId || '')
    const pluginName = String(args.pluginName || '')
    const cfg = await loadConfig()
    const key = marketId + '/' + pluginName
    delete cfg.installed[key]
    for (const sk of Object.keys(cfg.disabledSkills)) {
      if (sk.startsWith(key + '/')) delete cfg.disabledSkills[sk]
    }
    await saveConfig(cfg)
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

  async function getState() {
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
          }
          if (!entry.unsupported) {
            try {
              const pluginDir = marketDir + '/' + entry.source
              const meta = await readPluginMeta(pluginDir, entry.name)
              view.title = meta.title || entry.name
              view.description = meta.description
              view.version = meta.version
              const items = await scanSkillsInDir(pluginDir + '/' + meta.skillsRel)
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
      markets.push({ id: market.id, name: market.name, repo: market.repo, manifestFound: !!mp, plugins })
    }
    return { markets }
  }

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
}
