// dsh-agent-plugin-market —— Client 半端（静态 web 插件形态，ModuleLoader bundle）
// 供 `dsh plugin --profile web add github:Diluka/dsh-agent-plugin-market` 安装后
// 经 /plugins/dsh-agent-plugin-market/client.js 加载。
// 与动态版（会话内 cordis_define）逻辑同源；RPC 通过 ctx.connection.rpc 调用。

window.__ModuleLoader__.load({
  id: 'dsh-agent-plugin-market',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
    var React = require('react');
    var UI = require('@deepseek-ai/dsh-client-ui-primitives');

    function insertStyles(css) {
      try {
        const style = document.createElement('style')
        style.textContent = css
        document.head.appendChild(style)
        return () => { try { style.remove() } catch (e) { /* ignore */ } }
      } catch (e) {
        return () => {}
      }
    }

    const inject = ['connection', 'slots']

    function apply(ctx) {
      const apiCall = async (name, args) => {
        const result = await ctx.connection.rpc.call('/agent-plugin-market', name, args || {})
        if (!result.ok) return { ok: false, error: result.error.message }
        return { ok: true, data: result.value }
      }

      ctx.effect(() => insertStyles(`.apm-root{font-size:13px;color:var(--dsw-alias-label-primary);line-height:1.5}
.apm-hint{color:var(--dsw-alias-label-secondary);font-size:12px;margin:0 0 12px}
.apm-form{display:flex;gap:8px;margin-bottom:16px}
.apm-form-ref{margin-top:-8px;margin-bottom:16px;align-items:center}
.apm-input{flex:1;min-width:0}
.apm-search{flex:1;min-width:180px}
.apm-catalog-toolbar{display:flex;align-items:center;gap:8px;margin:0 0 8px;flex-wrap:wrap}
.apm-catalog-summary{color:var(--dsw-alias-label-secondary);font-size:12px;margin:0 0 12px}
.apm-switch:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.apm-info{color:var(--dsw-alias-state-success-primary);font-size:12px;margin:0 0 12px}
.apm-notice{border:1px solid var(--dsw-alias-border-l2);border-left:3px solid var(--dsw-alias-label-secondary);border-radius:8px;padding:10px 12px;margin:0 0 12px;background:var(--dsw-alias-bg-layer-2);font-size:12px}
.apm-command{display:block;margin-top:6px;color:var(--dsw-alias-label-primary);font-family:ui-monospace,monospace;overflow-wrap:anywhere}
.apm-btn{flex:none}
.apm-btn.danger{color:var(--dsw-alias-state-error-primary)}
.apm-card{border:1px solid var(--dsw-alias-border-l2);border-radius:12px;padding:14px 16px;margin-bottom:12px;background:var(--dsw-alias-bg-layer-1)}
.apm-card-head{display:flex;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap}
.apm-name{font-weight:600}
.apm-repo{color:var(--dsw-alias-label-secondary);font-size:12px;flex:1;min-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
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
.apm-skill{display:flex;align-items:flex-start;gap:10px;padding:8px 0 0}
.apm-skill-info{flex:1;min-width:0}
.apm-skill-name{font-size:12px;font-family:ui-monospace,monospace}
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
@media (max-width:640px){.apm-form{flex-wrap:wrap}.apm-form .apm-input{flex-basis:100%}.apm-plugin-topline{align-items:flex-start}.apm-plugin-actions{flex-wrap:wrap;justify-content:flex-end}.apm-plugin-summary{display:none}.apm-plugin-details{padding-left:0}}`))

      function Btn(props) {
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

      function TextInput(props) {
        return React.createElement(UI.Input, props)
      }

      function Tag(props) {
        return React.createElement(UI.Pill, { className: 'apm-tag', title: props.title }, props.children)
      }

      function RefTypeMenu(props) {
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

      function normalizedText(value) {
        return String(value || '').trim().toLowerCase()
      }

      function matchesText(query, values) {
        if (!query) return false
        return values.some((value) => normalizedText(value).includes(query))
      }

      function catalogForMarket(market, query, installedOnly) {
        const plugins = Array.isArray(market.plugins) ? market.plugins : []
        const marketMatches = matchesText(query, [market.name, market.repo, market.description])
        const matches = []
        for (const plugin of plugins) {
          if (installedOnly && !plugin.installed) continue
          const pluginMatches = marketMatches || matchesText(query, [plugin.name, plugin.title, plugin.description, plugin.version])
          const skills = Array.isArray(plugin.skills) ? plugin.skills : []
          const visibleSkills = !query || pluginMatches
            ? skills
            : skills.filter((skill) => matchesText(query, [skill.name, skill.description, skill.whenToUse]))
          if (!query || pluginMatches || visibleSkills.length) matches.push({ plugin, visibleSkills })
        }
        return { market, plugins, matches }
      }

      function MarketPage() {
        if (!ctx.connection.isLoopback) {
          return React.createElement('div', { className: 'apm-root' },
            React.createElement('div', { className: 'apm-notice' }, '插件市场只能从本机地址访问，以保护本机 Git 操作和 hooks 执行。'))
        }

        const [state, setState] = React.useState(null)
        const [error, setError] = React.useState(null)
        const [info, setInfo] = React.useState(null)
        const [repo, setRepo] = React.useState('')
        const [refType, setRefType] = React.useState('default')
        const [refText, setRefText] = React.useState('')
        const [query, setQuery] = React.useState('')
        const [installedOnly, setInstalledOnly] = React.useState(false)
        const [expandedPlugins, setExpandedPlugins] = React.useState({})
        const [busy, setBusy] = React.useState(null)
        const [confirmRemove, setConfirmRemove] = React.useState(null)
        const [confirmHooks, setConfirmHooks] = React.useState(null)

        const refresh = React.useCallback(async () => {
          try {
            const res = await apiCall('get-state')
            if (res && res.ok) { setState(res.data); setError(null) }
            else setError((res && res.error) || '加载状态失败')
          } catch (e) { setError(String((e && e.message) || e)) }
        }, [])

        React.useEffect(() => { refresh() }, [refresh])

        const act = React.useCallback(async (name, fn) => {
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
            setError(String((e && e.message) || e))
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

        const togglePlugin = (key) => {
          setExpandedPlugins((current) => ({ ...current, [key]: !current[key] }))
        }

        if (state === null) {
          return React.createElement('div', { className: 'apm-root' },
            React.createElement('div', { className: 'apm-loading' }, '加载中…'))
        }

        const hooksBridge = state.hooksBridge || { available: true, installCommand: '' }
        const markets = Array.isArray(state.markets) ? state.markets : []
        const filter = normalizedText(query)
        const catalog = markets.map((market) => catalogForMarket(market, filter, installedOnly))
        const totalPlugins = catalog.reduce((count, item) => count + item.plugins.length, 0)
        const totalSkills = catalog.reduce((count, item) => count + item.plugins.reduce((skills, plugin) => skills + (Array.isArray(plugin.skills) ? plugin.skills.length : 0), 0), 0)
        const matchedPlugins = catalog.reduce((count, item) => count + item.matches.length, 0)
        const matchedSkills = catalog.reduce((count, item) => count + item.matches.reduce((skills, match) => skills + match.visibleSkills.length, 0), 0)
        const hasFilter = !!filter || installedOnly
        const children = []

        if (!hooksBridge.available) {
          children.push(React.createElement('div', { className: 'apm-notice', key: 'hooks-bridge-unavailable' },
            React.createElement('div', null, 'Codex hooks bridge 当前不可用。市场和技能仍可正常使用；如需启用 hooks，请安装以下依赖并重启 DSH：'),
            React.createElement('code', { className: 'apm-command' }, hooksBridge.installCommand)))
        }
        children.push(React.createElement('div', { className: 'apm-hint', key: 'hint' },
          '将 git 仓库作为 agent 插件市场：添加后克隆到 .dsh/agent-plugin-market，安装插件即原地加载其技能（兼容 Codex / Claude / Copilot 的 SKILL.md 格式）。DSH 启动时自动更新各市场。'))

        const refPlaceholder = refType === 'branch' ? '分支名，如 main' : refType === 'tag' ? '标签名，如 v1.0.0' : 'commit id，如 1a2b3c4d'
        children.push(React.createElement('div', { className: 'apm-form', key: 'add-market' },
          React.createElement(TextInput, {
            className: 'apm-input',
            placeholder: 'git 仓库地址，如 git@github.com:owner/repo.git',
            'aria-label': '市场 Git 仓库地址',
            value: repo,
            disabled: busy !== null,
            onChange: (e) => setRepo(e.target.value),
            onKeyDown: (e) => { if (e.key === 'Enter') submitMarket() },
          }),
          React.createElement(Btn, {
            variant: 'primary',
            disabled: busy !== null || !repo.trim(),
            onClick: submitMarket,
          }, busy === 'add-market' ? '添加中…' : '添加市场')))
        children.push(React.createElement('div', { className: 'apm-form apm-form-ref', key: 'market-ref' },
          React.createElement(RefTypeMenu, {
            value: refType,
            disabled: busy !== null,
            onChange: (value) => setRefType(value),
          }),
          refType !== 'default'
            ? React.createElement(TextInput, {
                className: 'apm-input',
                placeholder: refPlaceholder,
                'aria-label': '市场 Git 引用',
                value: refText,
                disabled: busy !== null,
                onChange: (e) => setRefText(e.target.value),
              })
            : React.createElement('span', { className: 'apm-hint' }, '使用仓库默认分支（与 GitHub 默认一致），启动时自动拉取更新')))
        children.push(React.createElement('div', { className: 'apm-catalog-toolbar', key: 'catalog-toolbar' },
          React.createElement(TextInput, {
            className: 'apm-search',
            icon: React.createElement(UI.IconSearchOutline16, { size: 16 }),
            placeholder: '搜索插件、技能或描述',
            'aria-label': '搜索插件、技能或描述',
            value: query,
            disabled: busy !== null,
            onChange: (e) => setQuery(e.target.value),
          }),
          query
            ? React.createElement(Btn, { disabled: busy !== null, onClick: () => setQuery('') }, '清除')
            : null,
          React.createElement(Btn, {
            disabled: busy !== null,
            onClick: () => setInstalledOnly(!installedOnly),
            'aria-label': installedOnly ? '显示所有插件' : '仅显示已安装插件',
          }, installedOnly ? '显示全部' : '仅已安装')))
        children.push(React.createElement('div', { className: 'apm-catalog-summary', role: 'status', 'aria-live': 'polite', key: 'catalog-summary' },
          hasFilter
            ? '匹配 ' + matchedPlugins + ' / ' + totalPlugins + ' 个插件，' + matchedSkills + ' / ' + totalSkills + ' 个技能'
            : '共 ' + totalPlugins + ' 个插件，' + totalSkills + ' 个技能'))

        if (info) {
          children.push(React.createElement('div', { className: 'apm-info', role: 'status', 'aria-live': 'polite', key: 'info' }, info))
        }

        if (markets.length === 0) {
          children.push(React.createElement('div', { className: 'apm-hint', key: 'no-markets' }, '尚未添加插件市场。'))
        } else if (hasFilter && matchedPlugins === 0) {
          children.push(React.createElement('div', { className: 'apm-hint', key: 'no-matches' }, '没有匹配的插件或技能。'))
        }

        for (const item of catalog) {
          const market = item.market
          if (hasFilter && item.matches.length === 0) continue
          const card = []
          const marketSkillCount = item.plugins.reduce((count, plugin) => count + (Array.isArray(plugin.skills) ? plugin.skills.length : 0), 0)
          card.push(React.createElement('div', { className: 'apm-card-head', key: 'head' },
            React.createElement('span', { className: 'apm-name' }, market.name),
            React.createElement('span', { className: 'apm-repo', title: market.repo }, market.repo),
            React.createElement(Tag, { key: 'plugins' }, item.matches.length + ' / ' + item.plugins.length + ' 插件'),
            React.createElement(Tag, { key: 'skills' }, marketSkillCount + ' 技能'),
            market.refType && market.refType !== 'default'
              ? React.createElement(Tag, { key: 'ref' }, market.refType + ': ' + market.ref)
              : null,
            React.createElement(Btn, {
              disabled: busy !== null,
              onClick: () => act('update-' + market.id, () => apiCall('update-market', { marketId: market.id })),
            }, busy === 'update-' + market.id ? '更新中…' : '更新'),
            React.createElement(Btn, {
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
            }, confirmRemove === market.id ? '确认移除？' : '移除')))
          if (market.description) card.push(React.createElement('div', { className: 'apm-market-desc', key: 'market-desc' }, market.description))
          if (!market.manifestFound) {
            card.push(React.createElement('div', { className: 'apm-err', key: 'no-manifest' }, '未找到 marketplace.json 清单'))
          }
          if (item.plugins.length === 0) {
            card.push(React.createElement('div', { className: 'apm-hint', key: 'no-plugins' }, '该市场清单中没有插件。'))
          }
          for (const match of item.matches) {
            const plugin = match.plugin
            const pluginKey = market.id + '/' + plugin.name
            const skills = Array.isArray(plugin.skills) ? plugin.skills : []
            const skillCount = skills.length
            const enabledCount = skills.filter((skill) => skill.enabled).length
            const canExpand = !plugin.unsupported && (skillCount > 0 || !!(plugin.installed && plugin.hooks && (plugin.hooks.found || plugin.hooks.error)))
            const open = !!expandedPlugins[pluginKey]
            const summary = React.createElement('span', { className: 'apm-plugin-summary' },
              React.createElement(Tag, null, skillCount + ' 技能'),
              plugin.installed && skillCount > 0 ? React.createElement('span', null, enabledCount + ' 已启用') : null,
              plugin.hooks && plugin.hooks.found ? React.createElement(Tag, null, 'Codex hooks') : null)
            const details = []
            for (const skill of match.visibleSkills) {
              const skillBusy = 'skill-' + skill.fullName
              details.push(React.createElement('div', { className: 'apm-skill', key: skill.fullName },
                plugin.installed
                  ? React.createElement(Switch, {
                      on: skill.enabled,
                      disabled: busy !== null,
                      label: (skill.enabled ? '禁用技能 ' : '启用技能 ') + skill.name,
                      onClick: () => act(skillBusy, () => apiCall('set-skill-enabled', { fullName: skill.fullName, enabled: !skill.enabled })),
                    })
                  : React.createElement('span', { className: 'apm-skill-state' }, '安装后可启用'),
                React.createElement('div', { className: 'apm-skill-info' },
                  React.createElement('div', { className: 'apm-skill-name' }, skill.name),
                  skill.description ? React.createElement('div', { className: 'apm-skill-desc' }, skill.description) : null)))
            }
            if (plugin.installed && plugin.hooks && (plugin.hooks.found || plugin.hooks.error)) {
              const hook = plugin.hooks
              const waitingForConfirmation = !hook.enabled && confirmHooks === pluginKey
              const hookBusy = 'hooks-' + pluginKey
              const hookDetail = !hook.available
                ? 'Codex hooks bridge 当前不可用；请先按上方命令安装依赖并重启 DSH。'
                : hook.error
                  ? hook.error
                  : hook.needsApproval
                    ? '配置已变更；重新确认后才会再次执行。'
                    : hook.enabled
                      ? (hook.active ? '已注册；命令会在 agent 工作区触发。' : '已批准，正在等待注册。')
                      : (waitingForConfirmation ? '再次点击开关确认：允许此插件执行 hooks 命令。' : '默认关闭；启用后允许此插件在 agent 工作区执行 hooks 命令。')
              details.push(React.createElement('div', { className: 'apm-skill apm-hook', key: 'hooks' },
                React.createElement(Switch, {
                  on: hook.enabled,
                  disabled: !hook.available || !hook.found || busy !== null,
                  label: (hook.enabled ? '禁用' : '启用') + '插件 ' + plugin.title + ' 的 Codex hooks',
                  title: !hook.available ? 'Codex hooks bridge 不可用；安装依赖并重启 DSH 后可启用' : undefined,
                  onClick: () => {
                    if (!hook.enabled && !waitingForConfirmation) {
                      setConfirmHooks(pluginKey)
                      return
                    }
                    setConfirmHooks(null)
                    act(hookBusy, () => apiCall('set-plugin-hooks-enabled', {
                      marketId: market.id,
                      pluginName: plugin.name,
                      enabled: !hook.enabled,
                    }))
                  },
                }),
                React.createElement('div', { className: 'apm-skill-info' },
                  React.createElement('div', { className: 'apm-skill-name' }, 'Codex hooks (' + hook.count + ' 配置)'),
                  React.createElement('div', { className: 'apm-skill-desc' }, hookDetail))))
            }
            const pluginContent = []
            pluginContent.push(React.createElement('div', { className: 'apm-plugin-topline', key: 'head' },
              React.createElement('div', { className: 'apm-plugin-disclosure' },
                React.createElement(UI.DisclosureRow, {
                  icon: React.createElement(UI.IconSkillOutline16, { size: 16 }),
                  title: plugin.title,
                  open: open,
                  expandable: canExpand,
                  onToggle: () => togglePlugin(pluginKey),
                  expandOnRowClick: true,
                  collapsedContent: summary,
                  rowClassName: 'apm-disclosure-row',
                  titleClassName: 'apm-disclosure-title',
                }, React.createElement('div', { className: 'apm-plugin-details' }, ...details))),
              !plugin.unsupported
                ? React.createElement('div', { className: 'apm-plugin-actions' },
                    plugin.installed
                      ? React.createElement(Btn, {
                          disabled: busy !== null,
                          onClick: () => act('uninstall-' + pluginKey, () => apiCall('uninstall-plugin', { marketId: market.id, pluginName: plugin.name })),
                        }, busy === 'uninstall-' + pluginKey ? '卸载中…' : '卸载')
                      : React.createElement(Btn, {
                          variant: 'primary',
                          disabled: busy !== null,
                          onClick: () => act('install-' + pluginKey, () => apiCall('install-plugin', { marketId: market.id, pluginName: plugin.name })),
                        }, busy === 'install-' + pluginKey ? '安装中…' : '安装'))
                : React.createElement(Tag, null, '不支持来源: ' + plugin.sourceType)))
            if (plugin.description) pluginContent.push(React.createElement('div', { className: 'apm-plugin-desc', key: 'desc' }, plugin.description))
            if (plugin.error) pluginContent.push(React.createElement('div', { className: 'apm-err', key: 'err' }, plugin.error))
            card.push(React.createElement('div', { className: 'apm-plugin', key: pluginKey }, ...pluginContent))
          }
          children.push(React.createElement('div', { className: 'apm-card', key: market.id }, ...card))
        }

        if (error) {
          children.push(React.createElement('div', { className: 'apm-err', role: 'alert', key: 'err' }, error))
        }

        return React.createElement('div', { className: 'apm-root' }, ...children)
      }

      ctx.slots.inject('settings.section', () => ctx.slots.register(
        { name: 'settings.section', id: 'skills-and-hooks', order: 25, label: '技能与 Hooks' },
        () => React.createElement(MarketPage),
      ))
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
