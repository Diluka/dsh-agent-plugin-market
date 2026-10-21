import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
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
      // Mirror the mounted DSH backend's agentless workspace-write fallback.
      const policy = sandboxPolicy || { mode: 'workspace-write', workspaceRoot: '/workspace' }
      const file = targetPath(await resolve(displayPath(target)))
      const root = targetPath(await resolve(policy.workspaceRoot))
      if (policy.mode !== 'workspace-write' || !(file === root || file.startsWith(root + '/'))) {
        throw Object.assign(new Error('file access denied under workspace-write mode'), { code: 'FS_SANDBOX_DENIED' })
      }
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

test('removes a market when the default sandbox workspace is outside plugin storage', async () => {
  const configPath = '/dsh/agent-plugin-market/config.json'
  const removedId = 'ponytail'
  const config = {
    markets: [{ id: removedId, repo: 'example/ponytail' }, { id: 'keep', repo: 'example/keep' }],
    installed: {
      'ponytail/plugin': { marketId: removedId, pluginName: 'plugin' },
      'keep/plugin': { marketId: 'keep', pluginName: 'plugin' },
    },
    disabledSkills: { 'ponytail/plugin/skill': true, 'keep/plugin/skill': true },
    enabledStandaloneSkills: { 'ponytail/standalone-skills/skill': true, 'keep/standalone-skills/skill': true },
    hookApprovals: { 'ponytail/plugin': { fingerprint: 'remove' }, 'keep/plugin': { fingerprint: 'keep' } },
  }
  const expected = {
    markets: [config.markets[1]],
    installed: { 'keep/plugin': config.installed['keep/plugin'] },
    disabledSkills: { 'keep/plugin/skill': true },
    enabledStandaloneSkills: { 'keep/standalone-skills/skill': true },
    hookApprovals: { 'keep/plugin': { fingerprint: 'keep' } },
  }
  const writes = []
  const fs = createVfsBackedFs({ [configPath]: JSON.stringify(config) }, {}, writes)
  let checkoutRemovals = 0
  const runtime = createMarketRuntime({
    fs,
    subprocess: {
      spawn({ argv, cwd }) {
        assert.deepEqual(argv, ['rm', '-rf', '/dsh/agent-plugin-market/markets/ponytail'])
        assert.equal(cwd, '/dsh/agent-plugin-market/markets')
        checkoutRemovals++
        return { done: Promise.resolve({ exitCode: 0 }), collected: {} }
      },
    },
    dshHome: '/dsh',
  })
  let reconciled = 0
  let invalidated = 0
  const service = createMarketService({
    runtime,
    hooks: { async reconcile() { assert.deepEqual(await runtime.loadConfig(), expected); reconciled++ } },
    onSkillsChanged() { invalidated++ },
  })

  assert.deepEqual(await service.removeMarket({ marketId: removedId }), { removed: true })
  assert.deepEqual(await runtime.loadConfig(), expected)
  assert.deepEqual(writes[0].sandboxPolicy, { mode: 'workspace-write', workspaceRoot: '/dsh/agent-plugin-market' })
  assert.equal(checkoutRemovals, 1)
  assert.equal(reconciled, 1)
  assert.equal(invalidated, 1)
})

test('creates global config within plugin storage without widening the sandbox mode', async () => {
  const writes = []
  const fs = createVfsBackedFs({}, {}, writes)
  const runtime = createMarketRuntime({ fs, subprocess: {}, dshHome: '/dsh' })
  const config = await runtime.loadConfig()

  await runtime.saveConfig(config)

  assert.deepEqual(await runtime.loadConfig(), config)
  assert.equal(writes[0].path, '/dsh/agent-plugin-market/config.json')
  assert.deepEqual(writes[0].sandboxPolicy, { mode: 'workspace-write', workspaceRoot: '/dsh/agent-plugin-market' })
})

test('does not write global config through a symlink outside plugin storage', async () => {
  const configPath = '/dsh/agent-plugin-market/config.json'
  const fs = createVfsBackedFs({ '/outside/config.json': 'unchanged' }, { [configPath]: '/outside/config.json' })
  const runtime = createMarketRuntime({ fs, subprocess: {}, dshHome: '/dsh' })

  await assert.rejects(() => runtime.saveConfig({ markets: [], installed: {}, disabledSkills: {}, enabledStandaloneSkills: {}, hookApprovals: {} }), { code: 'FS_SANDBOX_DENIED' })
  assert.equal(await fs.readText(await fs.resolve('/outside/config.json')), 'unchanged')
})

test('bridge recovery guidance uses the target DSH cohort in state and enable errors', async () => {
  const { devDependencies } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const command = 'pnpm --dir "$DSH_PROFILE_DIR" add'
    + ' @deepseek-ai/dsh-hooks-codex@' + devDependencies['@deepseek-ai/dsh-hooks-codex']
    + ' @deepseek-ai/dsh-hook-protocol@' + devDependencies['@deepseek-ai/dsh-hook-protocol']
  const service = createMarketService({
    runtime: runtimeFor({}),
    hooks: { available: false, async reconcile() {} },
    onSkillsChanged() {},
  })

  const state = await service.getState()
  assert.equal(state.hooksBridge.available, false)
  assert.equal(state.hooksBridge.installCommand, command)
  await assert.rejects(() => service.setPluginHooksEnabled({ marketId: 'market', pluginName: 'plugin', enabled: true }), (error) => {
    assert.match(error.message, /Codex hooks bridge 不可用/)
    assert.ok(error.message.includes(command))
    return true
  })
})

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

test('enables a plugin skill in a workspace even when the plugin base is not installed', async () => {
  const marketDir = '/dsh/agent-plugin-market/markets/market'
  const runtime = runtimeFor({
    '/dsh/agent-plugin-market/config.json': JSON.stringify({
      markets: [{ id: 'market', name: 'market', repo: 'example/market' }],
      installed: {},
      disabledSkills: {},
      enabledStandaloneSkills: {},
      hookApprovals: {},
    }),
    [marketDir + '/marketplace.json']: JSON.stringify({
      plugins: [{ name: 'plugin', source: 'plugins/plugin' }],
    }),
    [marketDir + '/plugins/plugin/plugin.json']: JSON.stringify({ name: 'plugin' }),
    [marketDir + '/plugins/plugin/skills/one/SKILL.md']: skillDoc('one'),
    [marketDir + '/plugins/plugin/skills/two/SKILL.md']: skillDoc('two'),
    '/workspace-a/.dsh/agent-plugin-market.json': JSON.stringify({
      plugins: {},
      pluginSkills: { 'market/plugin/one': true },
      standaloneSkills: {},
    }),
  })

  // plugin is not installed globally and has no workspace override (inherit); skill 'one' is override-enabled.
  assert.deepEqual((await runtime.collectSkills({ cwd: '/workspace-a' })).map((skill) => skill.fullName), [
    'market/plugin/one',
  ])
  // a workspace with no overrides inherits the disabled plugin base -> no plugin skills.
  assert.deepEqual((await runtime.collectSkills({ cwd: '/workspace-b' })).map((skill) => skill.fullName), [])
})

