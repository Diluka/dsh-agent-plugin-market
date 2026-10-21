import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

// Exercise the real page callbacks with independent hook instances, as the
// main panel and the shell's Settings portal remain mounted at the same time.
async function viewsFixture(initialMarkets = []) {
  let registration
  let current
  const slots = new Map()
  const reads = []
  const workspaces = [{ id: 'workspace', title: 'Workspace', path: '/fixture' }]
  let markets = initialMarkets
  let refuseWrite = false
  let language = 'zh'
  const dictionaries = new Map()
  const cleanups = []
  const writes = []
  let css = ''
  function memo(create, deps) {
    const index = current.index++
    const previous = current.hooks[index]
    if (!previous || !deps.every((value, i) => Object.is(value, previous.deps[i]))) {
      current.hooks[index] = { value: create(), deps }
    }
    return current.hooks[index].value
  }
  const React = {
    createElement(type, props, ...children) {
      return { type, props: { ...props, children: children.length === 1 ? children[0] : children }, children }
    },
    useState(initial) {
      const instance = current
      const index = instance.index++
      if (!(index in instance.hooks)) instance.hooks[index] = initial
      return [instance.hooks[index], (next) => { instance.hooks[index] = typeof next === 'function' ? next(instance.hooks[index]) : next }]
    },
    useRef: (initial) => memo(() => ({ current: initial }), []),
    useCallback: (callback, deps) => memo(() => callback, deps),
    useSyncExternalStore: (_subscribe, get) => get(),
    useEffect(effect, deps) {
      const instance = current
      const index = instance.index++
      const previous = instance.hooks[index]
      if (!previous || !deps.every((value, i) => Object.is(value, previous.deps[i]))) {
        instance.effects.push(() => {
          previous?.cleanup?.()
          instance.hooks[index] = { deps, cleanup: effect() }
        })
      }
    },
  }
  vm.runInNewContext(await readFile(new URL('../lib/client.js', import.meta.url), 'utf8'), {
    window: {
      __ModuleLoader__: { load(value) { registration = value } },
      MutationObserver: class { observe() {} disconnect() {} },
    },
    document: {
      body: {},
      createElement: () => ({ remove() {} }),
      head: { appendChild(style) { css = style.textContent } },
      querySelectorAll: () => [],
      addEventListener() {},
      removeEventListener() {},
    },
  })
  const primitives = { Menu: 'Menu', Button: 'Button', Switch: 'Switch', Pill: 'Pill', DisclosureRow: 'DisclosureRow', Input: 'Input' }
  const client = registration.factory((id) => id === 'react' ? React : primitives)
  client.apply({
    effect(install) { const cleanup = install(); if (cleanup) cleanups.push(cleanup) },
    configForms: { get: () => ({ subscribe: () => () => {}, getSnapshot: () => ({ status: 'loading' }) }) },
    locale: {
      subscribe: () => () => {},
      getSnapshot: () => language,
      register(_namespace, locale, dictionary) { dictionaries.set(locale, dictionary); return () => dictionaries.delete(locale) },
      bind: () => (key) => dictionaries.get(language)[key],
    },
    workspaces: { list: { subscribe: () => () => {}, getSnapshot: () => ({ items: workspaces.map(({ id, ...item }) => ({ ...item, workspaceId: id })) }) } },
    slots: {
      inject: (_name, register) => register(),
      register(options, render) { slots.set(options.name, render); return () => {} },
    },
    connection: { rpc: { async call(route, method, args) {
      assert.equal(route, '/agent-plugin-market')
      if (method === 'get-state') {
        reads.push(args.workspaceId || 'global')
        return { ok: true, value: { markets: structuredClone(markets), workspaces, scope: args.workspaceId ? { kind: 'workspace', id: args.workspaceId } : { kind: 'global' } } }
      }
      assert.ok(['add-market', 'set-workspace-skill-enabled', 'set-workspace-plugin-enabled'].includes(method))
      writes.push(structuredClone({ method, args }))
      if (refuseWrite) return { ok: false, error: { message: 'fixture write refused' } }
      if (method === 'add-market') markets.push({ id: 'fixture-market', name: 'Fixture Market', repo: args.repo, plugins: [{ name: 'fixture-plugin', skills: [{ name: 'fixture-skill' }] }] })
      return { ok: true, value: {} }
    } } },
  })
  function mount(element) {
    const instance = {
      hooks: [], index: 0, effects: [],
      render() {
        instance.index = 0
        current = instance
        const tree = element.type(element.props)
        current = undefined
        for (const effect of instance.effects.splice(0)) effect()
        return tree
      },
      unmount() { for (const hook of instance.hooks) hook?.cleanup?.() },
    }
    instance.render()
    return instance
  }
  const panel = mount({ type: slots.get('main'), props: {} }).render()
  const mainPage = panel.children[0].children[1]
  const settingsPage = slots.get('settings.section')()
  function expand(tree) {
    if (Array.isArray(tree)) return tree.map(expand)
    if (!tree || typeof tree !== 'object') return tree
    if (typeof tree.type === 'function') return expand(mount(tree).render())
    // The external Menu renders its trigger from the anchor prop, not children.
    return { ...tree, children: [...(tree.type === 'Menu' ? [expand(tree.props.anchor)] : []), ...tree.children.map(expand)] }
  }
  return {
    mount, expand, mainPage, settingsPage, reads, writes, css,
    setLocale(locale) { language = locale },
    refuse() { refuseWrite = true },
    dispose() { for (const cleanup of cleanups.toReversed()) cleanup() },
  }
}

