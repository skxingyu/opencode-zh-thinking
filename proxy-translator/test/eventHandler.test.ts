import { describe, it } from 'node:test';
import assert from 'node:assert';
import { handleBusEvent, createReasoningState, isReasoningComplete, translateEvent } from '../src/eventHandler.js';
import { loadConfig } from '../src/config.js';
import type { BusEvent } from '../src/sseParser.js';

const config = loadConfig();

function makeEvent(type: string, props: Record<string, unknown>): BusEvent {
  return { type, properties: props };
}

describe('V2 段落流式翻译', () => {
  it('累积 reasoning delta 并在段落边界后翻译', async () => {
    const state = createReasoningState();

    // 注册 reasoning part
    const created = makeEvent('message.part.updated', {
      part: { id: 'p1', type: 'reasoning', text: '', time: { start: 1000 } },
    });
    await handleBusEvent(created, config, state);

    // 第一个 delta：不构成完整段落 → 缓冲，不转发
    const delta1 = makeEvent('message.part.delta', {
      partID: 'p1', field: 'text', delta: 'first paragraph text',
    });
    const out1 = await handleBusEvent(delta1, config, state);
    assert.strictEqual(out1.length, 0, '无段落边界时不转发');

    // 第二个 delta：追加后形成完整段落（含 \n\n）→ 翻译后转发
    const delta2 = makeEvent('message.part.delta', {
      partID: 'p1', field: 'text', delta: '\n\n',
    });
    const out2 = await handleBusEvent(delta2, config, state);
    assert.strictEqual(out2.length, 1, '段落边界后转发 1 个 delta');
    assert.strictEqual(out2[0].type, 'message.part.delta', '仍为 delta 事件');
    const translatedText = out2[0].properties.delta as string;
    assert.strictEqual(typeof translatedText, 'string');
    assert.ok(translatedText.length > 0, '翻译结果不应为空');
  });

  it('多个连续段落各翻译一次', async () => {
    const state = createReasoningState();

    const created = makeEvent('message.part.updated', {
      part: { id: 'p2', type: 'reasoning', text: '', time: { start: 1000 } },
    });
    await handleBusEvent(created, config, state);

    // 累积两个段落的内容（不含边界）→ 不转发
    const d1 = makeEvent('message.part.delta', { partID: 'p2', field: 'text', delta: 'para one' });
    const r1 = await handleBusEvent(d1, config, state);
    assert.strictEqual(r1.length, 0, '无边界不转发');

    // 第一个段落边界
    const d2 = makeEvent('message.part.delta', { partID: 'p2', field: 'text', delta: '\n\n' });
    const r2 = await handleBusEvent(d2, config, state);
    assert.strictEqual(r2.length, 1, '第一个段落翻译转发');
    assert.strictEqual(typeof r2[0].properties.delta, 'string');
    assert.ok((r2[0].properties.delta as string).includes('para') === false, '应翻译为中文');

    // 第二段落内容
    const d3 = makeEvent('message.part.delta', { partID: 'p2', field: 'text', delta: 'para two text' });
    const r3 = await handleBusEvent(d3, config, state);
    assert.strictEqual(r3.length, 0, '第二段落未完成不转发');

    // 第二段落边界
    const d4 = makeEvent('message.part.delta', { partID: 'p2', field: 'text', delta: '\n\n' });
    const r4 = await handleBusEvent(d4, config, state);
    assert.strictEqual(r4.length, 1, '第二段落翻译转发');
  });

  it('透传 text 类型的 delta', async () => {
    const state = createReasoningState();

    const created = makeEvent('message.part.updated', {
      part: { id: 'p3', type: 'text', text: '', time: { start: 1000 } },
    });
    await handleBusEvent(created, config, state);

    const delta = makeEvent('message.part.delta', {
      partID: 'p3', field: 'text', delta: 'Hello world',
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
    const complete = makeEvent('message.part.updated', {
      part: { id: 'p1', type: 'reasoning', text: 'full text', time: { start: 1000, end: 2000 } },
    });
    assert.ok(isReasoningComplete(complete));

    const start = makeEvent('message.part.updated', {
      part: { id: 'p1', type: 'reasoning', text: '', time: { start: 1000 } },
    });
    assert.ok(!isReasoningComplete(start));

    const heartbeat = makeEvent('server.heartbeat', {});
    assert.ok(!isReasoningComplete(heartbeat));
  });

  it('translateEvent 翻译完整文本', async () => {
    const state = createReasoningState();
    const complete = makeEvent('message.part.updated', {
      part: { id: 'p1', type: 'reasoning', text: 'hello world', time: { start: 1000, end: 2000 } },
    });

    const translated = await translateEvent(complete, config, state);
    assert.ok(translated !== null);
    const partText = (translated!.properties as any).part.text;
    assert.strictEqual(typeof partText, 'string');
    assert.ok(partText.length > 0, '翻译结果不应为空');
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

    // 连接1：累积段落
    const r1 = await handleBusEvent(
      makeEvent('message.part.delta', { partID: 'a1', field: 'text', delta: 'hello\n\n' }),
      config, state1,
    );
    assert.strictEqual(r1.length, 1, '连接1 翻译转发段落');

    // 连接2：独立缓冲
    const r2 = await handleBusEvent(
      makeEvent('message.part.delta', { partID: 'b1', field: 'text', delta: 'world' }),
      config, state2,
    );
    assert.strictEqual(r2.length, 0, '连接2 无段落边界不转发');
  });
});