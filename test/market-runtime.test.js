import assert from 'node:assert/strict'
import { posix as path } from 'node:path'
import test from 'node:test'

import { create } from '@platformatic/vfs'

import { createMarketRuntime } from '../lib/market-runtime.js'
import { createMarketService } from '../lib/market-service.js'

function skillDoc(name) {
  return '---\nname: ' + name + '\ndescription: Test ' + name + ' skill.\n---\n\n# ' + name + '\n'
}

// DSH exposes a different Fs service shape; VFS owns the filesystem behavior underneath this adapter.
function createVfsBackedFs(files, aliases = {}, writes = []) {
  const vfs = create({ moduleHooks: false })
  const normalize = (value) => {
    const normalized = path.normalize(String(value || '/'))
    return normalized.startsWith('/') ? normalized : '/' + normalized
  }
  const displayPath = (target) => normalize(typeof target === 'string' ? target : target.displayPath)
  const targetPath = (target) => typeof target === 'string'
    ? normalize(target)
    : target.targetKey || normalize(target.displayPath)
  const isMissing = (error) => error && error.code === 'ENOENT'
  const resolve = async (value) => {
    const display = normalize(value)
    try {
      return { displayPath: display, targetKey: await vfs.promises.realpath(display) }
    } catch (error) {
      if (isMissing(error)) return { displayPath: display, targetKey: display }
      throw error
    }
  }

  for (const [file, content] of Object.entries(files)) {
    const target = normalize(file)
    vfs.mkdirSync(path.dirname(target), { recursive: true })
    vfs.writeFileSync(target, content)
  }
  for (const [from, to] of Object.entries(aliases)) {
    const link = normalize(from)
    vfs.mkdirSync(path.dirname(link), { recursive: true })
    vfs.symlinkSync(normalize(to), link)
  }

  return {
    async mkdirp(dir) {
      await vfs.promises.mkdir(normalize(dir), { recursive: true })
    },
    resolve,
    async lstat(target) {
      try {
        const info = await vfs.promises.lstat(targetPath(target))
        return { type: info.isSymbolicLink() ? 'symlink' : info.isDirectory() ? 'directory' : info.isFile() ? 'file' : 'other' }
      } catch (error) {
        if (isMissing(error)) return null
        throw error
      }
    },
    async stat(target) {
      try {
        const info = await vfs.promises.stat(targetPath(target))
        return { type: info.isDirectory() ? 'directory' : info.isFile() ? 'file' : 'other', version: info.mtimeMs + ':' + info.size }
      } catch (error) {
        if (isMissing(error)) return null
        throw error
      }
    },
    async readText(target) {
      return vfs.promises.readFile(targetPath(target), 'utf8')
    },
    async writeText(target, content, expected, signal, sandboxPolicy) {
      const file = targetPath(target)
      writes.push({ path: file, content, expected, signal, sandboxPolicy })
      await vfs.promises.mkdir(path.dirname(file), { recursive: true })
      await vfs.promises.writeFile(file, content)
    },
    async listDir(target) {
      try {
        const entries = await vfs.promises.readdir(targetPath(target), { withFileTypes: true })
        const dir = displayPath(target)
        const result = []
        for (const entry of entries) {
          result.push({
            name: entry.name,
            type: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other',
            target: await resolve(path.join(dir, entry.name)),
          })
        }
        return result.sort((left, right) => left.name.localeCompare(right.name))
      } catch (error) {
        if (isMissing(error)) return []
        throw error
      }
    },
    contains(parent, child) {
      const parentPath = targetPath(parent)
      const childPath = targetPath(child)
      return parentPath === '/' || childPath === parentPath || childPath.startsWith(parentPath + '/')
    },
  }
}

function runtimeFor(files, aliases) {
  return createMarketRuntime({
    fs: createVfsBackedFs(files, aliases),
    subprocess: {},
    dshHome: '/dsh',
  })
}

