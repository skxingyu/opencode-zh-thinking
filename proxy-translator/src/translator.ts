import type { Config } from './config.js';
import { createTranslationCache, type TranslationCache } from './cache.js';

let cache: TranslationCache | null = null;

export function initCache(config: Pick<Config, 'maxCacheSize' | 'cacheTtlMs'>): void {
  cache = createTranslationCache(config.maxCacheSize, config.cacheTtlMs);
}

/** 直接调用 Ollama 翻译，无缓存 */
export async function translateText(text: string, config: Config): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.translateTimeoutMs);

  try {
    const res = await fetch(`http://${config.ollamaHost}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.model,
        messages: [
          {
            role: 'system',
            content:
              'You are a professional translator. Translate the following English text into Simplified Chinese. Return only the translation without any explanation.',
          },
          { role: 'user', content: text },
        ],
        stream: false,
        options: {
          temperature: 0.1,
          num_predict: Math.max(1024, Math.ceil(text.length * 2)),
        },
      }),
      signal: controller.signal,
    });

    if (!res.ok) throw new Error(`Ollama 返回 ${res.status}: ${await res.text()}`);

    const data = (await res.json()) as { message?: { content?: string } };
    const translated = data.message?.content?.trim();
    if (!translated) throw new Error('Ollama 返回空内容');
    return translated;
  } finally {
    clearTimeout(timeoutId);
  }
}

/** 带缓存+回退的翻译接口 */
export async function translateWithFallback(text: string, config: Config): Promise<string> {
  try {
    if (!cache) initCache(config);
    return await cache!.getOrSet(text, () => translateText(text, config));
  } catch (err) {
    console.warn('[Translator] 翻译失败，回退原文:', (err as Error).message);
    return text;
  }
}

/** 检测 Ollama 是否可用 */
export async function checkOllama(
  config: Config,
): Promise<{ ok: boolean; missingModel?: boolean }> {
  try {
    const res = await fetch(`http://${config.ollamaHost}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { ok: false };
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    const hasModel =
      data.models?.some(
        m => m.name === config.model || m.name.startsWith(config.model + ':'),
      ) ?? false;
    return { ok: true, missingModel: !hasModel };
  } catch {
    return { ok: false };
  }
}
