import assert from 'node:assert/strict'
import test from 'node:test'

import { Context, Service, resolveConfig } from '@deepseek-ai/cordis'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import { SystemPrompt, renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { SETTINGS_NAMESPACE, PROMPT_SECTION } from '../lib/market-features.js'

class MemorySettings extends SettingsProvider {
  writable = true
  async load() { return {} }
  async persist() {}
  async prepareDocument() { return '/fixture/.dsh/settings.yml' }
}

class FixtureTools extends Service {
  constructor(ctx, tools) {
    super(ctx, 'tools')
    this.entries = tools
  }
  register(tool) {
    return this.ctx.effect(() => {
      assert.equal(this.entries.has(tool.name), false, 'no duplicate registration')
      this.entries.set(tool.name, tool)
      return () => this.entries.delete(tool.name)
    })
  }
}
import * as marketPlugin from '../lib/index.js'

const { workspacePathForCwd } = marketPlugin

// Exercise the real Cordis guard and Connection channel registration, without
// opening a server or touching the user's settings, markets, or credentials.
async function hostFixture({ connectionInject = ['webServer'] } = {}) {
  const ctx = new Context()
  const routes = new Map()
  ctx.provide('fs', {
    async resolve(displayPath) { return { displayPath, targetKey: displayPath } },
    async stat() { return null },
  })
  await ctx.plugin(MemorySettings).await()
  await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false }).await()
  ctx.provide('subprocess', {
    spawn({ argv }) {
      assert.equal(argv[0], 'mkdir')
      return { done: Promise.resolve({ exitCode: 0 }), collected: {} }
    },
  })
  const skillProviders = new Set()
  ctx.provide('skills', {
    registerProvider(factory) {
      const provider = factory({ invalidate() {} })
      skillProviders.add(provider)
      return () => skillProviders.delete(provider)
    },
  })
  const tools = new Map()
  await ctx.plugin({ apply(toolCtx) { new FixtureTools(toolCtx, tools) } }).await()
  const connectionFiber = ctx.plugin({
    // Mirrors the provider-side dependency supplied by cordis.patch.yml.
    inject: connectionInject,
    apply(connectionCtx) { new HostConnectionService(connectionCtx, [], {}) },
  })
  await connectionFiber.inertia
  const webServer = {
    register(route) {
      assert.equal(routes.has(route.path), false)
      routes.set(route.path, route)
      return () => routes.delete(route.path)
    },
  }
  return { ctx, routes, webServer, connectionFiber, tools, skillProviders }
}

test('Host registers its Connection RPC channel and removes it on disposal', async (t) => {
  const { ctx, routes, webServer, connectionFiber } = await hostFixture()
  t.after(() => ctx.fiber.dispose())
  const webFiber = ctx.plugin({ apply(webCtx) { webCtx.provide('webServer', webServer) } })
  await webFiber.await()
  await connectionFiber.await()

  const fiber = ctx.plugin(marketPlugin)
  await fiber.await()
  assert.equal(routes.get('/agent-plugin-market')?.kind, 'prefix')

  await fiber.dispose()
  assert.equal(routes.size, 0)
})

test('Host waits for webServer before applying and registers when it appears', async (t) => {
  const { ctx, routes, webServer, connectionFiber } = await hostFixture()
  t.after(() => ctx.fiber.dispose())

  const fiber = ctx.plugin(marketPlugin)
  await fiber.await()
  assert.equal(routes.size, 0)

  const webFiber = ctx.plugin({ apply(webCtx) { webCtx.provide('webServer', webServer) } })
  await webFiber.await()
  await connectionFiber.await()
  await fiber.await()
  assert.equal(routes.has('/agent-plugin-market'), true)
})

test('market injection alone cannot satisfy the Connection provider shadow guard', async (t) => {
  const { ctx, webServer, connectionFiber } = await hostFixture({ connectionInject: [] })
  t.after(() => ctx.fiber.dispose())
  const webFiber = ctx.plugin({ apply(webCtx) { webCtx.provide('webServer', webServer) } })
  await webFiber.await()
  await connectionFiber.await()

  const fiber = ctx.plugin(marketPlugin)
  await assert.rejects(fiber.await(), /cannot get property "webServer" without inject/)
})

test('feature Config validates booleans and preserves enabled defaults', () => {
  assert.deepEqual(resolveConfig(marketPlugin, {}), { tools: true, systemPrompt: true })
  assert.deepEqual(resolveConfig(marketPlugin, { tools: false }), { tools: false, systemPrompt: true })
  assert.throws(() => resolveConfig(marketPlugin, { tools: 'false' }))
  const schema = marketPlugin.Config.toJSON()
  const root = schema.refs[schema.uid]
  assert.equal(root.meta.description, '功能')
  assert.match(schema.refs[root.dict.systemPrompt].meta.description, /工具未启用时默认也禁用/)
})

