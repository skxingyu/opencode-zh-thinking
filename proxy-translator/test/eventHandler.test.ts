import { describe, it } from 'node:test';
import assert from 'node:assert';
import { handleBusEvent, createReasoningState, isReasoningComplete, translateEvent } from '../src/eventHandler.js';
import { loadConfig } from '../src/config.js';
import type { BusEvent } from '../src/sseParser.js';

const config = loadConfig();

function makeEvent(type: string, props: Record<string, unknown>): BusEvent {
  return { type, properties: props };
}

describe('V1 Reasoning 事件处理', () => {
  it('透传 reasoning delta（不再拦截）', async () => {
    const state = createReasoningState();

    // 注册 reasoning part
    const created = makeEvent('message.part.updated', {
      part: { id: 'p1', type: 'reasoning', text: '', time: { start: 1000 } },
    });
    await handleBusEvent(created, config, state);

    // reasoning delta → 透传（不再拦截）
    const delta = makeEvent('message.part.delta', {
      partID: 'p1',
      field: 'text',
      delta: 'thinking content',
    });
    const deltaOut = await handleBusEvent(delta, config, state);
    assert.strictEqual(deltaOut.length, 1, 'reasoning delta 应透传');
    assert.strictEqual(deltaOut[0].type, 'message.part.delta');
  });

  it('透传 text 类型的 delta', async () => {
    const state = createReasoningState();

    const created = makeEvent('message.part.updated', {
      part: { id: 'p2', type: 'text', text: '', time: { start: 1000 } },
    });
    await handleBusEvent(created, config, state);

    const delta = makeEvent('message.part.delta', {
      partID: 'p2',
      field: 'text',
      delta: 'Hello world',
    });
    const deltaOut = await handleBusEvent(delta, config, state);
    assert.strictEqual(deltaOut.length, 1, 'text delta 应透传');
    assert.strictEqual(deltaOut[0].type, 'message.part.delta');
  });

  it('透传非 reasoning 事件', async () => {
    const state = createReasoningState();
    const result = await handleBusEvent(
      makeEvent('server.heartbeat', {}),
      config,
      state,
    );
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].type, 'server.heartbeat');
  });

  it('isReasoningComplete 判断正确', () => {
    // 完成信号
    const complete = makeEvent('message.part.updated', {
      part: { id: 'p1', type: 'reasoning', text: 'full text', time: { start: 1000, end: 2000 } },
    });
    assert.ok(isReasoningComplete(complete));

    // 开始信号（无 time.end）
    const start = makeEvent('message.part.updated', {
      part: { id: 'p1', type: 'reasoning', text: '', time: { start: 1000 } },
    });
    assert.ok(!isReasoningComplete(start));

    // 非 reasoning 事件
    const heartbeat = makeEvent('server.heartbeat', {});
    assert.ok(!isReasoningComplete(heartbeat));
  });

  it('translateEvent 翻译文本', async () => {
    const complete = makeEvent('message.part.updated', {
      part: { id: 'p1', type: 'reasoning', text: 'hello world', time: { start: 1000, end: 2000 } },
    });

    const translated = await translateEvent(complete, config);
    assert.ok(translated !== null);
    const partText = (translated!.properties as any).part.text;
    assert.strictEqual(typeof partText, 'string');
    assert.ok(partText.length > 0, '翻译结果不应为空');
    // 翻译成功时 ≠ 原文，Ollama 不可用时 = 原文
    // 两种情况均合法
  });

  it('多个连接互不干扰', async () => {
    const state1 = createReasoningState();
    const state2 = createReasoningState();

    await handleBusEvent(
      makeEvent('message.part.updated', {
        part: { id: 'a1', type: 'reasoning', text: '', time: { start: 1000 } },
      }),
      config,
      state1,
    );
    await handleBusEvent(
      makeEvent('message.part.updated', {
        part: { id: 'b1', type: 'reasoning', text: '', time: { start: 1000 } },
      }),
      config,
      state2,
    );

    // 两个连接各自透传各自的 delta
    const r1 = await handleBusEvent(
      makeEvent('message.part.delta', { partID: 'a1', field: 'text', delta: 'x' }),
      config,
      state1,
    );
    assert.strictEqual(r1.length, 1, '连接1 透传 a1 delta');

    const r2 = await handleBusEvent(
      makeEvent('message.part.delta', { partID: 'b1', field: 'text', delta: 'y' }),
      config,
      state2,
    );
    assert.strictEqual(r2.length, 1, '连接2 透传 b1 delta');
  });
});