function blockedActivationFixture({
  installed = true, source = 'plugins/plugin', refuseSave = false,
  duplicate = false, duplicateSource = 'plugins/duplicate',
  additionalSource = '', unreadableSource = false,
  globalOverrides = {}, workspaceOverrides = {}, additionalFiles = {}, aliases = {},
} = {}) {
  const marketDir = '/dsh/agent-plugin-market/markets/market'
  const globalConfig = {
    markets: [{ id: 'market', name: 'market', repo: 'example/market' }],
    installed: installed ? { 'market/plugin': { marketId: 'market', pluginName: 'plugin' } } : {},
    disabledSkills: { 'market/plugin/three': true },
    enabledStandaloneSkills: {},
    hookApprovals: {},
    ...globalOverrides,
  }
  const workspaceConfig = {
    version: 1,
    plugins: { 'market/plugin': false, 'unrelated/plugin': false },
    pluginSkills: { 'market/plugin/two': true, 'unrelated/plugin/keep': true },
    standaloneSkills: { 'unrelated/standalone-skills/keep': true },
    ...workspaceOverrides,
  }
  const writes = []
  const fs = createVfsBackedFs({
    '/dsh/agent-plugin-market/config.json': JSON.stringify(globalConfig),
    [marketDir + '/marketplace.json']: JSON.stringify({ plugins: [{ name: 'plugin', source }, ...(duplicate ? [{ name: 'plugin', source: duplicateSource }] : [])] }),
    [marketDir + '/plugins/plugin/plugin.json']: JSON.stringify({ name: 'plugin', ...(additionalSource ? { skills: ['skills', additionalSource] } : {}) }),
    ...Object.fromEntries(['one', 'two', 'three', 'four'].map((name) => [marketDir + '/plugins/plugin/skills/' + name + '/SKILL.md', skillDoc(name)])),
    ...(duplicate ? {
      [marketDir + '/plugins/duplicate/plugin.json']: JSON.stringify({ name: 'plugin' }),
      [marketDir + '/plugins/duplicate/skills/five/SKILL.md']: skillDoc('five'),
    } : {}),
    ...(additionalSource === 'extra' ? { [marketDir + '/plugins/plugin/extra/five/SKILL.md']: skillDoc('five') } : {}),
    '/workspace-a/.dsh/agent-plugin-market.json': JSON.stringify(workspaceConfig),
    ...additionalFiles,
  }, aliases, writes)
  if (refuseSave) fs.writeText = async () => { throw new Error('fixture save refused') }
  let readable = !unreadableSource
  const listDir = fs.listDir
  fs.listDir = async (target) => {
    const dir = typeof target === 'string' ? target : target.displayPath
    if (!readable && dir.endsWith('/extra')) throw Object.assign(new Error('fixture EIO'), { code: 'EIO' })
    return listDir(target)
  }
  const runtime = createMarketRuntime({ fs, subprocess: {}, dshHome: '/dsh' })
  const workspace = { id: 'workspace-a', title: 'A', path: '/workspace-a' }
  let invalidated = 0
  let reconciled = 0
  const service = createMarketService({
    runtime,
    hooks: { async reconcile() { reconciled++ } },
    workspaces: { list: () => [workspace], get: (id) => id === workspace.id ? workspace : undefined },
    onSkillsChanged() { invalidated++ },
  })
  return { runtime, service, globalConfig, workspaceConfig, writes, invalidated: () => invalidated, reconciled: () => reconciled, recoverSource() { readable = true } }
}

function ownerCollisionFixture(globalOverrides = {}) {
  const root = '/dsh/agent-plugin-market/markets/market'
  return blockedActivationFixture({
    globalOverrides: {
      installed: {
        'market/p': { marketId: 'market', pluginName: 'p' },
        'market/p/q': { marketId: 'market', pluginName: 'p/q' },
      },
      disabledSkills: {},
      enabledStandaloneSkills: { 'market/standalone-skills/solo': true },
      ...globalOverrides,
    },
    workspaceOverrides: {
      plugins: { 'market/p': true, 'market/p/q': true },
      pluginSkills: { 'market/p/a': false, 'market/p/q': false, 'market/p/q/b': false },
    },
    additionalFiles: {
      [root + '/marketplace.json']: JSON.stringify({ plugins: [
        { name: 'p', source: 'plugins/p' }, { name: 'p/q', source: 'plugins/pq' },
      ] }),
      [root + '/plugins/p/plugin.json']: JSON.stringify({ name: 'p' }),
      [root + '/plugins/p/skills/a/SKILL.md']: skillDoc('a'),
      [root + '/plugins/p/skills/q/SKILL.md']: skillDoc('q'),
      [root + '/plugins/pq/plugin.json']: JSON.stringify({ name: 'p/q' }),
      [root + '/plugins/pq/skills/b/SKILL.md']: skillDoc('b'),
      [root + '/skills/solo/SKILL.md']: skillDoc('solo'),
    },
  })
}

for (const { pluginName, skills, otherPluginName, otherSkills } of [
  { pluginName: 'p', skills: ['a', 'q'], otherPluginName: 'p/q', otherSkills: ['b'] },
  { pluginName: 'p/q', skills: ['b'], otherPluginName: 'p', otherSkills: ['a', 'q'] },
]) {
  for (const { action, mode } of [
    { action: 'single', mode: 'enabled' }, { action: 'single', mode: 'disabled' }, { action: 'single', mode: 'inherit' },
    { action: 'master', mode: 'enabled' }, { action: 'master', mode: 'disabled' }, { action: 'master', mode: 'inherit' },
  ]) {
    test(`exact plugin owner isolation: ${pluginName} ${action} ${mode}`, async () => {
      const fixture = ownerCollisionFixture()
      const { service, runtime } = fixture
      const stateBefore = await service.getState({ workspaceId: 'workspace-a' })
      const otherViewBefore = stateBefore.markets[0].plugins.find((plugin) => plugin.name === otherPluginName)
      const otherWorkspaceBefore = await runtime.collectSkills({ cwd: '/workspace-b' })
      const reconciledBefore = fixture.reconciled()
      const args = { workspaceId: 'workspace-a', marketId: 'market', pluginName }
      if (action === 'single') {
        await service.setWorkspaceSkillEnabled({ workspaceId: 'workspace-a', fullName: 'market/' + pluginName + '/' + skills[0], mode })
      } else if (mode === 'inherit') {
        await service.setWorkspacePluginEnabled({ ...args, mode })
      } else {
        await service.setPluginSkillsEnabled({ ...args, enabled: mode === 'enabled' })
      }
      assert.equal(fixture.reconciled(), reconciledBefore, 'activation never reconciles hooks')
      const current = await runtime.loadWorkspaceConfig('/workspace-a')
      assert.equal(current.plugins['market/' + otherPluginName], true)
      for (const skill of otherSkills) assert.equal(current.pluginSkills['market/' + otherPluginName + '/' + skill], false)
      assert.deepEqual(current.standaloneSkills, fixture.workspaceConfig.standaloneSkills)
      assert.deepEqual(await runtime.loadConfig(), fixture.globalConfig)
      assert.deepEqual(await runtime.collectSkills({ cwd: '/workspace-b' }), otherWorkspaceBefore)
      const state = await service.getState({ workspaceId: 'workspace-a' })
      assert.deepEqual(state.markets[0].plugins.find((plugin) => plugin.name === otherPluginName), otherViewBefore)
      assert.deepEqual(state.markets[0].standaloneSkills, stateBefore.markets[0].standaloneSkills)
      const target = state.markets[0].plugins.find((plugin) => plugin.name === pluginName)
      const expected = mode === 'disabled' ? [] : action === 'single' ? [skills[0]] : skills
      assert.deepEqual(target.skills.filter((skill) => skill.enabled).map((skill) => skill.name), expected)
      assert.equal(fixture.writes.length, 1)
      assert.equal(fixture.invalidated(), 1)
    })
  }

  test(`exact plugin owner uninstall preserves other plugin disabled states: ${pluginName}`, async () => {
    const fixture = ownerCollisionFixture({
      disabledSkills: { 'market/p/a': true, 'market/p/q': true, 'market/p/q/b': true },
      hookApprovals: { 'market/p': { fingerprint: 'p' }, 'market/p/q': { fingerprint: 'pq' } },
    })
    const { service, runtime } = fixture
    const before = (await service.getState()).markets[0].plugins.find((plugin) => plugin.name === otherPluginName)
    await service.uninstallPlugin({ marketId: 'market', pluginName })
    const current = await runtime.loadConfig()
    assert.equal(current.installed['market/' + pluginName], undefined)
    assert.deepEqual(current.installed['market/' + otherPluginName], fixture.globalConfig.installed['market/' + otherPluginName])
    assert.equal(current.hookApprovals['market/' + pluginName], undefined)
    assert.deepEqual(current.hookApprovals['market/' + otherPluginName], fixture.globalConfig.hookApprovals['market/' + otherPluginName])
    for (const skill of skills) assert.equal(current.disabledSkills['market/' + pluginName + '/' + skill], undefined)
    for (const skill of otherSkills) assert.equal(current.disabledSkills['market/' + otherPluginName + '/' + skill], true)
    assert.deepEqual(await runtime.loadWorkspaceConfig('/workspace-a'), fixture.workspaceConfig)
    assert.deepEqual((await service.getState()).markets[0].plugins.find((plugin) => plugin.name === otherPluginName), before)
  })
}

