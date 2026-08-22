import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const clientPath = new URL('../lib/client.js', import.meta.url)
let catalogPromise

async function loadCatalog() {
  if (!catalogPromise) {
    catalogPromise = (async () => {
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
      const client = registration.factory(() => ({}))
      assert.equal(typeof client.apply, 'function')
      assert.deepEqual(Array.from(client.inject), ['connection', 'slots'])
      return client.catalog
    })()
  }
  return catalogPromise
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
    activeSkills: 3,
    activeHooks: 1,
    availablePlugins: 2,
    availableSkills: 5,
    availableHooks: 2,
  })
})
