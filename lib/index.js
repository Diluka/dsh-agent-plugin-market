// dsh-agent-plugin-market Host plugin composition root.
import { createCodexHookManager } from './codex-hook-manager.js'
import { createMarketRuntime } from './market-runtime.js'
import { createMarketService } from './market-service.js'

/** @type {readonly ['skills', 'fs', 'settings', 'subprocess', 'connection']} */
export const inject = ['skills', 'fs', 'settings', 'subprocess', 'connection']

/**
 * Registers the Host half of the plugin with injected DSH services.
 *
 * @param {import('@deepseek-ai/cordis').Context & {skills: {registerProvider: (factory: (control: {invalidate: () => void}) => unknown) => (() => void)}, fs: Parameters<typeof createMarketRuntime>[0]['fs'], settings: {prepareDocument: () => Promise<string | undefined>}, subprocess: Parameters<typeof createMarketRuntime>[0]['subprocess'], connection: {rpc: {handle: (route: string, handler: (endpoint: string, payload: unknown) => Promise<unknown>, options: {authority: 'loopback'}) => unknown}}}} ctx
 */
export async function apply(ctx) {
  const { skills, fs, settings, subprocess, connection } = ctx
  let codexHooksBridge = null
  try {
    codexHooksBridge = await import('@deepseek-ai/dsh-hooks-codex')
  } catch (e) {
    console.warn('[agent-plugin-market] Codex hooks bridge unavailable: ' + String((e && e.message) || e))
  }

  const docPath = await settings.prepareDocument()
  if (!docPath) throw new Error('agent-plugin-market requires a file-backed settings provider')
  const sepIdx = Math.max(docPath.lastIndexOf('/'), docPath.lastIndexOf('\\'))
  const dshHome = sepIdx > 0 ? docPath.slice(0, sepIdx) : docPath
  const runtime = createMarketRuntime({ fs, subprocess, dshHome })
  await runtime.prepare()

  const hooks = createCodexHookManager({ ctx, fs, bridge: codexHooksBridge, runtime })
  hooks.start()

  let invalidate = () => {}
  ctx.effect(() => skills.registerProvider((control) => {
    invalidate = () => { try { control.invalidate() } catch { /* provider teardown may race invalidation */ } }
    return {
      name: 'agent-plugin-market',
      async list() {
        const out = []
        for (const sk of await runtime.collectSkills()) {
          out.push({
            name: sk.skillName,
            description: sk.description,
            ...(sk.whenToUse ? { whenToUse: sk.whenToUse } : {}),
            invocation: { modelInvocable: true, userInvocable: true },
            source: 'custom',
            provider: 'agent-plugin-market',
            rank: 800,
            locator: { path: sk.path },
            resourceBase: { kind: 'directory', path: sk.resourceDir },
            path: sk.path,
          })
        }
        return out
      },
      async get(candidate) {
        if (!candidate || !candidate.locator || typeof candidate.locator.path !== 'string' || !candidate.resourceBase || candidate.resourceBase.kind !== 'directory' || typeof candidate.resourceBase.path !== 'string') return undefined
        const doc = await runtime.readSkillFileWithin(candidate.resourceBase.path, candidate.locator.path)
        if (!doc) return undefined
        return {
          name: candidate.name,
          description: candidate.description,
          ...(candidate.whenToUse ? { whenToUse: candidate.whenToUse } : {}),
          invocation: candidate.invocation,
          source: candidate.source,
          provider: candidate.provider,
          resourceBase: candidate.resourceBase,
          path: candidate.path,
          content: doc.content,
        }
      },
    }
  }))

  const service = createMarketService({
    runtime,
    hooks,
    onSkillsChanged: () => invalidate(),
  })
  service.registerAutoUpdate(ctx)

  const rpcHandlers = new Map(/** @type {Array<[string, Function]>} */ ([
    ['get-state', async () => service.getState()],
    ['add-market', service.addMarket],
    ['update-market', service.updateMarket],
    ['remove-market', service.removeMarket],
    ['install-plugin', service.installPlugin],
    ['uninstall-plugin', service.uninstallPlugin],
    ['set-skill-enabled', service.setSkillEnabled],
    ['set-standalone-skills-enabled', service.setStandaloneSkillsEnabled],
    ['set-plugin-hooks-enabled', service.setPluginHooksEnabled],
  ]))

  function rpcFailure(error) {
    return {
      ok: false,
      error: {
        code: 'internal',
        message: String((error && error.message) || error).slice(0, 600),
        details: {},
      },
    }
  }

  connection.rpc.handle('/agent-plugin-market', async (endpoint, payload) => {
    const handler = rpcHandlers.get(endpoint)
    if (!handler) return rpcFailure(new Error('unsupported agent-plugin-market endpoint: ' + endpoint))
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return rpcFailure(new Error('agent-plugin-market RPC payload must be an object'))
    }
    try {
      return { ok: true, value: await handler(payload) }
    } catch (e) {
      return rpcFailure(e)
    }
  }, { authority: 'loopback' })
}