for (const installed of [true, false]) {
  test(`enabling a skill lifts its disabled parent without enabling siblings (installed=${installed})`, async () => {
    const fixture = blockedActivationFixture({ installed })
    const { runtime, service } = fixture
    const otherWorkspaceBefore = await runtime.collectSkills({ cwd: '/workspace-b' })
    assert.deepEqual(await runtime.collectSkills({ cwd: '/workspace-a' }), [])

    await service.setWorkspaceSkillEnabled({ workspaceId: 'workspace-a', fullName: 'market/plugin/one', mode: 'enabled' })
    assert.deepEqual((await runtime.collectSkills({ cwd: '/workspace-a' })).map((skill) => skill.fullName), ['market/plugin/one'])
    const state = await service.getState({ workspaceId: 'workspace-a' })
    assert.equal(state.markets[0].plugins[0].enabled, true)
    assert.equal(state.markets[0].plugins[0].activationState, 'partial')
    assert.equal(state.markets[0].plugins[0].installed, installed)
    assert.deepEqual(state.markets[0].plugins[0].skills.map((skill) => [skill.name, skill.enabled]), [
      ['four', false], ['one', true], ['three', false], ['two', false],
    ])
    assert.deepEqual(await runtime.loadWorkspaceConfig('/workspace-a'), {
      ...fixture.workspaceConfig,
      plugins: { 'unrelated/plugin': false },
      pluginSkills: {
        ...(installed ? { 'market/plugin/two': false, 'market/plugin/four': false } : { 'market/plugin/one': true }),
        'unrelated/plugin/keep': true,
      },
    })
    assert.deepEqual(await runtime.loadConfig(), fixture.globalConfig)
    assert.deepEqual(await runtime.collectSkills({ cwd: '/workspace-b' }), otherWorkspaceBefore)
    assert.equal(fixture.writes.length, 1, 'parent and skill coordination is one workspace write')
    assert.equal(fixture.writes[0].path, '/workspace-a/.dsh/agent-plugin-market.json')
    assert.equal(fixture.invalidated(), 1)

    await service.setWorkspaceSkillEnabled({ workspaceId: 'workspace-a', fullName: 'market/plugin/one', mode: 'disabled' })
    assert.deepEqual(await runtime.collectSkills({ cwd: '/workspace-a' }), [])
    await service.setWorkspaceSkillEnabled({ workspaceId: 'workspace-a', fullName: 'market/plugin/two', mode: 'enabled' })
    assert.deepEqual((await runtime.collectSkills({ cwd: '/workspace-a' })).map((skill) => skill.fullName), ['market/plugin/two'])
    await service.setWorkspacePluginEnabled({ workspaceId: 'workspace-a', marketId: 'market', pluginName: 'plugin', mode: 'disabled' })
    await service.setWorkspaceSkillEnabled({ workspaceId: 'workspace-a', fullName: 'market/plugin/four', mode: 'enabled' })
    assert.deepEqual((await runtime.collectSkills({ cwd: '/workspace-a' })).map((skill) => skill.fullName), ['market/plugin/four'])
  })
}

for (const target of ['one', 'five']) {
  test(`coordination includes every source sharing a plugin key when enabling ${target}`, async () => {
    const fixture = blockedActivationFixture({ duplicate: true })
    await fixture.service.setWorkspaceSkillEnabled({ workspaceId: 'workspace-a', fullName: 'market/plugin/' + target, mode: 'enabled' })
    assert.deepEqual((await fixture.runtime.collectSkills({ cwd: '/workspace-a' })).map((skill) => skill.fullName), ['market/plugin/' + target])
    assert.equal(fixture.writes.length, 1)
  })
}

test('an incomplete multi-source scan cannot activate the parent or omit a sibling', async () => {
  const fixture = blockedActivationFixture({ additionalSource: 'extra', unreadableSource: true })
  await assert.rejects(() => fixture.service.setWorkspaceSkillEnabled({
    workspaceId: 'workspace-a', fullName: 'market/plugin/one', mode: 'enabled',
  }), /fixture EIO/)
  assert.deepEqual(await fixture.runtime.loadWorkspaceConfig('/workspace-a'), fixture.workspaceConfig)
  assert.equal(fixture.writes.length, 0)
  assert.equal(fixture.invalidated(), 0)
  fixture.recoverSource()
  assert.deepEqual(await fixture.runtime.collectSkills({ cwd: '/workspace-a' }), [])
  await fixture.service.setWorkspaceSkillEnabled({ workspaceId: 'workspace-a', fullName: 'market/plugin/one', mode: 'enabled' })
  assert.deepEqual((await fixture.runtime.collectSkills({ cwd: '/workspace-a' })).map((skill) => skill.fullName), ['market/plugin/one'])
  assert.equal((await fixture.runtime.loadWorkspaceConfig('/workspace-a')).pluginSkills['market/plugin/five'], false)
})

