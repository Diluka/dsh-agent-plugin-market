import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

// Exercise the real page callbacks with independent hook instances, as the
// main panel and the shell's Settings portal remain mounted at the same time.
async function viewsFixture() {
  let registration
  let current
  const slots = new Map()
  const reads = []
  const workspaces = [{ id: 'workspace', title: 'Workspace', path: '/fixture' }]
  let markets = []
  let refuseWrite = false
  function memo(create, deps) {
    const index = current.index++
    const previous = current.hooks[index]
    if (!previous || !deps.every((value, i) => Object.is(value, previous.deps[i]))) {
      current.hooks[index] = { value: create(), deps }
    }
    return current.hooks[index].value
  }
  const React = {
    createElement(type, props, ...children) { return { type, props: props || {}, children } },
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
    window: { __ModuleLoader__: { load(value) { registration = value } } },
  })
  const client = registration.factory((id) => id === 'react' ? React : {})
  client.apply({
    effect() {}, // No browser DOM or live workspace-menu observers in this fixture.
    configForms: { get: () => ({}) },
    locale: { subscribe() {}, getSnapshot: () => 'zh', bind: () => (key) => key },
    workspaces: { list: { getSnapshot: () => ({ items: workspaces.map(({ id, ...item }) => ({ ...item, workspaceId: id })) }) } },
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
      assert.equal(method, 'add-market')
      if (refuseWrite) return { ok: false, error: { message: 'fixture write refused' } }
      markets.push({ id: 'fixture-market', name: 'Fixture Market', repo: args.repo, plugins: [{ name: 'fixture-plugin', skills: [{ name: 'fixture-skill' }] }] })
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
  return { mount, mainPage, settingsPage, reads, refuse() { refuseWrite = true } }
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
})
