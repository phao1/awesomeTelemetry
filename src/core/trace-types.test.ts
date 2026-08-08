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
  MessageRole,
  ProxyRequest,
  ProxyRequestListItem,
  RequestContextDiffResponse,
  RequestContextFormat,
  SessionAnnotations,
  SessionAnnotationsUpdate,
  SessionIndexEntry,
  TraceTurn,
  TraceEventSlim,
  TraceKind,
  TracePhase,
  TraceRecord,
  TokenUsage,
  TurnBadge,
  TurnKind,
  TurnKeySource,
  TurnMessage,
  TurnModel,
  TurnSegmentationSource,
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

  it('REQ-001 TRACE_KINDS 长度 13 且逐元素与契约一致（fix-adapter-turn-semantics 新增 reasoning/compact）', () => {
    expect(TRACE_KINDS).toHaveLength(13);
    expect(TRACE_KINDS).toEqual([
      'llm', 'tool', 'file_read', 'file_write', 'bash', 'test',
      'agent', 'system', 'message', 'user_prompt', 'subagent_prompt',
      'reasoning', 'compact',
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

describe('REQ-001 TraceKind 新增成员（fix-adapter-turn-semantics A2）', () => {
  it('REQ-001 TraceKind 枚举全集含 reasoning/compact 且封闭', () => {
    expectTypeOf<TraceKind>().toEqualTypeOf<
      'llm' | 'tool' | 'file_read' | 'file_write' | 'bash' | 'test'
      | 'agent' | 'system' | 'message' | 'user_prompt' | 'subagent_prompt'
      | 'reasoning' | 'compact'
    >();
  });

  it('REQ-001 TRACE_KINDS 同时包含两个新成员（运行时成员断言）', () => {
    expect(TRACE_KINDS).toContain('reasoning');
    expect(TRACE_KINDS).toContain('compact');
  });
});

describe('REQ-001 turnKey 与 TurnKeySource（fix-adapter-turn-semantics A3/A5）', () => {
  it('REQ-001 slim 档携带 turnKey 且 null 是合法值', () => {
    expectTypeOf<Pick<TraceEventSlim, 'turnKey'>>().toEqualTypeOf<{
      turnKey: string | null;
    }>();
  });

  it('REQ-001 TurnKeySource 来源枚举封闭且全集一致', () => {
    expectTypeOf<TurnKeySource>().toEqualTypeOf<
      'native_boundary' | 'stream_structure' | 'message_identity' | 'unavailable'
    >();
  });

  it('REQ-001 TraceRecord 声明 turnKeySource（A5 与 trace-model delta 的 "Declaration accompanies the record"）', () => {
    expectTypeOf<TraceRecord>().toHaveProperty('turnKeySource');
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

// add-trajectory-inspector §1.3/§1.4/§1.9 — 派生 turn 类型与注解类型形状验收
// （contracts/data-model.md §11 附加断言，编译期即失败）
describe('add-trajectory-inspector 派生 turn 类型形状', () => {
  it('TurnSegmentationSource 枚举封闭（trace-model delta spec 原样）', () => {
    expectTypeOf<TurnSegmentationSource>().toEqualTypeOf<
      'turn_key' | 'llm_boundary' | 'user_prompt_boundary' | 'sequence_fallback'
    >();
  });

  it('TurnKind 枚举封闭', () => {
    expectTypeOf<TurnKind>().toEqualTypeOf<'init' | 'user' | 'cycle'>();
  });

  it('MessageRole 枚举封闭（system/user/assistant/tool/reasoning/compact/subagent）', () => {
    expectTypeOf<MessageRole>().toEqualTypeOf<
      'system' | 'user' | 'assistant' | 'tool' | 'reasoning' | 'compact' | 'subagent'
    >();
  });

  it('TurnBadge 枚举封闭（无 length 徽标）', () => {
    expectTypeOf<TurnBadge>().toEqualTypeOf<
      'init' | 'user' | 'tools' | 'stop' | 'error' | 'subagent' | 'compact' | 'running'
    >();
  });

  it('TurnMessage 形状逐字段符合 trace-model delta spec', () => {
    expectTypeOf<TurnMessage>().toHaveProperty('eventId');
    expectTypeOf<TurnMessage>().toHaveProperty('sequence');
    expectTypeOf<TurnMessage>().toHaveProperty('role');
    expectTypeOf<TurnMessage>().toHaveProperty('kind');
    expectTypeOf<TurnMessage>().toHaveProperty('title');
    expectTypeOf<TurnMessage>().toHaveProperty('tool');
    expectTypeOf<TurnMessage>().toHaveProperty('startedAt');
    expectTypeOf<TurnMessage>().toHaveProperty('durationMs');
    expectTypeOf<TurnMessage>().toHaveProperty('status');
    expectTypeOf<TurnMessage>().toHaveProperty('tokens');
    expectTypeOf<TurnMessage>().toHaveProperty('hasInput');
    expectTypeOf<TurnMessage>().toHaveProperty('hasOutput');
    expectTypeOf<TurnMessage>().toHaveProperty('hasRaw');
    expectTypeOf<TurnMessage>().toHaveProperty('error');
    // 事件身份来自成员事件 id（null 不是合法 eventId）
    expectTypeOf<Pick<TurnMessage, 'eventId'>>().toEqualTypeOf<{ eventId: string }>();
    expectTypeOf<Pick<TurnMessage, 'tool'>>().toEqualTypeOf<{ tool: string | null }>();
    expectTypeOf<Pick<TurnMessage, 'tokens'>>().toEqualTypeOf<{ tokens: TokenUsage | null }>();
  });

  it('TraceTurn 形状逐字段符合 trace-model delta spec', () => {
    expectTypeOf<TraceTurn>().toHaveProperty('index');
    expectTypeOf<TraceTurn>().toHaveProperty('kind');
    expectTypeOf<TraceTurn>().toHaveProperty('startedAt');
    expectTypeOf<TraceTurn>().toHaveProperty('durationMs');
    expectTypeOf<TraceTurn>().toHaveProperty('tokens');
    expectTypeOf<TraceTurn>().toHaveProperty('model');
    expectTypeOf<TraceTurn>().toHaveProperty('messageCount');
    expectTypeOf<TraceTurn>().toHaveProperty('toolCount');
    expectTypeOf<TraceTurn>().toHaveProperty('status');
    expectTypeOf<TraceTurn>().toHaveProperty('badges');
    expectTypeOf<TraceTurn>().toHaveProperty('messages');
    expectTypeOf<Pick<TraceTurn, 'index'>>().toEqualTypeOf<{ index: number }>();
    expectTypeOf<Pick<TraceTurn, 'model'>>().toEqualTypeOf<{ model: string | null }>();
    expectTypeOf<Pick<TraceTurn, 'badges'>>().toEqualTypeOf<{ badges: TurnBadge[] }>();
  });

  it('TurnModel 携带 segmentationSource 与显式完整性', () => {
    expectTypeOf<TurnModel>().toHaveProperty('turns');
    expectTypeOf<TurnModel>().toHaveProperty('segmentationSource');
    expectTypeOf<TurnModel>().toHaveProperty('complete');
    expectTypeOf<TurnModel>().toHaveProperty('omittedEventCount');
    expectTypeOf<Pick<TurnModel, 'complete' | 'omittedEventCount'>>().toEqualTypeOf<{
      complete: boolean;
      omittedEventCount: number;
    }>();
  });

  it('C7 负向断言：不存在 toolCallId 字段，身份来自 event.id', () => {
    expectTypeOf<TurnMessage>().not.toHaveProperty('toolCallId');
    expectTypeOf<TraceTurn>().not.toHaveProperty('toolCallId');
    expectTypeOf<TurnModel>().not.toHaveProperty('toolCallId');
  });
});

describe('add-trajectory-inspector SessionIndexEntry.tags 与注解类型', () => {
  it('SessionIndexEntry 携带 tags: string[]，且仍不含 systemPrompt 正文', () => {
    expectTypeOf<Pick<SessionIndexEntry, 'tags'>>().toEqualTypeOf<{ tags: string[] }>();
    expectTypeOf<SessionIndexEntry>().not.toHaveProperty('systemPrompt');
  });

  it('SessionAnnotations 形状逐字段符合 design D13', () => {
    expectTypeOf<SessionAnnotations>().toHaveProperty('sessionKey');
    expectTypeOf<SessionAnnotations>().toHaveProperty('tags');
    expectTypeOf<SessionAnnotations>().toHaveProperty('note');
    expectTypeOf<SessionAnnotations>().toHaveProperty('updatedAt');
    expectTypeOf<SessionAnnotations>().toEqualTypeOf<{
      sessionKey: string;
      tags: string[];
      note: string | null;
      updatedAt: string | null;
    }>();
  });

  it('SessionAnnotationsUpdate 两个字段均可选（D13 部分更新语义）', () => {
    expectTypeOf<SessionAnnotationsUpdate>().toEqualTypeOf<{
      tags?: string[];
      note?: string | null;
    }>();
  });
});
