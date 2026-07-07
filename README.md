# OpenCode 中文思考 (opencode-zh-thinking)

自用，能够尽量保证中文思考

让 OpenCode AI 编程助手**全程使用简体中文进行思考、分析、规划和回复**，同时集成 **superpowers-zh** 技能系统实现专业工作流编排。

## 解决的问题

OpenCode 默认的 system prompt 是英文的，当工具返回大量英文结果时，AI 的**内部思考过程**容易切换到英文。这个配置包通过三层防护机制，强制 AI 保持中文思考。

## 三层防护机制

```
┌─────────────────────────────────────────────┐
│  第一层：替换系统提示词 (prompt)              │
│  build-zh.txt / compose-zh.md               │
│  用全中文提示词替换默认英文                   │
├─────────────────────────────────────────────┤
│  第二层：强化 instructions (AGENTS.md)         │
│  正反示例 + 思考规则 + 警示框                  │
├─────────────────────────────────────────────┤
│  第三层：后置补充指令                          │
│  workflow.md                                 │
│  专门针对工具调用后的语言切换问题                │
└─────────────────────────────────────────────┘
```

## 集成 superpowers-zh

compose agent 基于 [superpowers-zh](https://github.com/jnMetaCode/superpowers-zh) 技能系统（obra/superpowers 的中文增强 fork），提供专业工作流编排能力：

| 技能 | 场景 |
|------|------|
| brainstorming | 开始新任务时先头脑风暴，评估方案 |
| writing-plans / executing-plans | 多步骤任务的规划与执行 |
| systematic-debugging | 结构化 Bug 修复流程 |
| test-driven-development | 测试驱动开发纪律 |
| chinese-code-review | 中文项目的代码审查规范 |
| chinese-commit-conventions | 中文 commit message 规范 |
| chinese-documentation | 中文技术文档写作 |
| chinese-git-workflow | Gitee/Coding 等平台适配 |
| mcp-builder | MCP 服务器构建 |
| dispatching-parallel-agents | 并行子 agent 编排 |
| verification-before-completion | 完成前验证清单 |

技能系统通过 OpenCode 的 `plugin` 机制自动加载和注册。

## 文件说明

```
opencode-zh-thinking/
├── README.md                   # 本文件
├── opencode.json.example       # 仅含语言 + superpowers-zh 插件的配置示例
├── AGENTS.md                   # 全局指令：语言要求 + 任务委托
├── instructions/
│   └── workflow.md             # 工具调用后的语言保持规则
└── prompts/
    ├── compose-zh.md           # compose 模式提示词（含 superpowers-zh 工作流）
    └── build-zh.txt            # build 模式完整中文翻译版
```

不包含任何 provider 或个人 MCP 配置——你可以按需集成到自己的配置中。

## 快速开始

### 1. 复制配置文件

```bash
# 将配置复制到 opencode 配置目录
cp AGENTS.md ~/.config/opencode/
cp instructions/workflow.md ~/.config/opencode/instructions/
cp prompts/compose-zh.md ~/.config/opencode/prompts/
cp prompts/build-zh.txt ~/.config/opencode/prompts/
```

### 2. 合并到你现有的 opencode.json

将以下内容合并到你现有的 `~/.config/opencode/opencode.json` 中：

```json
{
  "default_agent": "build-zh",
  "agent": {
    "build-zh": {
      "description": "默认工作模式的中文版",
      "mode": "primary",
      "prompt": "（将 prompts/build-zh.txt 的全部内容粘贴到此）"
    },
    "compose": {
      "color": "#a7a3d8",
      "description": "基于 superpowers-zh 的 Compose 编排模式",
      "mode": "primary",
      "prompt": "（将 prompts/compose-zh.md 的全部内容粘贴到此）"
    }
  },
  "plugin": [
    "superpowers@git+https://github.com/jnMetaCode/superpowers-zh.git"
  ],
  "instructions": [
    "~/.config/opencode/AGENTS.md",
    "~/.config/opencode/instructions/workflow.md"
  ]
}
```

### 3. 使用方式

```bash
# 默认（build-zh 模式）
opencode

# Compose 编排模式（带 superpowers-zh 技能）
opencode --agent compose
```

### 4. 在 OpenCode 中使用技能

```bash
# 列出可用技能
skill

# 加载技能
skill "superpowers:brainstorming"
skill "superpowers:chinese-code-review"
```

## 原理说明

OpenCode 的系统提示词按以下顺序组装：

1. **Header** — provider 简短标识（英文）
2. **Agent/Provider Instructions** — 被 `build-zh.prompt` 替换为中文
3. **Environment Context** — 系统信息（英文）
4. **Custom Instructions** — AGENTS.md + workflow.md

传统方法（如只修改 AGENTS.md）只能在第 4 层追加中文指令，但第 2 层的英文 prompt 仍然在开头。本方案通过**替换第 2 层为全中文**，从根源上解决了语言切换问题。

## 许可证

MIT
