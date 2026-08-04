import { describe, expect, it } from 'vitest';

import { RequestContext } from './request-context.js';

describe('REQ-006/011 request-context', () => {
  it('TTNet 头检测', () => {
    expect(new RequestContext({ method: 'POST', url: 'u', hostname: 'h', headers: { 'x-tt-encrypt-version': '2' } }).ttnetEncrypted).toBe(true);
    expect(new RequestContext({ method: 'POST', url: 'u', hostname: 'h', headers: { authorization: 'Bearer x' } }).ttnetEncrypted).toBe(false);
  });

  it('requestId 格式 req-{timestamp}-{counter}', () => {
    const ctx = new RequestContext({ method: 'GET', url: 'u', hostname: 'h', headers: {} }, 42);
    expect(ctx.requestId).toMatch(/^req-\d+-42$/);
  });

  it('chunk 累积 + completeRequest 计算 durationMs 与最终 body', () => {
    const ctx = new RequestContext(
      { method: 'POST', url: 'u', hostname: 'h', headers: {}, startedAt: '2026-08-01T00:00:00.000Z' },
      1,
    );
    ctx.appendChunk('data: {"a":1}\n\n');
    ctx.appendChunk('data: {"a":2}\n\n');
    const completed = ctx.completeRequest(200, '2026-08-01T00:00:02.000Z');
    expect(completed.durationMs).toBe(2000);
    expect(completed.body).toContain('{"a":2}');
    expect(ctx.responseStatus).toBe(200);
  });
});
