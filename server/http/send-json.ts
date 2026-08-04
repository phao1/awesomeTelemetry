import { gzipSync } from 'node:zlib';
import type { IncomingMessage, ServerResponse } from 'node:http';

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';
const GZIP_THRESHOLD = 1024;

/**
 * contracts/api.md §0.2：响应体 ≥ 1024 字节且 accept-encoding 含 gzip 时
 * 必须 gzip 并带 content-encoding + vary；否则带 content-length。
 */
export function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  req?: IncomingMessage,
): void {
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  const acceptGzip = (req?.headers['accept-encoding'] ?? '').toString().includes('gzip');
  if (payload.length >= GZIP_THRESHOLD && acceptGzip) {
    const compressed = gzipSync(payload);
    res.writeHead(status, {
      'content-type': JSON_CONTENT_TYPE,
      'content-encoding': 'gzip',
      vary: 'accept-encoding',
      'content-length': compressed.length,
    });
    res.end(compressed);
    return;
  }
  res.writeHead(status, {
    'content-type': JSON_CONTENT_TYPE,
    'content-length': payload.length,
  });
  res.end(payload);
}
