import { describe, it } from 'node:test';
import assert from 'node:assert';
import { initCache, translateWithFallback } from '../src/translator.js';
import { loadConfig } from '../src/config.js';

describe('翻译降级', () => {
  it('超时应回退原文', { timeout: 5000 }, async () => {
    const config = loadConfig();
    config.translateTimeoutMs = 1; // 1ms 必然超时
    initCache(config);

    const text = 'This should timeout and fallback to original';
    const result = await translateWithFallback(text, config);
    assert.strictEqual(result, text, '超时应回退原文');
  });

  it('错误的 Ollama 地址应回退原文', { timeout: 5000 }, async () => {
    const config = loadConfig();
    config.ollamaHost = 'localhost:19999';
    initCache(config);

    const text = 'This should fail and fallback';
    const result = await translateWithFallback(text, config);
    assert.strictEqual(result, text, '连接失败时应回退原文');
  });
});