const settle = () => new Promise((resolve) => setImmediate(resolve))
const child = (tree, key) => tree.children.find((node) => node?.props?.key === key)
const hasMarket = (tree) => !!child(tree, 'fixture-market')

async function addMarket(instance) {
  child(instance.render(), 'add-market').props.onRepoChange('https://example.test/fixture.git')
  await child(instance.render(), 'add-market').props.onSubmit()
  await settle()
}

for (const editor of ['settings', 'main']) {
  test(`a ${editor} mutation refreshes all resident views without changing their scopes`, async () => {
    const fixture = await viewsFixture()
    const main = fixture.mount(fixture.mainPage)
    const settings = fixture.mount(fixture.settingsPage)
    await settle()
    const workspace = fixture.mount({ ...fixture.mainPage, props: { workspace: { id: 'workspace', title: 'Workspace', path: '/fixture' } } })
    await settle()
    assert.equal(hasMarket(main.render()), false)
    assert.equal(hasMarket(settings.render()), false)
    assert.equal(hasMarket(workspace.render()), false)
    fixture.reads.length = 0
    await addMarket(editor === 'settings' ? settings : main)
    assert.equal(hasMarket(main.render()), true, 'closing Settings must reveal current main-panel data')
    assert.equal(hasMarket(settings.render()), true)
    assert.equal(hasMarket(workspace.render()), true)
    assert.deepEqual(fixture.reads.toSorted(), ['global', 'global', 'workspace'])
    main.unmount()
    settings.unmount()
    workspace.unmount()
    fixture.dispose()
  })
}

test('unmounted views unsubscribe and failed mutations do not invalidate other views', async () => {
  const fixture = await viewsFixture()
  const main = fixture.mount(fixture.mainPage)
  const settings = fixture.mount(fixture.settingsPage)
  await settle()
  fixture.refuse()
  fixture.reads.length = 0
  await addMarket(settings)
  assert.deepEqual(fixture.reads, [])
  assert.equal(hasMarket(main.render()), false)
  main.unmount()
  settings.unmount()

  const success = await viewsFixture()
  const disposed = success.mount(success.mainPage)
  const editor = success.mount(success.settingsPage)
  await settle()
  disposed.unmount()
  success.reads.length = 0
  await addMarket(editor)
  assert.deepEqual(success.reads, ['global'], 'disposed pages must not fetch after another page writes')
  editor.unmount()
  fixture.dispose()
  success.dispose()
})

function nodes(tree, predicate) {
  if (Array.isArray(tree)) return tree.flatMap((node) => nodes(node, predicate))
  if (!tree || typeof tree !== 'object') return []
  return [...(predicate(tree) ? [tree] : []), ...tree.children.flatMap((node) => nodes(node, predicate))]
}

function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join(' ')
  if (tree && typeof tree === 'object') return tree.children.map(text).join(' ')
  return typeof tree === 'string' ? tree : ''
}

