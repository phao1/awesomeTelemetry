import { describe, expect, it } from 'vitest';

import {
  MAX_MESSAGES,
  MAX_PARAMETERS,
  MAX_SOURCE_BODY_BYTES,
  MAX_TOOLS,
  canonicalSha256,
  canonicalize,
  normalizeRequestContext,
  validateSource,
  type NormalizedMessage,
  type NormalizedRequestContext,
  type NormalizeResult,
} from './context-normalizer.js';

function ok(result: NormalizeResult): NormalizedRequestContext {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('expected ok');
  return result.normalized;
}

function reasonOf(result: NormalizeResult): string {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('expected failure');
  return result.reason;
}

function anthropicBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    model: 'claude-3-5-sonnet',
    system: 'you are helpful',
    messages: [{ role: 'user', content: 'hi' }],
    ...overrides,
  });
}

function chatBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: 'be terse' },
      { role: 'user', content: 'hello' },
    ],
    ...overrides,
  });
}

function responsesBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    model: 'gpt-4o',
    instructions: 'answer carefully',
    input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
    ...overrides,
  });
}

describe('design D9 constants', () => {
  it('exposes contractual hard bounds', () => {
    expect(MAX_SOURCE_BODY_BYTES).toBe(2 * 1024 * 1024);
    expect(MAX_MESSAGES).toBe(2_000);
    expect(MAX_TOOLS).toBe(256);
    expect(MAX_PARAMETERS).toBe(64);
  });
});

describe('design D6 canonical equality', () => {
  it('ignores object key order', () => {
    const a = { z: 1, a: { y: 2, b: 3 } };
    const b = { a: { b: 3, y: 2 }, z: 1 };
    expect(canonicalSha256(a)).toBe(canonicalSha256(b));
    expect(JSON.stringify(canonicalize(a))).toBe('{"a":{"b":3,"y":2},"z":1}');
  });

  it('treats array order as significant', () => {
    expect(canonicalSha256([1, 2, 3])).not.toBe(canonicalSha256([3, 2, 1]));
  });

  it('preserves JSON types as distinct', () => {
    expect(canonicalSha256(1)).not.toBe(canonicalSha256('1'));
    expect(canonicalSha256('1')).not.toBe(canonicalSha256(true));
    expect(canonicalSha256(null)).not.toBe(canonicalSha256(false));
  });

  it('keeps duplicate array items independent', () => {
    expect(canonicalSha256(['x', 'x'])).not.toBe(canonicalSha256(['x']));
  });
});

describe('task 4.2 source validation', () => {
  it('rejects a missing/empty desensitized body', () => {
    expect(reasonOf(normalizeRequestContext({ format: 'openai_chat', desensitizedBody: '' }))).toBe(
      'desensitized_body_missing',
    );
    expect(reasonOf(normalizeRequestContext({ format: 'openai_chat', desensitizedBody: '   ' }))).toBe(
      'desensitized_body_missing',
    );
  });

  it('rejects a body above 2 MiB without parsing it', () => {
    const oversized = JSON.stringify({ messages: ['x'.repeat(MAX_SOURCE_BODY_BYTES)] });
    expect(oversized.length).toBeGreaterThan(MAX_SOURCE_BODY_BYTES);
    expect(reasonOf(normalizeRequestContext({ format: 'openai_chat', desensitizedBody: oversized }))).toBe(
      'source_too_large',
    );
  });

  it('rejects non-JSON and non-object bodies', () => {
    expect(reasonOf(normalizeRequestContext({ format: 'openai_chat', desensitizedBody: 'not-json' }))).toBe(
      'invalid_json',
    );
    expect(reasonOf(normalizeRequestContext({ format: 'openai_chat', desensitizedBody: '123' }))).toBe(
      'not_an_object',
    );
  });

  it('rejects an encrypted/undecryptable body as unsupported', () => {
    // TTNet-style undecryptable payloads are not valid JSON, so they must not
    // be treated as an empty successful snapshot (design D5 / EC-5).
    const encrypted = Buffer.from('TTENC001 opaque-bytes-not-json').toString('base64');
    expect(
      reasonOf(normalizeRequestContext({ format: 'openai_chat', desensitizedBody: encrypted })),
    ).toBe('invalid_json');
  });

  it('rejects an unknown stored format', () => {
    expect(reasonOf(normalizeRequestContext({ format: 'unknown', desensitizedBody: '{}' }))).toBe(
      'unknown_format',
    );
  });

  it('rejects a stored format that disagrees with the body shape', () => {
    // openai_chat stored but the body is Responses-only (no messages).
    expect(
      reasonOf(normalizeRequestContext({ format: 'openai_chat', desensitizedBody: '{"input":[],"instructions":"x"}' })),
    ).toBe('classification_mismatch');
    // anthropic stored but the body has no messages array.
    expect(reasonOf(normalizeRequestContext({ format: 'anthropic_messages', desensitizedBody: '{"system":"x"}' }))).toBe(
      'classification_mismatch',
    );
  });

  it('accepts valid bodies with the matching stored format', () => {
    expect(normalizeRequestContext({ format: 'anthropic_messages', desensitizedBody: anthropicBody() }).ok).toBe(true);
    expect(normalizeRequestContext({ format: 'openai_chat', desensitizedBody: chatBody() }).ok).toBe(true);
    expect(normalizeRequestContext({ format: 'openai_responses', desensitizedBody: responsesBody() }).ok).toBe(true);
  });

  it('validateSource returns the parsed object on success', () => {
    const v = validateSource({ format: 'openai_chat', desensitizedBody: '{"messages":[]}' });
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.parsed).toEqual({ messages: [] });
  });
});

