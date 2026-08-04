import type { Database } from 'better-sqlite3';

import type { CaptureMethod } from '../../src/core/trace-types.js';
import { cachedStmt } from '../storage/stmt-cache.js';
import type { ParsedRequest } from './parser-router.js';
import type { RequestContext } from './request-context.js';
import { shouldKeepRawBodies, type DesensitizeOptions } from '../desensitization/engine.js';

const INSERT_PROXY_SQL =
  `INSERT INTO proxy_requests (request_id, method, url, hostname, request_headers, request_body, ` +
  `response_status, response_body, content_type, is_streaming, started_at, completed_at, duration_ms, ` +
  `capture_method, ttnet_encrypted, system_prompt, system_prompt_len, model, input_tokens, output_tokens, ` +
  `parsed_session_id, parser_route, raw_request_body, raw_response_body) ` +
  `VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

export interface ProxyWriteInput {
  db: Database;
  ctx: RequestContext;
  parsed: ParsedRequest;
  /** 已脱敏的 body（REQ-004：存储前必须脱敏）。 */
  desensitizedRequestBody: string | null;
  desensitizedResponseBody: string | null;
  contentType: string | null;
  isStreaming: boolean;
  captureMethod: CaptureMethod;
  desensitizeOptions?: DesensitizeOptions;
  notify?: (id: number) => void;
}

/** REQ-004/005：写入 proxy_requests；keepRawBodies 默认 false 时不写 raw 列。 */
export function writeProxyRequest(input: ProxyWriteInput): number {
  const keepRaw = shouldKeepRawBodies(input.desensitizeOptions);
  const completed = input.ctx.completeRequest(input.ctx.responseStatus ?? 0);
  const info = cachedStmt(input.db, INSERT_PROXY_SQL).run(
    input.ctx.requestId,
    input.ctx.method,
    input.ctx.url,
    input.ctx.hostname,
    JSON.stringify(input.ctx.headers),
    input.desensitizedRequestBody,
    input.ctx.responseStatus,
    input.desensitizedResponseBody,
    input.contentType,
    input.isStreaming ? 1 : 0,
    input.ctx.startedAt,
    new Date().toISOString(),
    completed.durationMs,
    input.captureMethod,
    input.ctx.ttnetEncrypted ? 1 : 0,
    input.parsed.systemPrompt,
    input.parsed.systemPromptLen,
    input.parsed.model,
    input.parsed.inputTokens,
    input.parsed.outputTokens,
    null,
    input.parsed.parserRoute,
    keepRaw ? input.desensitizedRequestBody : null,
    keepRaw ? input.desensitizedResponseBody : null,
  );
  const id = Number(info.lastInsertRowid);
  input.notify?.(id);
  return id;
}