test('keeps plugin-referenced root skills out of the standalone group', async () => {
  const marketDir = '/dsh/agent-plugin-market/markets/market'
  const runtime = runtimeFor({
    [marketDir + '/plugin.json']: JSON.stringify({
      name: 'root-plugin',
      skills: { paths: ['skills/referenced-one', 'skills/referenced-two'] },
    }),
    [marketDir + '/skills/referenced-one/SKILL.md']: skillDoc('referenced'),
    [marketDir + '/skills/referenced-two/SKILL.md']: skillDoc('referenced'),
    [marketDir + '/skills/standalone/SKILL.md']: skillDoc('standalone'),
  })
  const market = { id: 'market', repo: 'example/market' }
  const marketplace = { plugins: [{ name: 'root-plugin', source: '.', unsupported: false }] }

  const standalone = await runtime.scanStandaloneSkills(market, marketplace)

  assert.deepEqual(standalone.map((skill) => skill.skillName), ['standalone'])
  assert.equal(standalone[0].fullName, 'market/standalone-skills/standalone')
})

test('treats generic skill arrays as plugin references', async () => {
  const marketDir = '/dsh/agent-plugin-market/markets/market'
  const runtime = runtimeFor({
    [marketDir + '/plugin.json']: JSON.stringify({
      name: 'root-plugin',
      skills: ['skills/owned-one', 'skills/owned-two'],
    }),
    [marketDir + '/skills/owned-one/SKILL.md']: skillDoc('owned-one'),
    [marketDir + '/skills/owned-two/SKILL.md']: skillDoc('owned-two'),
    [marketDir + '/skills/standalone/SKILL.md']: skillDoc('standalone'),
  })
  const market = { id: 'market', repo: 'example/market' }
  const marketplace = { plugins: [{ name: 'root-plugin', source: '.', unsupported: false }] }

  assert.deepEqual((await runtime.scanStandaloneSkills(market, marketplace)).map((skill) => skill.skillName), ['standalone'])
})

test('treats an Awesome Copilot root skills source as a plugin reference', async () => {
  const marketDir = '/dsh/agent-plugin-market/markets/market'
  const runtime = runtimeFor({
    [marketDir + '/plugin.json']: JSON.stringify({
      name: 'root-plugin',
      extensions: { 'com.github.awesome-copilot': { skills: ['./skills'] } },
    }),
    [marketDir + '/skills/referenced/SKILL.md']: skillDoc('referenced'),
  })
  const market = { id: 'market', repo: 'example/market' }
  const marketplace = { plugins: [{ name: 'root-plugin', source: '.', unsupported: false }] }

  assert.deepEqual(await runtime.scanStandaloneSkills(market, marketplace), [])
})

test('does not duplicate an aliased plugin skill as standalone', async () => {
  const marketDir = '/dsh/agent-plugin-market/markets/market'
  const runtime = runtimeFor({
    [marketDir + '/plugin.json']: JSON.stringify({ name: 'root-plugin', skills: 'plugin-skills' }),
    [marketDir + '/skills/shared/SKILL.md']: skillDoc('shared'),
  }, {
    [marketDir + '/plugin-skills']: marketDir + '/skills',
  })
  const market = { id: 'market', repo: 'example/market' }
  const marketplace = { plugins: [{ name: 'root-plugin', source: '.', unsupported: false }] }

  assert.deepEqual(await runtime.scanStandaloneSkills(market, marketplace), [])
})

test('treats identical plugin-local copies as plugin references', async () => {
  const marketDir = '/dsh/agent-plugin-market/markets/market'
  const runtime = runtimeFor({
    [marketDir + '/plugins/root-plugin/plugin.json']: JSON.stringify({ name: 'root-plugin', skills: 'skills' }),
    [marketDir + '/plugins/root-plugin/skills/copied/SKILL.md']: skillDoc('copied'),
    [marketDir + '/skills/copied/SKILL.md']: skillDoc('copied'),
    [marketDir + '/skills/standalone/SKILL.md']: skillDoc('standalone'),
  })
  const market = { id: 'market', repo: 'example/market' }
  const marketplace = { plugins: [{ name: 'root-plugin', source: 'plugins/root-plugin', unsupported: false }] }

  assert.deepEqual((await runtime.scanStandaloneSkills(market, marketplace)).map((skill) => skill.skillName), ['standalone'])
})

