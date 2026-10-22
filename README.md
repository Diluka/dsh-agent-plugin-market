<img src="./icon.svg" width="80" height="80" alt="Agent 插件市场图标">

# dsh-agent-plugin-market

DSH（DeepSeek Harness）插件市场：将 Git 仓库作为 agent 内容市场。它克隆市场仓库，按当前作用域中各插件技能和独立技能的实际启用状态，通过 DSH 技能 provider 原地提供这些技能。

- **市场与插件清单**：市场清单依次识别 `.agents/plugins/marketplace.json`、`.claude-plugin/marketplace.json`、`.cursor-plugin/marketplace.json`、`.github/plugin/marketplace.json` 和根 `marketplace.json`；插件清单依次识别 `.codex-plugin/plugin.json`、`.claude-plugin/plugin.json` 和根 `plugin.json`。
- **技能生命周期**：已安装插件的有效技能默认启用；总开关统一开启或关闭该插件的全部技能，单项开关只改变该技能的实际状态。安装/卸载与技能启停独立；全部关闭技能不会卸载插件或改变 hooks 审批。市场根 `skills/` 中未被插件引用的独立技能默认关闭，并可单独或按市场批量启用。
- **工作区覆盖**：设置页可在全局默认和已注册工作区之间切换。工作区仅保存与各技能全局实际生效值不同的布尔覆盖；目标值与全局相同时自动删除该项覆盖，之后继续跟随全局。
- **代理工具**：通过插件配置的「功能」开关控制 `agent_market_info`、`agent_market_set_plugin` 和 `agent_market_set_skill`，让代理查看市场状态并只修改工作区覆盖；支持注入简短工具用法提示词。工具关闭时也停止注入提示词，具体配置见 [代理市场工具](docs/agent-tools.md)。home 路径会话会被 scoped restriction 隐藏这些工具；若运行时未能隐藏，执行时也会拒绝。
- **原地加载**：安装插件只保存安装状态，不复制市场文件。技能的 `resourceBase` 指向克隆后的技能目录，因此技能内的相对资源可用。
- **Codex hooks（可选）**：从 Codex 插件清单发现 hooks 配置；只有已安装的插件才能启用它们。启用需要设置页的双重确认、配置指纹审批和可用的 `@deepseek-ai/dsh-hooks-codex` bridge。
- **管理入口**：工作区列表上方的侧边栏默认显示「技能与挂钩」，打开独立管理面板；设置菜单保留同名区段。两个入口复用相同的市场、插件、技能和 hooks 管理界面及目录筛选。在插件配置的「功能」分组中关闭「在侧边栏显示」可即时隐藏侧边栏入口，不影响设置页或已打开的面板。同一浏览器页面内并存的管理视图会在操作成功后同步刷新，并保留各自的配置作用域。

## 安装

当前开发依赖和 CI 验证版本为 DSH `0.2.1-rc.2`（当前 npm `next` 发布线；`latest` 仍指向较早的 `0.2.0-rc.2` cohort）。Host 显式注入 `webServer`；bundle patch 同时为 `connection` 提供方补充 `webServer`，保留其原有 `webStartup` 依赖。这同时满足自定义 RPC 通道的调用方依赖及新版 Connection getter 的提供方 shadow 上下文检查，仅修改 Host 的注入列表仍会启动失败。

包的 `engines.dsh` 以精确版本 `0.2.1-rc.2` 声明兼容范围：只有该 DSH 运行时通过安装与 profile 启动检查，更低版本不兼容，更高版本也未声明兼容。插件自身版本使用普通 SemVer（不携带 DSH 目标后缀）；适配新的 DSH 版本时，需要同时更新 `engines.dsh`、开发依赖、CI 目标并重新验证。

在 DSH Web 侧边栏「插件」中添加并安装 `dsh-agent-plugin-market` bundle。安装后从工作区列表上方的「技能与挂钩」或设置页同名区段管理市场。包的 `cordis.patch.yml` 将 Host 插件加入 web profile，`package.json` 中的 `dsh.client` 声明加载浏览器端设置页。

