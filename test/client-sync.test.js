import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

// Exercise the real page callbacks with independent hook instances, as the
// main panel and the shell's Settings portal remain mounted at the same time.
async function viewsFixture(initialMarkets = [], options = {}) {
  let registration
  let current
  const slots = new Map()
  const reads = []
  let workspaces = options.workspaces || [{ id: 'workspace', title: 'Workspace', path: '/fixture' }]
  let markets = initialMarkets
  const scopedMarkets = new Map()
  let holdReads = false
  let onWrite
  const pendingReads = []
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
      if (type === 'div' && props?.ref && !props.ref.current) {
        const input = { indeterminate: false, attributes: {}, setAttribute(name, value) { this.attributes[name] = value } }
        props.ref.current = { querySelector: (selector) => selector === 'input' ? input : null }
      }
      return { type, props: { ...props, children: children.length === 1 ? children[0] : children }, children }
    },
    useState(initial) {
      const instance = current
      const index = instance.index++
      if (!(index in instance.hooks)) instance.hooks[index] = initial
      return [instance.hooks[index], (next) => {
        if (instance.unmounted) instance.lateUpdates++
        instance.hooks[index] = typeof next === 'function' ? next(instance.hooks[index]) : next
      }]
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
  const primitives = { Menu: 'Menu', Button: 'Button', Switch: 'Switch', Checkbox: 'Checkbox', Pill: 'Pill', DisclosureRow: 'DisclosureRow', Input: 'Input' }
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
        const value = {
          markets: structuredClone(scopedMarkets.get(args.workspaceId || 'global') || markets),
          workspaces: structuredClone(workspaces),
          scope: args.workspaceId
            ? { kind: 'workspace', id: args.workspaceId, title: 'Workspace', path: '/fixture', overrideCount: 0 }
            : { kind: 'global' },
          hooksBridge: options.hooksBridge || { available: true, installCommand: '' },
        }
        if (holdReads) return new Promise((resolve, reject) => pendingReads.push({
          scope: args.workspaceId || 'global', value,
          respond: (next = value) => resolve({ ok: true, value: next }),
          fail: (message) => resolve({ ok: false, error: { message } }),
          reject,
        }))
        return { ok: true, value }
      }
      assert.ok(['add-market', 'set-workspace-skill-enabled', 'set-workspace-plugin-enabled', 'set-plugin-skills-enabled', 'set-skill-enabled', 'set-plugin-hooks-enabled', 'install-plugin', 'uninstall-plugin'].includes(method))
      writes.push(structuredClone({ method, args }))
      if (refuseWrite) return { ok: false, error: { message: 'fixture write refused' } }
      if (onWrite) await onWrite(method, args)
      if (method === 'add-market') markets.push({ id: 'fixture-market', name: 'Fixture Market', repo: args.repo, manifestFound: true, standaloneSkills: [], plugins: [{ name: 'fixture-plugin', installed: false, hooks: null, skills: [{ name: 'fixture-skill' }] }] })
      return { ok: true, value: {} }
    } } },
  })
  function mount(element) {
    const instance = {
      hooks: [], index: 0, effects: [], unmounted: false, lateUpdates: 0,
      render() {
        instance.index = 0
        current = instance
        const tree = element.type(element.props)
        current = undefined
        for (const effect of instance.effects.splice(0)) effect()
        return tree
      },
      unmount() { instance.unmounted = true; for (const hook of instance.hooks) hook?.cleanup?.() },
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
    mount, expand, mainPage, settingsPage, reads, writes, css, pendingReads,
    holdReads() { holdReads = true },
    setMarkets(next, scope) { if (scope) scopedMarkets.set(scope, next); else markets = next },
    setWorkspaces(next) { workspaces = next },
    onWrite(callback) { onWrite = callback },
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

async function skillFixture(t, { plugin = {}, skill = {}, standalone = false, workspace = true, locale = 'zh', workspaces } = {}) {
  const fullName = standalone ? 'market/standalone-skills/skill' : 'market/plugin/skill'
  const skillView = { name: 'skill', fullName, globalEnabled: true, enabled: false, workspaceOverride: null, ...skill }
  const fixture = await viewsFixture([{
    id: 'market', name: 'Market', repo: 'https://example.test/market.git', manifestFound: true,
    plugins: standalone ? [] : [{ name: 'plugin', installed: false, hooks: null, skills: [skillView], ...plugin }],
    standaloneSkills: standalone ? [skillView] : [],
  }], { workspaces })
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
  const master = nodes(tree, (node) => node.type === 'Checkbox')[0]
  const wrapper = nodes(tree, (node) => node.props.className === 'apm-master-control')[0]
  const nativeMaster = wrapper?.props.ref.current.querySelector('input')
  const installation = nodes(tree, (node) => node.type === 'Button' && /^(安装|卸载)插件:/.test(node.props['aria-label'] || ''))[0]
  return { ...fixture, page, row, toggle, master, nativeMaster, installation, tree, render: () => fixture.expand(page.render()) }
}

test('workspace switches show effective state and a small inherited-source badge', async (t) => {
  const fixture = await skillFixture(t)
  assert.equal(fixture.toggle.props.checked, false)
  assert.equal(fixture.toggle.props.disabled, false)
  assert.equal(fixture.master.props.checked, false)
  assert.match(text(fixture.row), /未启用/)
  assert.match(text(fixture.row), /继承/)
  assert.doesNotMatch(text(fixture.row), /全局|已生效|未生效|所属插件/)
  assert.doesNotMatch(text(fixture.tree), /恢复默认|Restore default/)
  assert.match(fixture.css, /\.apm-plugin-topline\{[^}]*align-items:flex-start/)
})

test('enabled workspace skills use an on switch regardless of inherited configuration', async (t) => {
  const fixture = await skillFixture(t, { skill: { enabled: true } })
  assert.equal(fixture.toggle.props.checked, true)
  assert.equal(fixture.master.props.checked, true)
  assert.match(text(fixture.row), /已启用/)
  assert.match(text(fixture.row), /继承/)
  assert.doesNotMatch(text(fixture.row), /全局|未启用/)
})

test('master state follows the actual skill rather than the installation flag', async (t) => {
  const fixture = await skillFixture(t, { skill: { enabled: true, globalEnabled: false, workspaceOverride: true } })
  assert.equal(fixture.toggle.props.checked, true)
  assert.equal(fixture.toggle.props.disabled, false)
  assert.equal(fixture.master.props.checked, true)
  assert.equal(fixture.nativeMaster.indeterminate, false)
  assert.equal(fixture.master.props.label, '全部启用 1/1')
  assert.match(text(fixture.row), /已启用/)
  assert.doesNotMatch(text(fixture.tree), /恢复默认/)
})

test('an installed plugin skill stays clickable while the plugin itself is not fully enabled', async (t) => {
  const fixture = await skillFixture(t, { plugin: { installed: true }, skill: { workspaceOverride: true } })
  assert.equal(fixture.toggle.props.checked, false)
  assert.equal(fixture.toggle.props.disabled, false)
  assert.equal(fixture.toggle.props.title, undefined)
  assert.ok(!fixture.master.props.disabled)
  assert.match(text(fixture.row), /未启用/)
  assert.doesNotMatch(text(fixture.row), /所属插件|全局|继承/)
  await fixture.toggle.props.onChange(true)
  assert.deepEqual(fixture.writes[0], {
    method: 'set-workspace-skill-enabled',
    args: { workspaceId: 'workspace', fullName: 'market/plugin/skill', mode: 'enabled' },
  })
})

test('workspace-disabled and default-disabled skills have the same primary off state', async (t) => {
  const disabled = await skillFixture(t, { skill: { workspaceOverride: false } })
  const inherited = await skillFixture(t, { skill: { globalEnabled: false } })
  for (const fixture of [disabled, inherited]) {
    assert.equal(fixture.toggle.props.checked, false)
    assert.equal(fixture.toggle.props.disabled, false)
    assert.match(text(fixture.row), /未启用/)
    assert.doesNotMatch(text(fixture.row), /全局|原因/)
  }
  assert.doesNotMatch(text(disabled.tree), /恢复默认/)
  assert.doesNotMatch(text(inherited.tree), /恢复默认/)
})

test('direct skill switches write workspace enable and disable without changing global defaults', async (t) => {
  const off = await skillFixture(t)
  await off.toggle.props.onChange(true)
  const on = await skillFixture(t, { skill: { enabled: true } })
  await on.toggle.props.onChange(false)
  assert.deepEqual(off.writes, [{ method: 'set-workspace-skill-enabled', args: { workspaceId: 'workspace', fullName: 'market/plugin/skill', mode: 'enabled' } }])
  assert.deepEqual(on.writes, [{ method: 'set-workspace-skill-enabled', args: { workspaceId: 'workspace', fullName: 'market/plugin/skill', mode: 'disabled' } }])
})

test('workspace master invokes all-skill commands, never inheritance or installation', async (t) => {
  const fixture = await skillFixture(t)
  await fixture.master.props.onChange(true)
  await fixture.master.props.onChange(false)
  assert.deepEqual(fixture.writes, ['enabled', 'disabled'].map((mode) => ({
    method: 'set-workspace-plugin-enabled',
    args: { workspaceId: 'workspace', marketId: 'market', pluginName: 'plugin', mode },
  })))
  assert.doesNotMatch(text(fixture.tree), /恢复默认/)
  assert.equal(fixture.installation, undefined)
})

test('standalone switches remain directly controllable without restore-default actions', async (t) => {
  const fixture = await skillFixture(t, { standalone: true, skill: { enabled: true, workspaceOverride: true } })
  assert.equal(fixture.toggle.props.checked, true)
  assert.equal(fixture.toggle.props.disabled, false)
  await fixture.toggle.props.onChange(false)
  assert.deepEqual(fixture.writes, [{
    method: 'set-workspace-skill-enabled',
    args: { workspaceId: 'workspace', fullName: 'market/standalone-skills/skill', mode: 'disabled', standalone: true },
  }])
  assert.doesNotMatch(text(fixture.tree), /恢复默认/)
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

test('current state and aggregate master labels follow the locale', async (t) => {
  const fixture = await skillFixture(t, { locale: 'en', skill: { workspaceOverride: true } })
  assert.match(text(fixture.row), /Disabled/)
  assert.equal(fixture.master.props.label, 'All disabled 0/1')
  assert.match(fixture.nativeMaster.attributes['aria-label'], /All skills/)
  assert.doesNotMatch(text(fixture.tree), /Restore default/)
  assert.equal(fixture.toggle.props.title, undefined)
  assert.equal(fixture.toggle.props.disabled, false)
  assert.doesNotMatch(text(fixture.row), /全局|继承|未启用|未生效/)
})

test('global uninstalled plugin skills show the same control with an installation prerequisite', async (t) => {
  const fixture = await skillFixture(t, { workspace: false })
  assert.match(text(fixture.row), /未启用/)
  assert.equal(fixture.toggle.props.checked, false)
  assert.equal(fixture.toggle.props.disabled, true)
  assert.equal(fixture.toggle.props.title, '请先安装插件')
  assert.equal(fixture.master.props.disabled, true)
  assert.equal(text(fixture.installation), '安装')
  assert.doesNotMatch(text(fixture.tree), /恢复默认|Restore default/)
})

test('global and workspace scopes use identical activation controls with scope-specific writes', async (t) => {
  const global = await skillFixture(t, { workspace: false, plugin: { installed: true }, skill: { enabled: true } })
  const workspace = await skillFixture(t, { plugin: { installed: true }, skill: { enabled: true } })
  assert.equal(text(nodes(global.row, (node) => node.props.className === 'apm-effective-label on')[0]), text(nodes(workspace.row, (node) => node.props.className === 'apm-effective-label on')[0]))
  assert.equal(nodes(global.row, (node) => node.props.className === 'apm-config-source').length, 0)
  assert.match(text(workspace.row), /继承/)
  assert.equal(global.toggle.type, workspace.toggle.type)
  assert.equal(global.master.type, workspace.master.type)
  assert.equal(global.toggle.props.checked, true)
  assert.equal(global.toggle.props.disabled, false)
  assert.equal(global.master.props.checked, true)
  assert.doesNotMatch(text(global.tree), /恢复默认/)
  assert.equal(global.master.props.label, workspace.master.props.label)
  assert.equal(text(global.installation), '卸载')
  assert.equal(workspace.installation, undefined)
  await global.toggle.props.onChange(false)
  await global.toggle.props.onChange(true)
  await global.master.props.onChange(false)
  await global.master.props.onChange(true)
  assert.deepEqual(global.writes, [
    { method: 'set-skill-enabled', args: { fullName: 'market/plugin/skill', enabled: false } },
    { method: 'set-skill-enabled', args: { fullName: 'market/plugin/skill', enabled: true } },
    { method: 'set-plugin-skills-enabled', args: { marketId: 'market', pluginName: 'plugin', enabled: false } },
    { method: 'set-plugin-skills-enabled', args: { marketId: 'market', pluginName: 'plugin', enabled: true } },
  ])
})

for (const workspace of [false, true]) {
  test(`partial skill selection produces a genuine mixed master state (workspace=${workspace})`, async (t) => {
    const fixture = await skillFixture(t, {
      workspace,
      plugin: {
        installed: true,
        skills: [
          { name: 'skill', fullName: 'market/plugin/skill', enabled: true },
          { name: 'other', fullName: 'market/plugin/other', enabled: false },
        ],
      },
    })
    assert.equal(fixture.master.props.checked, false)
    assert.equal(fixture.master.props.label, '部分启用 1/2')
    assert.equal(fixture.nativeMaster.indeterminate, true)
    assert.equal(fixture.nativeMaster.attributes['aria-checked'], 'mixed')
    assert.match(fixture.nativeMaster.attributes['aria-label'], /plugin: 技能总开关/)
    await fixture.master.props.onChange(true)
    assert.deepEqual(fixture.writes[0], workspace
      ? { method: 'set-workspace-plugin-enabled', args: { marketId: 'market', pluginName: 'plugin', workspaceId: 'workspace', mode: 'enabled' } }
      : { method: 'set-plugin-skills-enabled', args: { marketId: 'market', pluginName: 'plugin', enabled: true } })
  })
}

test('rejected native master activation restores its accepted mixed appearance', async (t) => {
  const fixture = await skillFixture(t, {
    plugin: { installed: true, skills: [
      { name: 'skill', fullName: 'market/plugin/skill', enabled: true },
      { name: 'other', fullName: 'market/plugin/other', enabled: false },
    ] },
  })
  fixture.refuse()
  assert.equal(fixture.nativeMaster.indeterminate, true)
  // The browser does this before dispatching the checkbox change event.
  fixture.nativeMaster.indeterminate = false
  const write = fixture.master.props.onChange(true)
  assert.equal(fixture.nativeMaster.indeterminate, true, 'restore mixed before awaiting the Host')
  await write
  assert.equal(fixture.nativeMaster.attributes['aria-checked'], 'mixed')
  const refused = fixture.render()
  const master = nodes(refused, (node) => node.type === 'Checkbox')[0]
  assert.equal(master.props.checked, false)
  assert.equal(master.props.label, '部分启用 1/2')
  assert.match(text(refused), /fixture write refused/)
})

test('an installed plugin with every skill off still has actionable individual and master controls', async (t) => {
  const fixture = await skillFixture(t, { workspace: false, plugin: { installed: true } })
  assert.equal(fixture.toggle.props.disabled, false)
  assert.equal(fixture.master.props.disabled, false)
  assert.equal(fixture.master.props.checked, false)
  assert.equal(fixture.nativeMaster.attributes['aria-checked'], 'false')
  assert.equal(fixture.master.props.label, '全部关闭 0/1')
  assert.equal(text(fixture.installation), '卸载', 'resource remains installed independently of activation')
  await fixture.toggle.props.onChange(true)
  assert.equal(fixture.writes[0].method, 'set-skill-enabled')
})

test('installation management remains an explicit separate action', async (t) => {
  const installed = await skillFixture(t, { workspace: false, plugin: { installed: true } })
  await installed.installation.props.onClick()
  assert.deepEqual(installed.writes, [{ method: 'uninstall-plugin', args: { marketId: 'market', pluginName: 'plugin' } }])
  const available = await skillFixture(t, { workspace: false })
  await available.installation.props.onClick()
  assert.deepEqual(available.writes, [{ method: 'install-plugin', args: { marketId: 'market', pluginName: 'plugin' } }])
})

for (const [skillOverride, expected] of [
  [null, '继承'], [false, '覆盖'], [true, '覆盖'],
]) {
  test(`read-only source badge reflects the skill workspace override (${skillOverride})`, async (t) => {
    const fixture = await skillFixture(t, { skill: { workspaceOverride: skillOverride } })
    const badge = nodes(fixture.row, (node) => node.props.className === 'apm-config-source')[0]
    assert.equal(text(badge), expected)
    const group = nodes(fixture.tree, (node) => node.props.className === 'apm-master-control')[0]
    assert.equal(text(nodes(group, (node) => node.props.className === 'apm-config-source')[0]), expected)
    assert.equal(badge.type, 'span')
    assert.equal(badge.props.onClick, undefined)
    assert.equal(fixture.toggle.props.checked, false, 'origin never changes actual activation')
    assert.equal(fixture.writes.length, 0)
  })
}

test('a partially overridden group distinguishes source from partial activation', async (t) => {
  const fixture = await skillFixture(t, { plugin: { installed: true, skills: [
    { name: 'skill', fullName: 'market/plugin/skill', enabled: false, workspaceOverride: false },
    { name: 'other', fullName: 'market/plugin/other', enabled: true, workspaceOverride: null },
  ] } })
  const master = nodes(fixture.tree, (node) => node.props.className === 'apm-master-control')[0]
  assert.equal(text(nodes(master, (node) => node.props.className === 'apm-config-source')[0]), '部分覆盖')
  assert.equal(fixture.master.props.label, '部分启用 1/2')
  assert.equal(fixture.nativeMaster.indeterminate, true)
})

test('source labels are localized and absent from the global scope', async (t) => {
  const inherited = await skillFixture(t, { locale: 'en' })
  assert.match(text(inherited.row), /Inherited/)
  const override = await skillFixture(t, { locale: 'en', standalone: true, skill: { workspaceOverride: false } })
  assert.match(text(override.row), /Override/)
  const global = await skillFixture(t, { workspace: false })
  assert.equal(nodes(global.tree, (node) => node.props.className === 'apm-config-source').length, 0)
})

const otherWorkspace = { id: 'other', title: 'Other workspace', path: '/other' }
const defaultWorkspace = { id: 'workspace', title: 'Workspace', path: '/fixture' }
const masterOf = (fixture) => nodes(fixture.render(), (node) => node.type === 'Checkbox')[0]
const pageScope = (page) => nodes(page.render(), (node) => node.type?.name === 'PluginSection')[0].props.scope
const loadedScope = (fixture) => pageScope(fixture.page)
const selectScope = (fixture, id) => child(fixture.page.render(), 'scope').props.onScopeChange(id)
const editableNodes = (fixture) => nodes(fixture.render(), (node) => node.type === 'Switch' || node.type === 'Checkbox')
const activationMarkets = (enabled) => [{
  id: 'market', name: 'Market', repo: 'https://example.test/market.git', manifestFound: true,
  standaloneSkills: [],
  plugins: [{ name: 'plugin', installed: true, hooks: null, skills: [{ name: 'skill', fullName: 'market/plugin/skill', enabled }] }],
}]

test('scope selection removes old controls immediately and rejects retained old-scope callbacks', async (t) => {
  const fixture = await skillFixture(t, { workspace: false, plugin: { installed: true }, skill: { enabled: true } })
  fixture.holdReads()
  selectScope(fixture, 'workspace')
  assert.equal(editableNodes(fixture).length, 0)
  assert.equal(child(fixture.page.render(), 'scope').props.workspaceId, 'workspace')
  await fixture.master.props.onChange(false)
  await fixture.toggle.props.onChange(false)
  assert.equal(fixture.writes.length, 0, 'stale callbacks must not perform global writes')
  fixture.pendingReads[0].respond()
  await settle()
  assert.equal(loadedScope(fixture).id, 'workspace')
  const write = masterOf(fixture).props.onChange(false)
  await settle()
  fixture.pendingReads.at(-1).respond()
  await write
  assert.deepEqual(fixture.writes, [{
    method: 'set-workspace-plugin-enabled',
    args: { marketId: 'market', pluginName: 'plugin', workspaceId: 'workspace', mode: 'disabled' },
  }])
})

for (const lateResult of ['success', 'failure', 'rejection']) {
  test(`A cannot replace B after a scope switch, even with late ${lateResult}`, async (t) => {
    const fixture = await skillFixture(t, { workspace: false, workspaces: [defaultWorkspace, otherWorkspace], plugin: { installed: true }, skill: { enabled: true } })
    fixture.holdReads()
    selectScope(fixture, 'workspace')
    fixture.page.render()
    const a = fixture.pendingReads.at(-1)
    a.value.markets[0].plugins[0].skills[0].enabled = false
    selectScope(fixture, 'other')
    fixture.page.render()
    const b = fixture.pendingReads.at(-1)
    assert.equal(a.scope, 'workspace')
    assert.equal(b.scope, 'other')
    b.respond()
    await settle()
    if (lateResult === 'success') a.respond()
    else if (lateResult === 'failure') a.fail('old scope failed')
    else a.reject(new Error('old scope rejected'))
    await settle()
    assert.equal(child(fixture.page.render(), 'scope').props.workspaceId, 'other')
    assert.equal(loadedScope(fixture).id, 'other')
    assert.equal(masterOf(fixture).props.checked, true)
    assert.doesNotMatch(text(fixture.render()), /old scope/)
    const write = masterOf(fixture).props.onChange(false)
    await settle()
    fixture.pendingReads.at(-1).respond()
    await write
    assert.equal(fixture.writes.at(-1).args.workspaceId, 'other')
  })
}

for (const lateResult of ['success', 'failure']) {
  test(`old background ${lateResult} cannot roll back a fixed dialog after an accepted write`, async (t) => {
    const fixture = await skillFixture(t, { plugin: { installed: true } })
    const global = fixture.mount(fixture.settingsPage)
    t.after(() => global.unmount())
    await settle()
    fixture.onWrite((method) => fixture.setMarkets(activationMarkets(true), method === 'set-plugin-skills-enabled' ? 'global' : 'workspace'))
    fixture.holdReads()
    const globalMaster = nodes(fixture.expand(global.render()), (node) => node.type === 'Checkbox')[0]
    const globalWrite = globalMaster.props.onChange(true)
    await settle()
    fixture.pendingReads.find((read) => read.scope === 'global').respond()
    await globalWrite
    const oldRead = fixture.pendingReads.find((read) => read.scope === 'workspace')
    assert.ok(oldRead, 'the resident global page starts a workspace background read')
    const localWrite = masterOf(fixture).props.onChange(true)
    await settle()
    const freshRead = fixture.pendingReads.filter((read) => read.scope === 'workspace').at(-1)
    assert.notEqual(freshRead, oldRead)
    freshRead.respond()
    await localWrite
    assert.equal(masterOf(fixture).props.checked, true)
    if (lateResult === 'success') oldRead.respond()
    else oldRead.fail('obsolete read failed')
    await settle()
    assert.equal(masterOf(fixture).props.checked, true)
    assert.doesNotMatch(text(fixture.render()), /obsolete read failed/)
    assert.equal(loadedScope(fixture).id, 'workspace')
  })
}

test('failed scope reads hide old editable values and provide a correctly scoped retry', async (t) => {
  const fixture = await skillFixture(t, { workspace: false, plugin: { installed: true }, skill: { enabled: true } })
  fixture.holdReads()
  selectScope(fixture, 'workspace')
  fixture.page.render()
  fixture.pendingReads[0].fail('workspace load refused')
  await settle()
  assert.equal(editableNodes(fixture).length, 0)
  assert.match(text(fixture.render()), /workspace load refused/)
  const retry = nodes(fixture.render(), (node) => node.type === 'Button' && text(node) === '重试')[0]
  const read = retry.props.onClick()
  await settle()
  assert.equal(fixture.pendingReads.at(-1).scope, 'workspace')
  fixture.pendingReads.at(-1).respond()
  await read
  assert.equal(loadedScope(fixture).id, 'workspace')
  assert.equal(editableNodes(fixture).length, 2)
})

test('a response for the wrong owner is never made editable', async (t) => {
  const fixture = await skillFixture(t, { workspace: false, plugin: { installed: true } })
  fixture.holdReads()
  selectScope(fixture, 'workspace')
  fixture.page.render()
  const read = fixture.pendingReads[0]
  read.respond({ ...read.value, scope: { kind: 'global' } })
  await settle()
  assert.equal(editableNodes(fixture).length, 0)
  assert.match(text(fixture.render()), /作用域不匹配/)
  await fixture.master.props.onChange(true)
  assert.equal(fixture.writes.length, 0)
})

test('unmounted pages ignore late read results and retained activation callbacks', async (t) => {
  const fixture = await skillFixture(t, { workspace: false, plugin: { installed: true } })
  fixture.holdReads()
  selectScope(fixture, 'workspace')
  fixture.page.render()
  const read = fixture.pendingReads[0]
  fixture.page.unmount()
  read.respond()
  await settle()
  assert.equal(fixture.page.lateUpdates, 0)
  await fixture.master.props.onChange(true)
  assert.equal(fixture.writes.length, 0)
})

test('changing a fixed dialog owner invalidates its old controls before effects finish', async (t) => {
  const fixture = await viewsFixture(activationMarkets(true), { workspaces: [defaultWorkspace, otherWorkspace] })
  t.after(() => fixture.dispose())
  const element = { ...fixture.mainPage, props: { workspace: defaultWorkspace } }
  const page = fixture.mount(element)
  t.after(() => page.unmount())
  await settle()
  const oldMaster = nodes(fixture.expand(page.render()), (node) => node.type === 'Checkbox')[0]
  fixture.holdReads()
  element.props.workspace = otherWorkspace
  const pending = fixture.expand(page.render())
  assert.equal(nodes(pending, (node) => node.type === 'Checkbox').length, 0)
  await oldMaster.props.onChange(false)
  assert.equal(fixture.writes.length, 0)
  fixture.pendingReads.at(-1).respond()
  await settle()
  assert.equal(pageScope(page).id, 'other')
})

test('a removed workspace cannot keep its cached editable snapshot', async (t) => {
  const fixture = await skillFixture(t, { workspace: false, plugin: { installed: true } })
  fixture.holdReads()
  selectScope(fixture, 'workspace')
  fixture.page.render()
  fixture.pendingReads.at(-1).respond()
  await settle()
  fixture.setWorkspaces([])
  assert.equal(editableNodes(fixture).length, 0)
  fixture.page.render()
  assert.equal(child(fixture.page.render(), 'scope').props.workspaceId, null)
  fixture.pendingReads.at(-1).respond()
  await settle()
  assert.equal(loadedScope(fixture).kind, 'global')
})

test('a failed post-write reload keeps the catalog mounted but read-only until retry', async (t) => {
  const fixture = await skillFixture(t, { plugin: { installed: true } })
  fixture.onWrite(() => fixture.setMarkets(activationMarkets(true)))
  fixture.holdReads()
  const write = fixture.master.props.onChange(true)
  await settle()
  fixture.pendingReads.at(-1).fail('accepted write could not be reloaded')
  await write
  assert.ok(child(fixture.page.render(), 'market'), 'the same catalog remains present after reload failure')
  assert.equal(editableNodes(fixture).length, 2)
  assert.ok(editableNodes(fixture).every((node) => node.props.disabled))
  assert.match(text(fixture.render()), /accepted write could not be reloaded/)
  assert.match(text(fixture.render()), /当前显示上次状态/)
  await fixture.master.props.onChange(false)
  assert.equal(fixture.writes.length, 1, 'retained callbacks cannot write stale data')
  const retry = nodes(fixture.render(), (node) => node.type === 'Button' && text(node) === '重试')[0]
  const read = retry.props.onClick()
  await settle()
  fixture.pendingReads.at(-1).respond()
  await read
  assert.equal(masterOf(fixture).props.checked, true)
  assert.ok(editableNodes(fixture).every((node) => !node.props.disabled))
})

for (const target of ['master', 'skill']) {
  test(`same-scope ${target} writes refresh in place without replacing the catalog with a loader`, async (t) => {
    const fixture = await skillFixture(t, { plugin: { installed: true } })
    child(fixture.page.render(), 'catalog-toolbar').props.onQueryChange('skill')
    const before = child(fixture.page.render(), 'market')
    fixture.onWrite(() => fixture.setMarkets(activationMarkets(true)))
    fixture.holdReads()
    const write = (target === 'master' ? fixture.master : fixture.toggle).props.onChange(true)
    await settle()
    const pending = fixture.page.render()
    assert.ok(child(pending, 'market'), 'same-scope reload must not remove the existing card')
    assert.equal(child(pending, 'market').type, before.type)
    assert.equal(pending.props['aria-busy'], true)
    assert.equal(nodes(pending, (node) => node.props.className === 'apm-loading').length, 0)
    assert.equal(child(pending, 'catalog-toolbar').props.query, 'skill')
    assert.equal(nodes(pending, (node) => node.type?.name === 'PluginSection')[0].props.open, true)
    assert.equal(editableNodes(fixture).length, 2)
    assert.ok(editableNodes(fixture).every((node) => node.props.disabled))
    fixture.pendingReads.at(-1).respond()
    await write
    assert.equal(fixture.page.render().props['aria-busy'], false)
    assert.equal(masterOf(fixture).props.checked, true)
    assert.equal(child(fixture.page.render(), 'catalog-toolbar').props.query, 'skill')
    assert.equal(nodes(fixture.page.render(), (node) => node.type?.name === 'PluginSection')[0].props.open, true)
    assert.ok(editableNodes(fixture).every((node) => !node.props.disabled))
  })
}

test('background reload errors retain a read-only catalog while allowing a safe scope change', async (t) => {
  const fixture = await skillFixture(t, { workspace: false, plugin: { installed: true } })
  fixture.holdReads()
  fixture.setWorkspaces([defaultWorkspace, otherWorkspace])
  fixture.page.render()
  fixture.pendingReads.at(-1).fail('background load refused')
  await settle()
  assert.ok(child(fixture.page.render(), 'market'))
  assert.ok(editableNodes(fixture).every((node) => node.props.disabled))
  assert.equal(child(fixture.page.render(), 'scope').props.disabled, false)
  await fixture.master.props.onChange(true)
  assert.equal(fixture.writes.length, 0)
  selectScope(fixture, 'workspace')
  assert.equal(editableNodes(fixture).length, 0, 'actual scope changes still remove the old scope')
  fixture.pendingReads.at(-1).respond()
  await settle()
  assert.equal(loadedScope(fixture).id, 'workspace')
  assert.ok(editableNodes(fixture).every((node) => !node.props.disabled))
})

test('synchronous duplicate callbacks and scope changes cannot bypass an in-flight write', async (t) => {
  const fixture = await skillFixture(t, { workspace: false, plugin: { installed: true } })
  let finish
  fixture.onWrite(() => new Promise((resolve) => { finish = resolve }))
  const write = fixture.master.props.onChange(true)
  await fixture.master.props.onChange(true)
  selectScope(fixture, 'workspace')
  assert.equal(fixture.writes.length, 1)
  assert.equal(child(fixture.page.render(), 'scope').props.workspaceId, null)
  finish()
  await write
})

const hookView = { available: true, found: true, count: 2, enabled: false, active: false, needsApproval: false, error: null }
const hookMarket = (hooks) => [{
  id: 'market', name: 'Market', repo: 'https://example.test/market.git', manifestFound: true,
  standaloneSkills: [],
  plugins: [{
    name: 'plugin', title: 'Plugin', installed: true, hooks,
    skills: [{ name: 'skill', fullName: 'market/plugin/skill', globalEnabled: true, workspaceOverride: null, enabled: true }],
  }],
}]
const hookSwitches = (tree) => nodes(tree, (node) => node.type === 'button' && node.props.role === 'switch' && /Codex hooks/.test(node.props['aria-label'] || ''))
test('hook activation requires a second confirmation before writing', async (t) => {
  const fixture = await viewsFixture(hookMarket(hookView))
  t.after(() => fixture.dispose())
  await settle()
  const page = fixture.mount(fixture.mainPage)
  t.after(() => page.unmount())
  await settle()
  const collapsed = fixture.expand(page.render())
  assert.match(text(collapsed), /默认关闭/)
  nodes(collapsed, (node) => node.type === 'DisclosureRow')[0].props.onToggle()
  const initial = hookSwitches(fixture.expand(page.render()))[0]
  assert.equal(initial.props['aria-checked'], false)
  await initial.props.onClick()
  assert.equal(fixture.writes.length, 0, 'the first click only arms the confirmation')
  assert.match(text(fixture.expand(page.render())), /再次点击开关确认/)
  const confirmed = hookSwitches(fixture.expand(page.render()))[0]
  await confirmed.props.onClick()
  assert.deepEqual(fixture.writes, [{
    method: 'set-plugin-hooks-enabled',
    args: { marketId: 'market', pluginName: 'plugin', enabled: true },
  }])
})

test('an unavailable hooks bridge reports its install command and disables hook activation', async (t) => {
  const fixture = await viewsFixture(hookMarket({ ...hookView, available: false }), {
    hooksBridge: { available: false, installCommand: 'pnpm add @deepseek-ai/dsh-hooks-codex' },
  })
  t.after(() => fixture.dispose())
  await settle()
  const page = fixture.mount(fixture.mainPage)
  t.after(() => page.unmount())
  await settle()
  const collapsed = fixture.expand(page.render())
  assert.match(text(collapsed), /Codex hooks bridge 当前不可用/)
  assert.match(text(collapsed), /pnpm add @deepseek-ai\/dsh-hooks-codex/)
  nodes(collapsed, (node) => node.type === 'DisclosureRow')[0].props.onToggle()
  assert.equal(hookSwitches(fixture.expand(page.render()))[0].props.disabled, true)
})

test('workspace pages keep hooks global and read-only', async (t) => {
  const fixture = await viewsFixture(hookMarket(hookView))
  t.after(() => fixture.dispose())
  await settle()
  const page = fixture.mount({ ...fixture.mainPage, props: { workspace: defaultWorkspace } })
  t.after(() => page.unmount())
  await settle()
  const collapsed = fixture.expand(page.render())
  nodes(collapsed, (node) => node.type === 'DisclosureRow')[0].props.onToggle()
  const tree = fixture.expand(page.render())
  assert.equal(hookSwitches(tree).length, 0, 'hooks stay under the global configuration')
  assert.match(text(tree), /Hooks 和执行审批仍使用全局配置/)
})
