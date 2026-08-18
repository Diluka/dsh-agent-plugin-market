# dsh-agent-plugin-market

DSH（DeepSeek Harness）插件市场：将 **git 仓库**作为 agent 内容插件市场，安装并原地加载其中的技能到 DSH 技能系统。

- **兼容格式**：Codex / Claude 的内容插件（`.codex-plugin/plugin.json`、`.claude-plugin/plugin.json`、`SKILL.md` + YAML frontmatter）
- **原地加载**：市场仓库 `git clone` 到 `~/.dsh/agent-plugin-market/markets/<id>/`，安装插件不复制文件，技能路径原地注册进 DSH（`resourceBase` 指向克隆目录，技能内 `references/`、`scripts/` 相对资源可用）
- **技能开关**：每个技能可单独启用/禁用（默认全激活），禁用的技能不进入技能目录
- **设置页 UI**：设置菜单新增「插件市场」页面，管理市场（添加 / 更新 / 移除）与插件（安装 / 卸载 / 技能开关）
- 第一版不处理 hooks，只加载技能

## 安装

```bash
dsh plugin --profile web add github:Diluka/dsh-agent-plugin-market
```

安装完成后**重启 DeepSeek Harness**，设置 → 插件市场 即可使用。

手动等效步骤：

```bash
# 1. 安装依赖
dsh plugin --profile web add github:Diluka/dsh-agent-plugin-market

# 2. 确认组合行（插件包自带 cordis.patch.yml，通常已自动应用）
#    ~/.dsh/profiles/web/cordis.patch.yml 中应有：
#    - insert:
#        - id: dsh-agent-plugin-market
#          name: 'dsh-agent-plugin-market'

# 3. 重启 DeepSeek Harness
```

## 使用

1. **添加市场**：输入任意 git 仓库地址（ssh / https 均可），可选指定**分支 / 标签 / commit id**（默认使用仓库默认分支）；仓库需含市场清单 `marketplace.json`
   （查找顺序：`.agents/plugins/marketplace.json` → `.claude-plugin/marketplace.json` → `.cursor-plugin/marketplace.json` → 仓库根 `marketplace.json`）
2. **安装插件**：市场清单中每个插件一行（`source` 为仓库内路径，或 `{"source": "local", "path": "./"}` 指向仓库根），点击「安装」即原地注册其技能
3. **自动更新**：**DSH 每次启动时自动对全部市场执行 `git pull --ff-only`**（失败不影响启动，仅记录日志）；分支/默认分支市场随更新，**tag/commit 固定引用不自动更新**（「更新」按钮会提示无需更新）
4. **技能开关**：已安装插件下列出全部技能，默认全开；关闭后技能不再出现在 DSH 技能目录

## 市场仓库格式（Codex 兼容）

```text
<market repo>/
├── .agents/plugins/marketplace.json     # 市场清单
└── plugins/<plugin-name>/
    ├── .codex-plugin/plugin.json        # 插件清单（skills 字段，默认 ./skills）
    └── skills/
        └── <skill-name>/
            └── SKILL.md                 # frontmatter: name / description / when_to_use
```

`SKILL.md` 示例：

```markdown
---
name: my-skill
description: 说明何时应触发该技能。
when_to_use: 可选补充。
---

技能正文（Markdown 指令）。
```

## 配置存储

- 市场/插件/技能开关配置：`~/.dsh/agent-plugin-market/config.json`
- 市场克隆目录：`~/.dsh/agent-plugin-market/markets/<id>/`

## 卸载

```bash
dsh plugin --profile web rm dsh-agent-plugin-market
```

并从 `~/.dsh/profiles/web/cordis.patch.yml` 移除对应两行，重启后生效。

## 架构

| 半端 | 文件 | 职责 |
| --- | --- | --- |
| Host | `lib/index.js` | git 市场克隆/更新、清单解析、SKILL.md 扫描、`ctx.skills` provider 注册、RPC 路由（`POST /agent-plugin-market/api/<name>`） |
| Client | `lib/client.js` | 设置页「插件市场」UI（`settings.section` slot），fetch 调用 Host RPC |