`@deepseek-ai/dsh-client-ui-primitives`、`@deepseek-ai/dsh-home-paths` 和 `@deepseek-ai/schemastery` 是运行时 peer dependencies，由 DSH 运行环境提供。侧边栏显示、工具与提示词开关保存在 `dsh-agent-plugin-market` profile entry 的 volatile Config fields 中，通过 DSH Config Forms 即时编辑，并以内联方式显示在插件 bundle 详情页的「Agent 插件市场 → 功能」分组；`showInSidebar` 默认 `true`，与 `tools`、`systemPrompt` 独立。市场与技能功能不依赖 hooks bridge；bridge 缺失时，设置页显示通过 profile 依赖安装所需包的命令，并禁用 hooks 开关。Host RPC 使用 DSH `0.2.1-rc.2` 的 Connection 通道，由运行时统一执行 Host/Origin 校验和浏览器会话 token 认证；通过认证的本机或网络 Web 页面都可管理 Host 上的市场、Git checkout 和 hooks。代理工具只暴露读取和工作区覆盖写入，不执行市场添加、删除、Git 更新、全局安装/卸载或 hooks 授权。

### 启用 Codex hooks（可选）

官方 DSH CLI `0.2.1-rc.2` 已包含 Codex bridge；可用不代表 hooks 已授权，仍需设置页的双重确认。对于不含 bridge 的自定义部署，在运行于目标 profile 的 DSH shell 中执行以下命令，再重启 DSH。bridge 是可选的运行时依赖，不是可从侧边栏「插件」独立安装或加入 profile bundle 列表的 bundle：

```bash
pnpm --dir "$DSH_PROFILE_DIR" add @deepseek-ai/dsh-hooks-codex@0.2.1-rc.2 @deepseek-ai/dsh-hook-protocol@0.2.1-rc.2
```

## 使用

1. **添加市场**：输入 SSH 或 HTTPS Git 仓库地址；可选择默认分支、分支、标签或 commit。市场必须提供含 `plugins` 数组的市场清单，或在根 `skills/` 目录中提供至少一个有效的独立技能。
2. **修改市场引用**：已添加市场可随时改为默认分支、指定分支、标签或 commit。保存时会先克隆并校验目标引用，校验通过后替换当前市场 checkout；切回默认分支会删除持久化的 `refType/ref`。
3. **安装插件**：市场清单的每项插件由 `source` 指向市场内的插件目录；未声明 `source` 时使用仓库根目录。字符串 `source` 和 `{"source":"local","path":"<仓库内路径>"}` 都可用；`./` 指向仓库根。`{"source":"url","url":"..."}` 仅在 URL 规范化后等于当前市场仓库时被视为仓库根插件，其他 URL 来源会标记为不支持。所有路径都必须解析在市场根目录内。
4. **更新市场**：Host 启动时会依次对默认分支和分支引用执行 `git pull --ff-only`；失败只记录错误并继续其他市场。标签和 commit 是固定引用，手动或自动更新都会跳过。更新按钮复用相同逻辑。
5. **管理技能**：全局和工作区使用同款技能开关，直接显示当前作用域的实际状态。插件技能总控使用复选框，显示「全部启用／部分启用／全部关闭」和启用数量 `n/m`；半选表示只有部分技能开启。点击总控会将该插件全部技能统一设为开或关，单项操作只改变自身，其他技能的实际状态不变。全局切换插件技能前需要先安装；「安装插件／卸载插件」是独立的全局资源按钮，不是技能总控。全部关闭技能后插件仍已安装，单项和总控仍可操作，也不会改动 hooks 审批或挂载。根 `skills/` 中未被插件引用的技能需要显式启用，支持逐项或整组切换。
6. **工作区覆盖**：在工作区列表的项目操作菜单中点击「配置插件与技能」打开该工作区的配置弹窗；设置页的「配置作用域」也可切换全局默认或工作区视图。工作区技能以只读、中性色 Pill 小标记显示「继承／覆盖」：有自身布尔覆盖，或受插件旧父级布尔覆盖影响时显示「覆盖」，否则显示「继承」。技能组没有覆盖时标记「继承」，仅部分子项有覆盖时标记「部分覆盖」，全部子项有覆盖或存在旧父级布尔覆盖时标记「覆盖」。全局没有上级，不显示来源标记。这些标记只说明来源，与开关实际状态、总控半选及 `n/m` 独立，不是恢复或切换操作。工作区目标值与该技能全局实际生效值相同时，自动删除本地覆盖，之后全局继续接管；只有不同的值才保存覆盖，整组全部匹配时清除该组覆盖。UI 不提供「恢复默认」或「全部恢复默认」按钮。旧父级覆盖会在技能组或单项操作时被规范化；单项操作先保留其他技能当前实际状态，再只更改目标，不会恢复被父级隐藏的旧偏好。单个技能也可在插件未全局安装时独立开启，不改变全局安装状态。市场添加、修改引用、更新和移除仍属于全局操作。
7. **管理 hooks**：已安装且声明 Codex hooks 的插件初始未授权。bridge 可用时，第一次点击开关只显示确认，第二次点击才保存当前配置指纹并尝试挂载。授权状态和已挂载状态分别显示。hooks 和其审批在当前版本仍为全局配置，不因全部关闭技能而被隐藏或禁用。
8. **代理工具**：代理可调用 `agent_market_info` 查看市场、资源安装状态、技能组的全开／部分／全关状态、技能明细、hooks、工作区和当前作用域；可调用 `agent_market_set_plugin` 统一设置某个插件的工作区全部技能；可调用 `agent_market_set_skill` 只设置某个技能。两个写入工具默认使用当前会话 `cwd` 匹配到的工作区，也接受 `workspace_id`；`enabled/disabled` 指定目标实际值，不保证保留显式覆盖，`inherit` 作为高级工具/API 操作仍兼容。home 路径会话不可使用这些工具。参数和返回作用见[代理市场工具](<docs/agent-tools.md>)。

