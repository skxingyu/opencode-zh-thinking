/** 代理配置 */
export interface Config {
  /** 代理监听端口，默认 8081 */
  listenPort: number;
  /** OpenCode Server 地址，默认 localhost */
  serverHost: string;
  /** OpenCode Server 端口，默认 4096 */
  serverPort: number;
  /** Ollama 地址，默认 localhost:11434 */
  ollamaHost: string;
  /** 翻译模型名，默认 kaelri/hy-mt2:1.8b */
  model: string;
  /** 翻译超时（ms），默认 30000 */
  translateTimeoutMs: number;
  /** 缓存最大条目数，默认 2000 */
  maxCacheSize: number;
  /** 缓存 TTL（ms），默认 24h */
  cacheTtlMs: number;
}

export function loadConfig(): Config {
  return {
    listenPort: Number(process.env.OT_LISTEN_PORT ?? 8081),
    serverHost: process.env.OT_SERVER_HOST ?? 'localhost',
    serverPort: Number(process.env.OT_SERVER_PORT ?? 4096),
    ollamaHost: process.env.OT_OLLAMA_HOST ?? 'localhost:11434',
    model: process.env.OT_MODEL ?? 'kaelri/hy-mt2:1.8b',
    translateTimeoutMs: Number(process.env.OT_TRANSLATE_TIMEOUT_MS ?? 30000),
    maxCacheSize: Number(process.env.OT_MAX_CACHE_SIZE ?? 2000),
    cacheTtlMs: Number(process.env.OT_CACHE_TTL_MS ?? 86400000),
  };
}
