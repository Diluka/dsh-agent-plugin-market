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
  const primitives = { Menu: 'Menu', Button: 'Button', Pill: 'Pill', DisclosureRow: 'DisclosureRow', Input: 'Input' }
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
  const menus = nodes(tree, (node) => node.type === 'Menu')
  return { ...fixture, row, menus, tree }
}

test('inherited skill defaults never claim an uninstalled plugin skill is active', async (t) => {
  const fixture = await skillFixture(t)
  assert.match(text(fixture.row), /继承全局（全局默认开启）/)
  assert.match(text(fixture.row), /未生效/)
  assert.match(text(fixture.row), /所属插件未启用/)
  assert.doesNotMatch(text(fixture.row), /全局已启用/)
  const pluginMenu = fixture.menus.find((node) => node.props.anchor.props['aria-label'].startsWith('plugin:'))
  assert.match(text(pluginMenu.props.anchor), /继承全局（全局未启用）/)
  assert.match(fixture.css, /\.apm-plugin-topline\{[^}]*align-items:flex-start/)
  assert.match(fixture.css, /\.apm-skill-status \.apm-skill-state\{[^}]*color:var\(--dsw-alias-label-secondary\)/)
})

test('inherited skills show active after workspace plugin enablement', async (t) => {
  const fixture = await skillFixture(t, { plugin: { enabled: true, workspaceOverride: true }, skill: { enabled: true } })
  assert.match(text(fixture.row), /继承全局（全局默认开启）/)
  assert.match(text(fixture.row), /已生效/)
  assert.doesNotMatch(text(fixture.row), /未生效|所属插件未启用/)
})

test('explicit skill enablement is active independently of an uninstalled plugin', async (t) => {
  const fixture = await skillFixture(t, { skill: { enabled: true, globalEnabled: false, workspaceOverride: true } })
  assert.match(text(fixture.row), /仅此工作区启用/)
  assert.match(text(fixture.row), /已生效/)
  assert.doesNotMatch(text(fixture.row), /未生效|所属插件未启用/)
})

test('plugin-level workspace disablement explains why an enabled skill override is inactive', async (t) => {
  const fixture = await skillFixture(t, { plugin: { installed: true, globalEnabled: true, workspaceOverride: false }, skill: { workspaceOverride: true } })
  assert.match(text(fixture.row), /仅此工作区启用/)
  assert.match(text(fixture.row), /未生效/)
  assert.match(text(fixture.row), /所属插件已在此工作区禁用/)
})

test('skill workspace disablement is distinguished from a disabled global default', async (t) => {
  const disabled = await skillFixture(t, { plugin: { enabled: true }, skill: { workspaceOverride: false } })
  assert.match(text(disabled.row), /在此工作区禁用/)
  assert.match(text(disabled.row), /未生效/)
  assert.match(text(disabled.row), /技能已在此工作区禁用/)
  const inherited = await skillFixture(t, { plugin: { enabled: true }, skill: { globalEnabled: false } })
  assert.match(text(inherited.row), /继承全局（全局默认关闭）/)
  assert.match(text(inherited.row), /未生效/)
  assert.doesNotMatch(text(inherited.row), /所属插件未启用|技能已在此工作区禁用/)
})

test('standalone skill status has no plugin dependency and keeps its write routing', async (t) => {
  const inactive = await skillFixture(t, { standalone: true, skill: { globalEnabled: false } })
  assert.match(text(inactive.row), /未生效/)
  assert.match(text(inactive.row), /全局默认关闭/)
  const active = await skillFixture(t, { standalone: true, skill: { enabled: true, workspaceOverride: true } })
  assert.match(text(active.row), /已生效/)
  assert.doesNotMatch(text(active.row), /未生效|所属插件/)
  await active.menus[0].props.onSelect('inherit')
  assert.deepEqual(active.writes[0], {
    method: 'set-workspace-skill-enabled',
    args: { workspaceId: 'workspace', fullName: 'market/standalone-skills/skill', mode: 'inherit', standalone: true },
  })
})

test('skill and plugin menus preserve workspace override writes and reset', async (t) => {
  const fixture = await skillFixture(t)
  const skillMenu = fixture.menus.find((node) => node.props.anchor.props['aria-label'].startsWith('skill:'))
  const pluginMenu = fixture.menus.find((node) => node.props.anchor.props['aria-label'].startsWith('plugin:'))
  assert.equal(skillMenu.props.selectedId, 'inherit')
  for (const mode of ['enabled', 'disabled', 'inherit']) {
    await skillMenu.props.onSelect(mode)
    await settle()
  }
  await pluginMenu.props.onSelect('enabled')
  assert.deepEqual(fixture.writes, [
    ...['enabled', 'disabled', 'inherit'].map((mode) => ({ method: 'set-workspace-skill-enabled', args: { workspaceId: 'workspace', fullName: 'market/plugin/skill', mode } })),
    { method: 'set-workspace-plugin-enabled', args: { workspaceId: 'workspace', marketId: 'market', pluginName: 'plugin', mode: 'enabled' } },
  ])
})

test('workspace activation status and override copy follow the selected locale', async (t) => {
  const fixture = await skillFixture(t, { locale: 'en' })
  assert.match(text(fixture.row), /Inherit global \(global default on\)/)
  assert.match(text(fixture.row), /Inactive/)
  assert.match(text(fixture.row), /Plugin is not enabled/)
  assert.doesNotMatch(text(fixture.row), /继承全局|未生效/)
})

test('global uninstalled plugin skills retain the install prerequisite instead of workspace controls', async (t) => {
  const fixture = await skillFixture(t, { workspace: false })
  assert.match(text(fixture.row), /安装后可启用/)
  assert.doesNotMatch(text(fixture.row), /全局默认开启|未生效|已生效/)
})
