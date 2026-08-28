import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const clientPath = new URL('../lib/client.js', import.meta.url)
let clientPromise

async function loadClient() {
  if (!clientPromise) {
    clientPromise = (async () => {
      let registration
      const context = {
        window: {
          __ModuleLoader__: {
            load(value) { registration = value },
          },
        },
      }
      vm.runInNewContext(await readFile(clientPath, 'utf8'), context, {
        filename: clientPath.pathname,
      })
      assert.ok(registration)
      const client = registration.factory((id) => {
        if (id === 'react') return {}
        throw new Error('unexpected external require: ' + id)
      })
      assert.equal(typeof client.apply, 'function')
      assert.deepEqual(Array.from(client.inject), ['connection', 'slots', 'workspaces'])
      return client
    })()
  }
  return clientPromise
}

async function loadCatalog() {
  return (await loadClient()).catalog
}

test('normalizes catalog text and requires every search term', async () => {
  const catalog = await loadCatalog()

  assert.equal(catalog.normalizedText('  Codex Hook  '), 'codex hook')
  assert.equal(catalog.normalizedText(null), '')
  assert.equal(catalog.matchesText('codex hook', ['Codex', 'Hook manager']), true)
  assert.equal(catalog.matchesText('codex missing', ['Codex', 'Hook manager']), false)
  assert.equal(catalog.matchesText('   ', ['anything']), false)
})

test('filters market catalog entries by mode and matching skill name', async () => {
  const catalog = await loadCatalog()
  const market = {
    plugins: [
      {
        name: 'installed',
        title: 'Installed plugin',
        installed: true,
        skills: [{ name: 'hook-audit', fullName: 'market/installed/hook-audit' }],
      },
      {
        name: 'available',
        title: 'Available plugin',
        installed: false,
        skills: [{ name: 'market-search', fullName: 'market/available/market-search' }],
      },
      {
        name: 'unsupported',
        title: 'Unsupported plugin',
        installed: false,
        unsupported: true,
        skills: [{ name: 'ignored', fullName: 'market/unsupported/ignored' }],
      },
      { name: 'empty', title: 'Empty plugin', installed: false, skills: [] },
    ],
    standaloneSkills: [
      { name: 'root-search', fullName: 'market/standalone-skills/root-search' },
      { name: 'root-other', fullName: 'market/standalone-skills/root-other' },
    ],
  }

  const installed = catalog.catalogForMarket(market, '', 'installed')
  assert.deepEqual(Array.from(installed.matches, (match) => match.plugin.name), ['installed'])
  assert.deepEqual(Array.from(installed.visibleStandaloneSkills), [])

  const available = catalog.catalogForMarket(market, '', 'available')
  assert.deepEqual(Array.from(available.matches, (match) => match.plugin.name), ['installed', 'available'])

  const matched = catalog.catalogForMarket(market, 'search', 'all')
  assert.deepEqual(Array.from(matched.matches, (match) => match.plugin.name), ['available'])
  assert.deepEqual(Array.from(matched.visibleStandaloneSkills, (skill) => skill.name), ['root-search'])
  assert.equal(matched.matchingStandaloneSkillIds.has('market/standalone-skills/root-search'), true)

  const missingCollections = catalog.catalogForMarket({}, '', 'all')
  assert.equal(missingCollections.matches.length, 0)
  assert.equal(missingCollections.visibleStandaloneSkills.length, 0)
})

test('counts only the market state represented by the catalog', async () => {
  const catalog = await loadCatalog()
  const stats = catalog.catalogStats([{
    standaloneSkills: [{ enabled: true }, { enabled: false }],
    plugins: [
      {
        installed: true,
        skills: [{ enabled: true }, { enabled: false }],
        hooks: { available: true, found: true, active: true },
      },
      {
        installed: false,
        skills: [{ enabled: true }],
        hooks: { available: true, found: true, active: true },
      },
      {
        installed: true,
        unsupported: true,
        skills: [{ enabled: true }],
        hooks: null,
      },
    ],
  }])

  assert.deepEqual({ ...stats }, {
    installedPlugins: 2,
    activeSkills: 4,
    activeHooks: 1,
    availablePlugins: 2,
    availableSkills: 5,
    availableHooks: 2,
  })
})

test('uses effective workspace plugin state for catalog filtering and statistics', async () => {
  const catalog = await loadCatalog()
  const market = {
    plugins: [
      { name: 'global-disabled', installed: true, enabled: false, skills: [{ enabled: false }] },
      { name: 'workspace-only', installed: false, enabled: true, skills: [{ enabled: true }] },
    ],
    standaloneSkills: [],
  }

  assert.equal(catalog.pluginEnabled(market.plugins[0]), false)
  assert.equal(catalog.pluginEnabled(market.plugins[1]), true)
  assert.deepEqual(Array.from(catalog.catalogForMarket(market, '', 'installed').matches, (match) => match.plugin.name), ['workspace-only'])
  assert.equal(catalog.catalogStats([market]).installedPlugins, 1)
})

test('normalizes workspace list snapshots for the scope selector', async () => {
  const workspace = (await loadClient()).workspace

  const items = workspace.itemsFromSnapshot({
    items: [
      { workspaceId: 'one', title: 'One', path: '/one' },
      { workspaceId: 'missing-title', path: '/missing-title' },
      { workspaceId: 'missing-path', title: 'Missing path' },
      null,
    ],
  })
  assert.deepEqual(Array.from(items, (item) => ({ ...item })), [{ id: 'one', title: 'One', path: '/one' }])
  assert.deepEqual(Array.from(workspace.itemsFromSnapshot({})), [])
})

test('fingerprints workspace identity, title, path, and removal', async () => {
  const workspace = (await loadClient()).workspace
  const current = [
    { id: 'one', title: 'One', path: '/one' },
    { id: 'two', title: 'Two', path: '/two' },
  ]

  assert.notEqual(workspace.fingerprint(current), workspace.fingerprint([{ id: 'one', title: 'Renamed', path: '/one' }, current[1]]))
  assert.notEqual(workspace.fingerprint(current), workspace.fingerprint([{ id: 'one', title: 'One', path: '/moved' }, current[1]]))
  assert.notEqual(workspace.fingerprint(current), workspace.fingerprint([current[0]]))
})

test('matches shipped workspace action menus for the config entry', async () => {
  const workspaceMenu = (await loadClient()).workspaceMenu
  const items = [{ id: 'rename' }, { id: 'delete' }]
  const workspaces = [{ id: 'one', title: 'One', path: '/one' }]

  assert.equal(workspaceMenu.titleFromActionLabel('工作区“One”的操作'), 'One')
  assert.equal(workspaceMenu.titleFromActionLabel('Workspace actions for One'), 'One')
  assert.equal(workspaceMenu.titleFromActionLabel('rename'), null)
  assert.equal(workspaceMenu.isActionMenu(items), true)
  assert.equal(workspaceMenu.isActionMenu([{ id: 'rename' }]), false)
  assert.deepEqual(workspaceMenu.workspaceFromActionMenu({ items, anchor: { props: { 'aria-label': '工作区“One”的操作' } } }, workspaces), workspaces[0])
})
