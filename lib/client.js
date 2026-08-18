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
.apm-input{flex:1;min-width:0;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);border-radius:6px;padding:6px 10px;font-size:13px;outline:none}
.apm-input:focus{border-color:var(--dsw-alias-brand-primary)}
.apm-select{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);border-radius:6px;padding:5px 8px;font-size:12px;outline:none;flex:none}
.apm-info{color:var(--dsw-alias-state-success-primary);font-size:12px;margin:0 0 12px}
.apm-btn{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);border-radius:6px;padding:5px 12px;font-size:12px;cursor:pointer;flex:none}
.apm-btn:hover:not(:disabled){border-color:var(--dsw-alias-brand-primary)}
.apm-btn:disabled{opacity:.45;cursor:default}
.apm-btn.primary{background:var(--dsw-alias-brand-primary);border-color:transparent;color:#fff}
.apm-btn.danger{color:var(--dsw-alias-state-error-primary)}
.apm-card{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:12px 14px;margin-bottom:12px;background:var(--dsw-alias-bg-layer-1)}
.apm-card-head{display:flex;align-items:center;gap:8px;margin-bottom:6px}
.apm-name{font-weight:600}
.apm-repo{color:var(--dsw-alias-label-secondary);font-size:12px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.apm-tag{font-size:11px;color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l1);border-radius:4px;padding:0 5px;flex:none}
.apm-err{color:var(--dsw-alias-state-error-primary);font-size:12px;margin-top:6px}
.apm-plugin{border-top:1px solid var(--dsw-alias-border-l1);margin-top:10px;padding-top:10px}
.apm-plugin-head{display:flex;align-items:center;gap:8px}
.apm-plugin-title{font-weight:600}
.apm-plugin-desc{color:var(--dsw-alias-label-secondary);font-size:12px;margin:2px 0 0}
.apm-skill{display:flex;align-items:flex-start;gap:8px;padding:6px 0 0 2px}
.apm-skill-info{flex:1;min-width:0}
.apm-skill-name{font-size:12px;font-family:ui-monospace,monospace}
.apm-skill-desc{color:var(--dsw-alias-label-secondary);font-size:11px}
.apm-switch{width:30px;height:16px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);position:relative;cursor:pointer;flex:none;margin-top:1px;padding:0}
.apm-switch.on{background:var(--dsw-alias-brand-primary);border-color:transparent}
.apm-switch-knob{position:absolute;top:2px;left:2px;width:10px;height:10px;border-radius:50%;background:#fff;transition:left .15s}
.apm-switch.on .apm-switch-knob{left:16px}
.apm-loading{color:var(--dsw-alias-label-secondary);padding:16px 0}`)

      function Btn(props) {
        return React.createElement('button', {
          className: 'apm-btn' + (props.variant ? ' ' + props.variant : ''),
          disabled: props.disabled,
          onClick: props.onClick,
        }, props.children)
      }

      function Switch(props) {
        return React.createElement('button', {
          className: 'apm-switch' + (props.on ? ' on' : ''),
          onClick: props.onClick,
          title: props.on ? '点击禁用该技能' : '点击启用该技能',
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

        const children = []
        children.push(React.createElement('div', { className: 'apm-hint' },
          '将 git 仓库作为 agent 插件市场：添加后克隆到 .dsh/agent-plugin-market，安装插件即原地加载其技能（兼容 Codex / Claude 的 SKILL.md 格式）。DSH 启动时自动更新各市场。'))

        const refPlaceholder = refType === 'branch' ? '分支名，如 main' : refType === 'tag' ? '标签名，如 v1.0.0' : 'commit id，如 1a2b3c4d'
        children.push(React.createElement('div', { className: 'apm-form' },
          React.createElement('input', {
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
          React.createElement('select', {
            className: 'apm-select',
            value: refType,
            disabled: busy !== null,
            onChange: (e) => setRefType(e.target.value),
          },
            React.createElement('option', { value: 'default' }, '默认分支'),
            React.createElement('option', { value: 'branch' }, '分支'),
            React.createElement('option', { value: 'tag' }, '标签'),
            React.createElement('option', { value: 'commit' }, '提交')),
          refType !== 'default'
            ? React.createElement('input', {
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
              ? React.createElement('span', { className: 'apm-tag', key: 'ref' }, market.refType + ': ' + market.ref)
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
              head.push(React.createElement('span', { className: 'apm-tag', key: 'tag' }, '不支持来源: ' + plugin.sourceType))
            } else {
              head.push(React.createElement('span', { className: 'apm-tag', key: 'tag' }, plugin.skills.length + ' 技能'))
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
            if (plugin.installed) {
              for (const sk of plugin.skills) {
                p.push(React.createElement('div', { className: 'apm-skill', key: sk.name },
                  React.createElement(Switch, {
                    on: sk.enabled,
                    onClick: () => act('skill-' + sk.name, () => apiCall('set-skill-enabled', { fullName: sk.fullName, enabled: !sk.enabled })),
                  }),
                  React.createElement('div', { className: 'apm-skill-info' },
                    React.createElement('div', { className: 'apm-skill-name' }, sk.name),
                    sk.description ? React.createElement('div', { className: 'apm-skill-desc' }, sk.description) : null)))
              }
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
        { name: 'settings.section', id: 'agent-plugin-market', order: 25, label: '插件市场' },
        () => React.createElement(MarketPage),
      ))
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
