# OpenCode 思考内容翻译代理 — 方案总结

> 将 AI 编程助手的英文思考过程（reasoning）实时翻译为中文，无缝集成到 OpenCode TUI 中。
> 
> **方案对比**：任何通过提示词强制 AI 中文思考的方案（如替换 system prompt），在大量英文工具输出、代码上下文注入、长多轮对话之后，都容易失效。
> 本方案采用**直接翻译**的思路——不依赖 AI 遵从语言指令，而是在传输层拦截 SSE 事件流，将英文 reasoning 实时翻译为中文。
> 这种方式更稳定，因为它不受 prompt 漂移影响，也不受模型版本或 provider 切换的影响。
>
> 设计原则：**通用、轻量、可插拔**。不局限于 OpenCode，任何 SSE 驱动的 AI 前端均可适配。

---

## 目录

- [1. 问题与方案概述](#1-问题与方案概述)
- [2. 预期成果](#2-预期成果)
- [3. 架构设计](#3-架构设计)
- [4. 翻译流程详解](#4-翻译流程详解)
- [5. 模型说明](#5-模型说明)
- [6. 云端模型接口](#6-云端模型接口)
- [7. 通用适用性](#7-通用适用性)
- [8. 安装与使用](#8-安装与使用)
- [9. 配置参考](#9-配置参考)
- [10. 性能与缓存](#10-性能与缓存)
- [11. 已知限制与后续优化](#11-已知限制与后续优化)

---

## 1. 问题与方案概述

### 问题

OpenCode（以及许多 AI 编程工具）在生成回答时，会先输出一段**英文思考过程**（reasoning），用户无法直接阅读。需要一个实时翻译层，将英文思考转为中文。

### 核心挑战

| 挑战 | 说明 |
|------|------|
| **实时性** | 思考内容是流式（SSE）到达的，翻译不能阻断流式显示 |
| **事件顺序** | SSE 事件有严格顺序，翻译不能打乱（否则 TUI 状态机出错） |
| **非侵入性** | 不能修改 OpenCode 源码，只能通过代理拦截 |
| **协议兼容** | 需要处理 OpenCode 的 /event 和 /global/event 两种 SSE 格式 |

### 方案选择

| 方案 | 描述 | 结论 |
|------|------|------|
| 拦截 delta + 翻译后转发 | 拦截所有 reasoning delta 事件，等翻译完一次性转发 | ❌ 超时（TUI 无数据显示会判定连接失败） |
| 透传 delta + 后台推送翻译 | 实时转发英文 delta，翻译完成后推第二个事件 | ❌ TUI 忽略后续更新（只看第一个 completion） |
| **透传 delta + 堵住 completion 翻译** | 英文 delta 实时显示，completion 堵住 ~1s 翻译，翻译完发中文 completion | ✅ **最终方案** |

---

## 2. 预期成果

| 目标 | 说明 |
|------|------|
| **实时中英对照** | 英文思考流式先出，~1s 后 completion 自动变为中文，不影响阅读节奏 |
| **零配置接入** | 无需修改 OpenCode 配置或代码，只需将 TUI 连接到代理端口 |
| **事件完整性** | 所有 SSE 事件严格按原始顺序透传，翻译不会破坏 TUI 的状态机 |
| **优雅降级** | 翻译引擎不可用时自动回退到英文原文，TUI 功能不受影响 |
| **可插拔翻译后端** | 支持本地 Ollama 和云端 API 两种模式，用户可根据硬件条件和预算选择 |
| **通用架构** | 不绑定 OpenCode，任何 SSE 驱动的 AI 前端均可通过修改事件识别逻辑适配 |

---

## 3. 架构设计

```
┌──────────────────────────────────────────────────────────────────┐
│                         你的终端 / TUI                            │
│                       opencode attach                            │
│                    http://localhost:8081                          │
└──────────────────────────┬───────────────────────────────────────┘
                           │ HTTP 请求（所有流量）
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│                    ★ 翻译代理 (localhost:8081)                    │
│                                                                  │
│   ┌─────────────┐    ┌────────────────┐    ┌──────────────────┐  │
│   │  HTTP Proxy  │───▶│  SSE Transform │───▶│  Event Handler   │  │
│   │ (http-proxy) │    │ (sseParser.ts) │    │ (eventHandler.ts)│  │
│   └──────┬───────┘    └───────┬────────┘    └────────┬─────────┘  │
│          │                   │                       │            │
│          │            检测 reasoning                  │            │
│          │            completion 事件                 │            │
│          │                   │                       │            │
│          │            ┌──────▼────────┐              │            │
│          │            │  Translator   │◀─────────────┘            │
│          │            │ (translator.ts)│                          │
│          │            │  Ollama API   │                           │
│          │            └──────┬────────┘                           │
│          │                   │                                    │
│          │            ┌──────▼────────┐                           │
│          │            │  Cache Layer  │                           │
│          │            │  (cache.ts)   │                           │
│          │            └───────────────┘                           │
└──────────────────────────┬───────────────────────────────────────┘
                           │ 转发（代理到 OpenCode Server）
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│                  OpenCode Server (localhost:4096)                 │
│                                                                  │
│   ┌────────────┐  ┌──────────────┐  ┌───────────────────────┐    │
│   │  SSE 事件  │  │  API 请求    │  │  LLM 模型调用         │    │
│   │ /global/event│  │ /api/...    │  │  (Claude / GPT 等)    │    │
│   └────────────┘  └──────────────┘  └───────────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
```

### 组件职责

| 组件 | 文件 | 职责 |
|------|------|------|
| **HTTP 代理** | `proxy.ts` | 全量反向代理，识别 SSE 响应并注入 Transform |
| **SSE 变换器** | `sseParser.ts` | 解析 SSE 帧，识别 reasoning completion，触发翻译 |
| **事件处理器** | `eventHandler.ts` | 维护 reasoning 状态，判断事件类型，调用翻译器 |
| **翻译器** | `translator.ts` | 调用 Ollama API 翻译文本，含缓存和回退 |
| **缓存层** | `cache.ts` | LRU 缓存 + single-flight 防重复请求 |
| **配置** | `config.ts` | 环境变量驱动的配置加载 |

---

## 4. 翻译流程详解

### 4.1 SSE 事件流

OpenCode 的 SSE 事件流（`/global/event`）包含以下关键事件类型：

```
server.connected           → 连接建立
message.part.updated       → part 创建/更新（含 reasoning 或 text 元数据）
message.part.delta         → 增量内容（流式传输）
message.part.updated       → part 完成（含完整文本，time.end 标记完成）
```

### 4.2 翻译触发条件

仅当 `message.part.updated` 事件同时满足以下条件时才触发翻译：

1. `part.type === 'reasoning'` — 类型为 reasoning
2. `part.time.end != null` — 内容已完整（非流式中间状态）
3. `part.text` 不为空 — 有实际内容需要翻译

### 4.3 单次翻译时序

```
时间线

SSE 上游:  delta1  delta2  delta3  ...  deltaN  completion  text_delta1  ...
            │       │       │               │       │
代理:       └─透传──┴─透传──┴─透传───────────┴─堵住──┤
            (英文流式显示)                          │
                                                   ▼
                                            translateEvent()
                                               │ await ~1s
                                               ▼
                                            translatedEvent
                                               │
代理:                                       ──┴──→ 转发(中文) ── text_delta1 ...
TUI:  英文显示中...                     中文显示   回答开始
```

### 4.4 为什么堵住 completion 而不堵 delta

- **delta 透传**：TUI 持续收到数据，连接活跃，不会超时
- **completion 堵住 ~1s**：这是 PV 中的唯一阻塞点，由于前文 delta 已全部到达，TUI 有完整的英文思考显示，1s 延迟不会触发超时
- **text deltas 自然推迟**：text deltas 在 SSE 流中排在 completion 之后，completion 翻译完成后一并转发，不会乱序

### 4.5 事件顺序保障机制

```typescript
// sseParser.ts — 核心设计
async transform(chunk, encoding, callback) {
  // 第一遍：同步循环处理所有事件
  for (const raw of events) {
    if (reasoning-complete) {
      pendingTranslate = translateEvent(event); // 发起翻译，不 await
      results.push('');                          // 占位
    } else {
      results.push(serialize(event));            // 立即序列化
    }
  }

  // 第二遍：await 翻译完成
  if (pendingTranslate) {
    const translated = await pendingTranslate.promise;
    results[placeholderIndex] = serialize(translated);
  }

  callback(null, results.join('')); // 一次性输出，严格有序
}
```

关键设计点：
- **不使用递归 async 处理**：避免 Node.js Transform 的 `afterTransform` re-entrancy 问题
- **两遍式 + 占位符**：先同步收集所有事件结果，最后单次 await 翻译
- **翻译失败时静默回退**：`translateWithFallback` 捕获所有异常，返回原文

---

## 5. 模型说明

### 5.1 默认模型：`kaelri/hy-mt2:1.8b`

| 属性 | 值 |
|------|-----|
| 模型名 | `kaelri/hy-mt2:1.8b` |
| 参数量 | 1.8B |
| 架构 | 基于 LLM 的翻译微调模型 |
| 运行方式 | Ollama（`ollama pull kaelri/hy-mt2:1.8b`） |
| 硬件要求 | 4GB VRAM（GPU）/ 8GB RAM（CPU） |
| 单次翻译延迟 | ~300ms–1500ms（取决于文本长度和硬件） |

**选择理由：**

| 考量 | 说明 |
|------|------|
| **速度快** | 1.8B 参数，在消费级 GPU 上推理极快，适合实时翻译场景 |
| **质量足够** | 专为翻译微调，中英翻译质量优于同等大小的通用模型 |
| **资源低** | 可运行在 4GB VRAM 的显卡上，甚至纯 CPU 推理 |
| **Ollama 生态** | 一键拉取，无需配置 |

### 5.2 备选模型

| 模型 | 参数 | 优势 | 劣势 | 适用场景 |
|------|------|------|------|----------|
| `kaelri/hy-mt2:1.8b` | 1.8B | 速度快、专为翻译 | 质量一般 | **默认推荐** |
| `qwen2.5:3b` | 3B | 质量更好、中文强 | 稍慢 | 有 GPU 的用户 |
| `qwen2.5:7b` | 7B | 翻译质量高 | 需要 6GB+ VRAM | 追求质量 |
| `llama3.2:3b` | 3B | 通用能力强 | 翻译不如专用模型 | 需要多语言 |
| `nllb-200-distilled-1.3b` | 1.3B | 轻量、翻译专用 | 中文质量一般 | 低配机器 |

### 5.3 模型参数调优

翻译器使用以下 Ollama 参数：

```json
{
  "temperature": 0.1,
  "num_predict": 2048
}
```

### 5.4 切换模型

```bash
# 环境变量方式
export OT_MODEL=qwen2.5:3b
npm run dev

# 或直接修改 config.ts 中的默认值
```

---

## 6. 云端模型接口

### 6.1 设计思路

翻译器目前使用 Ollama（本地 API），但架构预留了**可插拔的翻译后端**接口，用户只需替换一个函数即可接入任意云端翻译 API。

### 6.2 当前翻译接口

```typescript
export async function translateText(text: string, config: Config): Promise<string> {
  const res = await fetch(`http://${config.ollamaHost}/api/chat`, {
    method: 'POST',
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: 'system', content: 'Translate to Chinese...' },
        { role: 'user', content: text },
      ],
      stream: false,
    }),
  });
}
```

### 6.3 替换为云端翻译 API

只需修改 `translateText` 函数，将 HTTP 请求目标改为云端服务即可。

#### 方案 A：OpenAI / 兼容 API

```typescript
export async function translateText(text: string, config: Config): Promise<string> {
  const apiKey = process.env.OT_OPENAI_API_KEY;
  const baseUrl = process.env.OT_OPENAI_BASE_URL ?? 'https://api.openai.com/v1';
  const res = await fetch(`${baseUrl}/chat/completions`, {
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: process.env.OT_OPENAI_MODEL ?? 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'Translate to Simplified Chinese.' },
        { role: 'user', content: text },
      ],
      temperature: 0.1,
    }),
  });
}
```

#### 方案 B：阿里云通义千问

```typescript
export async function translateText(text: string, config: Config): Promise<string> {
  const apiKey = process.env.OT_DASHSCOPE_API_KEY;
  const res = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'qwen-turbo',
      messages: [
        { role: 'system', content: 'Translate to Chinese.' },
        { role: 'user', content: text },
      ],
      temperature: 0.1,
    }),
  });
}
```

#### 方案 C：DeepSeek

```typescript
export async function translateText(text: string, config: Config): Promise<string> {
  const apiKey = process.env.OT_DEEPSEEK_API_KEY;
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: 'Translate to Chinese.' },
        { role: 'user', content: text },
      ],
      temperature: 0.1,
    }),
  });
}
```

### 6.4 设计建议：翻译后端抽象层

```typescript
interface TranslatorBackend {
  name: string;
  translate(text: string, config: Record<string, unknown>): Promise<string>;
}

