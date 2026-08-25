// dsh-agent-plugin-market browser entry and client UI implementation.

(() => {
/** @type {{__ModuleLoader__: {load: (module: any) => void}}} */
const dshWindow = /** @type {Window & {__ModuleLoader__: {load: (module: any) => void}}} */ (/** @type {unknown} */ (window))

const PACKAGE_ID = 'dsh-agent-plugin-market'
const RPC_ROUTE = '/agent-plugin-market'
const SETTINGS_SECTION = { name: 'settings.section', id: 'skills-and-hooks', order: 25, label: '技能与挂钩' }
const WORKSPACE_OVERLAY = { name: 'shell.overlay', id: 'agent-plugin-market-workspace-config', order: 10, label: '工作区插件与技能配置' }
/** @type {readonly ['connection', 'slots', 'workspaces']} */
const inject = ['connection', 'slots', 'workspaces']

dshWindow.__ModuleLoader__.load({
  id: PACKAGE_ID,
  factory: (/** @type {(id: string) => any} */ require) => {
    var module = /** @type {{exports: any}} */ ({ exports: {} })
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    var React = /** @type {typeof import('react')} */ (require('react'))
    /** @type {typeof import('@deepseek-ai/dsh-client-ui-primitives') | null} */
    let uiPrimitives = null

    function getUIPrimitives() {
      if (!uiPrimitives) {
        uiPrimitives = /** @type {typeof import('@deepseek-ai/dsh-client-ui-primitives')} */ (require('@deepseek-ai/dsh-client-ui-primitives'))
      }
      return /** @type {typeof import('@deepseek-ai/dsh-client-ui-primitives')} */ (uiPrimitives)
    }

    /**
     * @typedef {'installed' | 'available' | 'all'} CatalogMode
     * @typedef {{name: string, fullName?: string, description?: string, enabled?: boolean, globalEnabled?: boolean, workspaceOverride?: boolean | null}} CatalogSkill
     * @typedef {{available?: boolean, found?: boolean, active?: boolean, enabled?: boolean, error?: string, needsApproval?: boolean, count?: number, scope?: 'global'}} CatalogHooks
     * @typedef {{name: string, title?: string, description?: string, error?: string, sourceType?: string, installed?: boolean, globalEnabled?: boolean, workspaceOverride?: boolean | null, enabled?: boolean, unsupported?: boolean, skills?: CatalogSkill[], hooks?: CatalogHooks | null}} CatalogPlugin
     * @typedef {{id: string, name: string, repo: string, refType?: string, ref?: string, description?: string, manifestFound?: boolean, plugins?: CatalogPlugin[], standaloneSkills?: CatalogSkill[]}} CatalogMarket
     * @typedef {{id: string, title: string, path: string}} WorkspaceItem
     */

    /**
     * Normalizes a value for case-insensitive catalog matching.
     *
     * @param {unknown} value
     */
    function normalizedText(value) {
      return String(value || '').trim().toLowerCase()
    }

    /**
     * Matches every whitespace-separated query term across catalog fields.
     *
     * @param {unknown} query
     * @param {readonly unknown[]} values
     */
    function matchesText(query, values) {
      const terms = normalizedText(query).split(/\s+/).filter(Boolean)
      if (!terms.length) return false
      const text = values.map(normalizedText).join(' ')
      return terms.every((term) => text.includes(term))
    }

    /** @param {CatalogPlugin} plugin */
    function pluginEnabled(plugin) {
      return typeof plugin.enabled === 'boolean' ? plugin.enabled : !!plugin.installed
    }

    /**
     * Derives one market's visible catalog entries and matched skill identifiers.
     *
     * @param {CatalogMarket} market
     * @param {string} query
     * @param {CatalogMode} catalogMode
     */
    function catalogForMarket(market, query, catalogMode) {
      const plugins = Array.isArray(market.plugins) ? market.plugins : []
      const standaloneSkills = catalogMode === 'installed' ? [] : (Array.isArray(market.standaloneSkills) ? market.standaloneSkills : [])
      const matchingStandaloneSkillIds = new Set(query
        ? standaloneSkills.filter((skill) => matchesText(query, [skill.name])).map((skill) => skill.fullName || skill.name)
        : [])
      const visibleStandaloneSkills = query
        ? standaloneSkills.filter((skill) => matchingStandaloneSkillIds.has(skill.fullName || skill.name))
        : standaloneSkills
      const matches = []
      for (const plugin of plugins) {
        const skills = Array.isArray(plugin.skills) ? plugin.skills : []
        if (catalogMode === 'installed' && !pluginEnabled(plugin)) continue
        if (catalogMode === 'available' && (plugin.unsupported || skills.length === 0)) continue
        const pluginMatches = matchesText(query, [plugin.name, plugin.title])
        const matchingSkillIds = new Set(query
          ? skills.filter((skill) => matchesText(query, [skill.name])).map((skill) => skill.fullName || skill.name)
          : [])
        if (!query || pluginMatches || matchingSkillIds.size) {
          matches.push({ plugin, visibleSkills: skills, matchingSkillIds })
        }
      }
      return { market, plugins, standaloneSkills, visibleStandaloneSkills, matchingStandaloneSkillIds, matches }
    }

    /**
     * Counts installed, active, and available catalog items across markets.
     *
     * @param {readonly CatalogMarket[]} markets
     */
    function catalogStats(markets) {
      const stats = { installedPlugins: 0, activeSkills: 0, activeHooks: 0, availablePlugins: 0, availableSkills: 0, availableHooks: 0 }
      for (const market of markets) {
        const standaloneSkills = Array.isArray(market.standaloneSkills) ? market.standaloneSkills : []
        stats.availableSkills += standaloneSkills.length
        stats.activeSkills += standaloneSkills.filter((skill) => skill.enabled).length
        for (const plugin of Array.isArray(market.plugins) ? market.plugins : []) {
          const skills = Array.isArray(plugin.skills) ? plugin.skills : []
          const available = !plugin.unsupported && skills.length > 0
          if (available) {
            stats.availablePlugins++
            stats.availableSkills += skills.length
          }
          if (plugin.hooks && plugin.hooks.available && plugin.hooks.found) stats.availableHooks++
          if (!pluginEnabled(plugin)) continue
          stats.installedPlugins++
          stats.activeSkills += skills.filter((skill) => skill.enabled).length
          if (plugin.hooks && plugin.hooks.active) stats.activeHooks++
        }
      }
      return stats
    }

    /** @param {any} workspaceList */
    function workspaceItemsFromSnapshot(workspaceList) {
      return workspaceList && Array.isArray(workspaceList.items)
        ? workspaceList.items
          .filter(/** @param {any} workspace */ (workspace) => workspace && typeof workspace.workspaceId === 'string' && typeof workspace.title === 'string' && typeof workspace.path === 'string')
          .map(/** @param {{workspaceId: string, title: string, path: string}} workspace */ (workspace) => ({ id: workspace.workspaceId, title: workspace.title, path: workspace.path }))
        : []
    }

    /** @param {readonly WorkspaceItem[]} workspaces */
    function workspaceListFingerprint(workspaces) {
      return workspaces.map((workspace) => workspace.id + '\0' + workspace.title + '\0' + workspace.path).join('\0')
    }

    /** @param {unknown} label */
    function workspaceTitleFromActionLabel(label) {
      if (typeof label !== 'string') return null
      const zh = label.match(/^工作区“(.+)”的操作$/)
      if (zh) return zh[1]
      const en = label.match(/^Workspace actions for (.+)$/)
      return en ? en[1] : null
    }

    /** @param {unknown} items */
    function isWorkspaceActionMenu(items) {
      return Array.isArray(items)
        && items.some((item) => item && item.id === 'rename')
        && items.some((item) => item && item.id === 'delete')
    }

    /**
     * @param {any} menuProps
     * @param {readonly WorkspaceItem[]} workspaces
     */
    function workspaceFromActionMenu(menuProps, workspaces) {
      if (!menuProps || !isWorkspaceActionMenu(menuProps.items)) return null
      const label = menuProps.anchor && menuProps.anchor.props ? menuProps.anchor.props['aria-label'] : null
      const title = workspaceTitleFromActionLabel(label)
      return title ? workspaces.find((workspace) => workspace.title === title) || null : null
    }


    const catalogModel = { normalizedText, matchesText, pluginEnabled, catalogForMarket, catalogStats }
    const workspaceModel = { itemsFromSnapshot: workspaceItemsFromSnapshot, fingerprint: workspaceListFingerprint }
    const workspaceMenuModel = { titleFromActionLabel: workspaceTitleFromActionLabel, isActionMenu: isWorkspaceActionMenu, workspaceFromActionMenu }

    const styles = `.apm-root{font-size:13px;color:var(--dsw-alias-label-primary);line-height:1.5}
        .apm-hint{color:var(--dsw-alias-label-secondary);font-size:12px;margin:0 0 12px}
        .apm-scope{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0 0 14px}
        .apm-scope-label{font-size:12px;color:var(--dsw-alias-label-secondary)}
        .apm-scope-note{font-size:12px;color:var(--dsw-alias-label-secondary)}
        .apm-scope-mode{min-width:126px;text-align:left}
        .apm-modal-backdrop{position:fixed;inset:0;z-index:60;pointer-events:auto;display:flex;align-items:flex-start;justify-content:center;padding:42px 18px;background:rgba(0,0,0,.36);overflow:auto}
        .apm-modal{width:min(920px,calc(100vw - 36px));max-height:calc(100vh - 84px);overflow:auto;border:1px solid var(--dsw-alias-border-l2);border-radius:16px;background:var(--dsw-alias-bg-base);box-shadow:0 24px 80px rgba(0,0,0,.28)}
        .apm-modal-head{position:sticky;top:0;z-index:1;display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:16px 18px 12px;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base)}
        .apm-modal-title{font-size:16px;font-weight:700;line-height:22px}
        .apm-modal-subtitle{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;overflow-wrap:anywhere}
        .apm-modal-body{padding:16px 18px 18px}
        .apm-form{display:flex;gap:8px;margin-bottom:16px}
        .apm-form-ref{margin-top:-8px;margin-bottom:16px;align-items:center}
        .apm-input{flex:1;min-width:0}
        .apm-search{flex:1;min-width:180px}
        .apm-catalog-toolbar{display:flex;align-items:center;gap:8px;margin:0 0 8px;flex-wrap:wrap}
        .apm-catalog-filters{display:flex;align-items:center;gap:6px;flex:none}
        .apm-catalog-summary{color:var(--dsw-alias-label-secondary);font-size:12px;margin:0 0 12px}
        .apm-catalog-more{display:flex;align-items:center;gap:8px;padding-top:12px}
        .apm-switch:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
        .apm-info{color:var(--dsw-alias-state-success-primary);font-size:12px;margin:0 0 12px}
        .apm-notice{border:1px solid var(--dsw-alias-border-l2);border-left:3px solid var(--dsw-alias-label-secondary);border-radius:8px;padding:10px 12px;margin:0 0 12px;background:var(--dsw-alias-bg-layer-2);font-size:12px}
        .apm-command{display:block;margin-top:6px;color:var(--dsw-alias-label-primary);font-family:ui-monospace,monospace;overflow-wrap:anywhere}
        .apm-btn{flex:none}
        .apm-btn.danger{color:var(--dsw-alias-state-error-primary)}
        .apm-card{border:1px solid var(--dsw-alias-border-l2);border-radius:12px;padding:14px 16px;margin-bottom:12px;background:var(--dsw-alias-bg-layer-1)}
        .apm-card-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:4px;min-width:0}
        .apm-market-actions{display:flex;align-items:center;gap:8px;flex:none;margin-left:auto}
        .apm-name{font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .apm-repo{display:inline-flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-secondary);flex:none;padding:4px;cursor:help}
        .apm-repo:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px;border-radius:4px}
        .apm-tag{flex:none}
        .apm-market-desc{color:var(--dsw-alias-label-secondary);font-size:12px;margin:0 0 10px}
        .apm-err{color:var(--dsw-alias-state-error-primary);font-size:12px;margin-top:6px}
        .apm-plugin{border-top:1px solid var(--dsw-alias-border-l2);margin-top:12px;padding-top:12px}
        .apm-plugin-topline{display:flex;align-items:center;gap:8px;min-width:0}
        .apm-plugin-disclosure{flex:1;min-width:0}
        .apm-plugin-disclosure [data-disclosure-row]{width:100%}
        .apm-disclosure-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;color:var(--dsw-alias-label-primary)}
        .apm-plugin-summary{display:flex;align-items:center;gap:6px;min-width:0;margin-left:8px;color:var(--dsw-alias-label-secondary);font-size:12px;white-space:nowrap}
        .apm-plugin-actions{display:flex;gap:6px;flex:none}
        .apm-plugin-desc{color:var(--dsw-alias-label-secondary);font-size:12px;margin:4px 0 0;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}
        .apm-plugin-details{padding:8px 0 0 22px}
        .apm-standalone{border-top:1px solid var(--dsw-alias-border-l2);margin-top:12px;padding-top:12px}
        .apm-standalone-details{padding:8px 0 0 22px}
        .apm-skill{display:flex;align-items:flex-start;gap:10px;padding:8px 0 0}
        .apm-skill.match{margin-left:-6px;padding:8px 6px 0;border-radius:6px;background:var(--dsw-alias-bg-layer-2);box-shadow:inset 2px 0 0 var(--dsw-alias-brand-primary)}
        .apm-skill-info{flex:1;min-width:0}
        .apm-skill-name{font-size:12px;font-family:ui-monospace,monospace}
        .apm-skill-name.match{color:var(--dsw-alias-brand-primary);font-weight:600}
        .apm-skill-desc{color:var(--dsw-alias-label-secondary);font-size:11px}
        .apm-skill-state{color:var(--dsw-alias-label-tertiary);font-size:11px;white-space:nowrap;padding-top:2px}
        .apm-switch{appearance:none;width:34px;height:20px;box-sizing:border-box;border-radius:999px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);position:relative;cursor:pointer;flex:none;margin-top:1px;padding:0;transition:background .16s,border-color .16s}
        .apm-switch:hover:not(:disabled){background:var(--dsw-alias-bg-layer-1);border-color:var(--dsw-alias-label-secondary)}
        .apm-switch.on{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}
        .apm-switch-knob{position:absolute;top:3px;left:3px;width:12px;height:12px;border-radius:50%;background:var(--dsw-alias-label-secondary);transition:left .16s,background .16s}
        .apm-switch.on .apm-switch-knob{left:17px;background:var(--dsw-alias-bg-base)}
        .apm-switch:disabled{opacity:.45;cursor:default}
        .apm-hook{border-top:1px dashed var(--dsw-alias-border-l2);margin-top:10px;padding-top:10px}
        .apm-loading{color:var(--dsw-alias-label-secondary);padding:16px 0}
        @media (max-width:640px){.apm-root{min-width:0;overflow-wrap:anywhere}.apm-form{flex-wrap:wrap}.apm-form .apm-input{flex-basis:100%}.apm-scope{align-items:stretch}.apm-scope-label,.apm-scope-note{width:100%}.apm-scope-mode{min-width:0;max-width:100%;white-space:normal}.apm-modal-backdrop{padding:18px 10px}.apm-modal{width:calc(100vw - 20px);max-height:calc(100vh - 36px);border-radius:14px}.apm-modal-head{padding:14px 12px 10px}.apm-modal-body{padding:14px 12px}.apm-card{padding:12px;overflow:hidden}.apm-card-head,.apm-plugin-topline{align-items:flex-start;flex-wrap:wrap}.apm-market-actions,.apm-plugin-actions{width:100%;flex-wrap:wrap;justify-content:flex-start;margin-left:0}.apm-plugin-summary{display:none}.apm-plugin-details,.apm-standalone-details{padding-left:0}.apm-skill{flex-wrap:wrap}.apm-skill-state{white-space:normal}}`

    /** @param {string} css */
    function insertStyles(css) {
      try {
        const style = document.createElement('style')
        style.textContent = css
        document.head.appendChild(style)
        return () => { try { style.remove() } catch { /* ignore */ } }
      } catch {
        return () => {}
      }
    }

    function installStyles() {
      return insertStyles(styles)
    }

    /** @param {any} props */
    function Btn(props) {
      const UI = getUIPrimitives()
      const variant = props.variant === 'primary' ? 'primary' : props.variant === 'danger' ? 'ghost' : 'outline'
      return React.createElement(UI.Button, {
        variant: variant,
        size: 'sm',
        className: 'apm-btn' + (props.variant ? ' ' + props.variant : ''),
        disabled: props.disabled,
        onClick: props.onClick,
        title: props.title,
        'aria-label': props.ariaLabel || props['aria-label'],
      }, props.children)
    }

    /** @param {any} props */
    function TextInput(props) {
      const UI = getUIPrimitives()
      return React.createElement(UI.Input, props)
    }

    /** @param {any} props */
    function Tag(props) {
      const UI = getUIPrimitives()
      return React.createElement(UI.Pill, { className: 'apm-tag', title: props.title }, props.children)
    }

    /** @param {any} props */
    function RefTypeMenu(props) {
      const UI = getUIPrimitives()
      const [open, setOpen] = React.useState(false)
      const options = [
        { id: 'default', label: '默认分支' },
        { id: 'branch', label: '分支' },
        { id: 'tag', label: '标签' },
        { id: 'commit', label: '提交' },
      ]
      const selected = options.find((option) => option.id === props.value) || options[0]
      return React.createElement(UI.Menu, {
        open: open,
        anchor: React.createElement(UI.Button, {
          variant: 'outline',
          size: 'sm',
          disabled: props.disabled,
          icon: React.createElement(UI.IconBranchOutline16, { size: 16 }),
          onClick: () => setOpen(!open),
        }, selected.label),
        items: options,
        selectedId: props.value,
        onSelect: (id) => { setOpen(false); props.onChange(id) },
        onClose: () => setOpen(false),
        align: 'start',
        side: 'bottom',
        portal: true,
        compact: true,
      })
    }

    /** @param {any} props */
    function WorkspaceScopeMenu(props) {
      const UI = getUIPrimitives()
      const [open, setOpen] = React.useState(false)
      const items = [{ id: 'global', label: '全局默认' }]
      for (const workspace of Array.isArray(props.workspaces) ? props.workspaces : []) {
        if (!workspace || typeof workspace.id !== 'string') continue
        items.push({ id: 'workspace:' + workspace.id, label: String(workspace.title || workspace.path || workspace.id) })
      }
      const selectedId = props.workspaceId ? 'workspace:' + props.workspaceId : 'global'
      const selected = items.find((item) => item.id === selectedId) || items[0]
      return React.createElement(UI.Menu, {
        open: open,
        anchor: React.createElement(UI.Button, {
          variant: 'outline',
          size: 'sm',
          disabled: props.disabled,
          onClick: () => setOpen(!open),
        }, selected.label),
        items: items,
        selectedId: selectedId,
        onSelect: (id) => {
          setOpen(false)
          props.onChange(id === 'global' ? null : id.slice('workspace:'.length))
        },
        onClose: () => setOpen(false),
        align: 'start',
        side: 'bottom',
        portal: true,
        compact: true,
      })
    }

    /** @param {any} props */
    function WorkspaceOverrideMenu(props) {
      const UI = getUIPrimitives()
      const [open, setOpen] = React.useState(false)
      const inherited = props.globalEnabled ? '全局已启用' : '全局未启用'
      const options = [
        { id: 'inherit', label: '继承全局（' + inherited + '）' },
        { id: 'enabled', label: '仅此工作区启用' },
        { id: 'disabled', label: '在此工作区禁用' },
      ]
      const selectedId = props.override === null ? 'inherit' : props.override ? 'enabled' : 'disabled'
      const selected = options.find((option) => option.id === selectedId) || options[0]
      return React.createElement(UI.Menu, {
        open: open,
        anchor: React.createElement(UI.Button, {
          variant: 'outline',
          size: 'sm',
          className: 'apm-scope-mode',
          disabled: props.disabled,
          onClick: () => setOpen(!open),
        }, selected.label),
        items: options,
        selectedId: selectedId,
        onSelect: (id) => { setOpen(false); props.onChange(id) },
        onClose: () => setOpen(false),
        align: 'end',
        side: 'bottom',
        portal: true,
        compact: true,
      })
    }

    /** @param {any} props */
    function Switch(props) {
      return React.createElement('button', {
        type: 'button',
        className: 'apm-switch' + (props.on ? ' on' : ''),
        role: 'switch',
        'aria-checked': props.on,
        'aria-label': props.label || (props.on ? '禁用' : '启用'),
        onClick: props.onClick,
        disabled: props.disabled,
        title: props.title || props.label,
      }, React.createElement('span', { className: 'apm-switch-knob', 'aria-hidden': true }))
    }

    /** @param {any} props */
    function CatalogItem(props) {
      return React.createElement('div', { className: 'apm-skill' + (props.className ? ' ' + props.className : '') },
        props.leading,
        React.createElement('div', { className: 'apm-skill-info' },
          React.createElement('div', { className: 'apm-skill-name' + (props.matched ? ' match' : '') }, props.name),
          props.description ? React.createElement('div', { className: 'apm-skill-desc' }, props.description) : null))
    }


    function createWorkspaceConfigStore() {
      /** @type {any | null} */
      let current = null
      /** @type {Set<() => void>} */
      const listeners = new Set()
      const emit = () => { for (const listener of listeners) listener() }
      return {
        getSnapshot: () => current,
        subscribe: /** @param {() => void} listener */ (listener) => {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
        /** @param {any} workspace */
        open: (workspace) => {
          current = { id: workspace.id, title: workspace.title, path: workspace.path }
          emit()
        },
        close: () => {
          current = null
          emit()
        },
      }
    }

    /**
     * The shipped workspace menu has no slot yet, so add one DOM row to that menu only.
     * @param {any} ctx
     * @param {ReturnType<typeof createWorkspaceConfigStore>} workspaceConfigStore
     * @param {(workspace: any) => boolean} canConfigure
     * @param {(scan: () => void) => void} setScanner
     */
    function installWorkspaceMenuBridge(ctx, workspaceConfigStore, canConfigure, setScanner) {
      /** @type {any | null} */
      let activeWorkspace = null
      /** @type {any} */
      let activeButton = null
      /** @param {unknown} target */
      const rememberWorkspaceButton = (target) => {
        const element = /** @type {any} */ (target)
        const button = element && typeof element.closest === 'function' ? element.closest('button[aria-label]') : null
        const title = button ? workspaceMenuModel.titleFromActionLabel(button.getAttribute('aria-label')) : null
        const workspace = title ? workspaceModel.itemsFromSnapshot(ctx.workspaces.list.getSnapshot()).find(/** @param {any} item */ (item) => item.title === title) || null : null
        if (!workspace || !canConfigure(workspace)) return
        activeWorkspace = workspace
        activeButton = button && button.tagName === 'BUTTON' ? button : null
      }
      /** @param {any} menu */
      const isWorkspaceMenu = (menu) => {
        const labels = Array.from(menu.querySelectorAll('[role="menuitem"]')).map((item) => (item.textContent || '').trim())
        return (labels.includes('Rename') || labels.includes('重命名')) && (labels.includes('Delete workspace') || labels.includes('删除工作区'))
      }
      /** @param {any} menu */
      const injectRow = (menu) => {
        if (!activeWorkspace || !canConfigure(activeWorkspace) || !isWorkspaceMenu(menu) || menu.querySelector('[data-apm-workspace-config]')) return
        const firstItem = menu.querySelector('[role="menuitem"]')
        const sourceWrap = firstItem && firstItem.parentElement
        if (!sourceWrap) return
        const wrap = /** @type {any} */ (sourceWrap.cloneNode(true))
        const item = wrap.querySelector('[role="menuitem"]')
        if (!item || item.tagName !== 'BUTTON') return
        item.dataset.apmWorkspaceConfig = 'true'
        item.removeAttribute('aria-selected')
        item.onclick = /** @param {Event} event */ (event) => {
          event.preventDefault()
          event.stopPropagation()
          workspaceConfigStore.open(/** @type {any} */ (activeWorkspace))
          if (activeButton) activeButton.click()
        }
        const label = Array.from(item.querySelectorAll('span')).find((span) => ['Rename', '重命名'].includes((span.textContent || '').trim()))
        if (label) label.textContent = '配置插件与技能'
        else item.textContent = '配置插件与技能'
        const viewport = menu.querySelector('[role="presentation"]') || menu
        viewport.insertBefore(wrap, sourceWrap.nextSibling)
      }
      const scanMenus = () => {
        for (const menu of Array.from(document.querySelectorAll('[role="menu"]'))) injectRow(menu)
      }
      /** @param {Event} event */
      const onPointer = (event) => {
        rememberWorkspaceButton(event.target)
        scanMenus()
      }
      const observer = new window.MutationObserver(scanMenus)
      document.addEventListener('pointerdown', onPointer, true)
      document.addEventListener('click', onPointer, true)
      observer.observe(document.body, { childList: true, subtree: true })
      setScanner(scanMenus)
      scanMenus()
      return () => {
        document.removeEventListener('pointerdown', onPointer, true)
        document.removeEventListener('click', onPointer, true)
        observer.disconnect()
      }
    }

    /**
     * @param {{workspaceConfigStore: ReturnType<typeof createWorkspaceConfigStore>, Btn: any, MarketPage: any}} options
     */
    function createWorkspaceConfigOverlay(options) {
      return function WorkspaceConfigOverlay() {
        const workspace = React.useSyncExternalStore(
          options.workspaceConfigStore.subscribe,
          options.workspaceConfigStore.getSnapshot,
          options.workspaceConfigStore.getSnapshot,
        )
        React.useEffect(() => {
          if (!workspace) return undefined
          /** @param {KeyboardEvent} event */
          const onKeyDown = (event) => {
            if (event.key === 'Escape') options.workspaceConfigStore.close()
          }
          document.addEventListener('keydown', onKeyDown)
          return () => { document.removeEventListener('keydown', onKeyDown) }
        }, [workspace])
        if (!workspace) return null
        const title = workspace.title || workspace.path || workspace.id
        return React.createElement('div', {
          className: 'apm-modal-backdrop',
          onMouseDown: /** @param {import('react').MouseEvent<HTMLDivElement>} event */ (event) => {
            if (event.target === event.currentTarget) options.workspaceConfigStore.close()
          },
        }, React.createElement('section', {
          className: 'apm-modal',
          role: 'dialog',
          'aria-modal': true,
          'aria-labelledby': 'apm-workspace-config-title',
          onMouseDown: /** @param {import('react').MouseEvent<HTMLElement>} event */ (event) => { event.stopPropagation() },
        },
          React.createElement('div', { className: 'apm-modal-head' },
            React.createElement('div', null,
              React.createElement('div', { id: 'apm-workspace-config-title', className: 'apm-modal-title' }, '配置插件与技能 · ' + title),
              React.createElement('div', { className: 'apm-modal-subtitle' }, workspace.path)),
            React.createElement(options.Btn, { onClick: options.workspaceConfigStore.close, ariaLabel: '关闭工作区插件与技能配置' }, '关闭')),
          React.createElement('div', { className: 'apm-modal-body' },
            React.createElement(/** @type {any} */ (options.MarketPage), { workspace }))))
      }
    }

    const CATALOG_PAGE_SIZE = 10

    /**
     * @param {any} ctx
     * @param {{rpcRoute: string}} config
     */
    function createSettingsUi(ctx, config) {
      /**
       * @param {string} name
       * @param {any} args
       */
      const apiCall = async (name, args = {}) => {
        const result = await ctx.connection.rpc.call(config.rpcRoute, name, args || {})
        if (!result.ok) return { ok: false, error: result.error.message }
        return { ok: true, data: result.value }
      }

      const UI = getUIPrimitives()
      ctx.effect(installStyles)

      /** @param {{disabled: boolean, confirming: boolean, onClick: () => void}} props */
      function WorkspaceResetButton(props) {
        return React.createElement(Btn, {
          disabled: props.disabled,
          variant: props.confirming ? 'danger' : undefined,
          onClick: props.onClick,
        }, props.confirming ? '确认重置？' : '重置覆盖')
      }

      /** @param {any} props */
      function ScopeControls(props) {
        const resetButton = props.isWorkspaceScope
          ? React.createElement(WorkspaceResetButton, {
              disabled: props.disabled,
              confirming: props.confirming,
              onClick: props.onClearOverrides,
            })
          : null
        if (props.fixedWorkspace) {
          return React.createElement('section', { className: 'apm-scope', 'aria-label': '工作区配置' },
            React.createElement('span', { className: 'apm-scope-label' }, '工作区配置'),
            React.createElement('span', { className: 'apm-scope-note', title: props.scope.path },
              String(props.scope.overrideCount || 0) + ' 项覆盖 · 缺省继承全局配置'),
            resetButton)
        }
        return React.createElement('div', { className: 'apm-scope' },
          React.createElement('span', { className: 'apm-scope-label' }, '配置作用域'),
          React.createElement(WorkspaceScopeMenu, {
            workspaceId: props.workspaceId,
            workspaces: props.workspaces,
            disabled: props.disabled,
            onChange: props.onScopeChange,
          }),
          props.isWorkspaceScope
            ? React.createElement('span', { className: 'apm-scope-note', title: props.scope.path },
                String(props.scope.overrideCount || 0) + ' 项覆盖 · 工作区配置优先于全局')
            : React.createElement('span', { className: 'apm-scope-note' }, '作为所有工作区的默认配置'),
          resetButton)
      }

      /** @param {any} props */
      function AddMarketForm(props) {
        const refPlaceholder = props.refType === 'branch' ? '分支名，如 main' : props.refType === 'tag' ? '标签名，如 v1.0.0' : 'commit id，如 1a2b3c4d'
        return React.createElement(React.Fragment, null,
          React.createElement('div', { className: 'apm-form' },
            React.createElement(TextInput, {
              className: 'apm-input',
              placeholder: 'git 仓库地址，如 git@github.com:owner/repo.git',
              'aria-label': '市场 Git 仓库地址',
              value: props.repo,
              disabled: props.disabled,
              onChange: /** @param {any} e */ (e) => props.onRepoChange(e.target.value),
              onKeyDown: /** @param {any} e */ (e) => { if (e.key === 'Enter') props.onSubmit() },
            }),
            React.createElement(Btn, {
              variant: 'primary',
              disabled: props.disabled || !String(props.repo).trim(),
              onClick: props.onSubmit,
            }, props.busy === 'add-market' ? '添加中…' : '添加市场')),
          React.createElement('div', { className: 'apm-form apm-form-ref' },
            React.createElement(RefTypeMenu, {
              value: props.refType,
              disabled: props.disabled,
              onChange: props.onRefTypeChange,
            }),
            props.refType !== 'default'
              ? React.createElement(TextInput, {
                  className: 'apm-input',
                  placeholder: refPlaceholder,
                  'aria-label': '市场 Git 引用',
                  value: props.refText,
                  disabled: props.disabled,
                  onChange: /** @param {any} e */ (e) => props.onRefTextChange(e.target.value),
                })
              : React.createElement('span', { className: 'apm-hint' }, '使用仓库默认分支（与 GitHub 默认一致），启动时自动拉取更新')))
      }

      /** @param {any} props */
      function CatalogToolbar(props) {
        /**
         * @param {'installed' | 'available' | 'all'} mode
         * @param {string} label
         */
        const filterPill = (mode, label) => React.createElement(UI.Pill, {
          active: props.mode === mode,
          'aria-pressed': props.mode === mode,
          disabled: props.disabled,
          onClick: () => props.onModeChange(mode),
        }, label)
        return React.createElement('div', { className: 'apm-catalog-toolbar' },
          React.createElement(TextInput, {
            className: 'apm-search',
            icon: React.createElement(UI.IconSearchOutline16, { size: 16 }),
            placeholder: '按插件或技能名称模糊搜索',
            'aria-label': '按插件或技能名称模糊搜索',
            value: props.query,
            disabled: props.disabled,
            onChange: /** @param {any} e */ (e) => props.onQueryChange(e.target.value),
          }),
          props.query
            ? React.createElement(Btn, { disabled: props.disabled, onClick: () => props.onQueryChange('') }, '清除')
            : null,
          React.createElement('div', { className: 'apm-catalog-filters' },
            filterPill('installed', '已安装'),
            filterPill('available', '可用'),
            filterPill('all', '全部')))
      }

      /** @param {any} props */
      function CatalogMoreActions(props) {
        const remaining = props.total - props.visible
        const canShowMore = remaining > 0
        const canCollapse = props.visible > CATALOG_PAGE_SIZE
        if (!canShowMore && !canCollapse) return null
        return React.createElement('div', { className: 'apm-catalog-more' },
          canShowMore
            ? React.createElement(Btn, {
                disabled: props.disabled,
                onClick: props.onMore,
              }, props.moreLabel ? props.moreLabel(remaining) : '显示更多（剩余 ' + remaining + ' 个）')
            : null,
          canCollapse
            ? React.createElement(Btn, {
                disabled: props.disabled,
                onClick: props.onCollapse,
              }, props.collapseLabel || '收起')
            : null)
      }

      /** @param {any} props */
      function SkillRow(props) {
        const skill = props.skill
        const skillId = skill.fullName || skill.name
        const skillBusy = 'skill-' + skill.fullName
        const disabled = props.busy !== null
        let leading
        if (props.isWorkspaceScope) {
          leading = React.createElement(WorkspaceOverrideMenu, {
            override: skill.workspaceOverride,
            globalEnabled: skill.globalEnabled,
            disabled,
            onChange: /** @param {string} mode */ (mode) => props.act(skillBusy, () => {
              /** @type {{workspaceId: any, fullName: any, mode: string, standalone?: boolean}} */
              const request = { workspaceId: props.scope.id, fullName: skill.fullName, mode }
              if (props.standalone) request.standalone = true
              return apiCall('set-workspace-skill-enabled', request)
            }),
          })
        } else if (props.pluginActive === false) {
          leading = React.createElement('span', { className: 'apm-skill-state' }, '安装后可启用')
        } else {
          leading = React.createElement(Switch, {
            on: skill.enabled,
            disabled,
            label: (skill.enabled ? '禁用技能 ' : '启用技能 ') + skill.name,
            onClick: () => props.act(skillBusy, () => {
              /** @type {{fullName: any, enabled: boolean, standalone?: boolean}} */
              const request = { fullName: skill.fullName, enabled: !skill.enabled }
              if (props.standalone) request.standalone = true
              return apiCall('set-skill-enabled', request)
            }),
          })
        }
        return React.createElement(CatalogItem, {
          key: skillId,
          className: props.matched ? 'match' : '',
          matched: props.matched,
          leading,
          name: skill.name,
          description: skill.description,
        })
      }

      /** @param {any} props */
      function HooksRow(props) {
        const hook = props.hook
        if (!hook || (!hook.found && !hook.error)) return null
        if (props.isWorkspaceScope) {
          return React.createElement(CatalogItem, {
            key: 'hooks',
            className: 'apm-hook',
            leading: React.createElement('span', { className: 'apm-skill-state' }, '全局'),
            name: 'Codex hooks (' + hook.count + ' 配置)',
            description: 'Hooks 和执行审批仍使用全局配置，不受工作区覆盖影响。',
          })
        }
        const waitingForConfirmation = !hook.enabled && props.confirmHooks === props.pluginKey
        const hookBusy = 'hooks-' + props.pluginKey
        const hookDetail = !hook.available
          ? 'Codex hooks bridge 当前不可用；请先按上方命令安装依赖并重启 DSH。'
          : hook.error
            ? hook.error
            : hook.needsApproval
              ? '配置已变更；重新确认后才会再次执行。'
              : hook.enabled
                ? (hook.active ? '已注册；命令会在 agent 工作区触发。' : '已批准，正在等待注册。')
                : (waitingForConfirmation ? '再次点击开关确认：允许此插件执行 hooks 命令。' : '默认关闭；启用后允许此插件在 agent 工作区执行 hooks 命令。')
        return React.createElement(CatalogItem, {
          key: 'hooks',
          className: 'apm-hook',
          leading: React.createElement(Switch, {
            on: hook.enabled,
            disabled: !hook.available || !hook.found || props.busy !== null,
            label: (hook.enabled ? '禁用' : '启用') + '插件 ' + props.plugin.title + ' 的 Codex hooks',
            title: !hook.available ? 'Codex hooks bridge 不可用；安装依赖并重启 DSH 后可启用' : undefined,
            onClick: () => {
              if (!hook.enabled && !waitingForConfirmation) {
                props.setConfirmHooks(props.pluginKey)
                return
              }
              props.setConfirmHooks(null)
              props.act(hookBusy, () => apiCall('set-plugin-hooks-enabled', {
                marketId: props.market.id,
                pluginName: props.plugin.name,
                enabled: !hook.enabled,
              }))
            },
          }),
          name: 'Codex hooks (' + hook.count + ' 配置)',
          description: hookDetail,
        })
      }

      /** @param {any} props */
      function PluginAction(props) {
        const plugin = props.plugin
        if (plugin.unsupported) return React.createElement(Tag, null, '不支持来源: ' + plugin.sourceType)
        return React.createElement('div', { className: 'apm-plugin-actions' },
          props.isWorkspaceScope
            ? React.createElement(WorkspaceOverrideMenu, {
                override: plugin.workspaceOverride,
                globalEnabled: plugin.globalEnabled,
                disabled: props.busy !== null,
                onChange: /** @param {string} mode */ (mode) => props.act('workspace-plugin-' + props.pluginKey, () => apiCall('set-workspace-plugin-enabled', {
                  workspaceId: props.scope.id,
                  marketId: props.market.id,
                  pluginName: plugin.name,
                  mode,
                })),
              })
            : plugin.installed
              ? React.createElement(Btn, {
                  disabled: props.busy !== null,
                  onClick: () => props.act('uninstall-' + props.pluginKey, () => apiCall('uninstall-plugin', { marketId: props.market.id, pluginName: plugin.name })),
                }, props.busy === 'uninstall-' + props.pluginKey ? '卸载中…' : '卸载')
              : React.createElement(Btn, {
                  variant: 'primary',
                  disabled: props.busy !== null,
                  onClick: () => props.act('install-' + props.pluginKey, () => apiCall('install-plugin', { marketId: props.market.id, pluginName: plugin.name })),
                }, props.busy === 'install-' + props.pluginKey ? '安装中…' : '安装'))
      }

      /** @param {any} props */
      function PluginSection(props) {
        const market = props.market
        const match = props.match
        const plugin = match.plugin
        const pluginKey = market.id + '/' + plugin.name
        const pluginActive = catalogModel.pluginEnabled(plugin)
        const skills = Array.isArray(plugin.skills) ? plugin.skills : []
        const skillCount = skills.length
        const activeSkillCount = pluginActive ? skills.filter(/** @param {any} skill */ (skill) => skill.enabled).length : 0
        const hookTotal = plugin.hooks && plugin.hooks.found ? 1 : 0
        const activeHookCount = plugin.hooks && plugin.hooks.active ? 1 : 0
        const canExpand = !plugin.unsupported && (skillCount > 0 || !!((pluginActive || props.isWorkspaceScope) && plugin.hooks && (plugin.hooks.found || plugin.hooks.error)))
        const summary = React.createElement('span', { className: 'apm-plugin-summary' },
          React.createElement(Tag, null, '技能 ' + activeSkillCount + ' / ' + skillCount),
          hookTotal ? React.createElement(Tag, null, '挂钩 ' + activeHookCount + ' / ' + hookTotal) : null)
        const details = []
        for (const skill of match.visibleSkills) {
          const skillId = skill.fullName || skill.name
          details.push(SkillRow({
            skill,
            matched: match.matchingSkillIds.has(skillId),
            isWorkspaceScope: props.isWorkspaceScope,
            scope: props.scope,
            busy: props.busy,
            act: props.act,
            pluginActive,
          }))
        }
        if ((pluginActive || props.isWorkspaceScope) && plugin.hooks && (plugin.hooks.found || plugin.hooks.error)) {
          details.push(HooksRow({
            hook: plugin.hooks,
            isWorkspaceScope: props.isWorkspaceScope,
            pluginKey,
            plugin,
            market,
            busy: props.busy,
            confirmHooks: props.confirmHooks,
            setConfirmHooks: props.setConfirmHooks,
            act: props.act,
          }))
        }
        const pluginContent = []
        pluginContent.push(React.createElement('div', { className: 'apm-plugin-topline', key: 'head' },
          React.createElement('div', { className: 'apm-plugin-disclosure' },
            React.createElement(UI.DisclosureRow, {
              icon: React.createElement(UI.IconSkillOutline16, { size: 16 }),
              title: plugin.title || plugin.name,
              open: props.open,
              expandable: canExpand,
              onToggle: props.onToggle,
              expandOnRowClick: true,
              collapsedContent: summary,
              rowClassName: 'apm-disclosure-row',
              titleClassName: 'apm-disclosure-title',
            }, React.createElement('div', { className: 'apm-plugin-details' }, ...details))),
          React.createElement(PluginAction, {
            market,
            plugin,
            pluginKey,
            scope: props.scope,
            isWorkspaceScope: props.isWorkspaceScope,
            busy: props.busy,
            act: props.act,
          })))
        if (plugin.description) pluginContent.push(React.createElement('div', { className: 'apm-plugin-desc', key: 'desc' }, plugin.description))
        if (plugin.error) pluginContent.push(React.createElement('div', { className: 'apm-err', key: 'err' }, plugin.error))
        return React.createElement('div', { className: 'apm-plugin' }, ...pluginContent)
      }

      /** @param {any} props */
      function StandaloneSkillsSection(props) {
        const item = props.item
        if (item.visibleStandaloneSkills.length === 0) return null
        const activeStandaloneSkillCount = item.standaloneSkills.filter(/** @param {any} skill */ (skill) => skill.enabled).length
        const allStandaloneEnabled = activeStandaloneSkillCount === item.standaloneSkills.length
        const visibleStandaloneSkills = props.open ? item.visibleStandaloneSkills.slice(0, props.limit) : []
        const standaloneDetails = []
        if (props.open) {
          for (const skill of visibleStandaloneSkills) {
            const skillId = skill.fullName || skill.name
            standaloneDetails.push(SkillRow({
              skill,
              matched: item.matchingStandaloneSkillIds.has(skillId),
              isWorkspaceScope: props.isWorkspaceScope,
              scope: props.scope,
              busy: props.busy,
              act: props.act,
              standalone: true,
            }))
          }
          standaloneDetails.push(React.createElement(CatalogMoreActions, {
            key: 'standalone-more',
            total: item.visibleStandaloneSkills.length,
            visible: visibleStandaloneSkills.length,
            disabled: props.busy !== null,
            moreLabel: /** @param {number} remaining */ (remaining) => '显示更多独立技能（剩余 ' + remaining + ' 个）',
            collapseLabel: '收起独立技能',
            onMore: () => props.setMarketLimits(/** @param {Record<string, number>} current */ (current) => ({ ...current, [props.limitKey]: visibleStandaloneSkills.length + CATALOG_PAGE_SIZE })),
            onCollapse: () => props.setMarketLimits(/** @param {Record<string, number>} current */ (current) => ({ ...current, [props.limitKey]: CATALOG_PAGE_SIZE })),
          }))
        }
        return React.createElement('section', { className: 'apm-standalone', 'aria-label': '独立技能（skills/）' },
          React.createElement('div', { className: 'apm-plugin-topline' },
            React.createElement('div', { className: 'apm-plugin-disclosure' },
              React.createElement(UI.DisclosureRow, {
                icon: React.createElement(UI.IconSkillOutline16, { size: 16 }),
                title: '独立技能（skills/）',
                open: props.open,
                expandable: true,
                onToggle: props.onToggle,
                expandOnRowClick: true,
                collapsedContent: React.createElement('span', { className: 'apm-plugin-summary' },
                  React.createElement(Tag, null, '技能 ' + activeStandaloneSkillCount + ' / ' + item.standaloneSkills.length)),
                rowClassName: 'apm-disclosure-row',
                titleClassName: 'apm-disclosure-title',
              }, props.open
                ? React.createElement('div', { className: 'apm-standalone-details' }, ...standaloneDetails)
                : null)),
            !props.isWorkspaceScope
              ? React.createElement('div', { className: 'apm-plugin-actions' },
                  React.createElement(Btn, {
                    disabled: props.busy !== null,
                    onClick: () => props.act('standalone-group-' + props.market.id, () => apiCall('set-standalone-skills-enabled', { marketId: props.market.id, enabled: !allStandaloneEnabled })),
                  }, allStandaloneEnabled ? '全部关闭' : '全部开启'))
              : null))
      }

      /** @type {Set<string>} */
      let configurableWorkspaceIds = new Set()
      let configurableWorkspacesReady = false
      /** @type {Promise<void> | null} */
      let configurableWorkspaceRefresh = null
      /** @type {string | null} */
      let configurableWorkspaceFingerprint = null
      let rescanWorkspaceMenus = () => {}

      /** @param {unknown} workspaces */
      function rememberConfigurableWorkspaces(workspaces) {
        const next = new Set()
        if (Array.isArray(workspaces)) {
          for (const workspace of workspaces) {
            if (workspace && typeof workspace.id === 'string') next.add(workspace.id)
          }
        }
        configurableWorkspaceIds = next
        configurableWorkspacesReady = true
        rescanWorkspaceMenus()
      }

      /** @param {any} workspace */
      function canConfigureWorkspace(workspace) {
        return configurableWorkspacesReady && configurableWorkspaceIds.has(workspace.id)
      }

      async function refreshConfigurableWorkspaces() {
        if (configurableWorkspaceRefresh) return configurableWorkspaceRefresh
        configurableWorkspaceRefresh = apiCall('get-state', {}).then((res) => {
          if (res && res.ok && res.data) rememberConfigurableWorkspaces(res.data.workspaces)
        }).finally(() => { configurableWorkspaceRefresh = null })
        return configurableWorkspaceRefresh
      }

      function refreshConfigurableWorkspacesWhenListChanges() {
        const snapshot = workspaceModel.itemsFromSnapshot(ctx.workspaces.list.getSnapshot())
        const fingerprint = workspaceModel.fingerprint(snapshot)
        if (fingerprint === configurableWorkspaceFingerprint && configurableWorkspacesReady) return
        configurableWorkspaceFingerprint = fingerprint
        void refreshConfigurableWorkspaces()
      }

      const workspaceConfigStore = createWorkspaceConfigStore()
      ctx.effect(() => {
        refreshConfigurableWorkspacesWhenListChanges()
        return ctx.workspaces.list.subscribe(refreshConfigurableWorkspacesWhenListChanges)
      })
      ctx.effect(() => installWorkspaceMenuBridge(ctx, workspaceConfigStore, canConfigureWorkspace, /** @param {() => void} scan */ (scan) => { rescanWorkspaceMenus = scan }))

      /** @param {{workspace?: any}} [props] */
      function MarketPage(props) {
        const fixedWorkspace = props && props.workspace ? props.workspace : null
        const fixedWorkspaceId = fixedWorkspace ? fixedWorkspace.id : null
        const workspaceList = React.useSyncExternalStore(
          (listener) => ctx.workspaces.list.subscribe(listener),
          () => ctx.workspaces.list.getSnapshot(),
          () => ctx.workspaces.list.getSnapshot(),
        )
        const [state, setState] = React.useState(/** @type {any} */ (null))
        const [error, setError] = React.useState(/** @type {string | null} */ (null))
        const [info, setInfo] = React.useState(/** @type {string | null} */ (null))
        const [repo, setRepo] = React.useState('')
        const [refType, setRefType] = React.useState('default')
        const [refText, setRefText] = React.useState('')
        const [query, setQuery] = React.useState('')
        const [catalogMode, setCatalogMode] = React.useState(/** @type {'installed' | 'available' | 'all'} */ ('available'))
        const [marketLimits, setMarketLimits] = React.useState(/** @type {Record<string, number>} */ ({}))
        const [expandedPlugins, setExpandedPlugins] = React.useState(/** @type {Record<string, boolean>} */ ({}))
        const [expandedStandaloneSkills, setExpandedStandaloneSkills] = React.useState(/** @type {Record<string, boolean>} */ ({}))
        const [workspaceId, setWorkspaceId] = React.useState(/** @type {string | null} */ (fixedWorkspaceId))
        const [busy, setBusy] = React.useState(/** @type {string | null} */ (null))
        const [confirmRemove, setConfirmRemove] = React.useState(/** @type {string | null} */ (null))
        const [confirmClearWorkspace, setConfirmClearWorkspace] = React.useState(false)
        const [confirmHooks, setConfirmHooks] = React.useState(/** @type {string | null} */ (null))
        const rawWorkspaceItems = workspaceModel.itemsFromSnapshot(workspaceList)
        const workspaceItems = state && Array.isArray(state.workspaces)
          ? state.workspaces.filter(/** @param {any} workspace */ (workspace) => workspace && typeof workspace.id === 'string' && typeof workspace.title === 'string' && typeof workspace.path === 'string')
          : rawWorkspaceItems.filter(/** @param {any} workspace */ (workspace) => canConfigureWorkspace(workspace))
        const workspaceFingerprint = workspaceModel.fingerprint(rawWorkspaceItems)

        React.useEffect(() => {
          if (fixedWorkspaceId && workspaceId !== fixedWorkspaceId) {
            setConfirmClearWorkspace(false)
            setConfirmHooks(null)
            setState(null)
            setWorkspaceId(fixedWorkspaceId)
          }
        }, [fixedWorkspaceId, workspaceId])

        const refresh = React.useCallback(async () => {
          try {
            const res = await apiCall('get-state', workspaceId ? { workspaceId } : {})
            if (res && res.ok) {
              rememberConfigurableWorkspaces(res.data && res.data.workspaces)
              setState(res.data)
              setError(null)
            }
            else setError((res && res.error) || '加载状态失败')
          } catch (e) { setError(String((/** @type {any} */ (e) && /** @type {any} */ (e).message) || e)) }
        }, [workspaceId])

        React.useEffect(() => {
          if (!ctx.connection.isLoopback) return
          if (workspaceId && !workspaceItems.some(/** @param {any} workspace */ (workspace) => workspace.id === workspaceId)) {
            setConfirmClearWorkspace(false)
            setConfirmHooks(null)
            setState(null)
            if (fixedWorkspaceId) workspaceConfigStore.close()
            else setWorkspaceId(null)
            return
          }
          if (workspaceId) {
            setConfirmClearWorkspace(false)
            setConfirmHooks(null)
          }
          refresh()
        }, [fixedWorkspaceId, refresh, workspaceFingerprint, workspaceId])

        /**
         * @param {string} name
         * @param {() => Promise<any>} fn
         */
        const act = React.useCallback(async (/** @type {string} */ name, /** @type {() => Promise<any>} */ fn) => {
          setBusy(name)
          setError(null)
          try {
            const res = await fn()
            if (!res || !res.ok) {
              setError((res && res.error) || (name + ' 失败'))
              return false
            }
            if (res.data && res.data.skipped) setInfo(res.data.reason || '已是最新')
            else setInfo(null)
            await refresh()
            return true
          } catch (e) {
            setError(String((/** @type {any} */ (e) && /** @type {any} */ (e).message) || e))
            return false
          } finally {
            setBusy(null)
          }
        }, [refresh])

        const submitMarket = async () => {
          if (!repo.trim() || busy !== null) return
          const added = await act('add-market', () => apiCall('add-market', { repo: repo.trim(), refType: refType, ref: refText.trim() }))
          if (added) {
            setRepo('')
            setRefType('default')
            setRefText('')
          }
        }

        /** @param {string} key */
        const togglePlugin = (key) => {
          setExpandedPlugins((current) => ({ ...current, [key]: !current[key] }))
        }

        /** @param {string} marketId */
        const toggleStandaloneSkills = (marketId) => {
          setExpandedStandaloneSkills((current) => ({ ...current, [marketId]: !current[marketId] }))
        }

        /** @param {'installed' | 'available' | 'all'} mode */
        const selectCatalogMode = (mode) => {
          setCatalogMode(mode)
          setMarketLimits({})
        }

        if (!ctx.connection.isLoopback) {
          return React.createElement('div', { className: 'apm-root' },
            React.createElement('div', { className: 'apm-notice' }, '插件市场需要在本机 DSH Web 中使用；远程连接不会读取或修改本机市场配置。'))
        }

        if (state === null) {
          return React.createElement('div', { className: 'apm-root' },
            React.createElement('div', { className: 'apm-loading' }, '加载中…'))
        }

        const hooksBridge = state.hooksBridge || { available: true, installCommand: '' }
        const scope = state.scope || { kind: 'global' }
        const isWorkspaceScope = scope.kind === 'workspace'
        /** @type {any[]} */
        const markets = Array.isArray(state.markets) ? state.markets : []
        const filter = catalogModel.normalizedText(query)
        const catalog = markets.map((market) => catalogModel.catalogForMarket(market, filter, catalogMode))
        const stats = catalogModel.catalogStats(markets)
        const matchedGroups = catalog.reduce((count, item) => count + item.matches.length + (item.visibleStandaloneSkills.length ? 1 : 0), 0)
        const hasFilter = !!filter || catalogMode !== 'all'
        const children = []

        if (!hooksBridge.available) {
          children.push(React.createElement('div', { className: 'apm-notice', key: 'hooks-bridge-unavailable' },
            React.createElement('div', null, 'Codex hooks bridge 当前不可用。市场和技能仍可正常使用；如需启用 hooks，请安装以下依赖并重启 DSH：'),
            React.createElement('code', { className: 'apm-command' }, hooksBridge.installCommand)))
        }
        children.push(React.createElement('div', { className: 'apm-hint', key: 'hint' },
          '将 git 仓库作为 agent 插件市场：添加后克隆到 .dsh/agent-plugin-market，插件及未被引用的根 skills/ 技能均可加载（兼容 Codex / Claude / Copilot 的 SKILL.md 格式）。DSH 启动时自动更新各市场。'))
        const clearWorkspaceOverrides = () => {
          if (!isWorkspaceScope) return
          if (!confirmClearWorkspace) {
            setConfirmClearWorkspace(true)
            return
          }
          setConfirmClearWorkspace(false)
          act('clear-workspace-overrides', () => apiCall('clear-workspace-overrides', { workspaceId: scope.id }))
        }
        children.push(React.createElement(ScopeControls, {
          key: 'scope',
          fixedWorkspace,
          scope,
          isWorkspaceScope,
          workspaceId,
          workspaces: workspaceItems,
          disabled: busy !== null,
          confirming: confirmClearWorkspace,
          onClearOverrides: clearWorkspaceOverrides,
          onScopeChange: /** @param {string | null} id */ (id) => {
            setConfirmClearWorkspace(false)
            setWorkspaceId(id)
          },
        }))

        if (!isWorkspaceScope) {
          children.push(React.createElement(AddMarketForm, {
            key: 'add-market',
            repo,
            refType,
            refText,
            busy,
            disabled: busy !== null,
            onRepoChange: setRepo,
            onRefTypeChange: /** @param {any} value */ (value) => setRefType(value),
            onRefTextChange: setRefText,
            onSubmit: submitMarket,
          }))
        }
        children.push(React.createElement(CatalogToolbar, {
          key: 'catalog-toolbar',
          query,
          mode: catalogMode,
          disabled: busy !== null,
          onQueryChange: setQuery,
          onModeChange: selectCatalogMode,
        }))
        children.push(React.createElement('div', { className: 'apm-catalog-summary', role: 'status', 'aria-live': 'polite', key: 'catalog-summary' },
          '技能 ' + stats.activeSkills + ' / ' + stats.availableSkills + ' · 插件 ' + stats.installedPlugins + ' / ' + stats.availablePlugins + ' · ' + (isWorkspaceScope ? '全局挂钩 ' : '挂钩 ') + stats.activeHooks + ' / ' + stats.availableHooks))

        if (info) {
          children.push(React.createElement('div', { className: 'apm-info', role: 'status', 'aria-live': 'polite', key: 'info' }, info))
        }

        if (markets.length === 0) {
          children.push(React.createElement('div', { className: 'apm-hint', key: 'no-markets' }, '尚未添加插件市场。'))
        } else if (hasFilter && matchedGroups === 0) {
          children.push(React.createElement('div', { className: 'apm-hint', key: 'no-matches' }, '没有匹配的插件或技能。'))
        }

        for (const item of catalog) {
          const market = item.market
          if (hasFilter && item.matches.length === 0 && item.visibleStandaloneSkills.length === 0) continue
          const card = []
          const visibleLimit = marketLimits[market.id] || CATALOG_PAGE_SIZE
          const visibleMatches = item.matches.slice(0, visibleLimit)
          const standaloneLimitKey = market.id + '/standalone'
          const standaloneLimit = marketLimits[standaloneLimitKey] || CATALOG_PAGE_SIZE
          const standaloneOpen = !!expandedStandaloneSkills[market.id]
          const marketInstalledPluginCount = item.plugins.filter(/** @param {any} plugin */ (plugin) => catalogModel.pluginEnabled(plugin)).length
          const marketSkillCount = item.standaloneSkills.length + item.plugins.reduce(/** @param {number} count @param {any} plugin */ (count, plugin) => count + (Array.isArray(plugin.skills) ? plugin.skills.length : 0), 0)
          card.push(React.createElement('div', { className: 'apm-card-head', key: 'head' },
            React.createElement('span', { className: 'apm-name', title: market.name }, market.name),
            React.createElement('div', { className: 'apm-market-actions' },
              React.createElement(UI.Tooltip, {
                label: market.repo,
                side: 'bottom',
                maxWidth: 360,
                children: /** @type {import('react').ReactElement<{ref?: import('react').Ref<HTMLElement>, onMouseEnter?: import('react').MouseEventHandler, onMouseLeave?: import('react').MouseEventHandler, onFocus?: import('react').FocusEventHandler, onBlur?: import('react').FocusEventHandler}>} */ (
                  React.createElement('span', { className: 'apm-repo', role: 'img', tabIndex: 0, 'aria-label': '仓库地址：' + market.repo },
                    React.createElement(UI.IconLinkOutline16, { size: 16 }))),
              }),
              React.createElement(Tag, { key: 'plugins' }, '插件 ' + marketInstalledPluginCount + ' / ' + item.plugins.length),
              React.createElement(Tag, { key: 'skills' }, marketSkillCount + ' 技能'),
              market.refType && market.refType !== 'default'
                ? React.createElement(Tag, { key: 'ref' }, market.refType + ': ' + market.ref)
                : null,
              !isWorkspaceScope
                ? React.createElement(Btn, {
                    disabled: busy !== null,
                    onClick: () => act('update-' + market.id, () => apiCall('update-market', { marketId: market.id })),
                  }, busy === 'update-' + market.id ? '更新中…' : '更新')
                : null,
              !isWorkspaceScope
                ? React.createElement(Btn, {
                    variant: 'danger',
                    disabled: busy !== null,
                    onClick: () => {
                      if (confirmRemove === market.id) {
                        setConfirmRemove(null)
                        act('remove-' + market.id, () => apiCall('remove-market', { marketId: market.id }))
                      } else {
                        setConfirmRemove(market.id)
                      }
                    },
                  }, confirmRemove === market.id ? '确认移除？' : '移除')
                : null)))
          if (market.description) card.push(React.createElement('div', { className: 'apm-market-desc', key: 'market-desc' }, market.description))
          if (!market.manifestFound && item.standaloneSkills.length > 0) {
            card.push(React.createElement('div', { className: 'apm-hint', key: 'standalone-only' }, '未找到 marketplace.json，已从仓库根 skills/ 目录加载独立技能。'))
          } else if (!market.manifestFound) {
            card.push(React.createElement('div', { className: 'apm-err', key: 'no-manifest' }, '未找到 marketplace.json 清单，且根 skills/ 目录中没有可用技能。'))
          }
          if (item.plugins.length === 0 && item.standaloneSkills.length === 0) {
            card.push(React.createElement('div', { className: 'apm-hint', key: 'no-plugins' }, '该市场清单中没有插件。'))
          }
          for (const match of visibleMatches) {
            const pluginKey = market.id + '/' + match.plugin.name
            card.push(React.createElement(PluginSection, {
              key: pluginKey,
              market,
              match,
              scope,
              isWorkspaceScope,
              busy,
              confirmHooks,
              setConfirmHooks,
              act,
              open: !!expandedPlugins[pluginKey],
              onToggle: () => togglePlugin(pluginKey),
            }))
          }
          card.push(React.createElement(CatalogMoreActions, {
            key: 'more',
            total: item.matches.length,
            visible: visibleMatches.length,
            disabled: busy !== null,
            onMore: () => setMarketLimits((current) => ({ ...current, [market.id]: visibleMatches.length + CATALOG_PAGE_SIZE })),
            onCollapse: () => setMarketLimits((current) => ({ ...current, [market.id]: CATALOG_PAGE_SIZE })),
          }))
          card.push(React.createElement(StandaloneSkillsSection, {
            key: 'standalone-skills',
            item,
            market,
            scope,
            isWorkspaceScope,
            busy,
            act,
            open: standaloneOpen,
            limit: standaloneLimit,
            limitKey: standaloneLimitKey,
            setMarketLimits,
            onToggle: () => toggleStandaloneSkills(market.id),
          }))
          children.push(React.createElement('div', { className: 'apm-card', key: market.id }, ...card))
        }

        if (error) {
          children.push(React.createElement('div', { className: 'apm-err', role: 'alert', key: 'err' }, error))
        }

        return React.createElement('div', { className: 'apm-root' }, ...children)
      }

      const WorkspaceConfigOverlay = createWorkspaceConfigOverlay({ workspaceConfigStore, Btn, MarketPage })
      return { MarketPage, WorkspaceConfigOverlay }
    }

    /**
     * Registers the plugin market settings entries in the browser client.
     * @param {import('@deepseek-ai/cordis').Context & {connection: {isLoopback: boolean, rpc: {call: Function}}, slots: {inject: Function, register: Function}, workspaces: {list: {getSnapshot: () => {items?: Array<{workspaceId?: string, title?: string, path?: string}>}, subscribe: (listener: () => void) => () => void}}}} ctx
     */
    function apply(ctx) {
      const ui = createSettingsUi(ctx, { rpcRoute: RPC_ROUTE })
      ctx.slots.inject('settings.section', () => ctx.slots.register(
        SETTINGS_SECTION,
        () => React.createElement(ui.MarketPage),
      ))
      ctx.slots.inject('shell.overlay', () => ctx.slots.register(
        WORKSPACE_OVERLAY,
        () => React.createElement(ui.WorkspaceConfigOverlay),
      ))
    }

    exports.catalog = catalogModel
    exports.workspace = workspaceModel
    exports.workspaceMenu = workspaceMenuModel
    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
})()
