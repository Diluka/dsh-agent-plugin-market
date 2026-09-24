import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

async function featureCard(snapshot, view = 'page') {
  let registration
  let stateIndex = 0
  const state = []
  let effectIndex = 0
  let css = ''
  const slots = new Map()
  const writes = []
  const form = {
    getSnapshot() { return snapshot },
    subscribe() { return () => {} },
    async set(field, value) { writes.push([field, value]); return true },
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
  const primitives = { Switch: 'Switch', IconChevronDownOutlineMedium: 'IconChevronDownOutlineMedium' }
  vm.runInNewContext(await readFile(new URL('../lib/client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load(value) { registration = value } } },
    document: {
      createElement: () => ({ textContent: '', remove() {} }),
      head: { appendChild(style) { css = style.textContent } },
    },
  })
  const client = registration.factory((id) => id === 'react' ? React : primitives)
  client.apply({
    configForms: { get(entryId) { assert.equal(entryId, 'dsh-agent-plugin-market'); return form } },
    // Install the actual stylesheet but leave unrelated workspace observers idle.
    effect(install) { if (effectIndex++ === 0) install() },
    slots: {
      inject(_name, register) { return register() },
      register(options, render) { slots.set(options.name, { options, render }) },
    },
  })
  const card = slots.get('plugins.bundle.config')
  assert.equal(card.options.key, 'dsh-agent-plugin-market')
  assert.equal(slots.get('settings.section').options.id, 'skills-and-hooks')
  const element = card.render({ view })
  function render() { stateIndex = 0; return element.type(element.props) }
  return { tree: render(), writes, render, css }
}

function nodes(tree, type) {
  if (!tree || typeof tree !== 'object') return []
  return [...(tree.type === type ? [tree] : []), ...tree.children.flatMap((child) => nodes(child, type))]
}

test('plugin bundle configuration is inline, visible by default, and collapsible', async () => {
  const { tree, render, css } = await featureCard({ status: 'ready', writable: true, value: { tools: true, systemPrompt: true } })
  assert.equal(tree.props.className, 'apm-feature-card open')
  const header = nodes(tree, 'button')[0]
  assert.equal(header.props.type, 'button')
  assert.equal(header.props['aria-expanded'], true)
  assert.equal(header.props.className, 'apm-feature-header')
  assert.equal(header.children[0].props.className, 'apm-feature-head-text')
  assert.deepEqual(header.children[0].children.map((child) => child.children[0]), ['Agent 插件市场', '配置市场工具及其系统提示词。'])
  assert.equal(header.children[1].type, 'IconChevronDownOutlineMedium')
  assert.equal(nodes(tree, 'Switch').length, 2)
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
  assert.equal(nodes(render(), 'Switch').length, 2)
})

test('plugin bundle summary is concise', async () => {
  const { tree } = await featureCard({ status: 'unavailable' }, 'summary')
  assert.equal(tree.type, 'span')
  assert.equal(tree.children[0], '配置市场工具及其系统提示词。')
})

test('plugin bundle configuration form exposes the feature switches', async () => {
  const { tree, writes } = await featureCard({ status: 'ready', writable: true, value: { tools: true, systemPrompt: true } })
  assert.equal(nodes(tree, 'button')[0].props['aria-label'], '收起：Agent 插件市场')
  assert.equal(tree.props.className, 'apm-feature-card open')
  assert.equal(nodes(tree, 'h4')[0].children[0], '功能')
  const switches = nodes(tree, 'Switch')
  assert.equal(switches.length, 2)
  assert.equal(switches[0].props.label, '启用工具')
  assert.equal(switches[1].props.label, '注入系统提示词')
  switches[0].props.onChange(false)
  switches[1].props.onChange(false)
  assert.deepEqual(writes, [['tools', false], ['systemPrompt', false]])
})

test('disabled tools display prompt off and prevent editing its saved preference', async () => {
  const { tree } = await featureCard({ status: 'ready', writable: true, value: { tools: false, systemPrompt: true } })
  const switches = nodes(tree, 'Switch')
  assert.equal(switches[0].props.checked, false)
  assert.equal(switches[0].props.disabled, false)
  assert.equal(switches[1].props.checked, false)
  assert.equal(switches[1].props.disabled, true)
  assert.match(JSON.stringify(tree), /工具未启用时默认也禁用/)
})

test('plugin card respects read-only and unavailable settings', async () => {
  const { tree } = await featureCard({ status: 'ready', writable: false, value: { tools: true, systemPrompt: false } })
  assert.ok(nodes(tree, 'Switch').every((node) => node.props.disabled))
  assert.equal((await featureCard({ status: 'unavailable' })).tree, null)
})
