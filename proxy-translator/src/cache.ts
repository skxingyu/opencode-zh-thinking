import { createHash } from 'node:crypto';
import { LRUCache } from 'lru-cache';

type TranslateFn = () => Promise<string>;

/** 翻译缓存：LRU + TTL + single-flight */
export function createTranslationCache(max: number, ttlMs: number) {
  const cache = new LRUCache<string, string>({ max, ttl: ttlMs });
  const inFlight = new Map<string, Promise<string>>();

  return {
    key(text: string): string {
      return createHash('sha256').update(text).digest('hex');
    },

    async getOrSet(text: string, translate: TranslateFn): Promise<string> {
      const k = this.key(text);
      const cached = cache.get(k);
      if (cached) return cached;

      const existing = inFlight.get(k);
      if (existing) return existing;

      const promise = translate()
        .then(result => {
          cache.set(k, result);
          inFlight.delete(k);
          return result;
        })
        .catch(err => {
          inFlight.delete(k);
          throw err;
        });

      inFlight.set(k, promise);
      return promise;
    },

    size(): number {
      return cache.size;
    },
  };
}

export type TranslationCache = ReturnType<typeof createTranslationCache>;
