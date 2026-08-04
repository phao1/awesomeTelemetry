import { describe, expect, it } from 'vitest';

import { join } from 'node:path';

import { deriveSessionKey, sessionKey } from './session-key.js';

describe('REQ-007 sessionKey', () => {
  it('格式为 provider-14 位 hex，且确定性', () => {
    const a = sessionKey('codex', 'abc', '/tmp/x.jsonl');
    const b = sessionKey('codex', 'abc', '/tmp/x.jsonl');
    expect(a).toMatch(/^codex-[0-9a-f]{14}$/);
    expect(a).toBe(b);
  });

  it('包含 sourcePath，同 provider 同 id 不同文件不撞 key', () => {
    const a = sessionKey('codex', 'abc', '/tmp/x.jsonl');
    const b = sessionKey('codex', 'abc', '/tmp/y.jsonl');
    expect(a).not.toBe(b);
  });

  it('不同 provider 不撞 key', () => {
    expect(sessionKey('codex', 'abc', '/tmp/x.jsonl')).not.toBe(
      sessionKey('claude', 'abc', '/tmp/x.jsonl'),
    );
  });
});

describe('T-02 deriveSessionKey 统一口径', () => {
  it('JSONL 类（innerId 缺省）以文件名为稳定来源标识', () => {
    const path = join('/tmp', 'x', 'ca2a3d02.jsonl');
    expect(deriveSessionKey('claude', path)).toBe(
      sessionKey('claude', 'ca2a3d02.jsonl', path),
    );
  });

  it('SQLite 类（innerId 提供）以行内 session id 为稳定来源标识', () => {
    const path = join('/tmp', 'opencode.db');
    expect(deriveSessionKey('opencode', path, 'oc-s1')).toBe(
      sessionKey('opencode', 'oc-s1', path),
    );
  });
});