for (const scenario of [
  { name: 'unknown skill', fullName: 'market/plugin/missing', pattern: /技能不存在/ },
  { name: 'missing declared source', additionalSource: 'missing', pattern: /技能目录/ },
  { name: 'escaped declared source', additionalSource: '../../outside', pattern: /技能目录/ },
  { name: 'escaped plugin source', source: '../../outside', pattern: /插件路径/ },
  { name: 'refused save', refuseSave: true, pattern: /fixture save refused/ },
]) {
  test(`failed activation leaves parent and siblings unchanged: ${scenario.name}`, async () => {
    const fixture = blockedActivationFixture(scenario)
    await assert.rejects(() => fixture.service.setWorkspaceSkillEnabled({
      workspaceId: 'workspace-a', fullName: scenario.fullName || 'market/plugin/one', mode: 'enabled',
    }), scenario.pattern)
    assert.deepEqual(await fixture.runtime.loadWorkspaceConfig('/workspace-a'), fixture.workspaceConfig)
    assert.deepEqual(await fixture.runtime.loadConfig(), fixture.globalConfig)
    assert.equal(fixture.writes.length, 0)
    assert.equal(fixture.invalidated(), 0)
  })
}

const strictActivationCommands = [
  { name: 'global batch on', run: (service) => service.setPluginSkillsEnabled({ marketId: 'market', pluginName: 'plugin', enabled: true }) },
  { name: 'global batch off', run: (service) => service.setPluginSkillsEnabled({ marketId: 'market', pluginName: 'plugin', enabled: false }) },
  { name: 'workspace batch', run: (service) => service.setPluginSkillsEnabled({ workspaceId: 'workspace-a', marketId: 'market', pluginName: 'plugin', enabled: true }) },
  { name: 'workspace plugin wrapper', run: (service) => service.setWorkspacePluginEnabled({ workspaceId: 'workspace-a', marketId: 'market', pluginName: 'plugin', mode: 'disabled' }) },
  { name: 'workspace individual disabled', run: (service) => service.setWorkspaceSkillEnabled({ workspaceId: 'workspace-a', fullName: 'market/plugin/one', mode: 'disabled' }) },
  { name: 'workspace individual inherit', run: (service) => service.setWorkspaceSkillEnabled({ workspaceId: 'workspace-a', fullName: 'market/plugin/one', mode: 'inherit' }) },
]

for (const command of strictActivationCommands) {
  for (const scenario of [
    { name: 'missing plugin directory', source: 'plugins/missing', pattern: /插件路径/ },
    { name: 'escaped plugin directory', source: '../../outside', pattern: /插件路径/ },
    { name: 'symlinked plugin outside market', source: 'plugins/link', aliases: { '/dsh/agent-plugin-market/markets/market/plugins/link': '/outside' }, additionalFiles: { '/outside/.keep': '' }, pattern: /插件路径/ },
    { name: 'missing declared skill directory', additionalSource: 'missing', pattern: /技能目录/ },
    { name: 'escaped declared skill directory', additionalSource: '../../outside', pattern: /技能目录/ },
    { name: 'directory EIO', additionalSource: 'extra', unreadableSource: true, pattern: /fixture EIO/ },
    { name: 'missing later same-key source', duplicate: true, duplicateSource: 'plugins/missing', pattern: /插件路径/ },
    { name: 'escaped later same-key source', duplicate: true, duplicateSource: '../../outside', pattern: /插件路径/ },
    { name: 'EIO in later same-key source', duplicate: true, unreadableSource: true, additionalFiles: {
      '/dsh/agent-plugin-market/markets/market/plugins/duplicate/plugin.json': JSON.stringify({ name: 'plugin', skills: ['skills', 'extra'] }),
      '/dsh/agent-plugin-market/markets/market/plugins/duplicate/extra/six/SKILL.md': skillDoc('six'),
    }, pattern: /fixture EIO/ },
    { name: 'refused save', refuseSave: true, pattern: /fixture save refused/ },
  ]) {
    test(`strict activation fails atomically for ${command.name}: ${scenario.name}`, async () => {
      const fixture = blockedActivationFixture({ ...scenario, workspaceOverrides: { plugins: {} } })
      // Return shared live objects as well as checking persisted bytes: rejected
      // saves must not leave pre-save changes visible to other callers.
      fixture.runtime.loadConfig = async () => fixture.globalConfig
      fixture.runtime.loadWorkspaceConfig = async () => fixture.workspaceConfig
      const globalBefore = structuredClone(fixture.globalConfig)
      const workspaceBefore = structuredClone(fixture.workspaceConfig)
      await assert.rejects(() => command.run(fixture.service), scenario.pattern)
      assert.deepEqual(fixture.globalConfig, globalBefore)
      assert.deepEqual(fixture.workspaceConfig, workspaceBefore)
      assert.equal(fixture.writes.length, 0)
      assert.equal(fixture.invalidated(), 0)
      assert.equal(fixture.reconciled(), 0)
    })
  }
}

test('batch activation rejects invalid requests before saving or invalidating skills', async () => {
  const fixture = blockedActivationFixture()
  for (const args of [
    { marketId: 'market', pluginName: 'plugin', enabled: 'true' },
    { marketId: '', pluginName: 'plugin', enabled: true },
    { marketId: 'market', pluginName: '', enabled: false },
    { workspaceId: 'missing', marketId: 'market', pluginName: 'plugin', enabled: true },
    { workspaceId: 'workspace-a', marketId: 'missing', pluginName: 'plugin', enabled: true },
    { workspaceId: 'workspace-a', marketId: 'market', pluginName: 'missing', enabled: false },
  ]) await assert.rejects(() => fixture.service.setPluginSkillsEnabled(args))
  assert.equal(fixture.writes.length, 0)
  assert.equal(fixture.invalidated(), 0)
  assert.equal(fixture.reconciled(), 0)
})

test('batch scans supported same-key entries without accepting unsupported remote sources', async () => {
  const fixture = blockedActivationFixture({ additionalFiles: {
    '/dsh/agent-plugin-market/markets/market/marketplace.json': JSON.stringify({ plugins: [
      { name: 'plugin', source: 'plugins/plugin' },
      { name: 'plugin', source: { source: 'github', repo: 'untrusted/other' } },
    ] }),
  } })
  const result = await fixture.service.setPluginSkillsEnabled({ marketId: 'market', pluginName: 'plugin', enabled: false })
  assert.equal(result.count, 4)
  assert.deepEqual(await fixture.runtime.collectSkills(), [])
  const views = (await fixture.service.getState()).markets[0].plugins
  assert.equal(views.filter((view) => !view.unsupported).length, 1)
  assert.equal(views.find((view) => view.unsupported).activationState, 'disabled')
})