test('keeps a distinct root skill standalone when names collide', async () => {
  const marketDir = '/dsh/agent-plugin-market/markets/market'
  const runtime = runtimeFor({
    [marketDir + '/plugins/root-plugin/plugin.json']: JSON.stringify({ name: 'root-plugin', skills: 'skills' }),
    [marketDir + '/plugins/root-plugin/skills/shared/SKILL.md']: skillDoc('shared').replace('# shared', '# plugin variant'),
    [marketDir + '/skills/shared/SKILL.md']: skillDoc('shared'),
  })
  const market = { id: 'market', repo: 'example/market' }
  const marketplace = { plugins: [{ name: 'root-plugin', source: 'plugins/root-plugin', unsupported: false }] }

  assert.deepEqual((await runtime.scanStandaloneSkills(market, marketplace)).map((skill) => skill.skillName), ['shared'])
})

test('keeps standalone root skills disabled by default', async () => {
  const marketDir = '/dsh/agent-plugin-market/markets/market'
  const runtime = runtimeFor({
    '/dsh/agent-plugin-market/config.json': JSON.stringify({
      markets: [{ id: 'market', name: 'market', repo: 'example/market' }],
      installed: { 'market/root-plugin': { marketId: 'market', pluginName: 'root-plugin' } },
      disabledSkills: {},
      hookApprovals: {},
    }),
    [marketDir + '/.github/plugin/marketplace.json']: JSON.stringify({
      plugins: [{ name: 'root-plugin', source: '.' }],
    }),
    [marketDir + '/plugin.json']: JSON.stringify({ name: 'root-plugin', skills: 'skills/referenced' }),
    [marketDir + '/skills/referenced/SKILL.md']: skillDoc('referenced'),
    [marketDir + '/skills/standalone/SKILL.md']: skillDoc('standalone'),
  })

  const skills = await runtime.collectSkills()

  assert.deepEqual(skills.map((skill) => skill.fullName), ['market/root-plugin/referenced'])
})

test('keeps manifest-free standalone skills disabled by default', async () => {
  const marketDir = '/dsh/agent-plugin-market/markets/market'
  const runtime = runtimeFor({
    '/dsh/agent-plugin-market/config.json': JSON.stringify({
      markets: [{ id: 'market', name: 'market', repo: 'example/market' }],
      installed: {},
      disabledSkills: {},
      enabledStandaloneSkills: {},
      hookApprovals: {},
    }),
    [marketDir + '/skills/standalone/SKILL.md']: skillDoc('standalone'),
  })

  assert.deepEqual(await runtime.collectSkills(), [])
})

test('loads explicitly enabled standalone skills', async () => {
  const marketDir = '/dsh/agent-plugin-market/markets/market'
  const runtime = runtimeFor({
    '/dsh/agent-plugin-market/config.json': JSON.stringify({
      markets: [{ id: 'market', name: 'market', repo: 'example/market' }],
      installed: {},
      disabledSkills: {},
      enabledStandaloneSkills: { 'market/standalone-skills/standalone': true },
      hookApprovals: {},
    }),
    [marketDir + '/skills/standalone/SKILL.md']: skillDoc('standalone'),
  })

  assert.deepEqual((await runtime.collectSkills()).map((skill) => skill.skillName), ['standalone'])
})

