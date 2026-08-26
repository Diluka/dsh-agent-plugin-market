# 代理市场工具

`dsh-agent-plugin-market` 注册三组模型可调用工具，让代理读取市场状态，并管理当前工作区的插件与技能覆盖。工具定义在 `lib/market-tools.js`，复用 `lib/market-service.js` 的状态和写入逻辑。

## 作用域与安全边界

- 工具默认用当前代理会话的 `cwd` 匹配已注册工作区，并读取或写入该工作区的 `.dsh/agent-plugin-market.json` 覆盖文件。
- `workspace_id` 可显式指定目标工作区；该 ID 来自 `agent_market_info` 返回的 `workspaces` 列表。
- home 路径会话不支持这些工具：运行时会尽量通过 scoped restriction 隐藏它们；如果当前 DSH 版本未能动态隐藏，执行时也会报错并拒绝操作。
- 写入工具只修改工作区覆盖，不添加、删除或更新市场，不安装或卸载全局插件，不修改全局技能开关，不授权 hooks。
- 三态 `mode` 的含义固定为：`inherit` 继承全局状态，`enabled` 仅此工作区启用，`disabled` 在此工作区禁用。

## 工具清单

| 工具名 | 作用 | 写入范围 |
| --- | --- | --- |
| `agent_market_info` | 查看市场、插件、技能、hooks、工作区列表和当前作用域。 | 只读 |
| `agent_market_set_plugin` | 设置当前工作区中某个市场插件的三态覆盖。 | `<workspace>/.dsh/agent-plugin-market.json` 的 `plugins` |
| `agent_market_set_skill` | 设置当前工作区中某个市场技能的三态覆盖。 | `<workspace>/.dsh/agent-plugin-market.json` 的 `pluginSkills` 或 `standaloneSkills` |

## `agent_market_info`

查看代理当前可见的市场信息。省略 `workspace_id` 时，如果当前 `cwd` 能匹配已注册工作区，返回该工作区作用域；匹配不到时返回全局视图。

| 参数 | 必填 | 取值 | 作用 |
| --- | --- | --- | --- |
| `workspace_id` | 否 | 工作区 ID | 指定要查看的工作区作用域。 |

返回内容包含：

- `scope`：当前返回的是 `global` 还是某个 `workspace`，工作区作用域还包含覆盖数量。
- `workspaces`：可配置的工作区列表，home 路径已过滤。
- `markets`：市场 ID、仓库、引用类型、manifest 状态、插件、独立技能。
- `plugins`：插件安装状态、有效状态、工作区覆盖、技能列表和 hooks 状态。
- `skills`：技能全名、描述、全局状态、工作区覆盖和有效状态。

示例参数：

```json
{}
```

```json
{ "workspace_id": "workspace-id" }
```

## `agent_market_set_plugin`

设置某个市场插件在当前工作区中的启用模式。插件级 `disabled` 会让该插件下所有技能在该工作区失效。

| 参数 | 必填 | 取值 | 作用 |
| --- | --- | --- | --- |
| `market_id` | 是 | 市场 ID | 目标市场，来自 `agent_market_info` 的 `markets[].id`。 |
| `plugin_name` | 是 | 插件名 | 目标插件，来自 `agent_market_info` 的 `markets[].plugins[].name`。 |
| `mode` | 是 | `inherit` / `enabled` / `disabled` | 写入插件的工作区三态覆盖。 |
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

设置某个市场技能在当前工作区中的启用模式。工具会根据 `full_name` 自动判断目标是插件技能还是独立技能，并写入对应覆盖组。

| 参数 | 必填 | 取值 | 作用 |
| --- | --- | --- | --- |
| `full_name` | 是 | 技能全名 | 目标技能，来自 `agent_market_info` 的技能列表，例如 `market/plugin/skill` 或 `market/standalone-skills/skill`。 |
| `mode` | 是 | `inherit` / `enabled` / `disabled` | 写入技能的工作区三态覆盖。 |
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
