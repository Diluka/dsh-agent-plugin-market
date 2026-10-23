import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

async function featureCard(snapshot, view = 'page') {
  let registration
  let stateIndex = 0
  const state = []
  let css = ''
  const slots = new Map()
  const registrations = []
  const writes = []
  const listeners = new Set()
  const cleanups = []
  const dictionaries = new Map()
  // DSH ships LOCALE_IDS = ['zh', 'en'], not regional tags.
  let localeSnapshot = { active: 'zh' }
  const form = {
    getSnapshot() { return snapshot },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    async set(field, value) { writes.push([field, value]); return true },
  }
  const locale = {
    getSnapshot: () => localeSnapshot,
    subscribe: () => () => {},
    register(_namespace, language, dict) {
      assert.ok(['zh', 'en'].includes(language), 'register copy for a shipped DSH locale')
      dictionaries.set(language, dict)
      return () => dictionaries.delete(language)
    },
    bind: () => (key) => (dictionaries.get(localeSnapshot.active) || dictionaries.get('en'))[key],
  }
  const React = {
    createElement(type, props, ...children) { return { type, props: props || {}, children } },
    useCallback: (callback) => callback,
    useSyncExternalStore: (subscribe, get) => { subscribe(() => {})(); return get() },
    useState(value) {
      const index = stateIndex++
      if (!(index in state)) state[index] = value
      return [state[index], (next) => { state[index] = next }]
    },
  }
  const primitives = { Switch: 'Switch', IconChevronDownOutlineMedium: 'IconChevronDownOutlineMedium', IconSkillOutlineMedium: 'IconSkillOutlineMedium' }
  vm.runInNewContext(await readFile(new URL('../lib/client.js', import.meta.url), 'utf8'), {
    window: {
      __ModuleLoader__: { load(value) { registration = value } },
      MutationObserver: class { observe() {} disconnect() {} },
    },
    document: {
      body: {},
      createElement: () => ({ textContent: '', remove() {} }),
      head: { appendChild(style) { css = style.textContent } },
      querySelectorAll: () => [],
      addEventListener() {},
      removeEventListener() {},
    },
  })
  const client = registration.factory((id) => id === 'react' ? React : primitives)
  client.apply({
    configForms: { get(entryId) { assert.equal(entryId, 'dsh-agent-plugin-market'); return form } },
    locale,
    connection: { rpc: { async call() { return { ok: true, value: { workspaces: [] } } } } },
    workspaces: { list: { getSnapshot: () => ({ items: [] }), subscribe: () => () => {} } },
    effect(install) { const cleanup = install(); if (cleanup) cleanups.push(cleanup) },
    slots: {
      inject(_name, register) { return register() },
      register(options, render) {
        assert.ok(!slots.has(options.name), 'duplicate slot registration: ' + options.name)
        const entry = { options, render }
        slots.set(options.name, entry)
        registrations.push(options.name)
        return () => { if (slots.get(options.name) === entry) slots.delete(options.name) }
      },
    },
  })
  const card = slots.get('plugins.bundle.config')
  assert.equal(card.options.key, 'dsh-agent-plugin-market')
  assert.equal(slots.get('settings.section').options.id, 'skills-and-hooks')
  const element = card.render({ view })
  function render() { stateIndex = 0; return element.type(element.props) }
  return {
    tree: render(), writes, render, css, slots, registrations, form, listeners,
    publish(next) { snapshot = next; for (const listener of listeners) listener() },
    setLocale(active) { localeSnapshot = { active } },
    dispose() { for (const cleanup of cleanups.toReversed()) cleanup() },
  }
}

const ready = (value = {}, writable = true) => ({ status: 'ready', writable, value: { tools: true, systemPrompt: true, showInSidebar: true, ...value } })

function nodes(tree, type) {
  if (!tree || typeof tree !== 'object') return []
  return [...(tree.type === type ? [tree] : []), ...tree.children.flatMap((child) => nodes(child, type))]
}

function switchesByLabel(tree) {
  return Object.fromEntries(nodes(tree, 'Switch').map((node) => [node.props.label, node.props]))
}

test('plugin bundle configuration is inline, visible by default, and collapsible', async () => {
  const { tree, render, css } = await featureCard(ready())
  assert.equal(tree.props.className, 'apm-feature-card open')
  const header = nodes(tree, 'button')[0]
  assert.equal(header.props.type, 'button')
  assert.equal(header.props['aria-expanded'], true)
  assert.equal(header.props.className, 'apm-feature-header')
  assert.equal(header.children[0].props.className, 'apm-feature-head-text')
  assert.deepEqual(header.children[0].children.map((child) => child.children[0]), ['Agent 插件市场', '配置侧边栏入口、市场工具及其系统提示词。'])
  assert.equal(header.children[1].type, 'IconChevronDownOutlineMedium')
  assert.equal(nodes(tree, 'Switch').length, 3)
  assert.match(css, /\.apm-feature-card\{[^}]*border-radius:16px/)
  assert.match(css, /\.apm-feature-card\{[^}]*var\(--dsw-alias-bg-layer-3\)/)
  assert.match(css, /\.apm-feature-header\{[^}]*padding:14px 16px/)
  assert.match(css, /\.apm-feature-name\{[^}]*font-size:15px;font-weight:600/)
  assert.match(css, /\.apm-feature-body\{[^}]*border-top:\.5px solid var\(--dsw-alias-border-l2\)/)
  header.props.onClick()
  const closed = render()
  assert.equal(closed.props.className, 'apm-feature-card')
  assert.equal(nodes(closed, 'Switch').length, 0)
  nodes(closed, 'button')[0].props.onClick()
  assert.equal(nodes(render(), 'Switch').length, 3)
})

