// dsh-agent-plugin-market —— Client 半端（静态 web 插件形态，ModuleLoader bundle）
// 供 `dsh plugin --profile web add github:Diluka/dsh-agent-plugin-market` 安装后
// 经 /plugins/dsh-agent-plugin-market/client.js 加载。
// 与动态版（会话内 cordis_define）逻辑同源；RPC 改为 fetch POST /agent-plugin-market/api/<name>。

window.__ModuleLoader__.load({
  id: 'dsh-agent-plugin-market',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
    var React = require('react');
    var UI = require('@deepseek-ai/dsh-client-ui-primitives');

    async function apiCall(name, args) {
      const res = await fetch('/agent-plugin-market/api/' + name, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(args || {}),
      })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      return await res.json()
    }

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

    const inject = []

    function apply(ctx) {
      insertStyles(`.apm-root{font-size:13px;color:var(--dsw-alias-label-primary);line-height:1.5}
.apm-hint{color:var(--dsw-alias-label-secondary);font-size:12px;margin:0 0 12px}
.apm-form{display:flex;gap:8px;margin-bottom:16px}
.apm-form-ref{margin-top:-8px;margin-bottom:16px;align-items:center}
.apm-input{flex:1;min-width:0}
.apm-switch:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.apm-info{color:var(--dsw-alias-state-success-primary);font-size:12px;margin:0 0 12px}
.apm-notice{border:1px solid var(--dsw-alias-border-l2);border-left:3px solid var(--dsw-alias-label-secondary);border-radius:8px;padding:10px 12px;margin:0 0 12px;background:var(--dsw-alias-bg-layer-2);font-size:12px}
.apm-command{display:block;margin-top:6px;color:var(--dsw-alias-label-primary);font-family:ui-monospace,monospace;overflow-wrap:anywhere}
.apm-btn{flex:none}
.apm-btn.danger{color:var(--dsw-alias-state-error-primary)}
.apm-card{border:1px solid var(--dsw-alias-border-l2);border-radius:12px;padding:14px 16px;margin-bottom:12px;background:var(--dsw-alias-bg-layer-1)}
.apm-card-head{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.apm-name{font-weight:600}
.apm-repo{color:var(--dsw-alias-label-secondary);font-size:12px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.apm-tag{flex:none}
.apm-err{color:var(--dsw-alias-state-error-primary);font-size:12px;margin-top:6px}
.apm-plugin{border-top:1px solid var(--dsw-alias-border-l2);margin-top:12px;padding-top:12px}
.apm-plugin-head{display:flex;align-items:center;gap:8px}
.apm-plugin-title{font-weight:600}
.apm-plugin-desc{color:var(--dsw-alias-label-secondary);font-size:12px;margin:3px 0 0}
.apm-skill{display:flex;align-items:flex-start;gap:10px;padding:8px 0 0}
.apm-skill-info{flex:1;min-width:0}
.apm-skill-name{font-size:12px;font-family:ui-monospace,monospace}
.apm-skill-desc{color:var(--dsw-alias-label-secondary);font-size:11px}
.apm-skills{margin-top:8px}
.apm-skills-summary{cursor:pointer;color:var(--dsw-alias-label-secondary);font-size:12px;user-select:none}
.apm-skills-summary:hover{color:var(--dsw-alias-label-primary)}
.apm-switch{appearance:none;width:34px;height:20px;box-sizing:border-box;border-radius:999px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);position:relative;cursor:pointer;flex:none;margin-top:1px;padding:0;transition:background .16s,border-color .16s}
.apm-switch:hover:not(:disabled){background:var(--dsw-alias-bg-layer-1);border-color:var(--dsw-alias-label-secondary)}
.apm-switch.on{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}
.apm-switch-knob{position:absolute;top:3px;left:3px;width:12px;height:12px;border-radius:50%;background:var(--dsw-alias-label-secondary);transition:left .16s,background .16s}
.apm-switch.on .apm-switch-knob{left:17px;background:var(--dsw-alias-bg-base)}
.apm-switch:disabled{opacity:.45;cursor:default}
.apm-hook{border-top:1px dashed var(--dsw-alias-border-l2);margin-top:10px;padding-top:10px}
.apm-loading{color:var(--dsw-alias-label-secondary);padding:16px 0}`)

      function Btn(props) {
        const variant = props.variant === 'primary' ? 'primary' : props.variant === 'danger' ? 'ghost' : 'outline'
        return React.createElement(UI.Button, {
          variant: variant,
          size: 'sm',
          className: 'apm-btn' + (props.variant ? ' ' + props.variant : ''),
          disabled: props.disabled,
          onClick: props.onClick,
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
          'aria-pressed': props.on,
          onClick: props.onClick,
          disabled: props.disabled,
          title: props.title || (props.on ? '点击禁用' : '点击启用'),
        }, React.createElement('span', { className: 'apm-switch-knob' }))
      }

      function MarketPage() {
        const [state, setState] = React.useState(null)
        const [error, setError] = React.useState(null)
        const [info, setInfo] = React.useState(null)
        const [repo, setRepo] = React.useState('')
        const [refType, setRefType] = React.useState('default')
        const [refText, setRefText] = React.useState('')
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
            } else {
              if (res.data && res.data.skipped) setInfo(res.data.reason || '已是最新')
              else setInfo(null)
              await refresh()
            }
          } catch (e) { setError(String((e && e.message) || e)) }
          setBusy(null)
        }, [refresh])

        if (state === null) {
          return React.createElement('div', { className: 'apm-root' },
            React.createElement('div', { className: 'apm-loading' }, '加载中…'))
        }

        const hooksBridge = state.hooksBridge || { available: true, installCommand: '' }
        const children = []
        if (!hooksBridge.available) {
          children.push(React.createElement('div', { className: 'apm-notice', key: 'hooks-bridge-unavailable' },
            React.createElement('div', null, 'Codex hooks bridge 当前不可用。市场和技能仍可正常使用；如需启用 hooks，请安装以下依赖并重启 DSH：'),
            React.createElement('code', { className: 'apm-command' }, hooksBridge.installCommand)))
        }
        children.push(React.createElement('div', { className: 'apm-hint' },
          '将 git 仓库作为 agent 插件市场：添加后克隆到 .dsh/agent-plugin-market，安装插件即原地加载其技能（兼容 Codex / Claude 的 SKILL.md 格式）。DSH 启动时自动更新各市场。'))

        const refPlaceholder = refType === 'branch' ? '分支名，如 main' : refType === 'tag' ? '标签名，如 v1.0.0' : 'commit id，如 1a2b3c4d'
        children.push(React.createElement('div', { className: 'apm-form' },
          React.createElement(TextInput, {
            className: 'apm-input',
            placeholder: 'git 仓库地址，如 git@github.com:owner/repo.git',
            value: repo,
            disabled: busy !== null,
            onChange: (e) => setRepo(e.target.value),
            onKeyDown: (e) => {
              if (e.key === 'Enter' && repo.trim() && busy === null) {
                act('add-market', () => apiCall('add-market', { repo: repo.trim(), refType: refType, ref: refText.trim() })).then(() => { if (!error) { setRepo(''); setRefType('default'); setRefText('') } })
              }
            },
          }),
          React.createElement(Btn, {
            variant: 'primary',
            disabled: busy !== null || !repo.trim(),
            onClick: () => act('add-market', () => apiCall('add-market', { repo: repo.trim(), refType: refType, ref: refText.trim() })).then(() => { if (!error) { setRepo(''); setRefType('default'); setRefText('') } }),
          }, busy === 'add-market' ? '添加中…' : '添加市场')))
        children.push(React.createElement('div', { className: 'apm-form apm-form-ref' },
          React.createElement(RefTypeMenu, {
            value: refType,
            disabled: busy !== null,
            onChange: (value) => setRefType(value),
          }),
          refType !== 'default'
            ? React.createElement(TextInput, {
                className: 'apm-input',
                placeholder: refPlaceholder,
                value: refText,
                disabled: busy !== null,
                onChange: (e) => setRefText(e.target.value),
              })
            : React.createElement('span', { className: 'apm-hint' }, '使用仓库默认分支（与 GitHub 默认一致），启动时自动拉取更新')))

        if (info) {
          children.push(React.createElement('div', { className: 'apm-info', key: 'info' }, info))
        }

        if (state.markets.length === 0) {
          children.push(React.createElement('div', { className: 'apm-hint' }, '尚未添加插件市场。'))
        }

        for (const market of state.markets) {
          const card = []
          card.push(React.createElement('div', { className: 'apm-card-head', key: 'head' },
            React.createElement('span', { className: 'apm-name' }, market.name),
            React.createElement('span', { className: 'apm-repo', title: market.repo }, market.repo),
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
          if (!market.manifestFound) {
            card.push(React.createElement('div', { className: 'apm-err', key: 'no-manifest' }, '未找到 marketplace.json 清单'))
          }
          if (market.plugins.length === 0) {
            card.push(React.createElement('div', { className: 'apm-hint', key: 'no-plugins' }, '该市场清单中没有插件。'))
          }
          for (const plugin of market.plugins) {
            const p = []
            const head = []
            head.push(React.createElement('span', { className: 'apm-plugin-title', key: 'title' }, plugin.title))
            if (plugin.unsupported) {
              head.push(React.createElement(Tag, { key: 'tag' }, '不支持来源: ' + plugin.sourceType))
            } else {
              head.push(React.createElement(Tag, { key: 'tag' }, plugin.skills.length + ' 技能'))
               if (plugin.hooks && plugin.hooks.found) {
                 head.push(React.createElement(Tag, { key: 'hooks' }, 'Codex hooks'))
               }
              if (plugin.installed) {
                head.push(React.createElement(Btn, {
                  key: 'action',
                  disabled: busy !== null,
                  onClick: () => act('uninstall-' + plugin.name, () => apiCall('uninstall-plugin', { marketId: market.id, pluginName: plugin.name })),
                }, busy === 'uninstall-' + plugin.name ? '卸载中…' : '卸载'))
              } else {
                head.push(React.createElement(Btn, {
                  key: 'action',
                  variant: 'primary',
                  disabled: busy !== null,
                  onClick: () => act('install-' + plugin.name, () => apiCall('install-plugin', { marketId: market.id, pluginName: plugin.name })),
                }, busy === 'install-' + plugin.name ? '安装中…' : '安装'))
              }
            }
            p.push(React.createElement('div', { className: 'apm-plugin-head', key: 'head' }, ...head))
            if (plugin.description) {
              p.push(React.createElement('div', { className: 'apm-plugin-desc', key: 'desc' }, plugin.description))
            }
            if (plugin.error) {
              p.push(React.createElement('div', { className: 'apm-err', key: 'err' }, plugin.error))
            }
            if (plugin.installed && plugin.skills.length > 0) {
              const skills = []
              for (const sk of plugin.skills) {
                skills.push(React.createElement('div', { className: 'apm-skill', key: sk.name },
                  React.createElement(Switch, {
                    on: sk.enabled,
                     disabled: busy !== null,
                    onClick: () => act('skill-' + sk.name, () => apiCall('set-skill-enabled', { fullName: sk.fullName, enabled: !sk.enabled })),
                  }),
                  React.createElement('div', { className: 'apm-skill-info' },
                    React.createElement('div', { className: 'apm-skill-name' }, sk.name),
                    sk.description ? React.createElement('div', { className: 'apm-skill-desc' }, sk.description) : null)))
              }
              p.push(React.createElement('details', { className: 'apm-skills', key: 'skills' },
                React.createElement('summary', { className: 'apm-skills-summary' }, '已启用 ' + plugin.skills.filter((sk) => sk.enabled).length + ' 个技能'),
                ...skills))
            }
            if (plugin.installed && plugin.hooks && (plugin.hooks.found || plugin.hooks.error)) {
               const hook = plugin.hooks
               const hookKey = market.id + '/' + plugin.name
               const waitingForConfirmation = !hook.enabled && confirmHooks === hookKey
               const hookDetail = !hook.available
                  ? 'Codex hooks bridge 当前不可用；请先按上方命令安装依赖并重启 DSH。'
                  : hook.error
                 ? hook.error
                 : hook.needsApproval
                   ? '配置已变更；重新确认后才会再次执行。'
                   : hook.enabled
                     ? (hook.active ? '已注册；命令会在 agent 工作区触发。' : '已批准，正在等待注册。')
                     : (waitingForConfirmation ? '再次点击开关确认：允许此插件执行 hooks 命令。' : '默认关闭；启用后允许此插件在 agent 工作区执行 hooks 命令。')
               p.push(React.createElement('div', { className: 'apm-skill apm-hook', key: 'hooks' },
                 React.createElement(Switch, {
                   on: hook.enabled,
                   disabled: !hook.available || !hook.found || busy !== null,
                   title: !hook.available
                      ? 'Codex hooks bridge 不可用；安装依赖并重启 DSH 后可启用'
                      : (hook.enabled ? '点击禁用 Codex hooks' : '点击启用 Codex hooks'),
                   onClick: () => {
                     if (!hook.enabled && !waitingForConfirmation) {
                       setConfirmHooks(hookKey)
                       return
                     }
                     setConfirmHooks(null)
                     act('hooks-' + hookKey, () => apiCall('set-plugin-hooks-enabled', {
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
             card.push(React.createElement('div', { className: 'apm-plugin', key: plugin.name }, ...p))
          }
          children.push(React.createElement('div', { className: 'apm-card', key: market.id }, ...card))
        }

        if (error) {
          children.push(React.createElement('div', { className: 'apm-err', key: 'err' }, error))
        }

        return React.createElement('div', { className: 'apm-root' }, ...children)
      }

      const slots = ctx.get('slots')
      if (slots === undefined) return
      slots.inject('settings.section', () => slots.register(
        { name: 'settings.section', id: 'skills-and-hooks', order: 25, label: '技能与 Hooks' },
        () => React.createElement(MarketPage),
      ))
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
