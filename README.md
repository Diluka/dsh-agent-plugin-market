# dsh-agent-plugin-market

DSH（DeepSeek Harness）插件市场：将 Git 仓库作为 agent 内容市场。它克隆市场仓库，按当前作用域启用的插件或显式启用的根 `skills/` 目录发现技能，并通过 DSH 技能 provider 原地提供这些技能。

- **市场与插件清单**：市场清单依次识别 `.agents/plugins/marketplace.json`、`.claude-plugin/marketplace.json`、`.cursor-plugin/marketplace.json`、`.github/plugin/marketplace.json` 和根 `marketplace.json`；插件清单依次识别 `.codex-plugin/plugin.json`、`.claude-plugin/plugin.json` 和根 `plugin.json`。
- **技能生命周期**：已安装插件的有效技能默认启用；市场根 `skills/` 中未被插件引用的独立技能默认关闭，并可单独或按市场批量启用。
- **工作区覆盖**：设置页可在全局默认和已注册工作区之间切换。工作区为插件、插件技能和独立技能保存稀疏的启用/禁用覆盖；缺少覆盖时继承全局配置。
- **代理工具**：注册 `agent_market_info`、`agent_market_set_plugin` 和 `agent_market_set_skill`，让代理查看市场状态并只修改当前工作区覆盖。home 路径会话会被 scoped restriction 隐藏这些工具；若运行时未能隐藏，执行时也会拒绝。
- **原地加载**：安装插件只保存安装状态，不复制市场文件。技能的 `resourceBase` 指向克隆后的技能目录，因此技能内的相对资源可用。
- **Codex hooks（可选）**：从 Codex 插件清单发现 hooks 配置；只有已安装的插件才能启用它们。启用需要设置页的双重确认、配置指纹审批和可用的 `@deepseek-ai/dsh-hooks-codex` bridge。
- **设置页**：设置菜单添加「技能与挂钩」区段，提供市场、插件、技能和 hooks 的管理及目录筛选。

## 安装

```bash
dsh plugin --profile web add github:Diluka/dsh-agent-plugin-market
```

重启 DeepSeek Harness 后，在设置 -> 技能与挂钩中管理市场。包的 `cordis.patch.yml` 将 Host 插件加入 web profile，`package.json` 中的 `dsh.client` 声明加载浏览器端设置页。

`@deepseek-ai/dsh-client-ui-primitives` 是运行时 peer dependency，由 DSH profile 提供。市场与技能功能不依赖 hooks bridge；bridge 缺失时，设置页显示当前运行时的安装命令，并禁用 hooks 开关。Host RPC 以 loopback authority 注册，客户端也会在非本机连接时拒绝显示市场操作，以保护本机 Git 操作和 hooks 执行。代理工具只暴露读取和工作区覆盖写入，不执行市场添加、删除、Git 更新、全局安装/卸载或 hooks 授权。

### 启用 Codex hooks（可选）

需要执行已授权的 Codex hooks 时，按设置页提供的命令在同一 profile 中安装 bridge 及其运行时所需协议包，再重启 DSH：

```bash
dsh plugin --profile web add @deepseek-ai/dsh-hooks-codex @deepseek-ai/dsh-hook-protocol
```

## 使用

