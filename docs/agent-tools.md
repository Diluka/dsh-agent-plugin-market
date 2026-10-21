# 代理市场工具

`dsh-agent-plugin-market` 注册三个模型可调用工具，让代理读取市场状态，并管理工作区的技能实际启用状态：插件总控统一设置该插件全部技能，单项操作只设置自身。工具定义在[market-tools.js](<../lib/market-tools.js>)，复用[market-service.js](<../lib/market-service.js>) 的状态和写入逻辑，与 UI 使用同一套业务方法。

## 功能配置

在「设置 → 插件 → 插件配置 → Agent 插件市场」中展开「功能」分组：

- **在侧边栏显示**：默认开启，控制工作区列表上方的「技能与挂钩」入口；关闭仅隐藏入口，不影响设置页、已打开的管理面板、技能、hooks 或代理工具。
- **启用工具**：默认开启，控制三个代理市场工具的注册；关闭后，市场管理、技能加载和 hooks 仍可使用。
- **注入系统提示词**：默认开启，可单独关闭。工具未启用时默认也禁用注入，即使保留此项的开启偏好，也不会注入工具说明；home 路径会话同样不注入。

设置由 DSH 的 `dsh-agent-plugin-market` profile entry 保存并实时生效，配置键为 `showInSidebar`、`tools` 和 `systemPrompt`。侧边栏入口和设置页复用同一管理页面；显示偏好不参与工具或提示词的注册生命周期。提示词简要引导代理先查询实际状态和精确标识，并说明工作区目标值与全局实际值相同时自动继承，以及工具不可越过的全局写入与授权边界。它不包含市场清单或技能正文。

## 作用域与安全边界

- 工具默认用当前代理会话的 `cwd` 匹配已注册工作区，并读取或写入该工作区的 `.dsh/agent-plugin-market.json` 覆盖文件。
- `workspace_id` 可显式指定目标工作区；该 ID 来自 `agent_market_info` 返回的 `workspaces` 列表。
- home 路径会话不支持这些工具：运行时会尽量通过 scoped restriction 隐藏它们；如果当前 DSH 版本未能动态隐藏，执行时也会报错并拒绝操作。
- 写入工具只修改工作区覆盖，不添加、删除或更新市场，不安装或卸载全局插件，不修改全局技能开关，不授权 hooks。
- `mode` 枚举保持 `inherit` / `enabled` / `disabled`。`enabled/disabled` 指定工作区的目标实际值，而不是要求一定保存显式覆盖：目标等于该项全局**实际生效值**时删除本地键，之后继续跟随全局；只有不同的值才保存布尔覆盖。全局未安装插件时，其技能的全局实际值均为关闭。
- 插件工具的 `enabled/disabled` 统一设置该插件全部技能；单技能工具只改变目标实际状态，其他技能的实际状态不变。`inherit` 是兼容保留的高级操作：插件级清除该插件全部父/子覆盖，技能级使该项回到全局实际值，同时保持兄弟技能当前实际状态。
- 全局和工作区 UI 使用同款技能开关：总控复选框的半选表示 `partial`，并显示启用数量 `n/m`；安装/卸载是独立的全局资源按钮。工作区另以只读、中性色 Pill 标记来源：技能自身有布尔覆盖，或插件有旧父级布尔覆盖时为「覆盖」，否则为「继承」；技能组无覆盖为「继承」，部分子项有覆盖为「部分覆盖」，全部子项有覆盖或存在旧父级布尔覆盖时为「覆盖」。全局没有上级，不显示来源标记。标记不参与启停，不是可点击的恢复操作；UI 不提供「恢复默认」或「全部恢复默认」按钮，高级 `inherit` 与清空覆盖 API 仍存在。全部关闭技能不会卸载插件，也不会改变 hooks 审批或挂载。
- UI 操作只使用已加载且与当前选择匹配的作用域快照。同一作用域内保存后保留已挂载目录并就地刷新，滚动、筛选与展开状态不重置；刷新失败时展示上次内容及重试入口，过期快照保持只读。真正切换作用域后，新快照未加载完成时不展示旧快照的可写控件；失败可重试。旧作用域或乱序读取结果不得替换新作用域或写入后的显示，页面卸载后也不接受旧请求结果。这是 Client 的异步安全边界，不改变工具的工作区定位或写入权限。

## 工具清单

| 工具名 | 作用 | 写入范围 |
| --- | --- | --- |
| `agent_market_info` | 查看市场、插件、技能、hooks、工作区列表和当前作用域。 | 只读 |
| `agent_market_set_plugin` | 统一开启或关闭目标插件的全部技能；高级 `inherit` 清除该组覆盖。 | `<workspace>/.dsh/agent-plugin-market.json` 的 `pluginSkills`，并清除此插件旧 `plugins` 父级覆盖 |
| `agent_market_set_skill` | 只设置目标技能的实际状态，其他技能保持原实际状态。 | `<workspace>/.dsh/agent-plugin-market.json` 的 `pluginSkills`（规范化旧父级覆盖）或 `standaloneSkills` |

## `agent_market_info`