async function skillFixture(t, { plugin = {}, skill = {}, standalone = false, workspace = true, locale = 'zh' } = {}) {
  const fullName = standalone ? 'market/standalone-skills/skill' : 'market/plugin/skill'
  const skillView = { name: 'skill', fullName, globalEnabled: true, enabled: false, workspaceOverride: null, ...skill }
  const fixture = await viewsFixture([{
    id: 'market', name: 'Market', repo: 'https://example.test/market.git', manifestFound: true,
    plugins: standalone ? [] : [{ name: 'plugin', installed: false, enabled: false, globalEnabled: false, workspaceOverride: null, skills: [skillView], ...plugin }],
    standaloneSkills: standalone ? [skillView] : [],
  }])
  t.after(() => fixture.dispose())
  fixture.setLocale(locale)
  await settle()
  const page = fixture.mount({ ...fixture.mainPage, props: workspace ? { workspace: { id: 'workspace', title: 'Workspace', path: '/fixture' } } : {} })
  t.after(() => page.unmount())
  await settle()
  const collapsed = fixture.expand(page.render())
  const disclosure = nodes(collapsed, (node) => node.type === 'DisclosureRow')[0]
  disclosure.props.onToggle()
  const tree = fixture.expand(page.render())
  const row = nodes(tree, (node) => node.props.className === 'apm-skill')[0]
  const toggle = nodes(row, (node) => node.type === 'Switch')[0]
  const pluginToggle = nodes(tree, (node) => node.type === 'Switch' && node.props.label === 'plugin')[0]
  const reset = nodes(row, (node) => node.type === 'Button' && node.props.className === 'apm-reset-default')[0]
  const pluginReset = nodes(tree, (node) => node.type === 'Button' && node.props['aria-label']?.endsWith(': plugin'))[0]
  return { ...fixture, row, toggle, pluginToggle, reset, pluginReset, tree, render: () => fixture.expand(page.render()) }
}

test('workspace switches show only the current effective state, not default provenance', async (t) => {
  const fixture = await skillFixture(t)
  assert.equal(fixture.toggle.props.checked, false)
  assert.equal(fixture.toggle.props.disabled, false)
  assert.equal(fixture.pluginToggle.props.checked, false)
  assert.match(text(fixture.row), /未启用/)
  assert.doesNotMatch(text(fixture.row), /继承|全局|已生效|未生效|所属插件/)
  assert.equal(fixture.reset, undefined)
  assert.match(fixture.css, /\.apm-plugin-topline\{[^}]*align-items:flex-start/)
})

test('enabled workspace skills use an on switch regardless of inherited configuration', async (t) => {
  const fixture = await skillFixture(t, { plugin: { enabled: true, workspaceOverride: true }, skill: { enabled: true } })
  assert.equal(fixture.toggle.props.checked, true)
  assert.equal(fixture.pluginToggle.props.checked, true)
  assert.match(text(fixture.row), /已启用/)
  assert.doesNotMatch(text(fixture.row), /继承|全局|未启用/)
})

test('individual enablement remains active without an installed plugin and has a secondary reset', async (t) => {
  const fixture = await skillFixture(t, { skill: { enabled: true, globalEnabled: false, workspaceOverride: true } })
  assert.equal(fixture.toggle.props.checked, true)
  assert.equal(fixture.toggle.props.disabled, false)
  assert.equal(fixture.pluginToggle.props.checked, false)
  assert.match(text(fixture.row), /已启用/)
  assert.equal(text(fixture.reset), '恢复默认')
  await fixture.reset.props.onClick()
  assert.deepEqual(fixture.writes[0], {
    method: 'set-workspace-skill-enabled',
    args: { workspaceId: 'workspace', fullName: 'market/plugin/skill', mode: 'inherit' },
  })
})

test('a plugin-level disablement locks the skill switch at its effective off state', async (t) => {
  const fixture = await skillFixture(t, { plugin: { installed: true, globalEnabled: true, workspaceOverride: false }, skill: { workspaceOverride: true } })
  assert.equal(fixture.toggle.props.checked, false)
  assert.equal(fixture.toggle.props.disabled, true)
  assert.equal(fixture.toggle.props.title, '请先启用所属插件')
  assert.ok(!fixture.pluginToggle.props.disabled)
  assert.match(text(fixture.row), /未启用/)
  assert.doesNotMatch(text(fixture.row), /所属插件|全局|继承/)
  assert.equal(fixture.reset.props.disabled, false, 'a blocked skill can still clear its own override')
})

