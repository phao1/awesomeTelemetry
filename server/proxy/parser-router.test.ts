import { describe, expect, it } from 'vitest';

import { parseProxyRequest, routeParser } from './parser-router.js';

describe('REQ-008 hostname 路由', () => {
  it('精确域名', () => {
    expect(routeParser('api.openai.com')).toBe('openai');
    expect(routeParser('openai.azure.com')).toBe('openai');
    expect(routeParser('api.anthropic.com')).toBe('anthropic');
    expect(routeParser('console.enterprise.trae.cn')).toBe('trae-tunnel');
  });

  it('关键词启发式', () => {
    expect(routeParser('api.siliconflow.cn')).toBe('openai');
    expect(routeParser('ark.cn-beijing.volces.com')).toBe('openai');
    expect(routeParser('claude.internal')).toBe('anthropic');
    expect(routeParser('example.com')).toBeNull();
  });
});

describe('REQ-009 解析', () => {
  it('OpenAI：model + system prompt + response usage', () => {
    const parsed = parseProxyRequest({
      hostname: 'api.openai.com',
      requestBody: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'system', content: 'be concise' }] }),
      responseBody: JSON.stringify({ usage: { prompt_tokens: 12, completion_tokens: 4 } }),
    });
    expect(parsed.model).toBe('gpt-4o');
    expect(parsed.systemPrompt).toBe('be concise');
    expect(parsed.systemPromptLen).toBe('be concise'.length);
    expect(parsed.inputTokens).toBe(12);
    expect(parsed.outputTokens).toBe(4);
    expect(parsed.parserRoute).toBe('openai');
  });

  it('JSON 解析失败降级字符串扫描', () => {
    const parsed = parseProxyRequest({
      hostname: 'api.openai.com',
      requestBody: 'not-json "model":"gpt-4o-mini" "role":"system" "content":"hi"',
    });
    expect(parsed.model).toBe('gpt-4o-mini');
    expect(parsed.systemPrompt).toBe('hi');
  });

  it('Anthropic：顶层 system + input/output_tokens', () => {
    const parsed = parseProxyRequest({
      hostname: 'api.anthropic.com',
      requestBody: JSON.stringify({ model: 'claude-3-5-sonnet', system: 'sys text' }),
      responseBody: JSON.stringify({ usage: { input_tokens: 7, output_tokens: 3 } }),
    });
    expect(parsed.model).toBe('claude-3-5-sonnet');
    expect(parsed.systemPrompt).toBe('sys text');
    expect(parsed.inputTokens).toBe(7);
    expect(parsed.outputTokens).toBe(3);
    expect(parsed.parserRoute).toBe('anthropic');
  });

  it('流式响应从 SSE usage 提取 token', () => {
    const parsed = parseProxyRequest({
      hostname: 'api.openai.com',
      requestBody: JSON.stringify({ model: 'gpt-4o' }),
      isStreaming: true,
      sseEvents: [{ event: 'x', data: '{"usage":{"prompt_tokens":9,"completion_tokens":2}}' }],
    });
    expect(parsed.inputTokens).toBe(9);
    expect(parsed.outputTokens).toBe(2);
  });

  it('Trae tunnel 尽力解析 model', () => {
    const parsed = parseProxyRequest({
      hostname: 'console.enterprise.trae.cn',
      requestBody: '{"model":"trae-coder"}',
    });
    expect(parsed.parserRoute).toBe('trae-tunnel');
    expect(parsed.model).toBe('trae-coder');
    expect(parsed.systemPrompt).toBeNull();
  });
});