for (const scope of ['global', 'workspace']) {
  test(`group and individual toggles operate on actual skills throughout the full sequence (${scope})`, async () => {
    const fixture = blockedActivationFixture({ duplicate: true })
    const { service, runtime } = fixture
    const scopeArgs = scope === 'workspace' ? { workspaceId: 'workspace-a' } : {}
    const otherWorkspaceBefore = await runtime.collectSkills({ cwd: '/workspace-b' })
    const group = (enabled) => service.setPluginSkillsEnabled({ marketId: 'market', pluginName: 'plugin', enabled, ...scopeArgs })
    const single = (name, enabled) => scope === 'workspace'
      ? service.setWorkspaceSkillEnabled({ ...scopeArgs, fullName: 'market/plugin/' + name, mode: enabled ? 'enabled' : 'disabled' })
      : service.setSkillEnabled({ fullName: 'market/plugin/' + name, enabled })
    const assertActivation = async (names, activationState) => {
      const state = await service.getState(scopeArgs)
      assert.equal(state.markets[0].plugins.length, 1, 'supported sources sharing a key have one control')
      const view = state.markets[0].plugins[0]
      assert.equal(view.skills.length, 5)
      assert.equal(view.installed, true, 'activation never uninstalls the resource')
      assert.equal(view.activationState, activationState)
      assert.equal(view.enabled, names.length > 0)
      assert.deepEqual(view.skills.filter((skill) => skill.enabled).map((skill) => skill.name).sort(), [...names].sort())
      assert.deepEqual((await runtime.collectSkills({ cwd: scope === 'workspace' ? '/workspace-a' : '/workspace-b' }))
        .map((skill) => skill.skillName).sort(), [...names].sort())
    }

    assert.equal((await group(false)).count, 5)
    await assertActivation([], 'disabled')
    await single('one', true)
    await assertActivation(['one'], 'partial')
    await group(true)
    await assertActivation(['one', 'two', 'three', 'four', 'five'], 'enabled')
    await single('one', false)
    await assertActivation(['two', 'three', 'four', 'five'], 'partial')
    await group(false)
    await assertActivation([], 'disabled')
    await single('two', true)
    await assertActivation(['two'], 'partial')

    assert.equal(fixture.writes.length, 6, 'one save per operation')
    assert.equal(fixture.invalidated(), 6)
    assert.deepEqual((await runtime.loadConfig()).installed, fixture.globalConfig.installed)
    if (scope === 'workspace') {
      assert.deepEqual(await runtime.loadConfig(), fixture.globalConfig)
      assert.deepEqual(await runtime.collectSkills({ cwd: '/workspace-b' }), otherWorkspaceBefore)
      const config = await runtime.loadWorkspaceConfig('/workspace-a')
      assert.deepEqual(config.plugins, { 'unrelated/plugin': false })
      assert.equal(config.pluginSkills['unrelated/plugin/keep'], true)
      assert.deepEqual(config.standaloneSkills, fixture.workspaceConfig.standaloneSkills)
    } else {
      assert.deepEqual(await runtime.loadWorkspaceConfig('/workspace-a'), fixture.workspaceConfig)
    }
  })
}

test('global batch off retains installation, hook approvals and unrelated settings without reconciling hooks', async () => {
  const fixture = blockedActivationFixture({ globalOverrides: {
    disabledSkills: { 'market/plugin/three': true, 'unrelated/plugin/keep': true },
    enabledStandaloneSkills: { 'market/standalone-skills/keep': true },
    hookApprovals: { 'market/plugin': { fingerprint: 'approved', approvedAt: 123 } },
  } })
  const { service, runtime } = fixture
  await service.setPluginSkillsEnabled({ marketId: 'market', pluginName: 'plugin', enabled: false })
  let config = await runtime.loadConfig()
  assert.deepEqual(config.disabledSkills, {
    'market/plugin/one': true, 'market/plugin/two': true, 'market/plugin/three': true,
    'market/plugin/four': true, 'unrelated/plugin/keep': true,
  })
  await service.setPluginSkillsEnabled({ marketId: 'market', pluginName: 'plugin', enabled: true })
  config = await runtime.loadConfig()
  assert.deepEqual(config.disabledSkills, { 'unrelated/plugin/keep': true })
  for (const key of ['markets', 'installed', 'enabledStandaloneSkills', 'hookApprovals']) {
    assert.deepEqual(config[key], fixture.globalConfig[key])
  }
  assert.deepEqual(await runtime.loadWorkspaceConfig('/workspace-a'), fixture.workspaceConfig)
  assert.equal(fixture.reconciled(), 0)
  assert.equal(fixture.invalidated(), 2)
  assert.equal(fixture.writes.length, 2)
})

for (const enabled of [true, false]) {
  test(`global group toggle requires installation even for enabled=${enabled}`, async () => {
    const fixture = blockedActivationFixture({ installed: false })
    await assert.rejects(() => fixture.service.setPluginSkillsEnabled({ marketId: 'market', pluginName: 'plugin', enabled }), /请先安装/)
    assert.deepEqual(await fixture.runtime.loadConfig(), fixture.globalConfig)
    assert.equal(fixture.writes.length, 0)
    assert.equal(fixture.invalidated(), 0)
    assert.equal(fixture.reconciled(), 0)
  })
}

test('workspace batch toggles retain only global mixed-state differences and inherit after a full match', async () => {
  const fixture = blockedActivationFixture()
  const { service, runtime } = fixture
  const args = { workspaceId: 'workspace-a', marketId: 'market', pluginName: 'plugin' }
  await service.setPluginSkillsEnabled({ ...args, enabled: true })
  let current = await runtime.loadWorkspaceConfig('/workspace-a')
  assert.deepEqual(current.plugins, { 'unrelated/plugin': false })
  assert.deepEqual(current.pluginSkills, { 'market/plugin/three': true, 'unrelated/plugin/keep': true })
  await service.setSkillEnabled({ fullName: 'market/plugin/two', enabled: false })
  assert.deepEqual((await runtime.collectSkills({ cwd: '/workspace-a' })).map((skill) => skill.skillName).sort(), ['four', 'one', 'three'])

  await service.setWorkspacePluginEnabled({ ...args, mode: 'disabled' })
  current = await runtime.loadWorkspaceConfig('/workspace-a')
  assert.deepEqual(current.plugins, { 'unrelated/plugin': false })
  assert.deepEqual(current.pluginSkills, { 'market/plugin/one': false, 'market/plugin/four': false, 'unrelated/plugin/keep': true })
  await service.setPluginSkillsEnabled({ marketId: 'market', pluginName: 'plugin', enabled: false })
  await service.setWorkspacePluginEnabled({ ...args, mode: 'disabled' })
  current = await runtime.loadWorkspaceConfig('/workspace-a')
  assert.deepEqual(current.pluginSkills, { 'unrelated/plugin/keep': true }, 'full match clears the entire local group')
  await service.setPluginSkillsEnabled({ marketId: 'market', pluginName: 'plugin', enabled: true })
  assert.deepEqual((await runtime.collectSkills({ cwd: '/workspace-a' })).map((skill) => skill.skillName).sort(), ['four', 'one', 'three', 'two'])
  assert.deepEqual(current.standaloneSkills, fixture.workspaceConfig.standaloneSkills)
})

for (const installed of [true, false]) {
  test(`equal-to-global workspace individual targets delete overrides and follow subsequent global changes (installed=${installed})`, async () => {
    const fixture = blockedActivationFixture({
      installed,
      workspaceOverrides: {
        plugins: { 'unrelated/plugin': false },
        pluginSkills: { 'market/plugin/one': !installed, 'market/plugin/two': !installed, 'unrelated/plugin/keep': true },
      },
    })
    const { service, runtime } = fixture
    const siblingsBefore = (await service.getState({ workspaceId: 'workspace-a' })).markets[0].plugins[0].skills
      .filter((skill) => skill.name !== 'one').map((skill) => [skill.name, skill.enabled])
    await service.setWorkspaceSkillEnabled({ workspaceId: 'workspace-a', fullName: 'market/plugin/one', mode: installed ? 'enabled' : 'disabled' })
    const current = await runtime.loadWorkspaceConfig('/workspace-a')
    assert.equal(current.pluginSkills['market/plugin/one'], undefined)
    assert.equal(current.pluginSkills['market/plugin/two'], !installed)
    const view = (await service.getState({ workspaceId: 'workspace-a' })).markets[0].plugins[0]
    assert.deepEqual(view.skills.filter((skill) => skill.name !== 'one').map((skill) => [skill.name, skill.enabled]), siblingsBefore)
    assert.equal(view.skills.find((skill) => skill.name === 'one').globalEnabled, installed)
    if (installed) {
      await service.setSkillEnabled({ fullName: 'market/plugin/one', enabled: false })
      assert.equal((await service.getState({ workspaceId: 'workspace-a' })).markets[0].plugins[0].skills.find((skill) => skill.name === 'one').enabled, false)
    } else {
      await service.installPlugin({ marketId: 'market', pluginName: 'plugin' })
      assert.equal((await service.getState({ workspaceId: 'workspace-a' })).markets[0].plugins[0].skills.find((skill) => skill.name === 'one').enabled, true)
    }
  })
}

