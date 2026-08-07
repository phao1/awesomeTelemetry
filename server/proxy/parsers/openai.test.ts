import { describe, expect, it } from 'vitest';

import { parseProxyRequest } from '../parser-router.js';
import { extractOpenAiUsage, parseOpenAiRequest } from './openai.js';

describe('REQ-009 OpenAI 解析（tasks §3.8）', () => {
  it('Chat：model + system message + response usage', () => {
    const parsed = parseOpenAiRequest({
      requestBody: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: 'be concise' },
          { role: 'user', content: 'hi' },
        ],
      }),
      responseBody: JSON.stringify({ usage: { prompt_tokens: 12, completion_tokens: 4 } }),
    });
    expect(parsed.model).toBe('gpt-4o');
    expect(parsed.systemPrompt).toBe('be concise');
    expect(parsed.inputTokens).toBeNull();
    expect(parsed.outputTokens).toBeNull();
  });

  it('extractOpenAiUsage：正常/空/非法 response', () => {
    expect(extractOpenAiUsage('{"usage":{"prompt_tokens":5,"completion_tokens":2}}')).toEqual({
      inputTokens: 5,
      outputTokens: 2,
    });
    expect(extractOpenAiUsage(null)).toEqual({ inputTokens: null, outputTokens: null });
    expect(extractOpenAiUsage('not-json')).toEqual({ inputTokens: null, outputTokens: null });
  });

  it('Responses：instructions 不作为 Chat system（分类 openai_responses，§3.5）', () => {
    const parsed = parseProxyRequest({
      hostname: 'api.openai.com',
      url: '/v1/responses',
      requestBody: JSON.stringify({ model: 'gpt-4o', instructions: 'be concise', input: [{ role: 'user', content: 'hi' }] }),
    });
    expect(parsed.requestFormat).toBe('openai_responses');
    expect(parsed.model).toBe('gpt-4o');
  });

  it('Responses-before-Chat：含 input 的负载不因 openai 路由误标为 Chat', () => {
    const parsed = parseProxyRequest({
      hostname: 'api.openai.com',
      url: '/v1/responses',
      requestBody: JSON.stringify({ model: 'gpt-4o', input: [{ type: 'message', role: 'user', content: [] }] }),
    });
    expect(parsed.requestFormat).toBe('openai_responses');
  });
});