1. **添加市场**：输入 SSH 或 HTTPS Git 仓库地址；可选择默认分支、分支、标签或 commit。市场必须提供含 `plugins` 数组的市场清单，或在根 `skills/` 目录中提供至少一个有效的独立技能。
2. **修改市场引用**：已添加市场可随时改为默认分支、指定分支、标签或 commit。保存时会先克隆并校验目标引用，校验通过后替换当前市场 checkout；切回默认分支会删除持久化的 `refType/ref`。
3. **安装插件**：市场清单的每项插件由 `source` 指向市场内的插件目录；未声明 `source` 时使用仓库根目录。字符串 `source` 和 `{"source":"local","path":"<仓库内路径>"}` 都可用；`./` 指向仓库根。`{"source":"url","url":"..."}` 仅在 URL 规范化后等于当前市场仓库时被视为仓库根插件，其他 URL 来源会标记为不支持。所有路径都必须解析在市场根目录内。
4. **更新市场**：Host 启动时会依次对默认分支和分支引用执行 `git pull --ff-only`；失败只记录错误并继续其他市场。标签和 commit 是固定引用，手动或自动更新都会跳过。更新按钮复用相同逻辑。
5. **管理技能**：安装插件后，其有效技能默认进入 DSH 技能目录，可逐项关闭。根 `skills/` 中未被插件引用的技能需要先显式启用，支持逐项或整组切换。
6. **工作区覆盖**：在工作区列表的项目操作菜单中点击「配置插件与技能」打开该工作区的配置弹窗；设置页的「配置作用域」也可切换全局默认或工作区视图。选择工作区后，插件和技能使用三态菜单：继承全局、仅此工作区启用、在此工作区禁用。插件级禁用会屏蔽该插件的所有技能；但对单个技能启用「仅此工作区启用」会独立生效——即使该插件自身继承全局且未安装，该技能仍会在本工作区加载。重置覆盖立即恢复全局值。市场添加、修改引用、更新和移除仍属于全局操作。
7. **管理 hooks**：已安装且声明 Codex hooks 的插件初始未授权。bridge 可用时，第一次点击开关只显示确认，第二次点击才保存当前配置指纹并尝试挂载。授权状态和已挂载状态分别显示。hooks 和其审批在当前版本仍为全局配置。
8. **代理工具**：代理可调用 `agent_market_info` 查看市场、插件、技能、hooks、工作区和当前作用域；可调用 `agent_market_set_plugin` 写入某个插件的工作区三态覆盖；可调用 `agent_market_set_skill` 写入某个技能的工作区三态覆盖。两个写入工具默认使用当前会话 `cwd` 匹配到的工作区，也接受 `workspace_id`；home 路径会话不可使用这些工具。参数和返回作用见 `docs/agent-tools.md`。

市场清单查找顺序如下：

```text
.agents/plugins/marketplace.json
.claude-plugin/marketplace.json
.cursor-plugin/marketplace.json
.github/plugin/marketplace.json
marketplace.json
```

## 市场与技能格式

一个常见的市场布局如下：

```text
<market-repo>/
├── .agents/plugins/marketplace.json
├── plugins/<plugin-name>/
│   ├── .codex-plugin/plugin.json
│   ├── hooks/
│   │   └── hooks.json
│   └── skills/
│       └── <skill-name>/
│           └── SKILL.md
└── skills/
    └── <standalone-skill>/
        └── SKILL.md
```

插件清单的 `skills` 可以是字符串、字符串数组，或含 `paths` 的对象；未声明时默认扫描插件的 `skills` 目录。Awesome Copilot 兼容布局使用 `extensions["com.github.awesome-copilot"].skills`，其中只接受指向市场根 `./skills` 或其子路径的条目。

每个技能源目录只扫描两类直接子项：子目录中的 `SKILL.md`，以及目录自身的直接 `.md` 文件。有效技能必须具有 frontmatter，且至少包含：

```markdown
---
name: my-skill
description: 说明何时应触发该技能。
whenToUse: 可选补充。
---

技能正文（Markdown 指令）。
```

`name` 必须匹配 `[a-z0-9]+(?:-[a-z0-9]+)*`；`description` 不能为空。可选触发说明接受 `whenToUse` 或 `when_to_use`。根 `skills/` 中与某个插件技能同一文件、同一真实文件目标或内容相同的技能不会重复作为独立技能列出。

## Codex hooks

只有 `.codex-plugin/plugin.json` 中的 `hooks` 会形成 Codex hooks 配置。该字段可以省略、写成一个插件根相对 JSON 路径、一个内联 JSON 对象，或由两者组成的数组：

```json
{
  "skills": "./skills",
  "hooks": [
    "./hooks/hooks.json",
    { "hooks": {} }
  ]
}
```

省略 `hooks` 时，插件会尝试读取 `./hooks/hooks.json`。文件路径必须以 `./` 开头、位于插件根目录内、没有 `..`、反斜杠或空路径段，且不能是符号链接；目标必须是包含 JSON 对象的普通文件。内联对象不经过文件读取。

为每份已批准的 hooks 配置生成 bridge 配置前，插件会为 `type: "command"` 或未声明 `type` 的 command 项注入以下环境变量：

- `PLUGIN_ROOT`：插件根目录。
- `PLUGIN_DATA`：该市场插件的持久数据目录。
- `CLAUDE_PLUGIN_ROOT`：`PLUGIN_ROOT` 的兼容别名。
- `CLAUDE_PLUGIN_DATA`：`PLUGIN_DATA` 的兼容别名。

插件会把经验证的配置交给已安装的 Codex bridge。具体支持哪些事件点以及非 command hook 的执行语义由所安装的 bridge 和协议版本决定，不在本插件中硬编码。