const backends = new Map<string, TranslatorBackend>();
backends.set('ollama', ollamaTranslator);
backends.set('openai', openaiTranslator);

const backend = backends.get(process.env.OT_TRANSLATOR_BACKEND ?? 'ollama');
```

---

## 7. 通用适用性

### 7.1 OpenCode 专属适配

| 适配点 | 说明 |
|--------|------|
| `/global/event` 格式 | 检测 `payload` 包裹格式并自动解包/重包 |
| `/event` 格式 | 也支持扁平格式 SSE 事件 |
| 事件类型识别 | 识别 `message.part.updated`、`message.part.delta` 等 OpenCode 特有事件 |
| 状态追踪 | 通过 `partID -> part.type` 映射区分 reasoning 和 text delta |

### 7.2 适配其他工具

将本方案用于其他 AI 前端（如 Continue、Claude Code、自定义聊天界面）时，需要修改：

#### 修改点 1：事件识别逻辑（eventHandler.ts）

```typescript
export function isReasoningComplete(event: BusEvent): boolean {
  return event.type === 'thinking' && !!event.properties?.content;
}
```

#### 修改点 2：SSE 端点识别（sseParser.ts）

代理自动检测 `content-type: text/event-stream` 并应用 Transform。无需修改。

#### 修改点 3：JSON 格式检测（sseParser.ts）

`unwrapEvent` 自动检测 `payload` 包裹格式，也支持扁平格式。无需修改。

### 7.3 通用架构优势

- **协议无关**：代理工作在 HTTP 层，支持任何 SSE 协议
- **事件格式自适应**：自动检测 JSON 结构（payload 包裹或扁平）
- **翻译引擎可插拔**：替换 `translateText` 函数即可切换翻译后端
- **无状态**：代理本身无持久化状态，重启无成本

---

## 8. 安装与使用

### 8.1 前置条件

- Node.js >= 18（ESM 支持）
- Ollama（本地翻译）或 云端 API Key（远程翻译）
- OpenCode >= 1.18（已在 1.18.3/1.18.4 上测试）

### 8.2 安装

```bash
git clone <your-repo-url>
cd proxy-translator
npm install
ollama pull kaelri/hy-mt2:1.8b
```

### 8.3 运行

```bash
# 1. 启动 OpenCode Server
opencode serve --port 4096