test('uses the current workspace config to override plugin and skill activation', async () => {
  const marketDir = '/dsh/agent-plugin-market/markets/market'
  const runtime = runtimeFor({
    '/dsh/agent-plugin-market/config.json': JSON.stringify({
      markets: [{ id: 'market', name: 'market', repo: 'example/market' }],
      installed: { 'market/global-plugin': { marketId: 'market', pluginName: 'global-plugin' } },
      disabledSkills: { 'market/workspace-plugin/re-enabled': true },
      enabledStandaloneSkills: {},
      hookApprovals: {},
    }),
    [marketDir + '/marketplace.json']: JSON.stringify({
      plugins: [
        { name: 'global-plugin', source: 'plugins/global-plugin' },
        { name: 'workspace-plugin', source: 'plugins/workspace-plugin' },
      ],
    }),
    [marketDir + '/plugins/global-plugin/plugin.json']: JSON.stringify({ name: 'global-plugin' }),
    [marketDir + '/plugins/global-plugin/skills/global/SKILL.md']: skillDoc('global'),
    [marketDir + '/plugins/workspace-plugin/plugin.json']: JSON.stringify({ name: 'workspace-plugin' }),
    [marketDir + '/plugins/workspace-plugin/skills/default/SKILL.md']: skillDoc('workspace-default'),
    [marketDir + '/plugins/workspace-plugin/skills/re-enabled/SKILL.md']: skillDoc('re-enabled'),
    [marketDir + '/skills/standalone/SKILL.md']: skillDoc('standalone'),
    '/workspace-a/.dsh/agent-plugin-market.json': JSON.stringify({
      plugins: {
        'market/global-plugin': false,
        'market/workspace-plugin': true,
      },
      pluginSkills: { 'market/workspace-plugin/re-enabled': true },
      standaloneSkills: { 'market/standalone-skills/standalone': true },
    }),
  })

  assert.deepEqual((await runtime.collectSkills({ cwd: '/workspace-a' })).map((skill) => skill.fullName), [
    'market/workspace-plugin/workspace-default',
    'market/workspace-plugin/re-enabled',
    'market/standalone-skills/standalone',
  ])
  assert.deepEqual((await runtime.collectSkills({ cwd: '/workspace-b' })).map((skill) => skill.fullName), [
    'market/global-plugin/global',
  ])
})

test('ignores a workspace config reached through a .dsh symlink', async () => {
  const marketDir = '/dsh/agent-plugin-market/markets/market'
  const runtime = runtimeFor({
    '/dsh/agent-plugin-market/config.json': JSON.stringify({
      markets: [{ id: 'market', name: 'market', repo: 'example/market' }],
      installed: { 'market/plugin': { marketId: 'market', pluginName: 'plugin' } },
      disabledSkills: {},
      enabledStandaloneSkills: {},
      hookApprovals: {},
    }),
    [marketDir + '/marketplace.json']: JSON.stringify({ plugins: [{ name: 'plugin', source: '.' }] }),
    [marketDir + '/plugin.json']: JSON.stringify({ name: 'plugin' }),
    [marketDir + '/skills/plugin/SKILL.md']: skillDoc('plugin'),
    '/outside/agent-plugin-market.json': JSON.stringify({ plugins: { 'market/plugin': false } }),
  }, {
    '/workspace/.dsh': '/outside',
  })

  assert.deepEqual((await runtime.collectSkills({ cwd: '/workspace' })).map((skill) => skill.fullName), ['market/plugin/plugin'])
})

