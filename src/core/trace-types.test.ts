import { describe, expect, expectTypeOf, it } from 'vitest';
import type { CaptureReparseSnapshot, CaptureReparseStatus, CaptureReparseResponse, ProxyNativeUsage } from './trace-types';

import { EMPTY_TOKEN_USAGE, PROVIDER_KEYS, TEAM_TOPOLOGY_KINDS, TRACE_KINDS, TRACE_PHASES } from './trace-types';
import type { MonitorCapabilityReport, MonitorAgent, MonitorTransportCapability, CaptureComparisonAnalysis, CaptureComparisonResponse, CaptureComparisonSide, NativeSessionParentPage, ProxyCaptureBodies, ProxyProtocolAnalysis, TraceSourceIdentity, CaptureEvidenceExport, CaptureNetworkTiming, CaptureTransportResult, LinkedExecutionIdentityMatch, LinkedExecutionPage, CaptureMetadataCapacity, MonitorConnectionDiagnostics, MonitorDiagnosticCode, OriginalDeletionJob } from './trace-types';
import type {
  ComparisonMatch,
  CompletenessLevel,
  ContextCategoryDiff,
  ContextChangeEntry,
  ContextChangeKind,
  ContextDiffCategory,
  ContextDiffSegmentKind,
  ContextGrowth,
  ContextIndicator,
  ContextPairingConfidence,
  ContextRequestRef,
  DurationSource,
  EvidenceConfidence,
  EvidenceDimension,
  MessageRole,
  PriceCurrency,
  ProxyRequest,
  ProxyRequestListItem,
  RequestContextDiffResponse,
  RequestContextFormat,
  SessionAnnotations,
  SessionAnnotationsUpdate,
  SessionIndexEntry,
  TeamActivityKind,
  TeamActivitySlim,
  TeamAgent,
  TeamAgentEdgeKind,
  TeamAgentState,
  TeamArtifact,
  TeamCommunication,
  TeamCostMetrics,
  TeamMetricDimension,
  TeamMetricDirection,
  TeamMetricValue,
  TeamMessageCategory,
  TeamMessageMode,
  TeamOrderConfidence,
  TeamRoundSegmentationSource,
  TeamRunStatus,
  TeamRunSummary,
  TeamTask,
  TeamTaskStatus,
  TeamTopologyKind,
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

it('keeps original deletion file-job states explicit and projections metadata-only', () => {
  expectTypeOf<OriginalDeletionJob['state']>().toEqualTypeOf<'pending' | 'failed' | 'complete'>();
  expectTypeOf<OriginalDeletionJob['completedAt']>().toEqualTypeOf<string | null>();
  expectTypeOf<keyof OriginalDeletionJob>().toEqualTypeOf<'id' | 'proxyId' | 'requestId' | 'state' | 'error' | 'createdAt' | 'updatedAt' | 'completedAt'>();
});

it('separates implementation capabilities from installed versions, process filtering and Agent certification', () => {
  expectTypeOf<keyof MonitorCapabilityReport>().toEqualTypeOf<'manifestVersion' | 'generatedAt' | 'platform' | 'scope' | 'listener' | 'agents' | 'transports'>();
  expectTypeOf<MonitorCapabilityReport['manifestVersion']>().toEqualTypeOf<1>();
  expectTypeOf<MonitorCapabilityReport['agents'][number]['installedVersion']>().toEqualTypeOf<null>();
  expectTypeOf<MonitorCapabilityReport['agents'][number]['runtimeVerification']>().toEqualTypeOf<'unverified'>();
  expectTypeOf<MonitorCapabilityReport['agents'][number]['processRecipe']>().toEqualTypeOf<MonitorAgent | null>();
  expectTypeOf<MonitorCapabilityReport['listener']>().toEqualTypeOf<'shared_not_process_filtered'>();
  expectTypeOf<MonitorCapabilityReport['transports'][number]['id']>().toEqualTypeOf<MonitorTransportCapability>();
  expectTypeOf<MonitorCapabilityReport['transports'][number]['level']>().toEqualTypeOf<'controlled_test' | 'unsupported' | 'unverified' | 'dev_only' | 'experimental'>();
});

it('retains a nullable native tool-result error flag separately from content and protocol state', () => {
  expectTypeOf<ProxyProtocolAnalysis['items'][number]['toolResultIsError']>().toEqualTypeOf<boolean | null>();
});

it('separates capture reparse versions and metadata from body-bearing analysis', () => {
  expectTypeOf<keyof CaptureReparseSnapshot>().toEqualTypeOf<'parserVersion' | 'metricVersion' | 'sourceFingerprint' | 'parsedAt' | 'requestFormat' | 'state' | 'usage' | 'completeness'>();
  expectTypeOf<CaptureReparseSnapshot['usage']>().toEqualTypeOf<Omit<ProxyNativeUsage, 'snapshots'>>();
  expectTypeOf<CaptureReparseStatus['state']>().toEqualTypeOf<'not_parsed' | 'current' | 'stale' | 'unavailable'>();
  expectTypeOf<keyof CaptureReparseResponse>().toEqualTypeOf<'status' | 'analysis'>();
});

describe('functional capture timing, execution and export contract shapes', () => {
  it('keeps selected comparison summaries bounded and excludes inline body/header fields', () => {
    expectTypeOf<keyof CaptureComparisonResponse>().toEqualTypeOf<'base' | 'target' | 'generatedAt'>();
    expectTypeOf<CaptureComparisonSide['request']>().toEqualTypeOf<ProxyRequestListItem>();
    expectTypeOf<CaptureComparisonSide['evidence']>().toEqualTypeOf<Omit<ProxyCaptureBodies, 'responseHeaders'>>();
    expectTypeOf<CaptureComparisonSide['analysisUnavailableReason']>().toEqualTypeOf<'original_deleted' | 'analysis_unavailable' | 'metadata_only' | null>();
    expectTypeOf<keyof CaptureComparisonAnalysis>().toEqualTypeOf<'parserVersion' | 'requestFormat' | 'model' | 'state' | 'stopReason' | 'usage' | 'completeness' | 'errorCount' | 'errorCodes' | 'errorCodesTruncated'>();
    expectTypeOf<CaptureComparisonAnalysis['usage']>().toEqualTypeOf<ProxyProtocolAnalysis['usage']>();
    expectTypeOf<CaptureComparisonAnalysis['errorCodes']>().toEqualTypeOf<Array<string | null>>();
  });
  it('keeps parent references and uncertainty distinct from inferred execution topology', () => {
    expectTypeOf<NativeSessionParentPage['items'][number]['identity']>().toEqualTypeOf<TraceSourceIdentity>();
    expectTypeOf<NativeSessionParentPage['items'][number]['state']>().toEqualTypeOf<'resolved' | 'unresolved' | 'ambiguous' | 'incomplete'>();
    expectTypeOf<NativeSessionParentPage['items'][number]['matches']>().toEqualTypeOf<Array<Pick<SessionIndexEntry, 'id' | 'provider' | 'sourceAgent' | 'title' | 'startedAt'>>>();
    expectTypeOf<keyof NativeSessionParentPage['items'][number]>().toEqualTypeOf<'identity' | 'state' | 'matches' | 'matchesTruncated'>();
    expectTypeOf<NativeSessionParentPage['nextCursor']>().toEqualTypeOf<string | null>();
  });
  it('keeps capture timing optional for legacy outcomes and in one explicit clock domain', () => {
    expectTypeOf<CaptureTransportResult['timing']>().toEqualTypeOf<CaptureNetworkTiming | undefined>();
    expectTypeOf<CaptureNetworkTiming['clock']>().toEqualTypeOf<'proxy_monotonic'>();
    expectTypeOf<CaptureNetworkTiming['firstContentMs']>().toEqualTypeOf<number | null>();
    expectTypeOf<CaptureNetworkTiming['firstContentBasis']>().toEqualTypeOf<'sse_event_dispatch' | 'json_document_complete' | null>();
  });
  it('keeps linked execution pages metadata-only without manufactured execution identities', () => {
    expectTypeOf<LinkedExecutionPage['sessionDurationSource']>().toEqualTypeOf<DurationSource>();
    expectTypeOf<LinkedExecutionPage['events']>().toEqualTypeOf<TraceEventSlim[]>();
    expectTypeOf<LinkedExecutionPage['attempts'][number]['request']>().toEqualTypeOf<ProxyRequestListItem>();
    expectTypeOf<LinkedExecutionPage['attempts'][number]['transport']>().toEqualTypeOf<CaptureTransportResult | null>();
    expectTypeOf<LinkedExecutionPage['attempts'][number]['matches']>().toEqualTypeOf<LinkedExecutionIdentityMatch[]>();
    expectTypeOf<LinkedExecutionPage>().not.toHaveProperty('turns');
    expectTypeOf<keyof LinkedExecutionIdentityMatch>().toEqualTypeOf<'eventId' | 'scanIdentityId' | 'proxyIdentityId' | 'namespace' | 'kind' | 'value' | 'scope'>();
  });
  it('versions evidence exports and excludes all inline body/prompt preview fields', () => {
    expectTypeOf<CaptureEvidenceExport['format']>().toEqualTypeOf<'awesome-telemetry.capture-evidence'>();
    expectTypeOf<CaptureEvidenceExport['formatVersion']>().toEqualTypeOf<1>();
    expectTypeOf<CaptureEvidenceExport['request']>().toEqualTypeOf<Omit<ProxyRequest, 'requestBody' | 'responseBody' | 'rawRequestBody' | 'rawResponseBody' | 'systemPrompt'>>();
    expectTypeOf<CaptureEvidenceExport['analysisUnavailableReason']>().toEqualTypeOf<'original_deleted' | 'analysis_unavailable' | 'metadata_only' | null>();
  });
});

it('keeps metadata pressure unknown distinct from measured zero and hides filesystem paths', () => {
  expectTypeOf<CaptureMetadataCapacity['databaseBytes']>().toEqualTypeOf<number | null>();
  expectTypeOf<CaptureMetadataCapacity['state']>().toEqualTypeOf<'ready' | 'limited' | 'unavailable'>();
  expectTypeOf<keyof CaptureMetadataCapacity>().toEqualTypeOf<'databaseBytes' | 'walBytes' | 'combinedLimitBytes' | 'walLimitBytes' | 'combinedAdmissionBytes' | 'walAdmissionBytes' | 'state' | 'reason' | 'checkedAt'>();
});

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
      'exact' | 'capture_group' | 'linked_session' | 'manual'
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

// add-agent-team-observability §12.5 — team 类型级验收（编译期即失败）
// （contracts/data-model.md §12.5 断言原样，追加不覆盖既有断言）
describe('add-agent-team-observability 12 个闭合 team 枚举', () => {
  it('TeamTopologyKind 枚举全集不得增减', () => {
    expectTypeOf<TeamTopologyKind>().toEqualTypeOf<
      'two_level' | 'three_level' | 'deep_tree' | 'peer_graph' | 'hybrid' | 'unknown'
    >();
  });

  it('EvidenceConfidence 枚举全集不得增减', () => {
    expectTypeOf<EvidenceConfidence>().toEqualTypeOf<
      'native' | 'correlated' | 'inferred' | 'unavailable'
    >();
  });

  it('EvidenceDimension 枚举全集不得增减（九维）', () => {
    expectTypeOf<EvidenceDimension>().toEqualTypeOf<
      'topology' | 'tasks' | 'communication' | 'timing' | 'tools' | 'outputs'
      | 'tokens' | 'cost' | 'verification'
    >();
  });

  it('CompletenessLevel 枚举全集不得增减', () => {
    expectTypeOf<CompletenessLevel>().toEqualTypeOf<
      'complete' | 'partial' | 'unavailable' | 'conflicted'
    >();
  });

  it('TeamRunStatus 枚举全集不得增减', () => {
    expectTypeOf<TeamRunStatus>().toEqualTypeOf<
      'planned' | 'running' | 'blocked' | 'success' | 'error' | 'cancelled' | 'unknown'
    >();
  });

  it('TeamAgentState 枚举全集不得增减', () => {
    expectTypeOf<TeamAgentState>().toEqualTypeOf<
      'created' | 'ready' | 'busy' | 'blocked' | 'idle' | 'failed' | 'replaced'
      | 'cancelled' | 'completed' | 'unknown'
    >();
  });

  it('TeamTaskStatus 枚举全集不得增减', () => {
    expectTypeOf<TeamTaskStatus>().toEqualTypeOf<
      'pending' | 'ready' | 'claimed' | 'running' | 'blocked' | 'completed'
      | 'failed' | 'cancelled' | 'unknown'
    >();
  });

  it('TeamAgentEdgeKind 枚举全集不得增减', () => {
    expectTypeOf<TeamAgentEdgeKind>().toEqualTypeOf<
      'created' | 'supervises' | 'coordinates' | 'reviews' | 'replaces' | 'peer'
    >();
  });

  it('TeamActivityKind 枚举全集不得增减', () => {
    expectTypeOf<TeamActivityKind>().toEqualTypeOf<
      'agent_lifecycle' | 'task_created' | 'task_dependency' | 'task_assignment'
      | 'task_status' | 'round' | 'message_sent' | 'message_received' | 'tool_call'
      | 'tool_result' | 'artifact' | 'verification' | 'handoff' | 'error' | 'recovery'
      | 'integration' | 'unknown'
    >();
  });

  it('TeamMessageMode 枚举全集不得增减', () => {
    expectTypeOf<TeamMessageMode>().toEqualTypeOf<
      'direct' | 'leader_mediated' | 'broadcast' | 'unknown'
    >();
  });

  it('TeamMessageCategory 枚举全集不得增减', () => {
    expectTypeOf<TeamMessageCategory>().toEqualTypeOf<
      'assignment' | 'coordination' | 'question' | 'answer' | 'handoff' | 'status'
      | 'blocker' | 'review' | 'correction' | 'result' | 'system' | 'unknown'
    >();
  });

  it('ComparisonMatch 枚举全集不得增减', () => {
    expectTypeOf<ComparisonMatch>().toEqualTypeOf<
      'matched' | 'partially_matched' | 'unmatched' | 'unknown'
    >();
  });
});

describe('add-agent-team-observability 补充枚举封闭', () => {
  it('TeamOrderConfidence 枚举封闭', () => {
    expectTypeOf<TeamOrderConfidence>().toEqualTypeOf<'native' | 'ambiguous'>();
  });

  it('TeamRoundSegmentationSource 枚举封闭', () => {
    expectTypeOf<TeamRoundSegmentationSource>().toEqualTypeOf<
      'native_round' | 'session_turn' | 'turn_model' | 'unavailable'
    >();
  });

  it('TeamMetricDimension 枚举封闭（五维）', () => {
    expectTypeOf<TeamMetricDimension>().toEqualTypeOf<
      'speed' | 'accuracy' | 'stability' | 'cost' | 'collaboration'
    >();
  });

  it('TeamMetricDirection 枚举封闭', () => {
    expectTypeOf<TeamMetricDirection>().toEqualTypeOf<
      'higher_better' | 'lower_better' | 'descriptive'
    >();
  });

  it('TEAM_TOPOLOGY_KINDS 长度 6 且逐元素与契约一致', () => {
    expect(TEAM_TOPOLOGY_KINDS).toHaveLength(6);
    expect(TEAM_TOPOLOGY_KINDS).toEqual([
      'two_level', 'three_level', 'deep_tree', 'peer_graph', 'hybrid', 'unknown',
    ] as const);
  });
});

describe('add-agent-team-observability slim 类型绝不携带 body 字段', () => {
  it('TeamRunSummary 绝不含 raw / goal 正文', () => {
    expectTypeOf<TeamRunSummary>().not.toHaveProperty('raw');
    expectTypeOf<TeamRunSummary>().not.toHaveProperty('goal');
  });

  it('TeamCommunication 绝不含 body / message 正文', () => {
    expectTypeOf<TeamCommunication>().not.toHaveProperty('body');
    expectTypeOf<TeamCommunication>().not.toHaveProperty('message');
  });

  it('TeamActivitySlim 绝不含 raw / inputSummary / outputSummary / tool / reasoning 正文', () => {
    expectTypeOf<TeamActivitySlim>().not.toHaveProperty('raw');
    expectTypeOf<TeamActivitySlim>().not.toHaveProperty('inputSummary');
    expectTypeOf<TeamActivitySlim>().not.toHaveProperty('outputSummary');
    expectTypeOf<TeamActivitySlim>().not.toHaveProperty('toolInput');
    expectTypeOf<TeamActivitySlim>().not.toHaveProperty('toolOutput');
    expectTypeOf<TeamActivitySlim>().not.toHaveProperty('reasoning');
  });

  it('TeamTask 绝不含 description / result 正文', () => {
    expectTypeOf<TeamTask>().not.toHaveProperty('description');
    expectTypeOf<TeamTask>().not.toHaveProperty('result');
  });

  it('TeamArtifact 绝不含 content 正文', () => {
    expectTypeOf<TeamArtifact>().not.toHaveProperty('content');
  });
});

describe('add-agent-team-observability required id 存在且非空', () => {
  it('TeamRunSummary id 必填', () => {
    expectTypeOf<Pick<TeamRunSummary, 'id'>>().toEqualTypeOf<{ id: string }>();
  });

  it('TeamAgent id / runId 必填', () => {
    expectTypeOf<Pick<TeamAgent, 'id' | 'runId'>>().toEqualTypeOf<{ id: string; runId: string }>();
  });

  it('TeamTask id / runId 必填', () => {
    expectTypeOf<Pick<TeamTask, 'id' | 'runId'>>().toEqualTypeOf<{ id: string; runId: string }>();
  });

  it('TeamCommunication id / runId 必填', () => {
    expectTypeOf<Pick<TeamCommunication, 'id' | 'runId'>>().toEqualTypeOf<{ id: string; runId: string }>();
  });

  it('TeamActivitySlim id / runId 必填', () => {
    expectTypeOf<Pick<TeamActivitySlim, 'id' | 'runId'>>().toEqualTypeOf<{ id: string; runId: string }>();
  });
});

describe('add-agent-team-observability nullable 可用性（禁止 0 冒充）', () => {
  it('cost 不可观测必须能表达 null', () => {
    expectTypeOf<Pick<TeamRunSummary, 'costCurrency'>>().toEqualTypeOf<{ costCurrency: PriceCurrency | null }>();
    expectTypeOf<Pick<TeamCostMetrics, 'costCurrency'>>().toEqualTypeOf<{ costCurrency: PriceCurrency | null }>();
  });

  it('指标 value 不可用必须能表达 null', () => {
    expectTypeOf<Pick<TeamMetricValue, 'value'>>().toEqualTypeOf<{ value: number | null }>();
  });
});

it('keeps connection diagnostics evidence metadata-only with explicitly unverified runtime trust', () => {
  expectTypeOf<keyof MonitorConnectionDiagnostics>().toEqualTypeOf<'profileId' | 'profileRevision' | 'checkedAt' | 'expectedPort' | 'listener' | 'ca' | 'trust' | 'traffic' | 'status' | 'issues'>();
  expectTypeOf<MonitorConnectionDiagnostics['trust']['runtimeVerified']>().toEqualTypeOf<false>();
  expectTypeOf<MonitorConnectionDiagnostics['traffic']['scope']>().toEqualTypeOf<'shared_listener'>();
  expectTypeOf<MonitorConnectionDiagnostics['issues'][number]['code']>().toEqualTypeOf<MonitorDiagnosticCode>();
});
