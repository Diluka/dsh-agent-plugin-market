import type { Context, Plugin } from '@deepseek-ai/cordis'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'

declare global {
  type MarketRefType = 'branch' | 'tag' | 'commit'
  type MarketInputRefType = 'default' | MarketRefType
  type WorkspaceOverrideMode = 'inherit' | 'enabled' | 'disabled'
  type WorkspaceOverrideGroup = 'plugins' | 'pluginSkills' | 'standaloneSkills'

  interface MarketEntry {
    id: string
    name?: string
    repo: string
    addedAt?: number
    refType?: MarketRefType
    ref?: string
  }

  interface InstalledPlugin {
    marketId: string
    pluginName: string
    installedAt?: number
  }

  interface HookApproval {
    fingerprint: string
    approvedAt?: number
  }

  interface MarketConfig {
    markets: MarketEntry[]
    installed: Record<string, InstalledPlugin>
    disabledSkills: Record<string, boolean>
    enabledStandaloneSkills: Record<string, boolean>
    hookApprovals: Record<string, HookApproval>
  }

  interface WorkspaceConfig {
    version: 1
    plugins: Record<string, boolean>
    pluginSkills: Record<string, boolean>
    standaloneSkills: Record<string, boolean>
  }

  interface HostFsTarget {
    displayPath: string
    targetKey: string
  }

  interface HostFsInfo {
    type: string
    version?: unknown
  }

  interface HostFsEntry {
    name: string
    type: string
    target: HostFsTarget
  }

  interface HostFsWritePolicy {
    mode: 'read-only' | 'workspace-write' | 'danger-full-access'
    workspaceRoot: string
  }

  interface HostFsService {
    lstat(path: string): Promise<HostFsInfo | null>
    resolve(path: string): Promise<HostFsTarget>
    stat(target: HostFsTarget): Promise<HostFsInfo | null>
    readText(target: HostFsTarget): Promise<string>
    writeText(target: HostFsTarget, content: string, expected?: object, signal?: unknown, sandboxPolicy?: HostFsWritePolicy): Promise<void>
    listDir(target: HostFsTarget): Promise<HostFsEntry[]>
    contains(parent: HostFsTarget, child: HostFsTarget): boolean
  }

  interface HostSubprocessStream {
    readFrom(offset: number): { text: string }
  }

  interface HostSubprocessHandle {
    done: Promise<{ exitCode: number }>
    collected: {
      stdout?: HostSubprocessStream
      stderr?: HostSubprocessStream
    }
  }

  interface HostSubprocessService {
    spawn(options: object): HostSubprocessHandle
  }

  interface HostSettingsService {
    prepareDocument(): Promise<string | undefined>
  }

  type HostRpcConnection = HostConnectionHandle

  interface HostSkillProviderControl {
    invalidate(): void
  }

  interface HostSkillsService {
    registerProvider(factory: (control: HostSkillProviderControl) => unknown): () => void
  }

  interface HostWorkspaceView {
    id: string
    title: string
    path: string
  }

  interface HostWorkspaceRegistry {
    list?: () => Iterable<{ id?: unknown, title?: unknown, path?: unknown }>
  }

  interface HostWorkspaceProvider {
    list(): HostWorkspaceView[]
    get(id: string): HostWorkspaceView | undefined
  }

  interface HostToolOutputDefinition {
    schema: Record<string, unknown>
    render(args: unknown, value: unknown): { type: 'text', text: string }[]
  }

  interface HostToolCallView {
    card: 'generic'
    title: string
    kind: 'read' | 'other'
    rawInput?: string
  }

  interface HostToolDefinition {
    name: string
    description: string
    parameters: Record<string, unknown>
    output: HostToolOutputDefinition
    execute(args: unknown, exec: HostToolRunContext): Promise<unknown> | unknown
    isConcurrencySafe?(args: unknown): boolean
    presentCall?(args: unknown): HostToolCallView | undefined
  }

  interface HostToolRegistry {
    register(definition: HostToolDefinition): () => void
    restrict(filter: { allow?: readonly string[], deny?: readonly string[] }): () => void
  }

  interface HostAgent {
    session?: { header?: { cwd?: unknown } }
    ctx?: Context & { tools?: HostToolRegistry }
  }

  interface HostToolRunContext {
    agent?: HostAgent
    signal?: AbortSignal
  }

  interface HostAgentsService {
    list(): HostAgent[]
  }

  interface HostContext extends Context {
    skills: HostSkillsService
    fs: HostFsService
    settings: HostSettingsService
    subprocess: HostSubprocessService
    connection: HostRpcConnection
    tools: HostToolRegistry
    get(name: 'agents'): HostAgentsService | undefined
    get(name: 'workspaceRegistry'): HostWorkspaceRegistry | undefined
  }

  type HostCodexBridge = Plugin<{ configPath: string }> | null
  type MarketRuntimeOptions = { fs: HostFsService, subprocess: HostSubprocessService, dshHome: string }
  type MarketRuntime = ReturnType<typeof import('../lib/market-runtime.js').createMarketRuntime>
  type MarketService = ReturnType<typeof import('../lib/market-service.js').createMarketService>
  type CodexHookManager = ReturnType<typeof import('../lib/codex-hook-manager.js').createCodexHookManager>

  interface MarketServiceOptions {
    runtime: MarketRuntime
    hooks: CodexHookManager
    onSkillsChanged(): void
    workspaces?: HostWorkspaceProvider
  }

  interface CodexHookManagerOptions {
    ctx: HostContext
    fs: HostFsService
    bridge: HostCodexBridge
    runtime: MarketRuntime
  }

  interface SkillSource {
    root: 'market' | 'plugin'
    path: string
  }

  interface SkillDocument {
    data: Record<string, string | number | boolean>
    content: string
  }

  interface SkillInfo {
    skillName: string
    description: string
    whenToUse: string | null
    fullName: string
    path: string
    resourceDir: string
  }

  interface MarketplacePlugin {
    name: string
    source: string
    unsupported: boolean
    description: string
    sourceType?: string
  }

  interface Marketplace {
    name: string
    description: string
    plugins: MarketplacePlugin[]
  }

  type CodexHookSource =
    | { kind: 'path', path: string }
    | { kind: 'inline', config: Record<string, unknown> }

  interface CodexHookConfigs {
    declared: boolean
    errors: string[]
    sources: CodexHookSource[]
  }

  interface PluginMeta {
    title: string
    description: string
    skillSources: SkillSource[]
    hookConfigs: { codex: CodexHookConfigs | null }
  }

  interface CodexHookConfigEntry {
    source: string
    config: Record<string, unknown>
  }

  type CodexHookInspectResult =
    | MountableCodexHookInfo
    | {
        found: false
        declared: boolean
        configs: CodexHookConfigEntry[]
        fingerprint?: string
        pluginRoot?: string
        error: string | null
      }

  interface MountableCodexHookInfo {
    found: true
    declared: boolean
    configs: CodexHookConfigEntry[]
    fingerprint: string
    pluginRoot: string
    error: null
  }

  interface HostMarketStateSkill {
    name: string
    fullName: string
    description: string
    whenToUse: string | null
    globalEnabled: boolean
    workspaceOverride: boolean | null
    enabled: boolean
  }

  interface HostMarketStateHooks {
    available: boolean
    found: boolean
    count: number
    enabled: boolean
    active: boolean
    needsApproval: boolean
    error: string | null
    scope: 'global'
  }

  interface HostMarketStatePlugin {
    name: string
    installed: boolean
    globalEnabled: boolean
    workspaceOverride: boolean | null
    enabled: boolean
    unsupported: boolean
    sourceType: string
    title: string
    description: string
    error: string | null
    skills: HostMarketStateSkill[]
    hooks: HostMarketStateHooks | null
  }

  interface HostMarketStateMarket {
    id: string
    name?: string
    repo: string
    description: string
    refType: MarketInputRefType
    ref: string | null
    manifestFound: boolean
    standaloneSkills: HostMarketStateSkill[]
    plugins: HostMarketStatePlugin[]
  }

  type HostMarketStateScope =
    | { kind: 'workspace', id: string, title: string, path: string, overrideCount: number }
    | { kind: 'global' }

  interface HostMarketState {
    hooksBridge: { available: boolean, installCommand: string }
    scope: HostMarketStateScope
    workspaces: HostWorkspaceView[]
    markets: HostMarketStateMarket[]
  }
}

export {}
