import { describe, expect, it } from 'vitest';

import { parseProxyRequest } from '../parser-router.js';
import { parseAnthropicRequest } from './anthropic.js';

describe('REQ-009 Anthropic 解析（tasks §3.8）', () => {
  it('model + 顶层 system + response usage', () => {
    const parsed = parseAnthropicRequest({
      requestBody: JSON.stringify({ model: 'claude-3-5-sonnet', system: 'sys text', messages: [] }),
      responseBody: JSON.stringify({ usage: { input_tokens: 7, output_tokens: 3 } }),
    });
    expect(parsed.model).toBe('claude-3-5-sonnet');
    expect(parsed.systemPrompt).toBe('sys text');
    expect(parsed.systemPromptLen).toBe('sys text'.length);
    expect(parsed.inputTokens).toBe(7);
    expect(parsed.outputTokens).toBe(3);
  });

  it('非法 JSON：model/systemPrompt 降级字符串扫描，usage null', () => {
    const parsed = parseAnthropicRequest({
      requestBody: 'broken "model":"claude-x" "system":"s"',
      responseBody: 'not-json',
    });
    expect(parsed.model).toBe('claude-x');
    expect(parsed.systemPrompt).toBe('s');
    expect(parsed.inputTokens).toBeNull();
    expect(parsed.outputTokens).toBeNull();
  });

  it('非字符串 system（content blocks 数组）保持 null（分类由 shape 完成）', () => {
    const parsed = parseAnthropicRequest({
      requestBody: JSON.stringify({ model: 'claude-3-5-sonnet', system: [{ type: 'text', text: 'sys' }], messages: [] }),
    });
    expect(parsed.systemPrompt).toBeNull();
  });

  it('parseProxyRequest 对 anthropic 路由输出 anthropic_messages', () => {
    const parsed = parseProxyRequest({
      hostname: 'api.anthropic.com',
      url: '/v1/messages',
      requestBody: JSON.stringify({ model: 'claude-3-5-sonnet', messages: [{ role: 'user', content: 'hi' }] }),
    });
    expect(parsed.parserRoute).toBe('anthropic');
    expect(parsed.requestFormat).toBe('anthropic_messages');
  });
});
