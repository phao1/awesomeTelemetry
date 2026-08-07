import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseProxyRequest, routeParser } from './parser-router.js';

const PROXY_DIR = resolve(process.cwd(), 'server', 'proxy');

describe('NFR-P6 / §6.7 forwarding isolation（转发路径不引入 context 标准化/diff）', () => {
  // 转发/采集链路使用的模块：绝不能静态 import context-normalizer / context-diff。
  const forwardingModules = ['mitm-proxy.ts', 'proxy-writer.ts', 'parser-router.ts'];

  for (const file of forwardingModules) {
    it(`${file} 不 import context-normalizer / context-diff / context-diff-service`, () => {
      const src = readFileSync(resolve(PROXY_DIR, file), 'utf8');
      for (const target of ['context-normalizer', 'context-diff', 'context-diff-service']) {
        expect(src).not.toMatch(new RegExp(`from\\s+['"].*${target}['"]`));
      }
    });
  }

  it('路由解析结果不携带任何 diff 结构（只返回分类元数据）', () => {
    const parsed = parseProxyRequest({
      hostname: 'api.anthropic.com',
      requestBody: JSON.stringify({
        model: 'claude-3-5-sonnet',
        messages: [{ role: 'user', content: 'hi' }],
      }),
      responseBody: '',
    });
    expect(parsed).not.toHaveProperty('categories');
    expect(parsed).not.toHaveProperty('noChange');
    expect(parsed).not.toHaveProperty('pairing');
  });
});

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

describe('requestFormat 分类（design D3 / tasks §3.3-§3.5）', () => {
  it('Anthropic Messages：messages + anthropic 路由', () => {
    const parsed = parseProxyRequest({
      hostname: 'api.anthropic.com',
      requestBody: JSON.stringify({ model: 'claude-3-5-sonnet', messages: [{ role: 'user', content: 'hi' }] }),
    });
    expect(parsed.requestFormat).toBe('anthropic_messages');
  });

  it('Anthropic Messages：/v1/messages path 信号（自定义兼容 host）', () => {
    const parsed = parseProxyRequest({
      hostname: 'gateway.example.com',
      url: 'https://gateway.example.com/v1/messages',
      requestBody: JSON.stringify({ model: 'claude-3-5-sonnet', messages: [{ role: 'user', content: 'hi' }] }),
    });
    expect(parsed.requestFormat).toBe('anthropic_messages');
  });

  it('Anthropic Messages：顶层 system 信号', () => {
    const parsed = parseProxyRequest({
      hostname: 'unknown-host.test',
      url: '/custom/endpoint',
      requestBody: JSON.stringify({ system: 'sys', messages: [{ role: 'user', content: 'hi' }] }),
    });
    expect(parsed.requestFormat).toBe('anthropic_messages');
  });

  it('Anthropic Messages：tool input_schema 信号（未知 host）', () => {
    const parsed = parseProxyRequest({
      hostname: 'proxy.internal',
      url: '/',
      requestBody: JSON.stringify({
        model: 'claude-3-5-sonnet',
        messages: [{ role: 'user', content: 'hi' }],
        tools: [{ name: 'get_weather', input_schema: { type: 'object' } }],
      }),
    });
    expect(parsed.requestFormat).toBe('anthropic_messages');
  });

  it('OpenAI Responses：input 字段先于 Chat 判定（§3.5）', () => {
    const parsed = parseProxyRequest({
      hostname: 'api.openai.com',
      url: '/v1/responses',
      requestBody: JSON.stringify({
        model: 'gpt-4o',
        input: [{ role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
      }),
    });
    expect(parsed.requestFormat).toBe('openai_responses');
  });

  it('OpenAI Responses：instructions 字段（不含 messages）', () => {
    const parsed = parseProxyRequest({
      hostname: 'api.openai.com',
      url: '/v1/responses',
      requestBody: JSON.stringify({ model: 'gpt-4o', instructions: 'be concise' }),
    });
    expect(parsed.requestFormat).toBe('openai_responses');
  });

  it('OpenAI Responses：/responses path 信号', () => {
    const parsed = parseProxyRequest({
      hostname: 'gateway.example.com',
      url: 'https://gateway.example.com/v1/responses',
      requestBody: JSON.stringify({ model: 'gpt-4o' }),
    });
    expect(parsed.requestFormat).toBe('openai_responses');
  });

  it('OpenAI Chat：messages + openai 路由', () => {
    const parsed = parseProxyRequest({
      hostname: 'api.openai.com',
      url: '/v1/chat/completions',
      requestBody: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] }),
    });
    expect(parsed.requestFormat).toBe('openai_chat');
  });

  it('OpenAI Chat：messages + 兼容自定义 host（SiliconFlow）', () => {
    const parsed = parseProxyRequest({
      hostname: 'api.siliconflow.cn',
      url: '/v1/chat/completions',
      requestBody: JSON.stringify({ model: 'deepseek-ai/DeepSeek-V3', messages: [{ role: 'user', content: 'hi' }] }),
    });
    expect(parsed.requestFormat).toBe('openai_chat');
  });

  it('OpenAI Chat：messages + function tool 形状（未知 host）', () => {
    const parsed = parseProxyRequest({
      hostname: 'llm.internal',
      url: '/v1/chat/completions',
      requestBody: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'hi' }],
        tools: [{ type: 'function', function: { name: 'f', parameters: { type: 'object' } } }],
      }),
    });
    expect(parsed.requestFormat).toBe('openai_chat');
  });

  it('歧义 messages-only 负载在未知路由保持 unknown（§3.4，不猜）', () => {
    const parsed = parseProxyRequest({
      hostname: 'mystery.example.com',
      url: '/weird',
      requestBody: JSON.stringify({ model: 'x', messages: [{ role: 'user', content: 'hi' }] }),
    });
    expect(parsed.requestFormat).toBe('unknown');
  });

  it('非法 JSON → unknown', () => {
    const parsed = parseProxyRequest({
      hostname: 'api.openai.com',
      requestBody: 'not-json "model":"gpt-4o-mini" "role":"system" "content":"hi"',
    });
    expect(parsed.requestFormat).toBe('unknown');
  });

  it('空 body → unknown', () => {
    const parsed = parseProxyRequest({ hostname: 'api.anthropic.com', requestBody: '' });
    expect(parsed.requestFormat).toBe('unknown');
  });

  it('仅 system 无 messages 不是受支持形状 → unknown', () => {
    const parsed = parseProxyRequest({
      hostname: 'api.anthropic.com',
      requestBody: JSON.stringify({ model: 'claude-3-5-sonnet', system: 'sys only' }),
    });
    expect(parsed.requestFormat).toBe('unknown');
  });

  it('Trae tunnel：messages-only 无显式信号 → unknown（不强行归类）', () => {
    const parsed = parseProxyRequest({
      hostname: 'console.enterprise.trae.cn',
      requestBody: JSON.stringify({ model: 'trae-coder', messages: [{ role: 'user', content: 'hi' }] }),
    });
    expect(parsed.requestFormat).toBe('unknown');
  });
});