test('single-skill changes migrate a legacy enabled parent without losing sibling actual states', async () => {
  const fixture = blockedActivationFixture({
    installed: false,
    workspaceOverrides: {
      plugins: { 'market/plugin': true, 'unrelated/plugin': false },
      pluginSkills: { 'market/plugin/two': false, 'market/plugin/three': true, 'unrelated/plugin/keep': true },
    },
  })
  const { service, runtime } = fixture
  await service.setWorkspaceSkillEnabled({ workspaceId: 'workspace-a', fullName: 'market/plugin/one', mode: 'disabled' })
  let current = await runtime.loadWorkspaceConfig('/workspace-a')
  assert.deepEqual(current.plugins, { 'unrelated/plugin': false })
  assert.deepEqual(current.pluginSkills, { 'market/plugin/three': true, 'market/plugin/four': true, 'unrelated/plugin/keep': true })
  assert.deepEqual((await runtime.collectSkills({ cwd: '/workspace-a' })).map((skill) => skill.skillName).sort(), ['four', 'three'])
  await service.setWorkspaceSkillEnabled({ workspaceId: 'workspace-a', fullName: 'market/plugin/three', mode: 'inherit' })
  current = await runtime.loadWorkspaceConfig('/workspace-a')
  assert.deepEqual(current.pluginSkills, { 'market/plugin/four': true, 'unrelated/plugin/keep': true })
  assert.deepEqual((await runtime.collectSkills({ cwd: '/workspace-a' })).map((skill) => skill.skillName), ['four'])
  assert.deepEqual(await runtime.loadConfig(), fixture.globalConfig)
  assert.equal(fixture.reconciled(), 0)
})

test('advanced plugin inherit clears all parent and child flags while preserving other groups', async () => {
  const fixture = blockedActivationFixture({ workspaceOverrides: { pluginSkills: {
    'market/plugin/one': false, 'market/plugin/stale': true, 'unrelated/plugin/keep': true,
  } } })
  const { service, runtime } = fixture
  const result = await service.setWorkspacePluginEnabled({ workspaceId: 'workspace-a', marketId: 'market', pluginName: 'plugin', mode: 'inherit' })
  assert.deepEqual(result, { workspaceId: 'workspace-a', key: 'market/plugin', mode: 'inherit' })
  assert.deepEqual(await runtime.loadWorkspaceConfig('/workspace-a'), {
    ...fixture.workspaceConfig, plugins: { 'unrelated/plugin': false }, pluginSkills: { 'unrelated/plugin/keep': true },
  })
  assert.deepEqual((await runtime.collectSkills({ cwd: '/workspace-a' })).map((skill) => skill.skillName).sort(), ['four', 'one', 'two'])
  assert.deepEqual(await runtime.loadConfig(), fixture.globalConfig)
  assert.equal(fixture.writes.length, 1)
  assert.equal(fixture.reconciled(), 0)
})

for (const globalEnabled of [true, false]) {
  test(`workspace standalone target prunes equal-to-global overrides and follows changes (global=${globalEnabled})`, async () => {
    const fullName = 'market/standalone-skills/standalone'
    const fixture = blockedActivationFixture({
      globalOverrides: { enabledStandaloneSkills: globalEnabled ? { [fullName]: true } : {} },
      workspaceOverrides: { standaloneSkills: { [fullName]: !globalEnabled, 'unrelated/standalone-skills/keep': true } },
      additionalFiles: { '/dsh/agent-plugin-market/markets/market/skills/standalone/SKILL.md': skillDoc('standalone') },
    })
    const { service, runtime } = fixture
    await service.setWorkspaceSkillEnabled({ workspaceId: 'workspace-a', fullName, standalone: true, mode: globalEnabled ? 'enabled' : 'disabled' })
    let current = await runtime.loadWorkspaceConfig('/workspace-a')
    assert.deepEqual(current.standaloneSkills, { 'unrelated/standalone-skills/keep': true })
    assert.deepEqual(current.plugins, fixture.workspaceConfig.plugins)
    assert.deepEqual(current.pluginSkills, fixture.workspaceConfig.pluginSkills)
    assert.deepEqual(await runtime.loadConfig(), fixture.globalConfig)
    await service.setSkillEnabled({ fullName, standalone: true, enabled: !globalEnabled })
    assert.equal((await service.getState({ workspaceId: 'workspace-a' })).markets[0].standaloneSkills[0].enabled, !globalEnabled)
    await service.setWorkspaceSkillEnabled({ workspaceId: 'workspace-a', fullName, standalone: true, mode: globalEnabled ? 'enabled' : 'disabled' })
    assert.equal((await runtime.loadWorkspaceConfig('/workspace-a')).standaloneSkills[fullName], globalEnabled)
    await service.setWorkspaceSkillEnabled({ workspaceId: 'workspace-a', fullName, standalone: true, mode: 'inherit' })
    current = await runtime.loadWorkspaceConfig('/workspace-a')
    assert.equal(current.standaloneSkills[fullName], undefined)
  })
}

test('shared-key state views deduplicate child full names while batch commands still validate every source', async () => {
  const fixture = blockedActivationFixture({
    duplicate: true,
    additionalFiles: { '/dsh/agent-plugin-market/markets/market/plugins/duplicate/skills/one/SKILL.md': skillDoc('one') },
  })
  const result = await fixture.service.setPluginSkillsEnabled({ marketId: 'market', pluginName: 'plugin', enabled: false })
  assert.equal(result.count, 5)
  const views = (await fixture.service.getState()).markets[0].plugins
  assert.equal(views.length, 1)
  assert.equal(views[0].skills.length, 5)
  assert.equal(new Set(views[0].skills.map((skill) => skill.fullName)).size, 5)
  assert.equal(views[0].enabled, false)
  assert.equal(views[0].activationState, 'disabled')
  assert.equal(views[0].globalEnabled, false)
})

