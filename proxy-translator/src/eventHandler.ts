import type { BusEvent } from './sseParser.js';
import type { Config } from './config.js';
import { translateWithFallback } from './translator.js';

/** 每个 SSE 连接独立的 reasoning 追踪状态 */
export interface ReasoningState {
  /** partID → part.type 映射（来自 message.part.updated） */
  partTypes: Map<string, 'text' | 'reasoning' | 'step-start' | 'step-finish'>;
  /** 正在翻译的 partID 集合，避免重复翻译 */
  translating: Set<string>;
}

/** 创建新的 reasoning 状态（每个 SSE 连接一个） */
export function createReasoningState(): ReasoningState {
  return { partTypes: new Map(), translating: new Set() };
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
 * 当前只需要关心 reasoning completion，其他事件统一走 handleBusEvent。
 */
export function getEventCategory(event: BusEvent): 'reasoning-complete' | 'other' {
  if (isReasoningComplete(event)) return 'reasoning-complete';
  return 'other';
}

/**
 * 异步翻译 reasoning content，返回修改后的事件。
 * 在后台调用，不阻塞主事件流。
 */
export async function translateEvent(event: BusEvent, config: Config): Promise<BusEvent | null> {
  const props = event.properties as Record<string, unknown>;
  const part = props.part as { id?: string; text?: string; time?: { start: number; end?: number } };

  if (!part.id || !part.text) return null;

  console.log('[EventHandler] 后台翻译开始, partID:', part.id, '长度:', part.text.length);
  const translated = await translateWithFallback(part.text, config);
  const isTranslated = translated !== part.text;
  console.log(
    '[EventHandler] 翻译' + (isTranslated ? '成功' : '失败(回退)') +
    ', 结果长度:', translated.length
  );

  // 返回一个新事件，更新 part.text
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
 * - reasoning delta：透传（不拦截）→ TUI 先显示英文
 * - reasoning completion：在 transform 中特殊处理（详见 sseParser.ts）
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
      }
      return [event];
    }

    case 'message.part.delta': {
      const p = props as { partID: string; field: string };
      const partType = state.partTypes.get(p.partID);

      // ✅ 不再拦截 reasoning delta → 透传
      if (partType === 'reasoning') {
        return [event]; // 透传，让 TUI 实时显示英文
      }

      return [event];
    }

    default:
      return [event];
  }
}
