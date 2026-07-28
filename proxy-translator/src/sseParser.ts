import { Transform } from 'node:stream';
import type { Config } from './config.js';
import type { ReasoningState } from './eventHandler.js';

export interface BusEvent {
  id?: string;
  type: string;
  properties: Record<string, unknown>;
}

/** 从 SSE 原始帧中提取 data: 行的 JSON 并解析 */
export function parseSSEEvent(raw: string): BusEvent | null {
  const lines = raw.split(/\r?\n/);
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }
  if (dataLines.length === 0) return null;
  try {
    return JSON.parse(dataLines.join('')) as BusEvent;
  } catch {
    return null;
  }
}

export interface WrappedEvent {
  payload: BusEvent;
}

export function unwrapEvent(event: BusEvent | WrappedEvent): { event: BusEvent; wrapped: boolean } {
  if ('payload' in event && event.payload && typeof event.payload === 'object') {
    return { event: event.payload as BusEvent, wrapped: true };
  }
  return { event: event as BusEvent, wrapped: false };
}

export function serializeEvent(event: BusEvent, wrapped: boolean): string {
  const data = wrapped ? JSON.stringify({ payload: event }) : JSON.stringify(event);
  return `data: ${data}\n\n`;
}

/**
 * 创建 SSE Transform 流。
 *
 * 策略：
 * - reasoning delta → 透传（用户先看到英文思考流式显示）
 * - reasoning completion → 同步发起翻译，收集完本 chunk 所有事件后
 *   await 翻译完成，再一次性 callback。确保事件输出顺序不乱。
 * - 其他事件 → 正常透传
 *
 * 关键设计：使用 async _transform + 同步循环处理 + 末尾单次 await，
 * 避免 async 递归 callback 引起的 re-entrancy 和事件乱序。
 */
export function createSSETransform(
  config: Config,
  state: ReasoningState,
  handleBusEvent: (event: BusEvent, config: Config, state: ReasoningState) => Promise<BusEvent[]>,
  getEventCategory: (event: BusEvent) => 'reasoning-complete' | 'other',
  translateEvent: (event: BusEvent, config: Config, state: ReasoningState) => Promise<BusEvent | null>,
): Transform {
  let buffer = '';
  let detectedWrapped: boolean | null = null;

  return new Transform({
    objectMode: false,

    async transform(chunk: Buffer, _encoding: string, callback: (err?: Error | null, data?: string) => void) {
      buffer += chunk.toString('utf8');

      // 提取完整事件
      const events: string[] = [];
      while (true) {
        const delim = buffer.includes('\r\n\r\n')
          ? '\r\n\r\n'
          : buffer.includes('\n\n')
            ? '\n\n'
            : undefined;
        if (!delim) break;
        const idx = buffer.indexOf(delim);
        events.push(buffer.slice(0, idx));
        buffer = buffer.slice(idx + delim.length);
      }

      if (events.length === 0) {
        callback();
        return;
      }

      // 自动检测 payload 包裹格式
      if (detectedWrapped === null && events.length > 0) {
        const first = parseSSEEvent(events[0]);
        if (first && 'payload' in first) {
          detectedWrapped = true;
        } else {
          detectedWrapped = false;
        }
      }

      try {
        // ── 第一遍：同步收集所有事件，遇到 completion 就发起翻译但不 await ──
        const results: string[] = [];
        let pendingTranslate: {
          promise: Promise<BusEvent | null>;
          originalEvent: BusEvent;
          placeholderIndex: number;
        } | null = null;

        for (const raw of events) {
          const parsed = parseSSEEvent(raw);

          if (!parsed) {
            results.push(raw + '\n\n');
            continue;
          }

          const { event: busEvent } = unwrapEvent(parsed);
          const category = getEventCategory(busEvent);

          if (category === 'reasoning-complete') {
            // 发起翻译但不 await，先占位
            pendingTranslate = {
              promise: translateEvent(busEvent, config, state),
              originalEvent: busEvent,
              placeholderIndex: results.length,
            };
            results.push(''); // placeholder
          } else {
            // handleBusEvent 是 async 但内部无 await，会立即 resolve
            const out = await handleBusEvent(busEvent, config, state);
            for (const e of out) {
              results.push(serializeEvent(e, detectedWrapped!));
            }
          }
        }

        // ── 第二遍：如果存在 completion 翻译，等待它完成 ──
        if (pendingTranslate) {
          let translatedEvent: BusEvent | null;
          try {
            translatedEvent = await pendingTranslate.promise;
          } catch (err) {
            console.error('[SSE] 翻译异常，回退原文:', err);
            translatedEvent = null;
          }
          // 用翻译结果（或原文）替换占位
          const finalEvent = translatedEvent ?? pendingTranslate.originalEvent;
          results[pendingTranslate.placeholderIndex] = serializeEvent(finalEvent, detectedWrapped!);
        }

        callback(null, results.join(''));
      } catch (err) {
        console.error('[SSE] 处理异常:', err);
        callback(null, events.join('\n\n') + '\n\n'); // 回退：原样转发
      }
    },

    flush(callback: (err?: Error | null, data?: string) => void) {
      if (buffer) {
        this.push(buffer + (buffer.endsWith('\n') ? '' : '\n\n'));
      }
      callback();
    },
  });
}
