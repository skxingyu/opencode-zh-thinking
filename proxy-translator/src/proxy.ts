import http from 'node:http';
import type { Config } from './config.js';
import { createSSETransform } from './sseParser.js';
import { createReasoningState, handleBusEvent, getEventCategory, translateEvent } from './eventHandler.js';

/**
 * 安全结束一个 Writable 流，不抛异常。
 */
function safeEnd(stream: NodeJS.WritableStream | null | undefined): void {
  if (!stream) return;
  try {
    if (!(stream as any).destroyed && !(stream as any).writableEnded) {
      stream.end();
    }
  } catch {
    /* 忽略关闭过程中的异常 */
  }
}

/** 创建全量 HTTP 反向代理 */
export function createProxy(config: Config): http.Server {
  return http.createServer((req, res) => {
    const options: http.RequestOptions = {
      hostname: config.serverHost,
      port: config.serverPort,
      path: req.url ?? '/',
      method: req.method,
      headers: {
        ...req.headers,
        host: `${config.serverHost}:${config.serverPort}`,
      },
    };

    // 所有流上的 error 吞掉，防止未捕获异常崩溃进程
    const noop = () => {};

    const proxyReq = http.request(options, (proxyRes) => {
      const contentType = proxyRes.headers['content-type'] ?? '';

      proxyRes.on('error', noop);

      if (contentType.includes('text/event-stream')) {
        console.log('[Proxy] SSE 连接建立:', req.url, 'client:', req.socket?.remoteAddress);
        res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers);
        const state = createReasoningState();
        const sseTransform = createSSETransform(config, state, handleBusEvent, getEventCategory, translateEvent);
        sseTransform.on('error', noop);
        proxyRes.pipe(sseTransform).pipe(res);
        proxyRes.on('end', () => console.log('[Proxy] SSE 上游结束:', req.url));
        res.on('close', () => console.log('[Proxy] SSE 下游关闭:', req.url));
        return;
      }

      res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers);
      proxyRes.pipe(res);
    });

    proxyReq.on('error', () => {
      console.log('[Proxy] 上游连接失败:', req.url);
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'text/plain' });
      }
      safeEnd(res);
    });

    req.on('error', noop);
    res.on('error', noop);

    req.pipe(proxyReq);
  });
}
