/// <reference path="../types/host.d.ts" />
import Schema from '@deepseek-ai/schemastery'
import { registerMarketTools, marketToolsPrompt } from './market-tools.js'

export const SETTINGS_NAMESPACE = 'agent-plugin-market'
export const PROMPT_SECTION = 'agent-plugin-market:tools'
export const Config = Schema.object({
  tools: Schema.boolean().default(true).description('启用工具：允许模型查看市场状态和修改当前工作区的插件、技能覆盖；默认启用。'),
  systemPrompt: Schema.boolean().default(true).description('注入系统提示词：默认随工具启用，工具未启用时默认也禁用且不注入；可独立关闭提示词。'),
}).description('功能')

/**
 * Settings own persistence; a child Fiber owns the optional model-facing effects.
 * The settings watcher serializes asynchronous replacement and skips unload races.
 * @param {HostContext} ctx
 * @param {MarketFeatureConfig} entry
 * @param {{service: MarketService, runtime: MarketRuntime, workspaces: HostWorkspaceProvider}} options
 */
export async function installMarketFeatures(ctx, entry, options) {
  const scope = ctx.settings.register(SETTINGS_NAMESPACE, Config, { base: entry, applies: 'live' })
  /** @type {import('@deepseek-ai/cordis').Fiber | undefined} */
  let active
  let closed = false
  ctx.effect(() => () => { closed = true })

  /** @param {MarketFeatureConfig} config */
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

  const ready = sync(scope.get())
  scope.watch(async (config) => {
    await ready
    await sync(config)
  })
  await ready
}
