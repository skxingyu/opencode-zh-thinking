---
description: 切换中文模式（思考/回复中文注入开关）
---

用户执行了 /chinese 命令来切换 opencode 中文模式，下面是切换脚本的输出：

!`pwsh -NoProfile -ExecutionPolicy Bypass -File "$HOME/.config/opencode/chinese-mode.ps1" $ARGUMENTS`

请根据上面的输出，用一句简短的中文向用户确认当前中文模式的状态。不要执行任何其他操作，不要输出多余内容。
