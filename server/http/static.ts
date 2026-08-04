import { existsSync, readFileSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';

import { sendCompressedOrPlain } from './send-json.js';

const HTML_CONTENT_TYPE = 'text/html; charset=utf-8';

const MIME_TYPES: Record<string, string> = {
  '.html': HTML_CONTENT_TYPE,
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

/** 文本类资源才参与 gzip，复用 send-json 的判定策略（≥1KB 且 accept gzip）。 */
const COMPRESSIBLE_EXT = new Set([
  '.html', '.js', '.mjs', '.css', '.json', '.svg', '.map', '.txt', '.wasm',
]);

function contentTypeFor(filePath: string): string {
  return MIME_TYPES[extname(filePath)] ?? 'application/octet-stream';
}

function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/**
 * 把请求路径安全地映射到 dist 内的真实文件。
 * 返回 null 表示路径被判定为穿越（调用方应回 403）。
 * @param pathname 已剥离 query 的原始路径（未解码，可能含 %2e%2e）。
 */
function resolveInsideDist(distDir: string, pathname: string): string | null {
  const decoded = safeDecode(pathname);
  if (decoded === null) {
    return null;
  }
  const segments = decoded.split('/');
  for (const segment of segments) {
    if (segment === '..' || segment === '.' || segment.includes('\\')) {
      return null;
    }
  }
  const rel = decoded.replace(/^\/+/, '') || 'index.html';
  if (rel.includes('\0')) {
    return null;
  }
  const base = resolve(distDir);
  const candidate = resolve(base, rel);
  if (candidate !== base && !candidate.startsWith(base + sep)) {
    return null;
  }
  return candidate;
}

function writeText(
  res: ServerResponse,
  status: number,
  body: string,
  req: IncomingMessage,
  contentType = 'text/plain; charset=utf-8',
): void {
  const payload = Buffer.from(body, 'utf8');
  const headOnly = req.method === 'HEAD';
  res.writeHead(status, {
    'content-type': contentType,
    'content-length': payload.length,
  });
  res.end(headOnly ? undefined : payload);
}

/**
 * T-01：静态兜底（仅在路由未命中时调用）。
 * - dist/ 不存在 → 200 + 人话提示（不是 500）
 * - 路径穿越（.. / 绝对路径逃逸 / 反斜杠）→ 403
 * - 命中文件 → 按 MIME 返回，文本资源复用 send-json 的 gzip 判定
 * - 未命中文件 → SPA fallback 返回 index.html（200）
 */
export function serveStatic(
  req: IncomingMessage,
  res: ServerResponse,
  distDir: string,
): boolean {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return false;
  }

  if (!existsSync(distDir)) {
    writeText(
      res,
      200,
      '<!doctype html><html lang="zh"><head><meta charset="utf-8">' +
        '<title>Agent Observability</title></head><body>' +
        '<p>dist/ 目录不存在：请先运行 <code>npm run build</code>，再执行 <code>npm start</code>。</p>' +
        '</body></html>',
      req,
      HTML_CONTENT_TYPE,
    );
    return true;
  }

  const rawPath = (req.url ?? '/').split('?')[0] ?? '/';
  const filePath = resolveInsideDist(distDir, rawPath);
  if (filePath === null) {
    writeText(res, 403, 'Forbidden: 路径穿越被拒绝', req);
    return true;
  }

  const indexPath = join(distDir, 'index.html');
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    // SPA fallback：非 /api/* 且未命中文件的 GET 返回 index.html（200）
    if (existsSync(indexPath)) {
      const payload = readFileSync(indexPath);
      const compressible = COMPRESSIBLE_EXT.has(extname(indexPath));
      if (compressible) {
        sendCompressedOrPlain(
          res,
          200,
          { 'content-type': HTML_CONTENT_TYPE },
          payload,
          req,
        );
      } else {
        writeText(res, 200, payload.toString('utf8'), req, HTML_CONTENT_TYPE);
      }
      return true;
    }
    writeText(res, 404, 'Not Found', req);
    return true;
  }

  const payload = readFileSync(filePath);
  const contentType = contentTypeFor(filePath);
  if (COMPRESSIBLE_EXT.has(extname(filePath))) {
    sendCompressedOrPlain(
      res,
      200,
      { 'content-type': contentType },
      payload,
      req,
    );
  } else {
    res.writeHead(200, {
      'content-type': contentType,
      'content-length': payload.length,
    });
    res.end(req.method === 'HEAD' ? undefined : payload);
  }
  return true;
}