管理页面将操作绑定到已加载且与当前选择匹配的作用域快照。同一作用域内保存后就地刷新，不卸载目录，保留滚动位置、筛选和展开状态；刷新失败时保留上次内容并提供重试，但禁用过期数据的写入。真正切换作用域后，在对应快照加载完成前不会展示旧作用域的可写控件；加载失败可以重试。旧作用域或乱序返回的读取不能覆盖新的作用域快照，也不能让写入前的旧状态盖掉写入后的显示；页面卸载后不再接受未完成请求的结果。

插件状态按当前作用域的实际子技能聚合：`activationState` 为 `enabled`（全开）、`partial`（部分开启）或 `disabled`（全关，零技能也为全关）；`enabled` 只表示至少一个子技能开启，`installed` 独立表示全局资源已安装。同名且受支持的多个清单来源共享一个插件控制，合并技能并按全名去重。插件技能组批量启停与工作区插件技能单项修改都先严格完整扫描该组来源，目录缺失、越界或读取失败时拒绝保存，不产生父级或部分子项修改。

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

审批使用配置来源和内容的 SHA-256 指纹，并在当前 hooks 配置指纹匹配已保存审批时生效。禁用 hooks、配置指纹变化、插件卸载和市场移除都会处置已挂载的 hook Fibers；当前 hooks 配置消失或不再是可用对象时也会清除对应审批。市场更新只在 Git 操作期间暂停该市场 hook Fibers，随后重新检查当前配置；更新是否成功不会直接撤销或恢复审批。审批仍有效但 bridge 注册失败时，审批保留，状态显示加载错误。

## 运行时存储

运行时基目录是 `@deepseek-ai/dsh-home-paths` 根据 `$DSH_HOME` 或默认 `~/.dsh` 解析的 DSH home，再追加 `agent-plugin-market`。以下以 `<dsh-home>` 表示该解析结果：

- 市场、插件、技能开关和 hooks 审批：`<dsh-home>/agent-plugin-market/config.json`
- 市场克隆目录：`<dsh-home>/agent-plugin-market/markets/<id>/`
- 生成的 bridge 配置：`<dsh-home>/agent-plugin-market/generated-hooks/`
- 每个市场插件的 hooks 数据：`<dsh-home>/agent-plugin-market/hook-data/`

Host 写入全局配置时显式使用以 `agent-plugin-market` 为边界的 `workspace-write` 策略；写入生成的 bridge 配置时以 `generated-hooks` 为边界。这些插件自有状态写入不依赖某个代理会话的工作目录，也不提升会话权限。沙盒文件系统仍会校验解析后的目标，拒绝超出可写根集合的符号链接；该集合包括对应存储目录及 DSH 允许的平台临时目录。

