/// <reference path="../types/host.d.ts" />
import Schema from '@deepseek-ai/schemastery'
import { registerMarketTools, marketToolsPrompt } from './market-tools.js'

export const SETTINGS_ENTRY_ID = 'dsh-agent-plugin-market'
export const PROMPT_SECTION = 'agent-plugin-market:tools'

/** @typedef {{tools: boolean, systemPrompt: boolean}} MarketFeatureValues */
export const Config = Schema.object({
  tools: Schema.boolean().default(true).volatile().description('启用工具：允许模型查看市场状态和修改当前工作区的插件、技能覆盖；默认启用。'),
  systemPrompt: Schema.boolean().default(true).volatile().description('注入系统提示词：默认随工具启用，工具未启用时默认也禁用且不注入；可独立关闭提示词。'),
}).description('功能')

/**
 * Settings own persistence; volatile entry values drive optional model-facing effects.
 * Settings document updates serialize replacement and skip unload races.
 * @param {HostContext} ctx
 * @param {MarketFeatureConfig} entry
 * @param {{service: MarketService, runtime: MarketRuntime, workspaces: HostWorkspaceProvider}} options
 */
export async function installMarketFeatures(ctx, entry, options) {
  /** @returns {MarketFeatureValues} */
  function readConfig() {
    return {
      tools: entry.tools.get(),
      systemPrompt: entry.systemPrompt.get(),
    }
  }

  /** @type {MarketFeatureValues} */
  let current = readConfig()
  /** @type {import('@deepseek-ai/cordis').Fiber | undefined} */
  let active
  let closed = false
  let syncQueue = Promise.resolve()
  ctx.effect(() => () => { closed = true })

  /** @param {MarketFeatureValues} config */
  async function sync(config) {
    if (closed) return
    if (active) {
      await active.dispose()
      active = undefined
    }
    if (closed || !config.tools) return
    active = ctx.plugin({
      inject: ['tools'],
      apply(featureCtx) {
        registerMarketTools(/** @type {HostContext} */ (/** @type {unknown} */ (featureCtx)), options)
        if (!config.systemPrompt) return
        featureCtx.inject(['systemPrompt'], (promptCtx) => {
          promptCtx.systemPrompt.section({
            name: PROMPT_SECTION,
            order: 3000,
            text: (context) => marketToolsPrompt(options.runtime, context.agent),
          })
        })
      },
    })
    await active.await()
  }

  /** @param {MarketFeatureValues} config */
  function enqueueSync(config) {
    const pending = syncQueue.catch(() => {}).then(() => sync(config))
    syncQueue = pending
    pending.catch((error) => {
      if (!closed) console.error('[agent-plugin-market] failed to apply feature config:', error)
    })
    return pending
  }

  ctx.on('settings/document-updated', (entryId) => {
    if (closed || entryId !== SETTINGS_ENTRY_ID) return
    const next = readConfig()
    if (next.tools === current.tools && next.systemPrompt === current.systemPrompt) return
    current = next
    void enqueueSync(next)
  })

  await enqueueSync(current)
}