test('ignores a workspace config file symlink', async () => {
  const marketDir = '/dsh/agent-plugin-market/markets/market'
  const runtime = runtimeFor({
    '/dsh/agent-plugin-market/config.json': JSON.stringify({
      markets: [{ id: 'market', name: 'market', repo: 'example/market' }],
      installed: { 'market/plugin': { marketId: 'market', pluginName: 'plugin' } },
      disabledSkills: {},
      enabledStandaloneSkills: {},
      hookApprovals: {},
    }),
    [marketDir + '/marketplace.json']: JSON.stringify({ plugins: [{ name: 'plugin', source: '.' }] }),
    [marketDir + '/plugin.json']: JSON.stringify({ name: 'plugin' }),
    [marketDir + '/skills/plugin/SKILL.md']: skillDoc('plugin'),
    '/workspace/.dsh/.keep': '',
    '/outside/agent-plugin-market.json': JSON.stringify({ plugins: { 'market/plugin': false } }),
  }, {
    '/workspace/.dsh/agent-plugin-market.json': '/outside/agent-plugin-market.json',
  })

  assert.deepEqual((await runtime.collectSkills({ cwd: '/workspace' })).map((skill) => skill.fullName), ['market/plugin/plugin'])
})

test('ignores the home directory as a workspace config root', async () => {
  const runtime = createMarketRuntime({
    fs: createVfsBackedFs({ '/home/me/.keep': '' }),
    subprocess: {},
    dshHome: '/home/me/.dsh',
  })

  assert.equal(runtime.isHomeWorkspace('/home/me'), true)
  assert.equal(await runtime.resolveWorkspaceConfig('/home/me'), null)
  await assert.rejects(() => runtime.saveWorkspaceConfig('/home/me', {}), /工作区配置路径不可用/)
})

test('writes new workspace configs with create-if-absent intent', async () => {
  const writes = []
  const fs = createVfsBackedFs({ '/workspace/.keep': '' }, {}, writes)
  const runtime = createMarketRuntime({
    fs,
    subprocess: {
      spawn(options) {
        return {
          done: Promise.resolve().then(() => fs.mkdirp(options.argv[2])).then(() => ({ exitCode: 0 })),
          collected: {},
        }
      },
    },
    dshHome: '/dsh',
  })

  await runtime.saveWorkspaceConfig('/workspace', { plugins: { 'market/plugin': true } })

  assert.equal(writes[0].path, '/workspace/.dsh/agent-plugin-market.json')
  assert.deepEqual(writes[0].expected, { kind: 'createIfAbsent' })
  assert.deepEqual(writes[0].sandboxPolicy, { mode: 'workspace-write', workspaceRoot: '/workspace' })
  assert.deepEqual(JSON.parse(writes[0].content), {
    version: 1,
    plugins: { 'market/plugin': true },
    pluginSkills: {},
    standaloneSkills: {},
  })
})

test('writes existing workspace configs with replace-if-version intent', async () => {
  const configPath = '/workspace/.dsh/agent-plugin-market.json'
  const writes = []
  const fs = createVfsBackedFs({ [configPath]: JSON.stringify({ version: 1 }) }, {}, writes)
  const runtime = createMarketRuntime({ fs, subprocess: {}, dshHome: '/dsh' })
  const target = await fs.resolve(configPath)
  const version = (await fs.stat(target)).version

  await runtime.saveWorkspaceConfig('/workspace', { standaloneSkills: { 'market/standalone-skills/skill': true } })

  assert.deepEqual(writes[0].expected, { kind: 'replaceIfVersion', version })
  assert.deepEqual(writes[0].sandboxPolicy, { mode: 'workspace-write', workspaceRoot: '/workspace' })
  assert.deepEqual(JSON.parse(writes[0].content), {
    version: 1,
    plugins: {},
    pluginSkills: {},
    standaloneSkills: { 'market/standalone-skills/skill': true },
  })
})

function serviceRuntime({ standaloneSkills }) {
  const config = { markets: [], installed: {}, disabledSkills: {}, enabledStandaloneSkills: {}, hookApprovals: {} }
  const workspaceConfigs = {}
  const commands = []
  return {
    config,
    workspaceConfigs,
    commands,
    runtime: {
      paths: { marketsDir: '/markets' },
      async ensureDir() {},
      async runProc(argv) {
        commands.push(argv)
        return ''
      },
      async parseMarketplace() {
        return null
      },
      async scanStandaloneSkills() {
        return standaloneSkills
      },
      async loadConfig() {
        return config
      },
      async saveConfig(next) {
        Object.assign(config, next)
      },
      async loadWorkspaceConfig(path) {
        return workspaceConfigs[path] || { version: 1, plugins: {}, pluginSkills: {}, standaloneSkills: {} }
      },
      async saveWorkspaceConfig(path, next) {
        workspaceConfigs[path] = next
      },
    },
  }
}