describe('task 4.3 Anthropic Messages normalization', () => {
  it('maps string system, ordered messages, tools, and allowlisted params', () => {
    const result = ok(
      normalizeRequestContext({
        format: 'anthropic_messages',
        desensitizedBody: anthropicBody({
          system: 'sys',
          messages: [
            { role: 'user', content: 'one', id: 'msg-1' },
            { role: 'assistant', content: 'two' },
          ],
          tools: [{ name: 'lookup', description: 'find', input_schema: { type: 'object', properties: { q: { type: 'string' } } } }],
          max_tokens: 2048,
          temperature: 0.7,
          not_allowed_field: 'should-not-enter',
        }),
      }),
    );
    expect(result.format).toBe('anthropic_messages');
    expect(result.model).toBe('claude-3-5-sonnet');
    expect(result.system).toEqual([{ text: 'sys', sourcePath: 'system' }]);
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]!.role).toBe('user');
    expect(result.messages[0]!.stableId).toBe('msg-1');
    expect(result.messages[0]!.sourcePath).toBe('messages[0]');
    expect(result.messages[1]!.role).toBe('assistant');
    expect(result.messages[1]!.sourcePath).toBe('messages[1]');
    expect(result.tools).toHaveLength(1);
    expect(result.tools[0]!.identity).toBe('lookup');
    expect(result.tools[0]!.schema).toEqual({ type: 'object', properties: { q: { type: 'string' } } });
    expect(result.parameters.max_tokens).toBe(2048);
    expect(result.parameters.temperature).toBe(0.7);
    expect(result.parameters).not.toHaveProperty('not_allowed_field');
  });

  it('normalizes a top-level system content-block array', () => {
    const result = ok(
      normalizeRequestContext({
        format: 'anthropic_messages',
        desensitizedBody: JSON.stringify({
          model: 'claude-3-5-sonnet',
          system: [
            { type: 'text', text: 'alpha' },
            { type: 'text', text: 'beta' },
          ],
          messages: [{ role: 'user', content: 'hi' }],
        }),
      }),
    );
    expect(result.system.map((b) => b.text)).toEqual(['alpha', 'beta']);
    expect(result.system.map((b) => b.sourcePath)).toEqual(['system[0]', 'system[1]']);
  });

  it('preserves mixed content blocks within a message', () => {
    const result = ok(
      normalizeRequestContext({
        format: 'anthropic_messages',
        desensitizedBody: JSON.stringify({
          model: 'claude-3-5-sonnet',
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: 'see this' },
                { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aGk=' } },
              ],
            },
          ],
        }),
      }),
    );
    const m = result.messages[0]!;
    expect(m.contentKind).toBe('content');
    expect(Array.isArray(m.content)).toBe(true);
    if (Array.isArray(m.content)) {
      expect(m.content[0]).toEqual({ type: 'text', text: 'see this' });
      expect((m.content[1] as { type: string }).type).toBe('image');
    }
  });
});

