import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

async function featureCard(snapshot, expanded = true) {
  let registration
  let stateIndex = 0
  const state = []
  let effectIndex = 0
  let css = ''
  const slots = new Map()
  const writes = []
  class ReceiverBoundScope {
    constructor() { this.snapshot = snapshot; this.writes = writes }
    getSnapshot() { return this.snapshot }
    subscribe() { assert.equal(this.snapshot, snapshot); return () => {} }
    async set(field, value) { this.writes.push([field, value]) }
  }
  const scope = new ReceiverBoundScope()
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
  const primitives = { Switch: 'Switch', IconChevronDownOutline14: 'IconChevronDownOutline14' }
  vm.runInNewContext(await readFile(new URL('../lib/client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load(value) { registration = value } } },
    document: {
      createElement: () => ({ textContent: '', remove() {} }),
      head: { appendChild(style) { css = style.textContent } },
    },
  })
  const client = registration.factory((id) => id === 'react' ? React : primitives)
  client.apply({
    settingsScope: { bind(spec) { assert.equal(spec.namespace, 'agent-plugin-market'); return scope } },
    // Install the actual stylesheet but leave unrelated workspace observers idle.
    effect(install) { if (effectIndex++ === 0) install() },
    slots: {
      inject(_name, register) { return register() },
      register(options, render) { slots.set(options.name, { options, render }) },
    },
  })
  const card = slots.get('settings.plugin.item')
  assert.equal(card.options.key, 'agent-plugin-market')
  assert.equal(slots.get('settings.section').options.id, 'skills-and-hooks')
  const element = card.render()
  function render() { stateIndex = 0; return element.type(element.props) }
  let tree = render()
  if (expanded && tree) {
    nodes(tree, 'button')[0].props.onClick()
    tree = render()
  }
  return { tree, writes, render, css }
}

function nodes(tree, type) {
  if (!tree || typeof tree !== 'object') return []
  return [...(tree.type === type ? [tree] : []), ...tree.children.flatMap((child) => nodes(child, type))]
}

test('plugin card matches the native stacked header and discloses its bordered body', async () => {
  const { tree, render, css } = await featureCard({ status: 'ready', writable: true, value: { tools: true, systemPrompt: true } }, false)
  assert.equal(tree.props.className, 'apm-feature-card')
  const header = nodes(tree, 'button')[0]
  assert.equal(header.props.type, 'button')
  assert.equal(header.props['aria-expanded'], false)
  assert.equal(header.props.className, 'apm-feature-header')
  assert.equal(header.children[0].props.className, 'apm-feature-head-text')
  assert.deepEqual(header.children[0].children.map((child) => child.children[0]), ['Agent 插件市场', '配置市场工具及其系统提示词。'])
  assert.equal(header.children[1].type, 'IconChevronDownOutline14')
  assert.equal(nodes(tree, 'Switch').length, 0)
  assert.match(css, /\.apm-feature-card\{[^}]*border-radius:16px/)
  assert.match(css, /\.apm-feature-card\{[^}]*var\(--dsw-alias-bg-layer-3\)/)
  assert.match(css, /\.apm-feature-header\{[^}]*padding:14px 16px/)
  assert.match(css, /\.apm-feature-name\{[^}]*font-size:15px;font-weight:600/)
  assert.match(css, /\.apm-feature-body\{[^}]*border-top:\.5px solid var\(--dsw-alias-border-l2\)/)
  header.props.onClick()
  const open = render()
  assert.equal(open.props.className, 'apm-feature-card open')
  assert.equal(nodes(open, 'Switch').length, 2)
  assert.ok(nodes(open, 'div').some((node) => node.props.className === 'apm-feature-body'))
  nodes(open, 'button')[0].props.onClick()
  assert.equal(nodes(render(), 'Switch').length, 0)
})

test('native plugin card exposes feature switches through the settings namespace', async () => {
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
