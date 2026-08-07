import { describe, expect, expectTypeOf, it } from 'vitest';

import { EMPTY_TOKEN_USAGE, PROVIDER_KEYS, TRACE_KINDS, TRACE_PHASES } from './trace-types';
import type {
  ContextCategoryDiff,
  ContextChangeEntry,
  ContextChangeKind,
  ContextDiffCategory,
  ContextDiffSegmentKind,
  ContextGrowth,
  ContextIndicator,
  ContextPairingConfidence,
  ContextRequestRef,
  ProxyRequest,
  ProxyRequestListItem,
  RequestContextDiffResponse,
  RequestContextFormat,
  SessionIndexEntry,
  TraceEventSlim,
  TracePhase,
} from './trace-types';

// contracts/data-model.md §11 类型级验收（编译期即失败）
describe('REQ-001 枚举全集不得遗漏', () => {
  it('REQ-001 TracePhase 枚举全集不得遗漏', () => {
    expectTypeOf<TracePhase>().toEqualTypeOf<
      'understand' | 'plan' | 'implement' | 'debug' | 'verify' | 'report'
    >();
  });
});

describe('REQ-001 常量数组与契约逐元素一致', () => {
  it('REQ-001 TRACE_PHASES 长度 6 且逐元素与契约一致', () => {
    expect(TRACE_PHASES).toHaveLength(6);
    expect(TRACE_PHASES).toEqual([
      'understand', 'plan', 'implement', 'debug', 'verify', 'report',
    ] as const);
  });

  it('REQ-001 TRACE_KINDS 长度 11 且逐元素与契约一致', () => {
    expect(TRACE_KINDS).toHaveLength(11);
    expect(TRACE_KINDS).toEqual([
      'llm', 'tool', 'file_read', 'file_write', 'bash', 'test',
      'agent', 'system', 'message', 'user_prompt', 'subagent_prompt',
    ] as const);
  });

  it('REQ-001 PROVIDER_KEYS 长度 9 且逐元素与契约一致', () => {
    expect(PROVIDER_KEYS).toHaveLength(9);
    expect(PROVIDER_KEYS).toEqual([
      'claude', 'codex', 'opencode', 'codearts',
      'codeagent', 'codeagent2', 'trae', 'qoder', 'workbuddy',
    ] as const);
  });
});

describe('REQ-001 类型形状逐字采用契约', () => {
  it('REQ-001 索引条目绝不含 systemPrompt 正文', () => {
    expectTypeOf<SessionIndexEntry>().not.toHaveProperty('systemPrompt');
  });

  it('REQ-001 代理列表项绝不含任何 body', () => {
    expectTypeOf<ProxyRequestListItem>().not.toHaveProperty('requestBody');
    expectTypeOf<ProxyRequestListItem>().not.toHaveProperty('responseBody');
    expectTypeOf<ProxyRequestListItem>().not.toHaveProperty('rawRequestBody');
    expectTypeOf<ProxyRequestListItem>().not.toHaveProperty('rawResponseBody');
    expectTypeOf<ProxyRequestListItem>().not.toHaveProperty('systemPrompt');
    expectTypeOf<ProxyRequestListItem>().not.toHaveProperty('requestHeaders');
  });
});

describe('REQ-001 RequestContextFormat 封闭枚举（add-request-context-diff D3）', () => {
  it('REQ-001 格式枚举全集不得遗漏', () => {
    expectTypeOf<RequestContextFormat>().toEqualTypeOf<
      'anthropic_messages' | 'openai_chat' | 'openai_responses' | 'unknown'
    >();
  });

  it('REQ-001 ProxyRequest 携带 captureGroupId/requestFormat 元数据', () => {
    expectTypeOf<ProxyRequest>().toHaveProperty('captureGroupId');
    expectTypeOf<ProxyRequest>().toHaveProperty('requestFormat');
    expectTypeOf<Pick<ProxyRequest, 'captureGroupId'>>().toEqualTypeOf<{
      captureGroupId: string | null;
    }>();
    expectTypeOf<Pick<ProxyRequest, 'requestFormat'>>().toEqualTypeOf<{
      requestFormat: RequestContextFormat;
    }>();
  });

  it('REQ-001 列表项仍排除全部 body/header/system-prompt 字段且只带轻量元数据', () => {
    expectTypeOf<ProxyRequestListItem>().not.toHaveProperty('requestBody');
    expectTypeOf<ProxyRequestListItem>().not.toHaveProperty('responseBody');
    expectTypeOf<ProxyRequestListItem>().not.toHaveProperty('rawRequestBody');
    expectTypeOf<ProxyRequestListItem>().not.toHaveProperty('rawResponseBody');
    expectTypeOf<ProxyRequestListItem>().not.toHaveProperty('systemPrompt');
    expectTypeOf<ProxyRequestListItem>().not.toHaveProperty('requestHeaders');
    expectTypeOf<ProxyRequestListItem>().toHaveProperty('captureGroupId');
    expectTypeOf<ProxyRequestListItem>().toHaveProperty('requestFormat');
    expectTypeOf<ProxyRequestListItem>().toHaveProperty('hasSystemPrompt');
  });
});

