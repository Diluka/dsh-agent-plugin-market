import assert from 'node:assert/strict'
import { posix as path } from 'node:path'
import test from 'node:test'

import { createMarketRuntime } from '../lib/market-runtime.js'
import { createMarketService } from '../lib/market-service.js'

function skillDoc(name) {
  return '---\nname: ' + name + '\ndescription: Test ' + name + ' skill.\n---\n\n# ' + name + '\n'
}

function createMemoryFs(files, aliases = {}) {
  const nodes = new Map([['/', { type: 'directory' }]])
  const normalize = (value) => {
    const normalized = path.normalize(String(value || '/'))
    return normalized.startsWith('/') ? normalized : '/' + normalized
  }
  const aliasEntries = Object.entries(aliases)
    .map(([from, to]) => [normalize(from), normalize(to)])
    .sort((left, right) => right[0].length - left[0].length)
  const canonicalPath = (value) => {
    const display = normalize(value)
    for (const [from, to] of aliasEntries) {
      if (display === from || display.startsWith(from + '/')) return to + display.slice(from.length)
    }
    return display
  }
  const displayPath = (target) => normalize(typeof target === 'string' ? target : target.displayPath)
  const targetPath = (target) => typeof target === 'string'
    ? canonicalPath(target)
    : target.targetKey || canonicalPath(target.displayPath)
  const targetFor = (value) => ({ displayPath: normalize(value), targetKey: canonicalPath(value) })
  const addDirectory = (dir) => {
    const parts = normalize(dir).split('/').filter(Boolean)
    let current = ''
    for (const part of parts) {
      current += '/' + part
      if (!nodes.has(current)) nodes.set(current, { type: 'directory' })
    }
  }
  for (const [file, content] of Object.entries(files)) {
    const target = canonicalPath(file)
    addDirectory(path.dirname(target))
    nodes.set(target, { type: 'file', content })
  }

  return {
    async resolve(value) {
      return targetFor(value)
    },
    async stat(target) {
      const node = nodes.get(targetPath(target))
      return node ? { type: node.type } : null
    },
    async readText(target) {
      return nodes.get(targetPath(target)).content
    },
    async writeText(target, content) {
      const file = targetPath(target)
      addDirectory(path.dirname(file))
      nodes.set(file, { type: 'file', content })
    },
    async listDir(target) {
      const dir = targetPath(target)
      const prefix = dir === '/' ? '/' : dir + '/'
      const entries = []
      for (const [entryPath, node] of nodes) {
        if (entryPath === dir || !entryPath.startsWith(prefix)) continue
        const name = entryPath.slice(prefix.length)
        if (name.includes('/')) continue
        entries.push({
          name,
          type: node.type,
          target: { displayPath: path.join(displayPath(target), name), targetKey: entryPath },
        })
      }
      return entries.sort((a, b) => a.name.localeCompare(b.name))
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
    fs: createMemoryFs(files, aliases),
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

test('loads plugin and standalone root skills once each', async () => {
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

  assert.deepEqual(skills.map((skill) => skill.fullName), [
    'market/root-plugin/referenced',
    'market/standalone-skills/standalone',
  ])
})

test('loads a manifest-free market from its root skills directory', async () => {
  const marketDir = '/dsh/agent-plugin-market/markets/market'
  const runtime = runtimeFor({
    '/dsh/agent-plugin-market/config.json': JSON.stringify({
      markets: [{ id: 'market', name: 'market', repo: 'example/market' }],
      installed: {},
      disabledSkills: {},
      hookApprovals: {},
    }),
    [marketDir + '/skills/standalone/SKILL.md']: skillDoc('standalone'),
  })

  const skills = await runtime.collectSkills()

  assert.deepEqual(skills.map((skill) => skill.skillName), ['standalone'])
})

test('honors disabled standalone skills during registration', async () => {
  const marketDir = '/dsh/agent-plugin-market/markets/market'
  const runtime = runtimeFor({
    '/dsh/agent-plugin-market/config.json': JSON.stringify({
      markets: [{ id: 'market', name: 'market', repo: 'example/market' }],
      installed: {},
      disabledSkills: { 'market/standalone-skills/standalone': true },
      hookApprovals: {},
    }),
    [marketDir + '/skills/standalone/SKILL.md']: skillDoc('standalone'),
  })

  assert.deepEqual(await runtime.collectSkills(), [])
})

function serviceRuntime({ standaloneSkills }) {
  const config = { markets: [], installed: {}, disabledSkills: {}, hookApprovals: {} }
  const commands = []
  return {
    config,
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

test('returns standalone skills in the market state', async () => {
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
    enabled: true,
  }])
})