查看代理当前可见的市场信息。省略 `workspace_id` 时，如果当前 `cwd` 能匹配已注册工作区，返回该工作区作用域；匹配不到时返回全局视图。

| 参数 | 必填 | 取值 | 作用 |
| --- | --- | --- | --- |
| `workspace_id` | 否 | 工作区 ID | 指定要查看的工作区作用域。 |

返回内容包含：

- `scope`：当前返回的是 `global` 还是某个 `workspace`，工作区作用域还包含覆盖数量。
- `workspaces`：可配置的工作区列表，home 路径已过滤。
- `markets`：市场 ID、仓库、引用类型、manifest 状态、插件、独立技能。
- `plugins`：`installed` 独立表示全局资源是否安装；`activationState` 按当前作用域实际子技能聚合为 `enabled`（全开）、`partial`（部分开启）或 `disabled`（全关，零技能也为全关）。`enabled` 只表示至少一个子技能为开，不能据此把 `partial` 报成全开。同名且受支持的多个来源合并为一个插件视图，按技能全名去重。还包含旧父级覆盖、技能列表和全局 hooks 状态。
- `skills`：技能全名、描述、全局实际生效值、工作区子项覆盖和当前作用域实际状态。

工具的文本输出优先采用 `activationState`，附带实际技能数量 `n/m` 和独立的安装状态；兼容缺少该字段的旧视图时按子技能计数推导。`parentOverride` 只展示兼容的旧父级键，不代表整个技能组是否继承；每项 `override=inherit` 仅表示未保存该技能自身的本地覆盖。UI 的工作区来源标记还会考虑旧父级布尔覆盖，因此子项没有覆盖但父级有覆盖时仍显示「覆盖」。来源与启停是两个独立维度：「继承」的技能可为开或关，「部分覆盖」也不等同于技能启停的 `partial`。

示例参数：

```json
{}
```

```json
{ "workspace_id": "workspace-id" }
```

## `agent_market_set_plugin`

统一设置某个市场插件在目标工作区中的全部技能：`enabled` 全开，`disabled` 全关，不受之前各单项设置影响，也不会安装或卸载资源。服务严格完整扫描共享插件 key 的所有受支持来源后，在一次工作区保存中清除旧父级和子项覆盖，再逐项与全局实际值比较，仅保存差异；整组全部匹配全局时清除该组所有覆盖。目录缺失、越界或读取失败时不保存任何部分修改。高级 `inherit` 直接清除该插件全部父/子覆盖，让整组回到全局。其他插件、独立技能和其他工作区不受影响。

| 参数 | 必填 | 取值 | 作用 |
| --- | --- | --- | --- |
| `market_id` | 是 | 市场 ID | 目标市场，来自 `agent_market_info` 的 `markets[].id`。 |
| `plugin_name` | 是 | 插件名 | 目标插件，来自 `agent_market_info` 的 `markets[].plugins[].name`。 |
| `mode` | 是 | `inherit` / `enabled` / `disabled` | `enabled` 全开；`disabled` 全关；`inherit` 清除此插件全部父/子覆盖。 |
| `workspace_id` | 否 | 工作区 ID | 指定目标工作区；省略时使用当前会话 `cwd` 匹配。 |

示例参数：

```json
{
  "market_id": "market-id",
  "plugin_name": "plugin-name",
  "mode": "disabled"
}
```

```json
{
  "workspace_id": "workspace-id",
  "market_id": "market-id",
  "plugin_name": "plugin-name",
  "mode": "inherit"
}
```

## `agent_market_set_skill`

只设置某个市场技能在目标工作区中的实际启用状态。工具根据 `full_name` 自动判断目标是插件技能还是独立技能。插件技能操作会严格扫描共享 key 的完整技能组，先记录每项当前实际状态，仅替换目标值（`inherit` 使用其全局实际值），再移除旧父级覆盖，按与全局实际值的差异重建子项覆盖；兄弟技能保持原实际状态，不恢复被旧父级隐藏的启用偏好。目录无法完整扫描时不保存；拒绝保存时不留下父级或子项的预修改。独立技能同样仅在目标值不同于全局时保留覆盖。插件未全局安装时也可独立开启单个技能。全局安装、全局技能、hooks 审批和其他工作区均不受影响。

| 参数 | 必填 | 取值 | 作用 |
| --- | --- | --- | --- |
| `full_name` | 是 | 技能全名 | 目标技能，来自 `agent_market_info` 的技能列表，例如 `market/plugin/skill` 或 `market/standalone-skills/skill`。 |
| `mode` | 是 | `inherit` / `enabled` / `disabled` | 开启、关闭或使用此项全局实际值；相等时自动删除覆盖。 |
| `workspace_id` | 否 | 工作区 ID | 指定目标工作区；省略时使用当前会话 `cwd` 匹配。 |

示例参数：

```json
{
  "full_name": "market-id/plugin-name/skill-name",
  "mode": "enabled"
}
```

```json
{
  "workspace_id": "workspace-id",
  "full_name": "market-id/standalone-skills/skill-name",
  "mode": "disabled"
}
```
