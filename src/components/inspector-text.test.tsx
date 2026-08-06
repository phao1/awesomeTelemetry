import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

import {
  HighlightedJson,
  isDesensitizationEnabled,
  looksLikeJson,
  redactSecrets,
  setDesensitizationEnabled,
  tokenizeJson,
} from './inspector-text.js';

const containers: HTMLDivElement[] = [];

afterEach(() => {
  while (containers.length > 0) {
    const container = containers.pop();
    if (container !== undefined) {
      container.remove();
    }
  }
});

function renderJson(node: React.ReactNode): string {
  const container = document.createElement('div');
  document.body.appendChild(container);
  containers.push(container);
  const root = createRoot(container);
  act(() => {
    root.render(node);
  });
  return container.innerHTML;
}

describe('redactSecrets（建议 6）', () => {
  it('遮蔽 sk- / Bearer 长串', () => {
    expect(redactSecrets('key sk-abcdefghijklmnopqrstuvwxyz123')).toContain('sk-****');
    expect(redactSecrets('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.xxxx')).toContain('Bearer ****');
  });

  it('遮蔽 token 字段值（16+ 字符）', () => {
    const out = redactSecrets('"token": "abcdefghijklmnop123456"');
    expect(out).toBe('"token": "****"');
    expect(redactSecrets("token=abcdefghijklmnop123456")).toBe('token=****');
  });

  it('整块遮蔽私钥', () => {
    const key = '-----BEGIN RSA PRIVATE KEY-----\nabc==\n-----END RSA PRIVATE KEY-----';
    expect(redactSecrets(`key: ${key}`)).toContain('***PRIVATE KEY REDACTED***');
    expect(redactSecrets(`key: ${key}`)).not.toContain('BEGIN');
  });

  it('普通文本不受影响', () => {
    expect(redactSecrets('npm run test passed')).toBe('npm run test passed');
  });
});

describe('tokenizeJson（建议 5）', () => {
  it('识别 6 类 token', () => {
    const tokens = tokenizeJson('{"a": 1, "b": true, "c": null, "d": "x"}');
    const types = tokens.map((token) => token.type);
    expect(types).toContain('key');
    expect(types).toContain('number');
    expect(types).toContain('boolean');
    expect(types).toContain('null');
    expect(types).toContain('string');
    expect(types).toContain('punctuation');
    expect(tokens.find((token) => token.type === 'key')?.text).toBe('"a":');
  });

  it('嵌套与转义字符串不破坏结构', () => {
    const source = '{"s": "a\\"b", "n": -1.5e3}';
    const tokens = tokenizeJson(source);
    // "s"/"n" 是 key token，值中只有 "a\"b" 一个字符串
    expect(tokens.filter((token) => token.type === 'string').length).toBe(1);
    expect(tokens.filter((token) => token.type === 'number')[0]?.text).toBe('-1.5e3');
  });

  it('looksLikeJson 判定首尾括号', () => {
    expect(looksLikeJson('{"a":1}')).toBe(true);
    expect(looksLikeJson('  [1, 2]  ')).toBe(true);
    expect(looksLikeJson('plain text')).toBe(false);
  });
});

describe('desensitization 开关', () => {
  it('默认开启，可切换并持久化', () => {
    expect(isDesensitizationEnabled()).toBe(true);
    setDesensitizationEnabled(false);
    expect(isDesensitizationEnabled()).toBe(false);
    setDesensitizationEnabled(true);
    expect(isDesensitizationEnabled()).toBe(true);
  });
});

describe('HighlightedJson（建议 5，大文本截断）', () => {
  it('超长 JSON 只高亮前 maxChars，并显示截断提示', () => {
    const big = `{"a": "${'x'.repeat(5000)}"}`;
    const html = renderJson(<HighlightedJson text={big} maxChars={100} truncatedLabel="TRUNCATED" />);
    expect(html).toContain('TRUNCATED');
    expect(html).toContain('inspector-json-key');
  });

  it('短 JSON 不高亮截断提示', () => {
    const html = renderJson(<HighlightedJson text='{"a": 1}' maxChars={100} />);
    expect(html).not.toContain('inspector-json-truncated');
    expect(html).toContain('inspector-json-key');
  });
});