describe('task 4.4 OpenAI Chat normalization', () => {
  it('separates leading system/developer messages preserving order', () => {
    const result = ok(
      normalizeRequestContext({
        format: 'openai_chat',
        desensitizedBody: JSON.stringify({
          model: 'gpt-4o',
          messages: [
            { role: 'system', content: 'sys-1' },
            { role: 'developer', content: 'dev-1' },
            { role: 'system', content: 'sys-2' },
            { role: 'user', content: 'hello' },
            { role: 'assistant', content: 'hi' },
          ],
        }),
      }),
    );
    expect(result.system.map((b) => b.text)).toEqual(['sys-1', 'dev-1', 'sys-2']);
    expect(result.system.map((b) => b.sourcePath)).toEqual(['messages[0]', 'messages[1]', 'messages[2]']);
    expect(result.messages.map((m) => `${m.role}:${m.content}`)).toEqual(['user:hello', 'assistant:hi']);
  });

  it('maps function tools and legacy functions', () => {
    const result = ok(
      normalizeRequestContext({
        format: 'openai_chat',
        desensitizedBody: JSON.stringify({
          model: 'gpt-4o',
          messages: [{ role: 'user', content: 'x' }],
          tools: [{ type: 'function', function: { name: 'get_weather', description: 'w', parameters: { type: 'object' } } }],
          functions: [{ name: 'legacy_fn', description: 'legacy', parameters: { type: 'object' } }],
        }),
      }),
    );
    expect(result.tools.map((t) => t.identity)).toEqual(['get_weather', 'legacy_fn']);
    expect(result.tools.map((t) => t.sourcePath)).toEqual(['tools[0]', 'functions[0]']);
    expect(result.tools[0]!.schema).toEqual({ type: 'object' });
  });
});

describe('task 4.5 OpenAI Responses normalization', () => {
  it('maps instructions and typed input items', () => {
    const result = ok(
      normalizeRequestContext({
        format: 'openai_responses',
        desensitizedBody: JSON.stringify({
          model: 'gpt-4o',
          instructions: 'be precise',
          input: [
            { type: 'message', role: 'user', id: 'msg_1', content: [{ type: 'input_text', text: 'hello' }] },
            { type: 'function_call', id: 'fc_1', name: 'add', arguments: '{"a":1}' },
            { type: 'function_call_output', call_id: 'fc_1', output: '2' },
          ],
          tools: [{ type: 'function', name: 'add', description: 'sum', parameters: { type: 'object' } }],
        }),
      }),
    );
    expect(result.system.map((b) => b.text)).toEqual(['be precise']);
    expect(result.system[0]!.sourcePath).toBe('instructions');
    expect(result.messages).toHaveLength(3);
    expect(result.messages[0]!.role).toBe('user');
    expect(result.messages[0]!.stableId).toBe('msg_1');
    expect(result.messages[0]!.sourcePath).toBe('input[0]');
    expect(result.messages[1]!.role).toBe('function_call');
    expect(result.messages[1]!.stableId).toBe('fc_1');
    expect(result.messages[2]!.role).toBe('function_call_output');
    expect(result.tools[0]!.identity).toBe('add');
  });
});

describe('task 4.6 metadata filtering and secret exclusion', () => {
  it('keeps only scalar metadata values and excludes secret keys', () => {
    const result = ok(
      normalizeRequestContext({
        format: 'openai_chat',
        desensitizedBody: JSON.stringify({
          model: 'gpt-4o',
          messages: [{ role: 'user', content: 'x' }],
          metadata: {
            user_id: 'u-1',
            org: 'acme',
            api_key: 'sk-secret',
            token: 'abc',
            cookie: 'sid=1',
            nested: { a: 1 },
          },
        }),
      }),
    );
    expect(result.parameters['metadata.user_id']).toBe('u-1');
    expect(result.parameters['metadata.org']).toBe('acme');
    expect(result.parameters).not.toHaveProperty('metadata.api_key');
    expect(result.parameters).not.toHaveProperty('metadata.token');
    expect(result.parameters).not.toHaveProperty('metadata.cookie');
    // non-scalar nested value must not enter parameters
    expect(result.parameters).not.toHaveProperty('metadata.nested');
  });

  it('never copies unknown top-level fields into parameters', () => {
    const result = ok(
      normalizeRequestContext({
        format: 'openai_chat',
        desensitizedBody: JSON.stringify({
          model: 'gpt-4o',
          messages: [{ role: 'user', content: 'x' }],
          user: { unstable: true },
          stream_options: 'noise',
          x_transport: 'proxy-metadata',
        }),
      }),
    );
    const keys = Object.keys(result.parameters);
    expect(keys).not.toContain('user');
    expect(keys).not.toContain('stream_options');
    expect(keys).not.toContain('x_transport');
  });
});