for (const firstDeclaresHooks of [true, false]) {
  test(`merged skills do not expand hook authority beyond the first same-name entry (firstHooks=${firstDeclaresHooks})`, async () => {
    const root = '/dsh/agent-plugin-market/markets/market/plugins/'
    const fixture = blockedActivationFixture({
      duplicate: true,
      globalOverrides: { hookApprovals: { 'market/plugin': { fingerprint: 'approved' } } },
      additionalFiles: {
        [root + 'duplicate/.codex-plugin/plugin.json']: JSON.stringify({ name: 'plugin' }),
        ...(firstDeclaresHooks ? { [root + 'plugin/.codex-plugin/plugin.json']: JSON.stringify({ name: 'plugin' }) } : {}),
      },
    })
    const inspected = []
    const service = createMarketService({
      runtime: fixture.runtime,
      hooks: {
        available: true,
        async reconcile() {},
        async inspectCodexHooks(marketDir, pluginDir) {
          inspected.push(pluginDir)
          return { found: true, fingerprint: 'approved', configs: [{}], error: null }
        },
        isActive: () => true,
        runtimeError: () => null,
      },
      onSkillsChanged() {},
    })
    const view = (await service.getState()).markets[0].plugins[0]
    assert.equal(view.skills.length, 5)
    assert.equal(view.error, null)
    assert.deepEqual(inspected, firstDeclaresHooks ? [root + 'plugin'] : [])
    assert.deepEqual(view.hooks, firstDeclaresHooks ? {
      available: true, found: true, count: 1, enabled: true, active: true,
      needsApproval: false, error: null, scope: 'global',
    } : null)
  })
}

test('zero-skill plugin activation is disabled independently of installation', async () => {
  const fixture = blockedActivationFixture({ additionalFiles: {
    '/dsh/agent-plugin-market/markets/market/plugins/plugin/plugin.json': JSON.stringify({
      name: 'plugin', extensions: { 'com.github.awesome-copilot': { skills: [] } },
    }),
  } })
  const view = (await fixture.service.getState()).markets[0].plugins[0]
  assert.equal(view.installed, true)
  assert.equal(view.skills.length, 0)
  assert.equal(view.enabled, false)
  assert.equal(view.globalEnabled, false)
  assert.equal(view.activationState, 'disabled')
  assert.equal((await fixture.service.setPluginSkillsEnabled({ marketId: 'market', pluginName: 'plugin', enabled: true })).count, 0)
})

