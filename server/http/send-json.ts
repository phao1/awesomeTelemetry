import { gzipSync } from 'node:zlib';
import type { IncomingMessage, ServerResponse } from 'node:http';

export const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';
export const GZIP_THRESHOLD = 1024;

export function acceptsGzip(req?: IncomingMessage): boolean {
  return (req?.headers['accept-encoding'] ?? '').toString().includes('gzip');
}

/**
 * contracts/api.md §0.2：响应体 ≥ 1024 字节且 accept-encoding 含 gzip 时
 * 必须 gzip 并带 content-encoding + vary；否则带 content-length。
 */
export function sendCompressedOrPlain(
  res: ServerResponse,
  status: number,
  headers: Record<string, string | number>,
  payload: Buffer,
  req?: IncomingMessage,
): void {
  if (payload.length >= GZIP_THRESHOLD && acceptsGzip(req)) {
    const compressed = gzipSync(payload);
    res.writeHead(status, {
      ...headers,
      'content-encoding': 'gzip',
      vary: 'accept-encoding',
      'content-length': compressed.length,
    });
    res.end(compressed);
    return;
  }
  res.writeHead(status, {
    ...headers,
    'content-length': payload.length,
  });
  res.end(payload);
}

export function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  req?: IncomingMessage,
): void {
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  sendCompressedOrPlain(
    res,
    status,
    { 'content-type': JSON_CONTENT_TYPE },
    payload,
    req,
  );
}
