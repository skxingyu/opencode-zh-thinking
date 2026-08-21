/**
 * chinese-mode —— opencode 中文模式插件（方案 C）
 *
 * 移植自 dsh-chinese-mode（DeepSeek Harness 的中文思考/回复增强方案），
 * 并融合本仓库旧方案 A（三层防护）中的防漂移精华：
 * 通过 experimental.chat.system.transform hook，在每次 LLM 请求组装
 * system prompt 时实时注入语言指令。
 *
 * - 总开关关闭时不注入任何内容；
 * - 回复 / 思考两个区域各自可独立开关（默认均开启）；
 * - enhanced 强化段（默认开启）：中文引导语锚定 + 工具输出后防漂移规则 +
 *   正反示例，用于对抗大量英文工具输出导致的思考语言漂移；
 * - 工具区域默认关闭（避免工具调用相关文本变化引起意外），可在状态文件中开启；
 * - 状态存于 ~/.config/opencode/chinese-mode.json，
 *   由 /chinese 命令（commands/chinese.md + chinese-mode.ps1）切换，
 *   每次请求前重新读取，切换即时生效、无需重启。
 */

import type { Plugin } from "@opencode-ai/plugin"
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

// 状态文件路径（与切换脚本 chinese-mode.ps1 共享）
const STATE_FILE = join(homedir(), ".config", "opencode", "chinese-mode.json")

/** 状态结构：enabled 为总开关；reply/thinking/tools 为各区域注入开关；enhanced 为强化段开关 */
type State = {
  enabled: boolean
  reply: boolean
  thinking: boolean
  tools: boolean
  enhanced: boolean
}

/**
 * 默认状态：总开关开启；回复与思考注入中文指令；强化段开启；
 * 工具区域默认不注入（保持模型自然行为，防止工具调用出错）。
 */
const DEFAULT_STATE: State = { enabled: true, reply: true, thinking: true, tools: false, enhanced: true }

/** 读取状态文件；文件缺失或损坏时静默回退到默认值，不影响正常会话 */
function loadState(): State {
  try {
    if (!existsSync(STATE_FILE)) return DEFAULT_STATE
    const raw = JSON.parse(readFileSync(STATE_FILE, "utf8")) as Partial<State>
    return {
      enabled: raw.enabled === true,
      reply: raw.reply !== false,
      thinking: raw.thinking !== false,
      tools: raw.tools === true,
      enhanced: raw.enhanced !== false,
    }
  } catch {
    return DEFAULT_STATE
  }
}

// ---- 基础指令（简短正向，参考 dsh-chinese-mode 的实测有效文案，
//      并融入旧方案的“不受上下文语言影响”语义）----
const TEXT_REPLY = "回复始终使用简体中文（代码、命令、路径、配置键、专有名词保留原文）。"
const TEXT_THINKING =
  "思考过程始终使用简体中文；即使工具返回英文结果或上下文包含大量英文，思考也必须保持中文，不得切换。"
const TEXT_TOOLS =
  "工具调用的说明、进度更新等可见文本使用简体中文；代码、命令、路径、配置键、工具与 API 名称保留原文。"

// ---- 强化段（源自本仓库旧方案三层防护的实测精华：
//      中文引导语锚定思考链开头，是对抗语言漂移最有效的手段）----
const TEXT_ENHANCED = [
  "【思考语言纪律】",
  "- 每段思考以中文引导语开头（如\"让我分析一下\"\"先看一下问题\"\"我来梳理一下\"），禁止以 Let me / The user / I need to 等英文开头。",
  "- 分析工具输出时用中文归纳要点，不要用英文复述工具结果。",
  "- 一旦发现自己开始用英文思考，立即切回中文。",
  "正确示例：思考：用户问 TypeScript 是什么，我来梳理一下……",
  "错误示例：思考：The user is asking about TypeScript...（禁止）",
].join("\n")

export default (async () => ({
  "experimental.chat.system.transform": async (_input, output) => {
    const state = loadState()
    if (!state.enabled) return

    // 按区域开关拼接注入文案，追加到 system prompt 末尾（紧邻对话，遵循度高）
    const parts = [
      ...(state.reply ? [TEXT_REPLY] : []),
      ...(state.thinking ? [TEXT_THINKING] : []),
      // 强化段依附于思考区域：思考关闭时强化段无意义，一并跳过
      ...(state.thinking && state.enhanced ? [TEXT_ENHANCED] : []),
      ...(state.tools ? [TEXT_TOOLS] : []),
    ]
    if (parts.length === 0) return
    output.system.push(parts.join("\n"))
  },
})) satisfies Plugin