# 2. 启动翻译代理
npm run dev

# 3. 启动 OpenCode TUI 并连接到代理
opencode attach http://localhost:8081
```

### 8.4 环境变量配置

```bash
export OT_LISTEN_PORT=8081
export OT_SERVER_HOST=localhost
export OT_SERVER_PORT=4096
export OT_OLLAMA_HOST=localhost:11434
export OT_MODEL=kaelri/hy-mt2:1.8b
export OT_TRANSLATE_TIMEOUT_MS=30000
export OT_MAX_CACHE_SIZE=2000
export OT_CACHE_TTL_MS=86400000
```

### 8.5 验证运行

```bash
curl http://localhost:8081/global/health
timeout 3 curl -sN http://localhost:8081/global/event
```

---

## 9. 配置参考

### 9.1 配置项一览

| 环境变量 | 默认值 | 说明 |
|----------|--------|------|
| `OT_LISTEN_PORT` | `8081` | 代理监听端口 |
| `OT_SERVER_HOST` | `localhost` | 上游 OpenCode Server 地址 |
| `OT_SERVER_PORT` | `4096` | 上游 OpenCode Server 端口 |
| `OT_OLLAMA_HOST` | `localhost:11434` | Ollama 服务地址 |
| `OT_MODEL` | `kaelri/hy-mt2:1.8b` | 翻译模型名 |
| `OT_TRANSLATE_TIMEOUT_MS` | `30000` | 翻译超时（毫秒） |
| `OT_MAX_CACHE_SIZE` | `2000` | 缓存最大条目数 |
| `OT_CACHE_TTL_MS` | `86400000` | 缓存 TTL（24h） |

### 9.2 端口规划

| 服务 | 端口 | 说明 |
|------|------|------|
| OpenCode TUI | 动态 | 终端 UI，不独占端口 |
| 翻译代理 | **8081** | 入口，TUI 连接此地址 |
| OpenCode Server | **4096** | 内部，代理转发到此 |
| Ollama | **11434** | 内部，翻译请求到此 |

---

## 10. 性能与缓存

### 10.1 缓存架构

三层防护：
- **LRU 缓存**：最近翻译的文本自动缓存，相同文本直接命中
- **single-flight 去重**：同一文本同时被多个请求命中时，只发起一次翻译
- **TTL 过期**：24 小时后自动失效，避免脏数据

### 10.2 性能指标

| 场景 | 延迟 | 说明 |
|------|------|------|
| 缓存命中 | ~0ms | 相同文本重复出现时直接返回 |
| 本地翻译（短文本，GPU） | ~300ms | 典型思考内容（50-200 字符） |
| 本地翻译（长文本，CPU） | ~1500ms | 长思考内容（500+ 字符） |
| 云端翻译（API 调用） | ~500ms | 取决于 API 响应时间 |

### 10.3 翻译失败回退

翻译引擎不可用或超时时，自动回退到原文。TUI 显示英文原文，不会空白或报错。

---

## 11. 已知限制与后续优化

### 11.1 当前限制

| 限制 | 说明 | 影响 |
|------|------|------|
| completion 短暂阻塞 | 翻译 completion 时 SSE 流暂停 ~1s | 极少数情况下 TUI 可能超时 |
| 仅翻译 reasoning | text 部分不翻译（保持原文） | 用户仍需阅读英文回答 |
| 仅中英翻译 | 系统提示固定为英译中 | 需修改 system prompt 适配其他语言对 |
| Ollama 依赖 | 默认使用本地 Ollama | 需安装 Ollama 或改为云端 API |

### 11.2 后续优化方向

| 方向 | 方案 | 优先级 |
|------|------|--------|
| 流式分句翻译 | 不堵 completion，逐句翻译 delta 并实时转发中文 | 高 |
| 多语言支持 | 通过环境变量指定源语言和目标语言 | 中 |
| 翻译后端抽象 | 将 Translator 提取为接口，支持动态切换后端 | 中 |
| Web UI 仪表盘 | 实时显示翻译延迟、缓存命中率、连接状态 | 低 |
| Docker 部署 | 提供 Dockerfile 一键部署 | 低 |

### 11.3 流式分句翻译（远期方案）

当前方案中 completion 的 ~1s 阻塞是主要瓶颈。远期可以通过流式分句翻译消除阻塞：

```
原始方案：
  delta1 delta2 delta3 ... completion(翻译1s) text1 text2
  英文    英文    英文        中文              原文    原文

流式分句方案：
  delta1(300ms) delta2(200ms) ... completion(100ms)
  中文           中文              中文
```

每个小句子的翻译延迟极短（<100ms），累积不到 1s 但用户感知的是连续流畅的中文显示。

---

## 附录

### A. 项目结构

```
proxy-translator/
├── src/
│   ├── index.ts          # 入口：启动代理、初始化
│   ├── config.ts         # 配置管理（环境变量）
│   ├── proxy.ts          # HTTP 反向代理核心
│   ├── sseParser.ts      # SSE 事件解析与 Transform 变换
│   ├── eventHandler.ts   # 事件分类、状态追踪、翻译调用
│   ├── translator.ts     # Ollama 翻译 API 调用
│   └── cache.ts          # LRU 翻译缓存 + single-flight
├── test/
│   ├── eventHandler.test.ts
│   ├── cache.test.ts
│   └── translator.test.ts
├── SUMMARY.md            # 本文档
├── package.json
└── tsconfig.json
```

### B. 许可证

MIT