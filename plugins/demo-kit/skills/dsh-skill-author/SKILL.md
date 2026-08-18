---
name: dsh-skill-author
description: 为 DSH 编写 agent 技能（SKILL.md）时使用。覆盖技能目录布局、frontmatter 字段、正文写作要点与渐进式披露（progressive disclosure）规范。
when_to_use: 当用户要求新建、修改或评审一个 DSH / Codex / Claude 风格的技能文件，或询问技能格式规范时。
---

# DSH Agent Skill 编写指南

DSH 的技能格式与 OpenAI Codex / Claude Code 的 Agent Skills 标准兼容。

## 目录布局

一个技能是一个目录，目录内必须有 `SKILL.md`：

```text
skills/
  <skill-name>/
    SKILL.md
    references/   # 可选：补充文档
    scripts/      # 可选：可执行辅助脚本
    assets/       # 可选：模板或静态资源
```

技能目录内相对路径的资源（`references/`、`scripts/` 等）在技能加载后仍可访问。

## frontmatter 字段

`SKILL.md` 以 YAML frontmatter 开头，`name` 与 `description` 为必填：

```markdown
---
name: my-skill
description: 说明何时应触发该技能（触发条件，而非营销文案）。
when_to_use: 可选：更详细的使用场景说明。
---
```

- `name`：kebab-case（小写字母、数字、连字符），是技能的唯一标识。
- `description`：技能触发面，是模型判断"该不该用"的依据，必须写成精确的触发条件。
- `when_to_use`：可选补充说明，随目录信息一起展示。

## 正文写作要点

- 正文是模型激活技能后要遵循的指令，使用 Markdown。
- 保持每个技能聚焦单一职责；指令明确、可执行。
- 需要引用外部资料时，把文档放入 `references/` 并给出相对路径引用，避免正文过长（渐进式披露）。

## 分发

技能以插件（plugin）为单位分发：插件目录含 `skills/` 子目录，插件清单为 `.codex-plugin/plugin.json`（也兼容 `.claude-plugin/plugin.json`）。多个插件经插件市场（git 仓库 + `marketplace.json`）分发与安装。
