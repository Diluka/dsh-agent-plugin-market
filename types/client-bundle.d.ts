import type * as React from 'react'
import type * as UIPrimitives from '@deepseek-ai/dsh-client-ui-primitives'

declare global {
  type ReactNode = React.ReactNode
  type ClientUiPrimitivesModule = typeof UIPrimitives
  type PrimitiveInputProps = React.ComponentProps<typeof UIPrimitives.Input>
  type WorkspaceMarketPage = React.ComponentType<{ workspace: WorkspaceItem }>
  type ReactModalBackdropMouseEvent = React.MouseEvent<HTMLDivElement>
  type ReactModalContentMouseEvent = React.MouseEvent<HTMLElement>
  type MarketLimitSetter = React.Dispatch<React.SetStateAction<Record<string, number>>>
  type TooltipAnchorElement = React.ReactElement<
    React.HTMLAttributes<HTMLElement> & { ref?: React.Ref<HTMLElement> }
  >

  interface ClientModuleMap {
    react: typeof React
    '@deepseek-ai/dsh-client-ui-primitives': typeof UIPrimitives
  }

  type ClientModuleRequire = <K extends keyof ClientModuleMap>(specifier: K) => ClientModuleMap[K]

  interface ClientBundleRegistration {
    id: string
    factory(require: ClientModuleRequire): Record<string, unknown>
  }

  type CatalogMode = 'installed' | 'available' | 'all'

  interface CatalogSkill {
    name: string
    fullName?: string
    description?: string
    enabled?: boolean
    globalEnabled?: boolean
    workspaceOverride?: boolean | null
  }

  interface CatalogHooks {
    available?: boolean
    found?: boolean
    active?: boolean
    enabled?: boolean
    error?: string
    needsApproval?: boolean
    count?: number
    scope?: 'global'
  }

  interface CatalogPlugin {
    name: string
    title?: string
    description?: string
    error?: string
    sourceType?: string
    installed?: boolean
    globalEnabled?: boolean
    workspaceOverride?: boolean | null
    enabled?: boolean
    unsupported?: boolean
    skills?: CatalogSkill[]
    hooks?: CatalogHooks | null
  }

  interface CatalogMarket {
    id: string
    name: string
    repo: string
    refType?: string
    ref?: string
    description?: string
    manifestFound?: boolean
    plugins?: CatalogPlugin[]
    standaloneSkills?: CatalogSkill[]
  }

  interface WorkspaceItem {
    id: string
    title: string
    path: string
  }

  interface ConfigScope {
    kind?: 'global' | 'workspace'
    id?: string
    path?: string
    overrideCount?: number
  }

  interface CatalogPluginMatch {
    plugin: CatalogPlugin
    visibleSkills: CatalogSkill[]
    matchingSkillIds: Set<string>
  }

  interface CatalogMarketView {
    market: CatalogMarket
    plugins: CatalogPlugin[]
    standaloneSkills: CatalogSkill[]
    visibleStandaloneSkills: CatalogSkill[]
    matchingStandaloneSkillIds: Set<string>
    matches: CatalogPluginMatch[]
  }

  interface MarketState {
    markets?: CatalogMarket[]
    workspaces?: WorkspaceItem[]
    scope?: ConfigScope
    hooksBridge?: {
      available?: boolean
      installCommand?: string
    }
  }

  interface WorkspaceListSnapshot {
    items?: Array<{ workspaceId?: unknown, title?: unknown, path?: unknown } | null | undefined>
  }

  type ClientRpcResult =
    | { ok: true, value: unknown }
    | { ok: false, error: { message: string } }

  type ApiResult<T> =
    | { ok: true, data: T }
    | { ok: false, error?: string }

  type ActionResult = ApiResult<{ skipped?: boolean, reason?: string }>

  interface ClientContext {
    connection: {
      isLoopback: boolean
      rpc: {
        call(route: string, name: string, args: object): Promise<ClientRpcResult>
      }
    }
    effect(effect: () => void | (() => void)): void
    slots: {
      inject(name: string, register: () => unknown): unknown
      register(slot: { name: string, id: string, order: number, label: string }, render: () => React.ReactNode): unknown
    }
    workspaces: {
      list: {
        getSnapshot(): WorkspaceListSnapshot
        subscribe(listener: () => void): () => void
      }
    }
  }

  interface Window {
    __ModuleLoader__: {
      load(registration: ClientBundleRegistration): void
    }
  }
}

export {}
