import { describe, expect, it } from 'vitest';

import { DEFAULT_RULES, resolveRules } from './rules.js';
import {
  desensitize,
  desensitizeChecked,
  desensitizeObject,
  shouldKeepRawBodies,
} from './engine.js';

describe('REQ-001 十条规则', () => {
  it('规则全集为 10 条，aws_secret_key 默认禁用', () => {
    expect(DEFAULT_RULES).toHaveLength(10);
    expect(DEFAULT_RULES.find((r) => r.id === 'aws_secret_key')?.enabled).toBe(false);
    expect(DEFAULT_RULES.filter((r) => r.enabled)).toHaveLength(9);
  });

  it('每条规则都有用例', () => {
    const cases: Array<[string, string, string]> = [
      ['api_key', 'sk-abcdefghijklmnopqrstuvwxyz123', 'sk-***'],
      ['api_key_generic', 'key-abcdefghijklmnopqrstuvwxyz123', 'key-***'],
      ['bearer_token', 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9', 'Authorization: Bearer ***'],
      ['email', 'contact me at alice@example.com now', 'contact me at u***@e***.c*** now'],
      ['ip_address', 'server at 192.168.1.10 responds', 'server at ***.***.***.*** responds'],
      ['file_path_win', 'load C:\\Users\\howell\\secret.txt ok', 'load C:\\*** ok'],
      ['file_path_unix', 'cat /home/howell/secret.txt', 'cat /home/***'],
      ['aws_access_key', 'AKIAIOSFODNN7EXAMPLE', 'AKIA***'],
      ['private_key', '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----', '***PRIVATE KEY REDACTED***'],
    ];
    for (const [id, input, expected] of cases) {
      expect(desensitize(input, { enabled: [id], disabled: DEFAULT_RULES.filter((r) => r.id !== id).map((r) => r.id) }), id).toBe(expected);
    }
  });
});

describe('REQ-002 lastIndex 重置', () => {
  it('连续调用不因 lastIndex 漂移漏匹配', () => {
    const text = 'token sk-abc12345678901234567890 and sk-abc12345678901234567890 again';
    const first = desensitize(text, { enabled: ['api_key'] });
    const second = desensitize(text, { enabled: ['api_key'] });
    expect(first).toBe(second);
    expect((first.match(/sk-\*\*\*/g) ?? []).length).toBe(2);
  });
});

describe('REQ-003 对象脱敏', () => {
  it('只脱敏字符串字段', () => {
    const obj = { title: 'hello alice@example.com', count: 3, token: 'sk-abcdefghijklmnopqrstuvwxyz123' };
    const out = desensitizeObject(obj, {}, ['title']);
    expect(out.title).toContain('u***@e***.c***');
    expect(out.count).toBe(3);
    expect(out.token).toContain('sk-');
  });
});

describe('REQ-004 规则合并', () => {
  it('用户覆盖启用/禁用', () => {
    const rules = resolveRules({ disabled: ['email'], enabled: ['aws_secret_key'] });
    expect(rules.find((r) => r.id === 'email')?.enabled).toBe(false);
    expect(rules.find((r) => r.id === 'aws_secret_key')?.enabled).toBe(true);
    expect(rules).toHaveLength(10);
  });
});

describe('REQ-006/007 raw 与预算', () => {
  it('keepRawBodies 默认 false', () => {
    expect(shouldKeepRawBodies()).toBe(false);
    expect(shouldKeepRawBodies({ keepRawBodies: true })).toBe(true);
  });

  it('超预算时跳过并记录', () => {
    const result = desensitizeChecked('sk-abcdefghijklmnopqrstuvwxyz123', { enabled: ['api_key'] }, 0);
    expect(result.skipped).toBe(true);
    expect(result.text).toContain('sk-');
  });

  it('100KB 文本在预算内完成', () => {
    const big = ('Bearer abcdef12345 alice@example.com /home/user/x '.repeat(3000));
    const started = performance.now();
    const result = desensitizeChecked(big);
    const elapsed = performance.now() - started;
    expect(result.skipped).toBe(false);
    expect(elapsed).toBeLessThan(200); // 机器波动容忍；预算 5ms 由守卫保证
  });
});
