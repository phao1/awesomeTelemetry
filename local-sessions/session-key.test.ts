import { describe, expect, it } from 'vitest';

import { sessionKey } from './session-key.js';

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