test('rejects a manifest-free repository without valid root skills', async () => {
  const fixture = serviceRuntime({ standaloneSkills: [] })
  const service = createMarketService({
    runtime: fixture.runtime,
    hooks: { async reconcile() {} },
    onSkillsChanged() {},
  })

  await assert.rejects(() => service.addMarket({ repo: 'example/empty.git' }), /skills/)

  assert.equal(fixture.config.markets.length, 0)
  assert.ok(fixture.commands.some((argv) => argv[0] === 'rm'))
})

test('adds a manifest-free repository when root skills are valid', async () => {
  const fixture = serviceRuntime({
    standaloneSkills: [{
      skillName: 'standalone',
      fullName: 'market/standalone-skills/standalone',
      description: 'Test standalone skill.',
      whenToUse: null,
    }],
  })
  let invalidated = 0
  const service = createMarketService({
    runtime: fixture.runtime,
    hooks: { async reconcile() {} },
    onSkillsChanged() { invalidated++ },
  })

  const added = await service.addMarket({ repo: 'example/skills.git' })

  assert.equal(added.name, 'skills')
  assert.equal(fixture.config.markets.length, 1)
  assert.equal(invalidated, 1)
  assert.equal(fixture.commands.some((argv) => argv[0] === 'rm'), false)
})

test('cleans a newly added market when setup fails after persistence', async () => {
  const fixture = serviceRuntime({
    standaloneSkills: [{
      skillName: 'standalone',
      fullName: 'market/standalone-skills/standalone',
      description: 'Test standalone skill.',
      whenToUse: null,
    }],
  })
  const service = createMarketService({
    runtime: fixture.runtime,
    hooks: { async reconcile() { throw new Error('hooks failed') } },
    onSkillsChanged() {},
  })

  await assert.rejects(() => service.addMarket({ repo: 'example/skills.git' }), /hooks failed/)

  assert.equal(fixture.config.markets.length, 0)
  assert.ok(fixture.commands.some((argv) => argv[0] === 'rm'))
})

test('exposes standalone skills separately from plugin skills', async () => {
  const fixture = serviceRuntime({
    standaloneSkills: [{
      skillName: 'standalone',
      fullName: 'market/standalone-skills/standalone',
      description: 'Test standalone skill.',
      whenToUse: null,
    }],
  })
  fixture.config.markets.push({ id: 'market', name: 'market', repo: 'example/market' })
  const service = createMarketService({
    runtime: fixture.runtime,
    hooks: { async reconcile() {} },
    onSkillsChanged() {},
  })

  const state = await service.getState()

  assert.deepEqual(state.markets[0].standaloneSkills, [{
    name: 'standalone',
    fullName: 'market/standalone-skills/standalone',
    description: 'Test standalone skill.',
    whenToUse: null,
    globalEnabled: false,
    workspaceOverride: null,
    enabled: false,
  }])
})

test('toggles all standalone skills for a market', async () => {
  const fixture = serviceRuntime({
    standaloneSkills: [
      { skillName: 'one', fullName: 'market/standalone-skills/one', description: 'One.', whenToUse: null },
      { skillName: 'two', fullName: 'market/standalone-skills/two', description: 'Two.', whenToUse: null },
    ],
  })
  fixture.config.markets.push({ id: 'market', name: 'market', repo: 'example/market' })
  let invalidated = 0
  const service = createMarketService({
    runtime: fixture.runtime,
    hooks: { async reconcile() {} },
    onSkillsChanged() { invalidated++ },
  })

  const enabled = await service.setStandaloneSkillsEnabled({ marketId: 'market', enabled: true })
  assert.equal(enabled.count, 2)
  assert.deepEqual(fixture.config.enabledStandaloneSkills, {
    'market/standalone-skills/one': true,
    'market/standalone-skills/two': true,
  })

  await service.setStandaloneSkillsEnabled({ marketId: 'market', enabled: false })
  assert.deepEqual(fixture.config.enabledStandaloneSkills, {})
  assert.equal(invalidated, 2)
})

