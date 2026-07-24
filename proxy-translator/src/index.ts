import { createProxy } from './proxy.js';
import { loadConfig } from './config.js';
import { initCache, checkOllama } from './translator.js';

// 全局未捕获异常处理器，确保代理不会因单个连接异常而崩溃
process.on('uncaughtException', (err) => {
  console.error('[入口] 未捕获异常 (已接管):', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('[入口] 未处理 Promise 拒绝 (已接管):', String(reason));
});

async function main(): Promise<void> {
  const config = loadConfig();
  initCache(config);

  // 启动时检测 Ollama 状态
  const ollama = await checkOllama(config);
  if (!ollama.ok) {
    console.warn('[入口] Ollama 不可用，代理将以纯透传模式运行。');
  } else if (ollama.missingModel) {
    console.warn(
      `[入口] 模型 ${config.model} 未拉取，请运行: ollama pull ${config.model}`,
    );
  }

  const server = createProxy(config);
  server.listen(config.listenPort, () => {
    console.log(`[入口] 代理已启动: http://localhost:${config.listenPort}`);
    console.log(
      `[入口] 目标 Server: http://${config.serverHost}:${config.serverPort}`,
    );
    console.log(
      `[入口] 翻译模型: ${config.model} (Ollama: ${ollama.ok ? '✓' : '✗'})`,
    );
  });

  // 优雅关闭
  const shutdown = () => {
    console.log('\n[入口] 关闭代理...');
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[入口] 启动失败:', err);
  process.exit(1);
});