test('does not duplicate a plugin skill enabled both globally and in the workspace', async () => {
  const marketDir = '/dsh/agent-plugin-market/markets/market'
  const runtime = runtimeFor({
    '/dsh/agent-plugin-market/config.json': JSON.stringify({
      markets: [{ id: 'market', name: 'market', repo: 'example/market' }],
      installed: { 'market/plugin': { marketId: 'market', pluginName: 'plugin' } },
      disabledSkills: {},
      enabledStandaloneSkills: {},
      hookApprovals: {},
    }),
    [marketDir + '/marketplace.json']: JSON.stringify({
      plugins: [{ name: 'plugin', source: 'plugins/plugin' }],
    }),
    [marketDir + '/plugins/plugin/plugin.json']: JSON.stringify({ name: 'plugin' }),
    [marketDir + '/plugins/plugin/skills/one/SKILL.md']: skillDoc('one'),
    '/workspace-a/.dsh/agent-plugin-market.json': JSON.stringify({
      plugins: {},
      pluginSkills: { 'market/plugin/one': true },
      standaloneSkills: {},
    }),
  })
  const workspaces = {
    list: () => [{ id: 'workspace-a', title: 'A', path: '/workspace-a' }],
    get: () => ({ id: 'workspace-a', title: 'A', path: '/workspace-a' }),
  }
  const service = createMarketService({ runtime, hooks: { async reconcile() {} }, onSkillsChanged() {}, workspaces })

  const state = await service.getState({ workspaceId: 'workspace-a' })
  const market = state.markets[0]
  const matches = market.plugins[0].skills.filter((skill) => skill.fullName === 'market/plugin/one')
  assert.equal(matches.length, 1, 'a skill enabled both globally and in the workspace appears exactly once')
  assert.equal(matches[0].enabled, true)
  assert.equal(matches[0].globalEnabled, true)
  assert.equal(matches[0].workspaceOverride, true)
  assert.deepEqual(market.standaloneSkills.map((skill) => skill.fullName), [], 'the plugin skill must not be duplicated into the standalone group')
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

function standaloneSkill(skillName = 'standalone', description = 'Test standalone skill.') {
  return {
    skillName,
    fullName: 'market/standalone-skills/' + skillName,
    description,
    whenToUse: null,
  }
}

function serviceRuntime({ standaloneSkills = [] } = {}) {
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

function updateServiceRuntime({ pullFails = false, after = 'after' } = {}) {
  const config = {
    markets: [{ id: 'market', name: 'market', repo: 'example/market' }],
    installed: {},
    disabledSkills: {},
    enabledStandaloneSkills: {},
    hookApprovals: { 'market/plugin': { fingerprint: 'approved' } },
  }
  const commands = []
  let revParseCount = 0
  return {
    config,
    commands,
    runtime: {
      paths: { marketsDir: '/markets' },
      async loadConfig() { return config },
      async runProc(argv) {
        commands.push(argv)
        if (argv[3] === 'rev-parse') return (revParseCount++ === 0 ? 'before' : after) + '\n'
        if (argv[3] === 'pull' && pullFails) throw new Error('pull failed')
        return ''
      },
    },
  }
}

function refServiceRuntime({ marketplace = { name: 'Updated Market', description: '', plugins: [] }, standaloneSkills = [], existingDir = true } = {}) {
  const config = {
    markets: [{ id: 'market', name: 'market', repo: 'example/market', refType: 'tag', ref: 'old' }],
    installed: { 'market/plugin': { marketId: 'market', pluginName: 'plugin' } },
    disabledSkills: { 'market/plugin/skill': true },
    enabledStandaloneSkills: { 'market/standalone-skills/skill': true },
    hookApprovals: { 'market/plugin': { fingerprint: 'approved' } },
  }
  const commands = []
  return {
    config,
    commands,
    runtime: {
      paths: { marketsDir: '/markets' },
      async ensureDir() {},
      async loadConfig() { return config },
      async saveConfig(next) {
        for (const key of Object.keys(config)) delete config[key]
        Object.assign(config, next)
      },
      async runProc(argv) {
        commands.push(argv)
        return ''
      },
      async parseMarketplace() {
        return marketplace
      },
      async scanStandaloneSkills() {
        return standaloneSkills
      },
      async resolveDirectoryWithin(parent, child) {
        return existingDir && child === 'market' ? parent + '/' + child : null
      },
    },
  }
}

test('updates markets without changing hook approvals directly', async () => {
  const fixture = updateServiceRuntime()
  const hookCalls = []
  let invalidated = 0
  const service = createMarketService({
    runtime: fixture.runtime,
    hooks: {
      async reconcile() { hookCalls.push('reconcile') },
      suspendMarket(id) { hookCalls.push('suspend:' + id) },
      resumeMarket(id) { hookCalls.push('resume:' + id) },
    },
    onSkillsChanged() { invalidated++ },
  })

  assert.deepEqual(await service.updateMarket({ marketId: 'market' }), { updated: true })

  assert.deepEqual(fixture.config.hookApprovals, { 'market/plugin': { fingerprint: 'approved' } })
  assert.deepEqual(hookCalls, ['suspend:market', 'reconcile', 'resume:market', 'reconcile'])
  assert.equal(invalidated, 1)
})

test('keeps hook approvals when market pull fails', async () => {
  const fixture = updateServiceRuntime({ pullFails: true })
  const hookCalls = []
  const service = createMarketService({
    runtime: fixture.runtime,
    hooks: {
      async reconcile() { hookCalls.push('reconcile') },
      suspendMarket(id) { hookCalls.push('suspend:' + id) },
      resumeMarket(id) { hookCalls.push('resume:' + id) },
    },
    onSkillsChanged() {},
  })

  await assert.rejects(() => service.updateMarket({ marketId: 'market' }), /pull failed/)

  assert.deepEqual(fixture.config.hookApprovals, { 'market/plugin': { fingerprint: 'approved' } })
  assert.deepEqual(hookCalls, ['suspend:market', 'reconcile', 'resume:market', 'reconcile'])
})

test('changes an existing market to a branch or tag checkout', async () => {
  for (const target of [{ refType: 'branch', ref: 'release' }, { refType: 'tag', ref: 'v1.0.0' }]) {
    const fixture = refServiceRuntime()
    const hookCalls = []
    let invalidated = 0
    const service = createMarketService({
      runtime: fixture.runtime,
      hooks: {
        async reconcile() { hookCalls.push('reconcile') },
        suspendMarket(id) { hookCalls.push('suspend:' + id) },
        resumeMarket(id) { hookCalls.push('resume:' + id) },
      },
      onSkillsChanged() { invalidated++ },
    })

    assert.deepEqual(await service.setMarketRef({ marketId: 'market', ...target }), { id: 'market', ...target })

    const clone = fixture.commands.find((argv) => argv[0] === 'git' && argv[1] === 'clone')
    assert.deepEqual(clone.slice(0, -1), ['git', 'clone', '--depth', '1', '--branch', target.ref, 'example/market'])
    const moves = fixture.commands.filter((argv) => argv[0] === 'mv')
    assert.equal(moves[0][1], 'market')
    assert.match(moves[0][2], /^market\.backup-/)
    assert.match(moves[1][1], /^market\.next-/)
    assert.equal(moves[1][2], 'market')
    assert.deepEqual(fixture.config.markets[0], { id: 'market', name: 'Updated Market', repo: 'example/market', refType: target.refType, ref: target.ref })
    assert.deepEqual(fixture.config.installed, { 'market/plugin': { marketId: 'market', pluginName: 'plugin' } })
    assert.deepEqual(fixture.config.hookApprovals, { 'market/plugin': { fingerprint: 'approved' } })
    assert.deepEqual(hookCalls, ['suspend:market', 'reconcile', 'resume:market', 'reconcile'])
    assert.equal(invalidated, 1)
  }
})

test('changes an existing market to a commit checkout', async () => {
  const fixture = refServiceRuntime()
  const service = createMarketService({
    runtime: fixture.runtime,
    hooks: {
      async reconcile() {},
      suspendMarket() {},
      resumeMarket() {},
    },
    onSkillsChanged() {},
  })

  await service.setMarketRef({ marketId: 'market', refType: 'commit', ref: 'abc1234' })

  const clone = fixture.commands.find((argv) => argv[0] === 'git' && argv[1] === 'clone')
  const checkout = fixture.commands.find((argv) => argv[0] === 'git' && argv[3] === 'checkout')
  assert.deepEqual(clone.slice(0, -1), ['git', 'clone', 'example/market'])
  assert.equal(checkout[4], 'abc1234')
  assert.deepEqual(fixture.config.markets[0], { id: 'market', name: 'Updated Market', repo: 'example/market', refType: 'commit', ref: 'abc1234' })
})

test('resets an existing market ref to the repository default', async () => {
  const fixture = refServiceRuntime()
  const service = createMarketService({
    runtime: fixture.runtime,
    hooks: {
      async reconcile() {},
      suspendMarket() {},
      resumeMarket() {},
    },
    onSkillsChanged() {},
  })

  assert.deepEqual(await service.setMarketRef({ marketId: 'market', refType: 'default', ref: 'ignored' }), { id: 'market', refType: 'default', ref: null })

  const clone = fixture.commands.find((argv) => argv[0] === 'git' && argv[1] === 'clone')
  assert.deepEqual(clone.slice(0, -1), ['git', 'clone', '--depth', '1', 'example/market'])
  assert.deepEqual(fixture.config.markets[0], { id: 'market', name: 'Updated Market', repo: 'example/market' })
})

test('keeps the old market ref when a replacement checkout is invalid', async () => {
  const fixture = refServiceRuntime({ marketplace: null, standaloneSkills: [] })
  const hookCalls = []
  const service = createMarketService({
    runtime: fixture.runtime,
    hooks: {
      async reconcile() { hookCalls.push('reconcile') },
      suspendMarket(id) { hookCalls.push('suspend:' + id) },
      resumeMarket(id) { hookCalls.push('resume:' + id) },
    },
    onSkillsChanged() {},
  })

  await assert.rejects(() => service.setMarketRef({ marketId: 'market', refType: 'branch', ref: 'empty' }), /skills/)

  assert.deepEqual(fixture.config.markets[0], { id: 'market', name: 'market', repo: 'example/market', refType: 'tag', ref: 'old' })
  assert.equal(fixture.commands.some((argv) => argv[0] === 'mv'), false)
  assert.equal(fixture.commands.filter((argv) => argv[0] === 'rm').length >= 1, true)
  assert.deepEqual(hookCalls, [])
})

test('rejects a manifest-free repository without valid root skills', async () => {
  const fixture = serviceRuntime()
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
  const fixture = serviceRuntime({ standaloneSkills: [standaloneSkill()] })
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
  const fixture = serviceRuntime({ standaloneSkills: [standaloneSkill()] })
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
  const fixture = serviceRuntime({ standaloneSkills: [standaloneSkill()] })
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
    standaloneSkills: [standaloneSkill('one', 'One.'), standaloneSkill('two', 'Two.')],
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
  const fixture = serviceRuntime()
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
  const fixture = blockedActivationFixture({ installed: false })
  const { service, runtime } = fixture
  assert.deepEqual(await service.setWorkspacePluginEnabled({
    workspaceId: 'workspace-a', marketId: 'market', pluginName: 'plugin', mode: 'enabled',
  }), { workspaceId: 'workspace-a', key: 'market/plugin', mode: 'enabled' })
  await service.setWorkspaceSkillEnabled({
    workspaceId: 'workspace-a', fullName: 'market/plugin/one', mode: 'disabled',
  })

  assert.deepEqual(await runtime.loadWorkspaceConfig('/workspace-a'), {
    ...fixture.workspaceConfig,
    plugins: { 'unrelated/plugin': false },
    pluginSkills: {
      'market/plugin/two': true, 'market/plugin/three': true, 'market/plugin/four': true,
      'unrelated/plugin/keep': true,
    },
  })
  assert.deepEqual(await runtime.loadConfig(), fixture.globalConfig)

  await service.clearWorkspaceOverrides({ workspaceId: 'workspace-a' })
  assert.deepEqual(await runtime.loadWorkspaceConfig('/workspace-a'), { version: 1, plugins: {}, pluginSkills: {}, standaloneSkills: {} })
  assert.equal(fixture.invalidated(), 3)
  await assert.rejects(() => service.setWorkspacePluginEnabled({ workspaceId: 'missing', marketId: 'market', pluginName: 'plugin', mode: 'enabled' }), /工作区/)
})

test('hides home workspace entries from configurable workspace state', async () => {
  const fixture = serviceRuntime()
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