describe('task 4.7 stable IDs, occurrence ordinals, canonical order', () => {
  it('assigns occurrence ordinals to duplicate messages', () => {
    const result = ok(
      normalizeRequestContext({
        format: 'anthropic_messages',
        desensitizedBody: JSON.stringify({
          model: 'claude-3-5-sonnet',
          messages: [
            { role: 'user', content: 'dup' },
            { role: 'user', content: 'dup' },
          ],
        }),
      }),
    );
    expect(result.messages[0]!.occurrence).toBe(0);
    expect(result.messages[1]!.occurrence).toBe(1);
    expect(result.messages[0]!.contentSha256).toBe(result.messages[1]!.contentSha256);
  });

  it('assigns occurrence ordinals to duplicate tools', () => {
    const result = ok(
      normalizeRequestContext({
        format: 'anthropic_messages',
        desensitizedBody: JSON.stringify({
          model: 'claude-3-5-sonnet',
          messages: [{ role: 'user', content: 'x' }],
          tools: [
            { name: 't', description: 'a', input_schema: { type: 'object' } },
            { name: 't', description: 'a', input_schema: { type: 'object' } },
          ],
        }),
      }),
    );
    expect(result.tools.map((t) => t.occurrence)).toEqual([0, 1]);
  });

  it('uses provider id as the stable message id', () => {
    const result = ok(
      normalizeRequestContext({
        format: 'anthropic_messages',
        desensitizedBody: JSON.stringify({
          model: 'claude-3-5-sonnet',
          messages: [{ role: 'assistant', id: 'msg_xyz', content: 'hi' }],
        }),
      }),
    );
    expect(result.messages[0]!.stableId).toBe('msg_xyz');
  });

  it('canonicalizes tool schema keys regardless of input key order', () => {
    const a = ok(
      normalizeRequestContext({
        format: 'anthropic_messages',
        desensitizedBody: JSON.stringify({
          model: 'claude-3-5-sonnet',
          messages: [{ role: 'user', content: 'x' }],
          tools: [{ name: 't', input_schema: { type: 'object', properties: { b: { type: 'string' }, a: { type: 'string' } } } }],
        }),
      }),
    );
    const b = ok(
      normalizeRequestContext({
        format: 'anthropic_messages',
        desensitizedBody: JSON.stringify({
          model: 'claude-3-5-sonnet',
          messages: [{ role: 'user', content: 'x' }],
          tools: [{ name: 't', input_schema: { properties: { a: { type: 'string' }, b: { type: 'string' } }, type: 'object' } }],
        }),
      }),
    );
    expect(JSON.stringify(a.tools[0]!.schema)).toBe(JSON.stringify(b.tools[0]!.schema));
    expect(canonicalSha256(a.tools[0]!.schema as never)).toBe(canonicalSha256(b.tools[0]!.schema as never));
  });
});