test('workspace-disabled and default-disabled skills have the same primary off state', async (t) => {
  const disabled = await skillFixture(t, { plugin: { enabled: true }, skill: { workspaceOverride: false } })
  const inherited = await skillFixture(t, { plugin: { enabled: true }, skill: { globalEnabled: false } })
  for (const fixture of [disabled, inherited]) {
    assert.equal(fixture.toggle.props.checked, false)
    assert.equal(fixture.toggle.props.disabled, false)
    assert.match(text(fixture.row), /未启用/)
    assert.doesNotMatch(text(fixture.row), /全局|继承|原因/)
  }
  assert.ok(disabled.reset)
  assert.equal(inherited.reset, undefined)
})

test('direct skill switches write workspace enable and disable without changing global defaults', async (t) => {
  const off = await skillFixture(t)
  await off.toggle.props.onChange(true)
  const on = await skillFixture(t, { skill: { enabled: true } })
  await on.toggle.props.onChange(false)
  assert.deepEqual(off.writes, [{ method: 'set-workspace-skill-enabled', args: { workspaceId: 'workspace', fullName: 'market/plugin/skill', mode: 'enabled' } }])
  assert.deepEqual(on.writes, [{ method: 'set-workspace-skill-enabled', args: { workspaceId: 'workspace', fullName: 'market/plugin/skill', mode: 'disabled' } }])
})

test('direct plugin switches and secondary reset keep plugin write routing', async (t) => {
  const fixture = await skillFixture(t, { plugin: { workspaceOverride: false } })
  await fixture.pluginToggle.props.onChange(true)
  await fixture.pluginToggle.props.onChange(false)
  await fixture.pluginReset.props.onClick()
  assert.deepEqual(fixture.writes, ['enabled', 'disabled', 'inherit'].map((mode) => ({
    method: 'set-workspace-plugin-enabled',
    args: { workspaceId: 'workspace', marketId: 'market', pluginName: 'plugin', mode },
  })))
})

test('standalone switches and reset have no plugin prerequisite and preserve routing', async (t) => {
  const fixture = await skillFixture(t, { standalone: true, skill: { enabled: true, workspaceOverride: true } })
  assert.equal(fixture.toggle.props.checked, true)
  assert.equal(fixture.toggle.props.disabled, false)
  await fixture.toggle.props.onChange(false)
  await fixture.reset.props.onClick()
  assert.deepEqual(fixture.writes, ['disabled', 'inherit'].map((mode) => ({
    method: 'set-workspace-skill-enabled',
    args: { workspaceId: 'workspace', fullName: 'market/standalone-skills/skill', mode, standalone: true },
  })))
})

test('in-flight and refused workspace changes never optimistically report an enabled skill', async (t) => {
  const fixture = await skillFixture(t)
  fixture.refuse()
  const write = fixture.toggle.props.onChange(true)
  const pending = fixture.render()
  assert.ok(nodes(pending, (node) => node.type === 'Switch').every((node) => node.props.disabled))
  assert.equal(nodes(pending, (node) => node.type === 'Switch' && node.props.label === 'skill')[0].props.checked, false)
  await write
  const refused = fixture.render()
  assert.equal(nodes(refused, (node) => node.type === 'Switch' && node.props.label === 'skill')[0].props.checked, false)
  assert.match(text(refused), /fixture write refused/)
})

test('current state, reset action and blocked tooltip follow the locale', async (t) => {
  const fixture = await skillFixture(t, { locale: 'en', plugin: { workspaceOverride: false }, skill: { workspaceOverride: true } })
  assert.match(text(fixture.row), /Disabled/)
  assert.equal(text(fixture.reset), 'Restore default')
  assert.equal(fixture.toggle.props.title, 'Enable the plugin first')
  assert.doesNotMatch(text(fixture.row), /全局|继承|未启用|未生效/)
})

test('global uninstalled plugin skills retain the install prerequisite', async (t) => {
  const fixture = await skillFixture(t, { workspace: false })
  assert.match(text(fixture.row), /安装后可启用/)
  assert.equal(fixture.toggle, undefined)
  assert.equal(fixture.reset, undefined)
})