每个工作区的覆盖文件是 `<workspace>/.dsh/agent-plugin-market.json`。运行时写入 `version: 1`，并保留 `plugins`、`pluginSkills` 和 `standaloneSkills` 三组布尔覆盖的读取兼容性。当前插件总控与单项操作不再写入 `plugins` 父级覆盖，而是在完整校验插件技能组后移除该插件旧父/子覆盖，按各技能与全局实际生效值的差异重建 `pluginSkills`；独立技能同样在与全局相等时删除 `standaloneSkills` 的对应键。未安装插件的全局实际技能值为关闭，而非仅看技能自身的全局禁用标记。没有覆盖的项继续跟随以后全局的变化；旧父级及隐藏子项偏好不会在规范化时意外启用其他技能。高级 `inherit` 和清空工作区覆盖 API 仍保留，不对应 UI 恢复按钮。

设置页和代理写入工具都使用同一个工作区覆盖文件。工作区文件可以按团队需要提交到版本控制或加入忽略规则。为避免目录逃逸，`.dsh` 目录和配置文件都不能是符号链接；用户 home 目录本身不作为工作区覆盖根，避免和全局配置目录混用。市场克隆、hooks 和 hooks 审批仍保存在 `<dsh-home>`。

## 卸载

在 DSH Web 侧边栏「插件」中卸载 `dsh-agent-plugin-market` bundle。如果 profile 的自定义 `cordis.patch.yml` 仍保留该包的插入条目，请移除该条目后重启 DSH。

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
- CI 启动检查用 `.github/pin-dsh.cjs` 将 CLI 与 profile 子安装中的 DSH 依赖统一到 `DSH_VERSION`，同时固定已验证的 Cordis 配套版本，并使用独立缓存。DSH `0.2.1-rc.2` 已精确声明其 DSH 依赖；版本一致性测试校验 `engines.dsh`、开发依赖与 CI 目标指向同一精确运行时，同时仍需固定本插件的通配 peer 和框架 patch 范围，避免 smoke 安装漂移。Smoke job 按当前 DSH CLI 通过 pnpm 准备临时 profile 并应用包内的 Cordis patch。矩阵只区分 profile 是否显式安装 hooks 依赖；CLI 已自带 bridge，因此不代表运行时真正缺少 bridge。hook manager 在 bridge 不可用时的降级由 Node 测试覆盖。升级 CI 目标版本时需一并核验 CLI 与框架配套契约。

## 架构

| 半端 | 文件 | 职责 |
| --- | --- | --- |
| Host composition root | `lib/index.js` | 注入 DSH 服务，加载可选 bridge，创建 runtime、service 和 hook manager，注册技能 provider 与统一认证 RPC。 |
| Host runtime | `lib/market-runtime.js` | 管理全局与工作区配置路径和持久化，解析市场/插件清单，按会话 cwd 扫描与读取有效技能。 |
| Host service | `lib/market-service.js` | 执行市场 Git 生命周期、全局安装状态、工作区覆盖、技能开关、hooks 授权、状态视图和启动自动更新。 |
| Host features | `lib/market-features.js` | 注册 DSH 功能设置，按开关管理工具和简短系统提示词的生命周期。 |
| Host tools | `lib/market-tools.js` | 定义市场状态读取、工作区插件/技能覆盖工具及其用法提示，并为 home 路径会话做 scoped restriction。 |
| Host config model | `lib/market-config.js` | 纯配置状态转换：市场、插件安装、全局技能开关与工作区覆盖解析。 |
| Host Codex adapter | `lib/codex-hook-manager.js` | 检查 hooks 来源，协调审批，生成 bridge 配置并管理 Fiber 生命周期。 |
| Host hook plan | `lib/hook-reconcile-plan.js` | 纯 desired/active 差异计划，确定处置和挂载顺序。 |
| Host hook helper | `lib/codex-hooks.js` | 解析 hooks 来源和相对路径，计算指纹，生成稳定存储键并注入 command 环境。 |
| Client | `lib/client.js` | 浏览器入口，注册插件「功能」配置、可配置显示的「技能与挂钩」侧边栏面板、复用同一页面的设置区段和工作区配置弹窗；文件内拆分目录模型、共享控件与页面实现。 |
| Profile composition | `cordis.patch.yml` | 将双端插件包插入 web profile。 |

Hook 元数据按协议键存入 `hookConfigs`；当前实现只挂载 `codex` 适配器。