test('plugin bundle summary is concise', async () => {
  const { tree } = await featureCard({ status: 'unavailable' }, 'summary')
  assert.equal(tree.type, 'span')
  assert.equal(tree.children[0], '配置侧边栏入口、市场工具及其系统提示词。')
})

test('plugin bundle configuration persists sidebar and model feature switches independently', async () => {
  const { tree, writes } = await featureCard(ready())
  assert.equal(nodes(tree, 'button')[0].props['aria-label'], '收起：Agent 插件市场')
  assert.equal(nodes(tree, 'h4')[0].children[0], '功能')
  const switches = switchesByLabel(tree)
  assert.equal(Object.keys(switches).length, 3)
  switches['在侧边栏显示'].onChange(false)
  switches['启用工具'].onChange(false)
  switches['注入系统提示词'].onChange(false)
  assert.deepEqual(writes, [['showInSidebar', false], ['tools', false], ['systemPrompt', false]])
})

test('disabled tools display prompt off but leave sidebar preference editable', async () => {
  const { tree, slots } = await featureCard(ready({ tools: false }))
  const switches = switchesByLabel(tree)
  assert.equal(switches['启用工具'].checked, false)
  assert.equal(switches['启用工具'].disabled, false)
  assert.equal(switches['注入系统提示词'].checked, false)
  assert.equal(switches['注入系统提示词'].disabled, true)
  assert.equal(switches['在侧边栏显示'].checked, true)
  assert.equal(switches['在侧边栏显示'].disabled, false)
  assert.ok(slots.has('sidebar.panellist'))
  assert.match(JSON.stringify(tree), /工具未启用时默认也禁用/)
})

test('plugin card respects read-only and unavailable settings', async () => {
  const { tree, slots } = await featureCard(ready({ systemPrompt: false, showInSidebar: false }, false))
  assert.ok(nodes(tree, 'Switch').every((node) => node.props.disabled))
  assert.equal(switchesByLabel(tree)['在侧边栏显示'].checked, false)
  assert.equal(slots.has('sidebar.panellist'), false)
  assert.equal((await featureCard({ status: 'unavailable' })).tree, null)
})

test('sidebar panel addresses the shared settings page and honors the shell icon size', async () => {
  const { slots, css } = await featureCard(ready())
  const sidebar = slots.get('sidebar.panellist')
  const main = slots.get('main')
  assert.equal(sidebar.options.id, main.options.key)
  assert.equal(sidebar.options.label(), '技能与挂钩')
  const icon = sidebar.render({ size: 18, active: true })
  assert.equal(icon.type, 'IconSkillOutlineMedium')
  assert.equal(icon.props.size, 18)
  const panel = main.render()
  assert.equal(panel.props['aria-label'], '技能与挂钩')
  assert.equal(nodes(panel, 'h1')[0].children[0], '技能与挂钩')
  const settingsPage = slots.get('settings.section').render()
  assert.equal(panel.children[0].children[1].type, settingsPage.type, 'both surfaces reuse the same MarketPage component')
  assert.match(css, /\.apm-panel\{[^}]*height:100%;[^}]*overflow:auto/)
  assert.match(css, /@media[^`]*\.apm-panel-content\{/)
})

test('sidebar preference updates live without duplicates or removing settings or an open panel', async () => {
  const fixture = await featureCard(ready())
  const { slots, publish, registrations } = fixture
  const settings = slots.get('settings.section')
  const main = slots.get('main')
  publish(ready({ tools: false }))
  assert.equal(registrations.filter((name) => name === 'sidebar.panellist').length, 1)
  publish(ready({ showInSidebar: false }))
  assert.equal(slots.has('sidebar.panellist'), false)
  assert.equal(slots.get('settings.section'), settings)
  assert.equal(slots.get('main'), main)
  publish(ready())
  publish(ready())
  assert.equal(registrations.filter((name) => name === 'sidebar.panellist').length, 2)
  assert.ok(slots.has('sidebar.panellist'))
  fixture.dispose()
  assert.equal(fixture.listeners.size, 0)
  assert.equal(slots.has('sidebar.panellist'), false)
  publish(ready())
  assert.equal(slots.has('sidebar.panellist'), false)
})

test('sidebar entry waits for accepted configuration and withdraws unavailable preferences', async () => {
  const { slots, publish } = await featureCard({ status: 'loading' })
  assert.equal(slots.has('sidebar.panellist'), false)
  publish(ready({ showInSidebar: false }))
  assert.equal(slots.has('sidebar.panellist'), false)
  publish(ready({}, false))
  assert.ok(slots.has('sidebar.panellist'), 'read-only clients still display the accepted preference')
  publish({ status: 'unavailable' })
  assert.equal(slots.has('sidebar.panellist'), false)
  assert.ok(slots.has('settings.section'))
})

test('sidebar label, panel title, and new configuration copy follow the locale', async () => {
  const fixture = await featureCard(ready())
  fixture.setLocale('en')
  assert.equal(fixture.slots.get('sidebar.panellist').options.label(), 'Skills & Hooks')
  assert.equal(nodes(fixture.slots.get('main').render(), 'h1')[0].children[0], 'Skills & Hooks')
  assert.ok(switchesByLabel(fixture.render())['Show in sidebar'])
})

test('refused sidebar writes report failure and preserve accepted navigation state', async () => {
  const fixture = await featureCard(ready())
  fixture.form.set = async () => false
  switchesByLabel(fixture.tree)['在侧边栏显示'].onChange(false)
  await new Promise((resolve) => setImmediate(resolve))
  assert.match(JSON.stringify(fixture.render()), /设置已变化或当前只读/)
  assert.ok(fixture.slots.has('sidebar.panellist'))
})
