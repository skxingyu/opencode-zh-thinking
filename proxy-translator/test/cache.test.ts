import { describe, it } from 'node:test';
import assert from 'node:assert';
import { initCache, translateWithFallback } from '../src/translator.js';
import { loadConfig } from '../src/config.js';

const config = loadConfig();

// 预初始化缓存（共享给所有测试）
initCache(config);

describe('翻译缓存', () => {
  it('相同文本第二次不应调用 Ollama（缓存命中）', { timeout: 30000 }, async () => {
    const text = 'Cache hit test ' + Date.now();
    const t1 = Date.now();
    const r1 = await translateWithFallback(text, config);
    const t2 = Date.now();
    console.log(`[Cache] 第1次: ${t2 - t1}ms, 结果: ${r1?.slice(0, 30)}`);

    const t3 = Date.now();
    const r2 = await translateWithFallback(text, config);
    const t4 = Date.now();
    const elapsed2 = t4 - t3;
    console.log(`[Cache] 第2次: ${elapsed2}ms, 结果: ${r2?.slice(0, 30)}`);

    // 缓存命中应 < 20ms（纯内存查询，无网络调用）
    assert.ok(
      elapsed2 < 100,
      `缓存命中应极快（${elapsed2}ms），不应 > 100ms`,
    );
    assert.strictEqual(r1, r2, '两次结果应一致');
  });
});