test('toggles one standalone skill without changing plugin state', async () => {
  const fixture = serviceRuntime({ standaloneSkills: [] })
  const service = createMarketService({
    runtime: fixture.runtime,
    hooks: { async reconcile() {} },
    onSkillsChanged() {},
  })

  await service.setSkillEnabled({ fullName: 'market/standalone-skills/one', enabled: true, standalone: true })
  assert.deepEqual(fixture.config.enabledStandaloneSkills, { 'market/standalone-skills/one': true })
  assert.deepEqual(fixture.config.disabledSkills, {})

  await service.setSkillEnabled({ fullName: 'market/standalone-skills/one', enabled: false, standalone: true })
  assert.deepEqual(fixture.config.enabledStandaloneSkills, {})
})

test('writes and clears workspace overrides without changing global defaults', async () => {
  const fixture = serviceRuntime({ standaloneSkills: [] })
  const workspace = { id: 'workspace-a', title: 'Workspace A', path: '/workspace-a' }
  let invalidated = 0
  const service = createMarketService({
    runtime: fixture.runtime,
    hooks: { async reconcile() {} },
    workspaces: {
      list: () => [workspace],
      get: (id) => id === workspace.id ? workspace : undefined,
    },
    onSkillsChanged() { invalidated++ },
  })

  await service.setWorkspacePluginEnabled({
    workspaceId: workspace.id,
    marketId: 'market',
    pluginName: 'plugin',
    mode: 'enabled',
  })
  await service.setWorkspaceSkillEnabled({
    workspaceId: workspace.id,
    fullName: 'market/plugin/skill',
    mode: 'disabled',
  })

  assert.deepEqual(fixture.workspaceConfigs['/workspace-a'], {
    version: 1,
    plugins: { 'market/plugin': true },
    pluginSkills: { 'market/plugin/skill': false },
    standaloneSkills: {},
  })
  assert.deepEqual(fixture.config, { markets: [], installed: {}, disabledSkills: {}, enabledStandaloneSkills: {}, hookApprovals: {} })

  await service.clearWorkspaceOverrides({ workspaceId: workspace.id })
  assert.deepEqual(fixture.workspaceConfigs['/workspace-a'], { version: 1, plugins: {}, pluginSkills: {}, standaloneSkills: {} })
  assert.equal(invalidated, 3)
  await assert.rejects(() => service.setWorkspacePluginEnabled({ workspaceId: 'missing', marketId: 'market', pluginName: 'plugin', mode: 'enabled' }), /工作区/)
})

test('hides home workspace entries from configurable workspace state', async () => {
  const fixture = serviceRuntime({ standaloneSkills: [] })
  fixture.runtime.isHomeWorkspace = (workspacePath) => workspacePath === '/home/me'
  const home = { id: 'home', title: 'me', path: '/home/me' }
  const repo = { id: 'repo', title: 'repo', path: '/home/me/repo' }
  const service = createMarketService({
    runtime: fixture.runtime,
    hooks: { async reconcile() {} },
    workspaces: {
      list: () => [home, repo],
      get: (id) => ({ home, repo })[id],
    },
    onSkillsChanged() {},
  })

  assert.deepEqual((await service.getState()).workspaces, [repo])
  await assert.rejects(() => service.clearWorkspaceOverrides({ workspaceId: 'home' }), /工作区不存在或已移除/)
})