审批使用配置来源和内容的 SHA-256 指纹，并在当前 hooks 配置指纹匹配已保存审批时生效。禁用、配置指纹变化、插件卸载和市场移除都会处置已挂载的 hook Fibers；当前 hooks 配置消失或不再是可用对象时也会清除对应审批。市场更新只在 Git 操作期间暂停该市场 hook Fibers，随后重新检查当前配置；更新是否成功不会直接撤销或恢复审批。审批仍有效但 bridge 注册失败时，审批保留，状态显示加载错误。

## 运行时存储

运行时基目录是文件型 DSH settings document 的父目录加上 `agent-plugin-market`。以下以 `<dsh-home>` 表示该父目录：

- 市场、插件、技能开关和 hooks 审批：`<dsh-home>/agent-plugin-market/config.json`
- 市场克隆目录：`<dsh-home>/agent-plugin-market/markets/<id>/`
- 生成的 bridge 配置：`<dsh-home>/agent-plugin-market/generated-hooks/`
- 每个市场插件的 hooks 数据：`<dsh-home>/agent-plugin-market/hook-data/`

每个工作区的覆盖文件是 `<workspace>/.dsh/agent-plugin-market.json`。运行时写入 `version: 1`，以及 `plugins`、`pluginSkills` 和 `standaloneSkills` 三组稀疏布尔覆盖值；没有某个覆盖键时继承全局状态。设置页和代理写入工具都使用同一个工作区覆盖文件。工作区文件可以按团队需要提交到版本控制或加入忽略规则。为避免目录逃逸，`.dsh` 目录和配置文件都不能是符号链接；用户 home 目录本身不作为工作区覆盖根，避免和全局配置目录混用。市场克隆、hooks 和 hooks 审批仍保存在 `<dsh-home>`。

## 卸载

```bash
dsh plugin --profile web rm dsh-agent-plugin-market
```

如果 profile 的 `cordis.patch.yml` 仍保留该包的插入条目，请移除整个 `dsh-agent-plugin-market` 插入条目后重启 DSH。

## 开发与验证

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm test
pnpm typecheck
node --check lib/*.js test/*.test.js
git diff --check
```

- `pnpm lint` 执行 `eslint lib test`；仓库的 ESLint 配置检查 `lib/**/*.js` 和 `test/**/*.js`，并忽略 `test-repos/`。
- `pnpm test` 执行 Node 原生 `node --test`。运行时扫描测试使用 `@platformatic/vfs` 的内存文件系统，并覆盖技能去重中的符号链接场景。
- `pnpm typecheck` 执行 `tsc -p tsconfig.json`，以 JavaScript + JSDoc 检查 `lib/**/*.js`，加载 `types/client-bundle.d.ts`，且不生成输出。

## 架构

| 半端 | 文件 | 职责 |
| --- | --- | --- |
| Host composition root | `lib/index.js` | 注入 DSH 服务，加载可选 bridge，创建 runtime、service 和 hook manager，注册技能 provider 与 loopback RPC。 |
| Host runtime | `lib/market-runtime.js` | 管理全局与工作区配置路径和持久化，解析市场/插件清单，按会话 cwd 扫描与读取有效技能。 |
| Host service | `lib/market-service.js` | 执行市场 Git 生命周期、全局安装状态、工作区覆盖、技能开关、hooks 授权、状态视图和启动自动更新。 |
| Host tools | `lib/market-tools.js` | 注册代理可调用的市场状态读取和工作区插件/技能覆盖工具，并为 home 路径会话做 scoped restriction。 |
| Host config model | `lib/market-config.js` | 纯配置状态转换：市场、插件安装、全局技能开关与工作区覆盖解析。 |
| Host Codex adapter | `lib/codex-hook-manager.js` | 检查 hooks 来源，协调审批，生成 bridge 配置并管理 Fiber 生命周期。 |
| Host hook plan | `lib/hook-reconcile-plan.js` | 纯 desired/active 差异计划，确定处置和挂载顺序。 |
| Host hook helper | `lib/codex-hooks.js` | 解析 hooks 来源和相对路径，计算指纹，生成稳定存储键并注入 command 环境。 |
| Client | `lib/client.js` | 浏览器入口，注册「技能与挂钩」设置页和工作区配置弹窗；文件内拆分目录模型、共享控件与页面实现。 |
| Profile composition | `cordis.patch.yml` | 将双端插件包插入 web profile。 |

Hook 元数据按协议键存入 `hookConfigs`；当前实现只挂载 `codex` 适配器。
