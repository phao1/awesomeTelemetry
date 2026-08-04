import { describe, expect, it } from 'vitest';

import Database from 'better-sqlite3';

import { initSchema } from '../storage/schema.js';
import { RequestContext } from './request-context.js';
import { parseProxyRequest } from './parser-router.js';
import { writeProxyRequest } from './proxy-writer.js';

function setup() {
  const db = new Database(':memory:');
  initSchema(db);
  return db;
}

describe('REQ-004/005 proxy-writer', () => {
  it('keepRawBodies 默认 false：不写 raw 列，写 system_prompt_len', () => {
    const db = setup();
    const ctx = new RequestContext(
      { method: 'POST', url: 'https://api.openai.com/v1/chat/completions', hostname: 'api.openai.com', headers: { authorization: 'Bearer sk-abcdefghijklmnopqrstuvwxyz123' }, startedAt: '2026-08-01T00:00:00.000Z' },
      1,
    );
    const parsed = parseProxyRequest({
      hostname: 'api.openai.com',
      requestBody: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'system', content: 'prompt' }] }),
    });
    let notified = 0;
    const id = writeProxyRequest({
      db,
      ctx,
      parsed,
      desensitizedRequestBody: '{"model":"gpt-4o"}',
      desensitizedResponseBody: '{"ok":true}',
      contentType: 'application/json',
      isStreaming: false,
      captureMethod: 'mitm',
      notify: () => {
        notified += 1;
      },
    });

    expect(notified).toBe(1);
    const row = db.prepare('SELECT * FROM proxy_requests WHERE id = ?').get(id) as Record<string, unknown>;
    expect(row.raw_request_body).toBeNull();
    expect(row.raw_response_body).toBeNull();
    expect(row.system_prompt).toBe('prompt');
    expect(row.system_prompt_len).toBe('prompt'.length);
    expect(row.parser_route).toBe('openai');
    expect(row.ttnet_encrypted).toBe(0);
    db.close();
  });

  it('keepRawBodies true 时写 raw 列；TTNet 标记', () => {
    const db = setup();
    const ctx = new RequestContext(
      { method: 'POST', url: 'u', hostname: 'h', headers: { 'x-tt-encrypt-version': '2' } },
      2,
    );
    const parsed = parseProxyRequest({ hostname: 'h', requestBody: '{}' });
    const id = writeProxyRequest({
      db,
      ctx,
      parsed,
      desensitizedRequestBody: 'req',
      desensitizedResponseBody: 'resp',
      contentType: null,
      isStreaming: false,
      captureMethod: 'mitm',
      desensitizeOptions: { keepRawBodies: true },
    });
    const row = db.prepare('SELECT raw_request_body, raw_response_body, ttnet_encrypted FROM proxy_requests WHERE id = ?').get(id) as {
      raw_request_body: string | null;
      raw_response_body: string | null;
      ttnet_encrypted: number;
    };
    expect(row.raw_request_body).toBe('req');
    expect(row.raw_response_body).toBe('resp');
    expect(row.ttnet_encrypted).toBe(1);
    db.close();
  });
});
