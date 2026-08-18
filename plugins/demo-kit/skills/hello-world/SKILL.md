---
name: hello-world
description: 一个最简示例技能。当用户想验证 DSH 插件市场的技能加载链路是否工作（例如安装插件后检查技能是否生效）时使用。
---

# Hello World

这是一个从 DSH 插件市场安装并原地加载的示例技能。

如果模型正在阅读本技能，说明插件市场的完整链路已经打通：

1. git 仓库被识别为插件市场（`marketplace.json`）；
2. 插件已安装（`demo-kit`，含 `.codex-plugin/plugin.json`）；
3. `skills/` 目录下的技能被扫描并注册进 DSH 技能系统；
4. 模型通过 `skill` 工具按需加载了本技能。

请向用户确认：技能加载成功，市场链路可用。
