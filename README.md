# OpenCode 中文思考 (opencode-zh-thinking)

自用，能够尽量保证中文思考

让 OpenCode AI 编程助手**全程使用简体中文进行思考、分析、规划和回复**，即使在大量英文内容注入后也能保持中文。

## 解决的问题

OpenCode 默认的 system prompt 是英文的（`default.txt`），当工具返回大量英文结果时，AI 的**内部思考过程**容易切换到英文。这个配置包通过三层防护机制，强制 AI 保持中文思考。

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

## 包含的 agent

| Agent | 说明 | 启动方式 |
|-------|------|---------|
| `build-zh` | 默认工作模式，原生 build 的中文版 | `opencode --agent build-zh` 或设为默认 |
| `compose` | Compose 编排模式的中文版 | `opencode --agent compose` |

两个 agent 的功能与原生版本完全一致，唯一区别是语言从英文改为中文。

## 文件说明

```
opencode-zh-thinking/
├── README.md                   # 本文件
├── opencode.json.example       # 仅含语言相关配置的示例
├── AGENTS.md                   # 全局指令：语言要求 + 任务委托
├── instructions/
│   └── workflow.md             # 工具调用后的语言保持规则
└── prompts/
    ├── compose-zh.md           # compose 模式中文提示词
    └── build-zh.txt            # build 模式完整中文翻译版
```

不包含任何 provider、MCP server 或个人配置——你可以按需集成到自己的配置中。

## 快速开始

### 1. 复制配置文件

```bash
# 将配置复制到 opencode 配置目录
cp AGENTS.md ~/.config/opencode/
cp instructions/workflow.md ~/.config/opencode/instructions/
cp prompts/compose-zh.md ~/.config/opencode/prompts/
cp prompts/build-zh.txt ~/.config/opencode/prompts/
```

### 2. 合并到你的 opencode.json

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
      "prompt": "（将 prompts/compose-zh.md 的全部内容粘贴到此）"
    }
  },
  "instructions": [
    "~/.config/opencode/AGENTS.md",
    "~/.config/opencode/instructions/workflow.md",
    "~/.config/opencode/prompts/compose-zh.md"
  ]
}
```

### 3. 重启生效

```bash
opencode
```

## 功能对照

| 功能点 | 原生 build | build-zh |
|--------|:----------:|:--------:|
| 角色定位（opencode CLI） | ✅ | ✅ |
| 禁止猜测 URL | ✅ | ✅ |
| 帮助/反馈指引 | ✅ | ✅ |
| 简洁风格、解释命令 | ✅ | ✅ |
| 表情符号规则 | ✅ | ✅ |
| 减少输出 token | ✅ | ✅ |
| 不要开场白/结束语 | ✅ | ✅ |
| 答案 ≤4 行、直接回答 | ✅ | ✅ |
| few-shot 示例 | ✅ | ✅ |
| 主动性规则 | ✅ | ✅ |
| 代码约定、安全准则 | ✅ | ✅ |
| 任务执行 + 测试验证 | ✅ | ✅ |
| 工具使用策略 | ✅ | ✅ |
| **语言要求（中文思考）** | ❌ | ✅ |

## 原理说明

OpenCode 的系统提示词按以下顺序组装：

1. **Header** — provider 简短标识（英文）
2. **Agent/Provider Instructions** — 被 `build-zh.prompt` 替换为中文
3. **Environment Context** — 系统信息（英文）
4. **Custom Instructions** — AGENTS.md + workflow.md

传统方法（如只修改 AGENTS.md）只能在第 4 层追加中文指令，但第 2 层的英文 prompt 仍然在开头。本方案通过**替换第 2 层为全中文**，从根源上解决了语言切换问题。

## 许可证

MIT
