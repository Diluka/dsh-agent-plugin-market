import assert from 'node:assert/strict'
import test from 'node:test'

import { Context } from '@deepseek-ai/cordis'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
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
  ctx.provide('settings', { async prepareDocument() { return '/fixture/.dsh/settings.yml' } })
  ctx.provide('subprocess', {
    spawn({ argv }) {
      assert.equal(argv[0], 'mkdir')
      return { done: Promise.resolve({ exitCode: 0 }), collected: {} }
    },
  })
  ctx.provide('skills', {
    registerProvider(factory) {
      factory({ invalidate() {} })
      return () => {}
    },
  })
  ctx.provide('tools', { register() { return () => {} } })
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
  return { ctx, routes, webServer, connectionFiber }
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
