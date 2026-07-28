import type { BusEvent } from './sseParser.js';
import type { Config } from './config.js';
import { translateWithFallback } from './translator.js';

/** 每个 SSE 连接独立的 reasoning 追踪状态 */
export interface ReasoningState {
  /** partID → part.type 映射（来自 message.part.updated） */
  partTypes: Map<string, 'text' | 'reasoning' | 'step-start' | 'step-finish'>;
  /** 正在翻译的 partID 集合，避免重复翻译 */
  translating: Set<string>;
  /** 按段落累积的 reasoning delta 文本（partID → 累积文本） */
  reasoningBuffers: Map<string, string>;
}

/** 创建新的 reasoning 状态（每个 SSE 连接一个） */
export function createReasoningState(): ReasoningState {
  return { partTypes: new Map(), translating: new Set(), reasoningBuffers: new Map() };
}

/** 判断是否是 reasoning 完成信号 */
export function isReasoningComplete(event: BusEvent): boolean {
  const part = (event.properties as any)?.part as
    | { type?: string; time?: { end?: number }; text?: string }
    | undefined;
  return (
    event.type === 'message.part.updated' &&
    part?.type === 'reasoning' &&
    part.time?.end != null &&
    !!part.text
  );
}

/**
 * 检查事件类型（用于 transform 中快速判断是否需要特殊处理）。
 */
export function getEventCategory(event: BusEvent): 'reasoning-complete' | 'other' {
  if (isReasoningComplete(event)) return 'reasoning-complete';
  return 'other';
}

/**
 * 分段翻译 reasoning 文本。
 * 将文本按 \n\n 切分，只翻译第一个段落（留待后续段落等下一批）。
 * 返回 { translated: 已翻译的段落文本, remaining: 未翻译的剩余文本 }。
 */
async function translateParagraphs(
  bufferedText: string,
  config: Config,
): Promise<{ translated: string[]; remaining: string }> {
  const paragraphs = bufferedText.split('\n\n');

  // 如果末尾是空字符串（文本以 \n\n 结尾），说明所有段落都完整
  if (paragraphs.length >= 2 && paragraphs[paragraphs.length - 1] === '') {
    // 所有段落完整，翻译全部（去掉最后的空元素）
    paragraphs.pop();
    const translated = await Promise.all(
      paragraphs.map(p => translateWithFallback(p, config)),
    );
    return { translated, remaining: '' };
  }

  if (paragraphs.length >= 2) {
    // 至少有一个完整段落
    const completeParas = paragraphs.slice(0, -1);
    const remaining = paragraphs[paragraphs.length - 1];
    const translated = await Promise.all(
      completeParas.map(p => translateWithFallback(p, config)),
    );
    return { translated, remaining };
  }

  // 没有完整段落
  return { translated: [], remaining: bufferedText };
}

/**
 * 异步翻译 reasoning content，返回修改后的事件。
 * 在后台调用，不阻塞主事件流。
 */
export async function translateEvent(
  event: BusEvent,
  config: Config,
  state: ReasoningState,
): Promise<BusEvent | null> {
  const props = event.properties as Record<string, unknown>;
  const part = props.part as { id?: string; text?: string; time?: { start: number; end?: number } };

  if (!part.id || !part.text) return null;

  // 清理该 partID 的累积缓冲（delta 阶段的段落翻译已经由 handleBusEvent 处理）
  state.reasoningBuffers.delete(part.id);

  console.log('[EventHandler] 翻译完整 reasoning 完成, partID:', part.id, '长度:', part.text.length);
  const translated = await translateWithFallback(part.text, config);
  const isTranslated = translated !== part.text;
  console.log(
    '[EventHandler] 翻译' + (isTranslated ? '成功' : '失败(回退)') +
    ', 结果长度:', translated.length,
  );

  return {
    ...event,
    properties: {
      ...props,
      part: { ...part, text: translated },
    },
  };
}

/**
 * 处理单个 BusEvent，返回待转发的事件列表。
 *
 * 策略：
 * - reasoning delta：累积文本 → 检测段落边界 → 翻译已完成段落并返回翻译后的 delta 事件
 * - reasoning completion：由 sseParser 中的 translateEvent 处理
 * - 其他事件：原样透传
 */
export async function handleBusEvent(
  event: BusEvent,
  config: Config,
  state: ReasoningState,
): Promise<BusEvent[]> {
  const props: Record<string, unknown> = event.properties ?? {};
  const part = props.part as
    | { id?: string; type?: string; text?: string }
    | undefined;

  switch (event.type) {
    case 'message.part.updated': {
      // 记录 partID → part.type 映射
      if (part?.id && (part.type === 'reasoning' || part.type === 'text')) {
        state.partTypes.set(part.id, part.type);
        // 初始化该 partID 的累积缓冲
        if (!state.reasoningBuffers.has(part.id)) {
          state.reasoningBuffers.set(part.id, '');
        }
      }
      return [event];
    }

    case 'message.part.delta': {
      const p = props as { partID: string; field: string; delta?: string };
      const partType = state.partTypes.get(p.partID);

      if (partType === 'reasoning' && p.delta) {
        // ========== 按段落累积 + 翻译 ==========
        const current = state.reasoningBuffers.get(p.partID) || '';
        const accumulated = current + p.delta;
        if (!accumulated) return [];

        const { translated, remaining } = await translateParagraphs(accumulated, config);

        // 更新缓冲
        state.reasoningBuffers.set(p.partID, remaining);

        if (translated.length === 0) {
          // 没有完整段落，继续缓冲
          return [];
        }

        // 每段创建一个 delta 事件（保留原始事件的类型和结构）
        const deltaEvents: BusEvent[] = translated.map(t => ({
          ...event,
          properties: { ...p as unknown as Record<string, unknown>, delta: t },
        }));
        return deltaEvents;
      }

      // 非 reasoning delta → 原样透传
      return [event];
    }

    default:
      return [event];
  }
}