describe('task 4.8 hard bounds', () => {
  it('retains first/last 1000 of >2000 messages with omitted count', () => {
    const total = 2_500;
    const messages = Array.from({ length: total }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}` }));
    const result = ok(
      normalizeRequestContext({
        format: 'anthropic_messages',
        desensitizedBody: JSON.stringify({ model: 'claude-3-5-sonnet', messages }),
      }),
    );
    expect(result.messages).toHaveLength(MAX_MESSAGES);
    expect(result.messages[0]!.content).toBe('m0');
    expect(result.messages[MAX_MESSAGES - 1]!.content).toBe('m2499');
    expect(result.completeness.complete).toBe(false);
    expect(result.completeness.omittedCount).toBe(total - MAX_MESSAGES);
    expect(result.completeness.reasons).toEqual(['item_limit']);
  });

  it('retains the first 256 tools with omitted count', () => {
    const total = 300;
    const tools = Array.from({ length: total }, (_, i) => ({ name: `tool_${i}`, input_schema: { type: 'object' } }));
    const result = ok(
      normalizeRequestContext({
        format: 'anthropic_messages',
        desensitizedBody: JSON.stringify({
          model: 'claude-3-5-sonnet',
          messages: [{ role: 'user', content: 'x' }],
          tools,
        }),
      }),
    );
    expect(result.tools).toHaveLength(MAX_TOOLS);
    expect(result.tools[0]!.name).toBe('tool_0');
    expect(result.completeness.omittedCount).toBe(total - MAX_TOOLS);
  });

  it('keeps the lexical-first 64 parameters with omitted count', () => {
    const metadata: Record<string, string> = {};
    for (let i = 0; i < 90; i += 1) metadata[`k_${String(i).padStart(2, '0')}`] = `v${i}`;
    // No other allowlisted parameter is present, so the candidate count is exactly 90.
    const result = ok(
      normalizeRequestContext({
        format: 'openai_chat',
        desensitizedBody: JSON.stringify({ messages: [{ role: 'user', content: 'x' }], metadata }),
      }),
    );
    const keys = Object.keys(result.parameters).sort();
    expect(keys).toHaveLength(MAX_PARAMETERS);
    expect(result.completeness.complete).toBe(false);
    expect(result.completeness.omittedCount).toBe(90 - MAX_PARAMETERS);
  });

  it('reports complete when no bound is hit', () => {
    const result = ok(normalizeRequestContext({ format: 'openai_chat', desensitizedBody: chatBody() }));
    expect(result.completeness.complete).toBe(true);
    expect(result.completeness.omittedCount).toBe(0);
    expect(result.completeness.reasons).toEqual([]);
  });
});

describe('task 4.10 raw-only sentinel isolation', () => {
  it('never surfaces a raw-only sentinel from the desensitized body', () => {
    // The raw request carried a unique secret that only exists in raw retention.
    const rawOnlySentinel = 'sk-ant-RAWONLYSENTINEL7f3a9c2d1e0b';
    // The stored desensitized body has that value redacted by the engine.
    const desensitizedBody = JSON.stringify({
      model: 'claude-3-5-sonnet',
      system: `call helper ${rawOnlySentinel.replace('sk-ant-RAWONLYSENTINEL7f3a9c2d1e0b', 'sk-***')}`,
      messages: [
        { role: 'user', id: 'msg_1', content: `api_key is ${rawOnlySentinel.replace('sk-ant-RAWONLYSENTINEL7f3a9c2d1e0b', 'sk-***')}` },
        { role: 'assistant', content: 'ok' },
      ],
      tools: [{ name: 'lookup', input_schema: { type: 'object', properties: { key: { type: 'string' } } } }],
      metadata: { api_key: 'sk-***' },
    });
    // The desensitized body passed to the normalizer must not contain the sentinel.
    expect(desensitizedBody).not.toContain(rawOnlySentinel);

    const result = ok(
      normalizeRequestContext({ format: 'anthropic_messages', desensitizedBody }),
    );
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(rawOnlySentinel);
    expect(serialized).not.toContain('RAWONLYSENTINEL');
  });

  it('accepts only the desensitized body the service supplies', () => {
    const secret = 'sk-RAWONLY-9f8e7d6c5b4a';
    // The service hands the normalizer the desensitized body (secret removed).
    const desensitizedBody = JSON.stringify({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'key is sk-***' }],
    });
    const normalized = ok(normalizeRequestContext({ format: 'openai_chat', desensitizedBody }));
    expect(JSON.stringify(normalized.messages)).not.toContain(secret);
    expect(JSON.stringify(normalized.parameters)).not.toContain(secret);
  });
});

describe('stats', () => {
  it('accumulates measured character counts by category', () => {
    const result = ok(
      normalizeRequestContext({
        format: 'anthropic_messages',
        desensitizedBody: JSON.stringify({
          model: 'claude-3-5-sonnet',
          system: 'abcd',
          messages: [{ role: 'user', content: 'hello' }],
          max_tokens: 10,
        }),
      }),
    );
    expect(result.stats.systemChars).toBe(4);
    expect(result.stats.totalChars).toBe(
      result.stats.systemChars + result.stats.messageChars + result.stats.toolChars + result.stats.parameterChars,
    );
    expect(result.stats.totalChars).toBeGreaterThan(0);
  });
});

// Keep the NormalizedMessage type referenced so the import stays meaningful for type-level assertions.
function _typeGuard(_m: NormalizedMessage[]): void {
  void _m;
}
