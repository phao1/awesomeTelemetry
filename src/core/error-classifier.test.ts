import { describe, expect, it } from 'vitest';

import { classifyErrorText } from './error-classifier.js';

describe('classifyErrorText（add-mission-control B9）', () => {
  it('各类关键词确定性映射', () => {
    expect(classifyErrorText('Error: connect ETIMEDOUT')).toBe('timeout');
    expect(classifyErrorText('request timed out after 30s')).toBe('timeout');
    expect(classifyErrorText('ECONNREFUSED 127.0.0.1:443')).toBe('network');
    expect(classifyErrorText('failed to fetch https://...')).toBe('network');
    expect(classifyErrorText('permission denied: /root')).toBe('permission');
    expect(classifyErrorText('EACCES: cannot open file')).toBe('permission');
    expect(classifyErrorText('ENOENT: no such file or directory')).toBe('notfound');
    expect(classifyErrorText('404 Not Found')).toBe('notfound');
    expect(classifyErrorText('SyntaxError: Unexpected token }')).toBe('parse');
    expect(classifyErrorText('command not found: rg')).toBe('shell');
    expect(classifyErrorText('Exit Code: 1')).toBe('shell');
  });

  it('空文本与未知文本归 other，不抛错', () => {
    expect(classifyErrorText(null)).toBe('other');
    expect(classifyErrorText('')).toBe('other');
    expect(classifyErrorText('some weird vendor message')).toBe('other');
  });
});