describe('REQ-001 Request-context diff 公共类型逐字采用（add-request-context-diff D10）', () => {
  it('REQ-001 四个 diff 枚举封闭且全集一致', () => {
    expectTypeOf<ContextPairingConfidence>().toEqualTypeOf<
      'exact' | 'capture_group' | 'manual'
    >();
    expectTypeOf<ContextDiffCategory>().toEqualTypeOf<
      'system' | 'messages' | 'tools' | 'parameters'
    >();
    expectTypeOf<ContextChangeKind>().toEqualTypeOf<
      'added' | 'removed' | 'modified'
    >();
    expectTypeOf<ContextDiffSegmentKind>().toEqualTypeOf<
      'equal' | 'added' | 'removed'
    >();
  });

  it('REQ-001 RequestContextDiffResponse 顶层形状与契约一致', () => {
    expectTypeOf<RequestContextDiffResponse>().toHaveProperty('base');
    expectTypeOf<RequestContextDiffResponse>().toHaveProperty('target');
    expectTypeOf<RequestContextDiffResponse>().toHaveProperty('pairing');
    expectTypeOf<RequestContextDiffResponse>().toHaveProperty('noChange');
    expectTypeOf<RequestContextDiffResponse>().toHaveProperty('growth');
    expectTypeOf<RequestContextDiffResponse>().toHaveProperty('indicators');
    expectTypeOf<RequestContextDiffResponse>().toHaveProperty('categories');
    expectTypeOf<RequestContextDiffResponse>().toHaveProperty('completeness');
    expectTypeOf<RequestContextDiffResponse>().toHaveProperty('generatedAt');
    expectTypeOf<RequestContextDiffResponse>().toHaveProperty('durationMs');
    expectTypeOf<RequestContextDiffResponse['pairing']>().toEqualTypeOf<{
      confidence: ContextPairingConfidence;
      reason: string;
      warnings: string[];
    }>();
    expectTypeOf<RequestContextDiffResponse['categories']>().toEqualTypeOf<
      ContextCategoryDiff[]
    >();
  });

  it('REQ-001 证据/条目/增长/指标形状与契约一致', () => {
    expectTypeOf<ContextRequestRef>().toHaveProperty('captureMethod');
    expectTypeOf<ContextRequestRef>().toHaveProperty('parserRoute');
    expectTypeOf<ContextRequestRef>().toHaveProperty('requestFormat');
    expectTypeOf<ContextRequestRef>().toHaveProperty('parsedSessionId');
    expectTypeOf<ContextRequestRef>().toHaveProperty('captureGroupId');
    expectTypeOf<ContextRequestRef>().toHaveProperty('bodySha256');
    expectTypeOf<ContextRequestRef>().toHaveProperty('bodyBytes');
    expectTypeOf<ContextChangeEntry>().toHaveProperty('changedPaths');
    expectTypeOf<ContextChangeEntry>().toHaveProperty('segments');
    expectTypeOf<ContextChangeEntry>().toHaveProperty('truncatedReason');
    expectTypeOf<ContextGrowth>().toHaveProperty('inputTokenDelta');
    expectTypeOf<ContextGrowth>().toHaveProperty('inputTokenDeltaReason');
    expectTypeOf<ContextIndicator>().toHaveProperty('classification');
    expectTypeOf<ContextIndicator>().toHaveProperty('severity');
  });

  it('REQ-001 公共 diff 类型绝不泄漏 body/header 字段（NFR-S1）', () => {
    expectTypeOf<RequestContextDiffResponse>().not.toHaveProperty('requestBody');
    expectTypeOf<RequestContextDiffResponse>().not.toHaveProperty('rawRequestBody');
    expectTypeOf<RequestContextDiffResponse>().not.toHaveProperty('requestHeaders');
    expectTypeOf<ContextRequestRef>().not.toHaveProperty('requestBody');
    expectTypeOf<ContextRequestRef>().not.toHaveProperty('requestHeaders');
    expectTypeOf<ContextChangeEntry>().not.toHaveProperty('beforeBody');
    expectTypeOf<ContextChangeEntry>().not.toHaveProperty('afterBody');
  });
});

describe('REQ-002 三档事件形状', () => {
  it('REQ-002 slim 档不含 inputSummary / outputSummary / raw', () => {
    expectTypeOf<TraceEventSlim>().not.toHaveProperty('inputSummary');
    expectTypeOf<TraceEventSlim>().not.toHaveProperty('outputSummary');
    expectTypeOf<TraceEventSlim>().not.toHaveProperty('raw');
  });

  it('REQ-002 slim 档用 hasInput / hasOutput / hasRaw 布尔代替正文', () => {
    expectTypeOf<TraceEventSlim>().toHaveProperty('hasInput');
    expectTypeOf<TraceEventSlim>().toHaveProperty('hasOutput');
    expectTypeOf<TraceEventSlim>().toHaveProperty('hasRaw');
  });
});

describe('REQ-004 EMPTY_TOKEN_USAGE', () => {
  it('REQ-004 EMPTY_TOKEN_USAGE 七个字段全为 0（total 符合公式，cacheWrite 不计入）', () => {
    expect(EMPTY_TOKEN_USAGE).toEqual({
      input: 0,
      output: 0,
      reasoning: 0,
      cacheRead: 0,
      cacheWrite: 0,
      netInput: 0,
      total: 0,
    });
    expect(EMPTY_TOKEN_USAGE.input).toBe(0);
    expect(EMPTY_TOKEN_USAGE.output).toBe(0);
    expect(EMPTY_TOKEN_USAGE.reasoning).toBe(0);
    expect(EMPTY_TOKEN_USAGE.cacheRead).toBe(0);
    expect(EMPTY_TOKEN_USAGE.cacheWrite).toBe(0);
    expect(EMPTY_TOKEN_USAGE.netInput).toBe(0);
    expect(EMPTY_TOKEN_USAGE.total).toBe(0);
  });
});
