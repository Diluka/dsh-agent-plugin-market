// dsh-agent-plugin-market Host plugin composition root.
import { createCodexHookManager } from './codex-hook-manager.js'
import { createMarketRuntime } from './market-runtime.js'
import { createMarketService } from './market-service.js'

/** @type {readonly ['skills', 'fs', 'settings', 'subprocess', 'connection']} */
export const inject = ['skills', 'fs', 'settings', 'subprocess', 'connection']

/**
 * @param {Array<{path: string}>} workspaces
 * @param {string | undefined} cwd
 */
export function workspacePathForCwd(workspaces, cwd) {
  if (typeof cwd !== 'string' || !cwd) return undefined
  let best = ''
  for (const workspace of workspaces) {
    const raw = workspace && typeof workspace.path === 'string' ? workspace.path : ''
    const root = raw === '/' ? raw : raw.replace(/\/+$/, '')
    if (!root) continue
    if ((cwd === root || root === '/' || cwd.startsWith(root + '/')) && root.length > best.length) best = root
  }
  return best || cwd
}

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
    const detail = e && typeof e === 'object' && 'message' in e ? e.message : undefined
    console.warn('[agent-plugin-market] Codex hooks bridge unavailable: ' + String(detail || e))
  }

  const docPath = await settings.prepareDocument()
  if (!docPath) throw new Error('agent-plugin-market requires a file-backed settings provider')
  const sepIdx = Math.max(docPath.lastIndexOf('/'), docPath.lastIndexOf('\\'))
  const dshHome = sepIdx > 0 ? docPath.slice(0, sepIdx) : docPath
  const runtime = createMarketRuntime({ fs, subprocess, dshHome })
  await runtime.prepare()

  const hooks = createCodexHookManager({ ctx, fs, bridge: codexHooksBridge, runtime })
  hooks.start()

  /**
   * Workspace registry is a web-profile capability. Keep it optional so the
   * market still supplies inherited global skills in profiles without it.
   */
  function workspaceViews() {
    const registry = /** @type {{list?: () => Iterable<{id?: unknown, title?: unknown, path?: unknown}>} | undefined} */ (ctx.get('workspaceRegistry'))
    if (!registry || typeof registry.list !== 'function') return []
    const result = []
    for (const workspace of registry.list()) {
      if (!workspace || typeof workspace.id !== 'string' || typeof workspace.title !== 'string' || typeof workspace.path !== 'string') continue
      if (runtime.isHomeWorkspace(workspace.path)) continue
      result.push({ id: workspace.id, title: workspace.title, path: workspace.path })
    }
    return result
  }
  const workspaces = {
    list: workspaceViews,
    /** @param {string} id */
    get(id) { return workspaceViews().find((workspace) => workspace.id === id) },
  }

  let invalidate = () => {}
  ctx.effect(() => skills.registerProvider((control) => {
    invalidate = () => { try { control.invalidate() } catch { /* provider teardown may race invalidation */ } }
    return {
      name: 'agent-plugin-market',
      /** @param {{cwd?: unknown} | undefined} options */
      async list(options) {
        const cwd = workspacePathForCwd(workspaceViews(), options && typeof options.cwd === 'string' ? options.cwd : undefined)
        const out = []
        for (const sk of await runtime.collectSkills({ cwd })) {
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
      /**
       * @param {{
       *   locator?: {path?: unknown},
       *   resourceBase?: {kind?: unknown, path?: unknown},
       *   name?: unknown,
       *   description?: unknown,
       *   whenToUse?: unknown,
       *   invocation?: unknown,
       *   source?: unknown,
       *   provider?: unknown,
       *   path?: unknown,
       * }} candidate
       */
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
    workspaces,
    onSkillsChanged: () => invalidate(),
  })
  service.registerAutoUpdate(ctx)

  const rpcHandlers = new Map(/** @type {Array<[string, Function]>} */ ([
    ['get-state', service.getState],
    ['add-market', service.addMarket],
    ['update-market', service.updateMarket],
    ['remove-market', service.removeMarket],
    ['install-plugin', service.installPlugin],
    ['uninstall-plugin', service.uninstallPlugin],
    ['set-skill-enabled', service.setSkillEnabled],
    ['set-standalone-skills-enabled', service.setStandaloneSkillsEnabled],
    ['set-workspace-plugin-enabled', service.setWorkspacePluginEnabled],
    ['set-workspace-skill-enabled', service.setWorkspaceSkillEnabled],
    ['clear-workspace-overrides', service.clearWorkspaceOverrides],
    ['set-plugin-hooks-enabled', service.setPluginHooksEnabled],
  ]))

  /** @param {unknown} error */
  function rpcFailure(error) {
    const detail = error && typeof error === 'object' && 'message' in error ? error.message : undefined
    const message = String(detail || error)
    return {
      ok: false,
      error: {
        code: 'internal',
        message: message.slice(0, 600),
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