for (const tools of [true, false]) {
  for (const systemPrompt of [true, false]) {
    test(`feature combination tools=${tools}, systemPrompt=${systemPrompt} preserves market UI and skills`, async (t) => {
      const fixture = await hostFixture()
      const { ctx, webServer, connectionFiber } = fixture
      t.after(() => ctx.fiber.dispose())
      await ctx.plugin({ apply(webCtx) { webCtx.provide('webServer', webServer) } }).await()
      await connectionFiber.await()
      const fiber = ctx.plugin(marketPlugin, { tools, systemPrompt })
      await fiber.await()
      assert.equal(fixture.tools.size, tools ? 3 : 0)
      assert.equal(fixture.skillProviders.size, 1)
      assert.equal(fixture.routes.has('/agent-plugin-market'), true)
      const assembly = await ctx.systemPrompt.assemble()
      assert.equal(assembly.sections.some((section) => section.name === PROMPT_SECTION), tools && systemPrompt)
      await fiber.dispose()
      assert.equal(fixture.tools.size, 0)
      assert.equal(fixture.skillProviders.size, 0)
      assert.equal(fixture.routes.size, 0)
      assert.equal(ctx.settings.describe().some((entry) => entry.ns === SETTINGS_NAMESPACE), false)
      assert.equal(renderPrompt(await ctx.systemPrompt.assemble()), '')
    })
  }
}

test('native settings toggles dispose and restore tools and guidance without duplicates', async (t) => {
  const { ctx, webServer, connectionFiber, tools } = await hostFixture()
  t.after(() => ctx.fiber.dispose())
  await ctx.plugin({ apply(webCtx) { webCtx.provide('webServer', webServer) } }).await()
  await connectionFiber.await()
  let restrictions = 0
  const homeAgent = {
    session: { header: { cwd: '/fixture' } },
    ctx: { tools: { restrict() { restrictions++; return () => { restrictions-- } } } },
  }
  ctx.provide('agents', { list: () => [homeAgent] })
  const fiber = ctx.plugin(marketPlugin)
  await fiber.await()
  assert.equal(restrictions, 1)
  const prompt = async (cwd) => renderPrompt(await ctx.systemPrompt.assemble({ agent: { session: { header: { cwd } } } }))
  assert.match(await prompt('/repo'), /agent_market_info.*agent_market_set_plugin.*agent_market_set_skill/)
  assert.equal(await prompt('/fixture'), '')
  assert.match(await prompt('/fixture/project'), /agent_market_info/)

  // Settings writes commit before asynchronous watchers finish; drain their
  // microtasks and the plugin's child Fibers before inspecting effects.
  async function update(patch) {
    await ctx.settings.update(SETTINGS_NAMESPACE, patch)
    await new Promise((resolve) => setImmediate(resolve))
    await fiber.await()
  }
  await update({ tools: false })
  assert.equal(tools.size, 0)
  assert.equal(restrictions, 0)
  assert.equal(await prompt('/repo'), '')
  await update({ tools: true })
  assert.equal(tools.size, 3)
  assert.equal(restrictions, 1)
  assert.match(await prompt('/repo'), /agent_market_info/)
  await update({ tools: true })
  assert.equal(tools.size, 3)
  await update({ systemPrompt: false })
  assert.equal(tools.size, 3)
  assert.equal(await prompt('/repo'), '')
  await update({ tools: false })
  await update({ tools: true })
  assert.equal(tools.size, 3)
  assert.equal(await prompt('/repo'), '')
  await update({ systemPrompt: true })
  assert.match(await prompt('/repo'), /agent_market_info/)
  await Promise.all([update({ tools: false }), update({ tools: true }), update({ tools: false }), update({ tools: true })])
  assert.equal(tools.size, 3)
  assert.equal(restrictions, 1)
  await ctx.settings.update(SETTINGS_NAMESPACE, { tools: false })
  await fiber.dispose()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(tools.size, 0)
  assert.equal(restrictions, 0)
  assert.equal(await prompt('/repo'), '')
})

test('maps nested cwd to the most specific registered workspace root', () => {
  const workspaces = [
    { path: '/repo' },
    { path: '/repo/packages/app' },
    { path: '/other' },
  ]

  assert.equal(workspacePathForCwd(workspaces, '/repo/packages/app/src'), '/repo/packages/app')
  assert.equal(workspacePathForCwd(workspaces, '/repo/tools'), '/repo')
  assert.equal(workspacePathForCwd(workspaces, '/repository'), '/repository')
  assert.equal(workspacePathForCwd(workspaces, undefined), undefined)
})
