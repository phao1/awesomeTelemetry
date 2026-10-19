import { describe, expect, it } from 'vitest';

import { buildCaptureComparison } from './capture-comparison.js';
import type { CaptureComparisonResponse, CaptureComparisonSide, CaptureNetworkTiming } from './trace-types.js';

function side(id: number): CaptureComparisonSide {
  return {
    request: { id, requestId: 'request-' + id, method: 'POST', url: 'https://example.test/v1/chat/completions', hostname: 'example.test',
      responseStatus: 200, contentType: 'text/event-stream', isStreaming: true, startedAt: '2026-10-16T00:00:00.000Z', completedAt: '2026-10-16T00:00:01.000Z',
      durationMs: 9999, captureMethod: 'mitm', ttnetEncrypted: false, systemPromptLen: 0, model: 'same-model', inputTokens: 9999, outputTokens: 9999,
      parsedSessionId: null, parserRoute: '/v1/chat/completions', captureGroupId: null, requestFormat: 'openai_chat', hasSystemPrompt: false },
    evidence: { request: { id: 'req-body-' + id, bytes: 100, sha256: 'a'.repeat(64), status: 'complete', error: null },
      response: { id: 'res-body-' + id, bytes: 200, sha256: 'b'.repeat(64), status: 'complete', error: null },
      requestPreviewTruncated: false, responsePreviewTruncated: false, processing: { version: 1, status: 'ok', error: null },
      transport: { version: 1, state: 'completed', error: null, requestEnded: true, responseEnded: true, statusCode: 200,
        timing: { version: 1, clock: 'proxy_monotonic', responseHeadersMs: 10, firstBodyByteMs: 20, firstContentMs: 30,
          firstContentKind: 'text', firstContentBasis: 'sse_event_dispatch', completedMs: 1000, contentTimingStatus: 'observed', serverTiming: null, serverTimingTruncated: false } } },
    originalDeletion: null, analysisUnavailableReason: null,
    analysis: { parserVersion: 2, requestFormat: 'openai_chat', model: 'same-model', state: 'completed', stopReason: 'stop', errorCount: 0, errorCodes: [], errorCodesTruncated: false,
      completeness: { complete: true, omittedCount: 0, reasons: [] },
      usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 40, cacheWriteTokens: null, reasoningTokens: 5, nativeTotalTokens: 120, totalTokens: 120, accounting: 'openai_subsets', snapshots: [] } },
  };
}
function fixture(): CaptureComparisonResponse { return { base: side(1), target: side(2), generatedAt: '2026-10-16T00:00:02.000Z' }; }
function timing(value: CaptureComparisonSide): CaptureNetworkTiming { return value.evidence.transport!.timing!; }

describe('explicit capture comparison display model', () => {
  it('subtracts target minus base for four proxy timings and never substitutes legacy duration', () => {
    const input = fixture(); Object.assign(timing(input.target), { responseHeadersMs: 15, firstBodyByteMs: 22, firstContentMs: 25, completedMs: 900 });
    const model = buildCaptureComparison(input);
    expect(model.timings.map(row => [row.id, row.base, row.target, row.delta, row.comparable])).toEqual([
      ['responseHeadersMs', 10, 15, 5, true], ['firstBodyByteMs', 20, 22, 2, true], ['firstContentMs', 30, 25, -5, true], ['completedMs', 1000, 900, -100, true],
    ]);
    expect(model.timings[0]!.baseSource).toBe('base.evidence.transport.timing.responseHeadersMs');
    expect(model.timings[0]!.targetSource).toBe('target.evidence.transport.timing.responseHeadersMs');
    expect(model.cost).toEqual({ base: null, target: null, delta: null, reason: 'not_estimated' });
  });
  it('preserves zero offsets and zero token counters while keeping missing counters unknown', () => {
    const input = fixture(); Object.assign(timing(input.base), { responseHeadersMs: 0, firstBodyByteMs: 0, firstContentMs: 0 });
    input.base.analysis!.usage.inputTokens = 0; input.target.analysis!.usage.inputTokens = 0;
    input.target.analysis!.usage.outputTokens = null;
    const model = buildCaptureComparison(input);
    expect(model.timings[0]).toMatchObject({ base: 0, target: 10, delta: 10 });
    expect(model.usage.find(row => row.id === 'inputTokens')).toMatchObject({ base: 0, target: 0, delta: 0, comparable: true });
    expect(model.usage.find(row => row.id === 'outputTokens')).toMatchObject({ base: 20, target: null, delta: null, comparable: false });
  });
  it('displays native counters without adding cache/reasoning subsets into totals or replaying native snapshots', () => {
    const input = fixture(); Object.assign(input.target.analysis!.usage, { inputTokens: 110, outputTokens: 25, cacheReadTokens: 45, reasoningTokens: 7, nativeTotalTokens: 135, totalTokens: 135,
      snapshots: [{ eventIndex: 1, value: '{"total_tokens":135}' }, { eventIndex: 2, value: '{"total_tokens":135}' }] });
    const model = buildCaptureComparison(input);
    expect(model.usage.map(row => [row.id, row.base, row.target, row.delta])).toEqual([
      ['inputTokens', 100, 110, 10], ['outputTokens', 20, 25, 5], ['cacheReadTokens', 40, 45, 5], ['cacheWriteTokens', null, null, null],
      ['reasoningTokens', 5, 7, 2], ['nativeTotalTokens', 120, 135, 15], ['totalTokens', 120, 135, 15],
    ]);
    expect(model.usage[0]!.baseSource).toBe('base.analysis.usage.inputTokens');
    input.target.analysis!.usage.totalTokens = null;
    expect(buildCaptureComparison(input).usage.find(row => row.id === 'totalTokens')!.target).toBeNull();
  });
  it.each([NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])('does not compute invalid millisecond offsets: %s', invalid => {
    const input = fixture(); timing(input.target).firstContentMs = invalid;
    const row = buildCaptureComparison(input).timings.find(row => row.id === 'firstContentMs')!;
    expect(row.target).toBeNull(); expect(row.delta).toBeNull(); expect(row.reasons).toContain('invalid_value');
  });
  it('does not calculate a null timing or fill it with E2E/header/request duration', () => {
    const input = fixture(); timing(input.target).firstContentMs = null;
    const row = buildCaptureComparison(input).timings.find(row => row.id === 'firstContentMs')!;
    expect(row).toMatchObject({ base: 30, target: null, delta: null, comparable: false }); expect(row.reasons).toContain('missing_value');
  });
  it('treats normally ended HTTP errors as valid network measurements without declaring protocol/Agent success', () => {
    const input = fixture(); input.target.evidence.transport!.state = 'http_error'; input.target.evidence.transport!.statusCode = 429;
    input.target.evidence.transport!.error = 'HTTP_ERROR'; input.target.analysis!.state = 'failed';
    const model = buildCaptureComparison(input);
    expect(model.timings.every(row => row.comparable)).toBe(true);
    expect(model.usage.every(row => !row.comparable)).toBe(true);
    expect(model.usage.every(row => row.reasons.includes('protocol_not_completed') && !row.reasons.includes('incomplete_evidence'))).toBe(true);
    expect(model.warnings.some(warning => warning.code === 'analysis_incomplete')).toBe(false);
    expect(model.warnings.some(warning => warning.code === 'analysis_mismatch')).toBe(true);
  });
  it.each(['failed', 'unknown', 'incomplete'] as const)('separates a fully retained %s protocol outcome from incomplete analysis evidence', state => {
    const input = fixture(); input.target.analysis!.state = state;
    const model = buildCaptureComparison(input);
    expect(input.target.analysis!.completeness.complete).toBe(true);
    expect(model.usage.every(row => row.delta === null && row.reasons.includes('protocol_not_completed'))).toBe(true);
    expect(model.usage.every(row => !row.reasons.includes('incomplete_evidence'))).toBe(true);
    expect(model.usage[0]!.target).toBe(100);
    expect(model.warnings.some(warning => warning.code === 'analysis_incomplete')).toBe(false);
  });
  it('keeps incomplete evidence warnings alongside the separate failed-protocol restriction when both apply', () => {
    const input = fixture(); input.target.analysis!.state = 'failed';
    input.target.analysis!.completeness = { complete: false, omittedCount: 1, reasons: ['response:value_limit'] };
    const model = buildCaptureComparison(input);
    expect(model.usage.every(row => row.delta === null && row.reasons.includes('protocol_not_completed') && row.reasons.includes('incomplete_evidence'))).toBe(true);
    expect(model.warnings.find(warning => warning.code === 'analysis_incomplete')).toMatchObject({ sides: ['target'], details: ['target:state=failed', 'target:response:value_limit'] });
    expect(model.usage[0]!.target).toBe(100);
  });
  it('does not interpret an unknown future timing representation as a compatible measurement', () => {
    const input = fixture(); Object.assign(timing(input.target), { version: 2 });
    expect(buildCaptureComparison(input).timings.every(row => row.delta === null && row.reasons.includes('invalid_value'))).toBe(true);
  });
  it.each(['clock_missing', 'clock_mismatch', 'transport_incomplete', 'direction_unfinished', 'bad_order'] as const)('keeps raw observations but disallows timing arithmetic with %s', kind => {
    const input = fixture();
    if (kind === 'clock_missing') Reflect.deleteProperty(timing(input.target), 'clock');
    if (kind === 'clock_mismatch') Object.assign(timing(input.target), { clock: 'vendor_clock' });
    if (kind === 'transport_incomplete') input.target.evidence.transport!.state = 'interrupted';
    if (kind === 'direction_unfinished') input.target.evidence.transport!.requestEnded = false;
    if (kind === 'bad_order') timing(input.target).firstContentMs = 5;
    const model = buildCaptureComparison(input);
    expect(model.timings.every(row => row.delta === null && !row.comparable)).toBe(true);
    expect(model.timings[0]!.target).toBe(10);
  });
  it.each(['basis', 'kind', 'status', 'missing_basis', 'missing_kind'] as const)('requires observed matching content measurement basis and kind (%s)', mismatch => {
    const input = fixture();
    if (mismatch === 'basis') timing(input.target).firstContentBasis = 'json_document_complete';
    if (mismatch === 'kind') timing(input.target).firstContentKind = 'reasoning';
    if (mismatch === 'status') timing(input.target).contentTimingStatus = 'preview_limit';
    if (mismatch === 'missing_basis') timing(input.target).firstContentBasis = null;
    if (mismatch === 'missing_kind') timing(input.target).firstContentKind = null;
    const model = buildCaptureComparison(input);
    expect(model.timings.find(row => row.id === 'firstContentMs')).toMatchObject({ base: 30, target: 30, delta: null, comparable: false });
    expect(model.timings[0]!.delta).toBe(0);
    expect(model.warnings.some(warning => warning.code === 'measurement_mismatch')).toBe(true);
  });
  it('does not erase independently observed timing after later body truncation, processing failure, incomplete analysis or deletion', () => {
    const input = fixture(); input.target.evidence.response!.status = 'body_limit'; input.target.evidence.processing!.status = 'worker_error';
    input.target.analysis!.completeness = { complete: false, omittedCount: 1, reasons: ['value_limit'] };
    input.target.originalDeletion = { id: 'deletion', proxyId: 2, requestId: 'request-2', state: 'pending', error: null, createdAt: input.generatedAt, updatedAt: input.generatedAt, completedAt: null };
    const model = buildCaptureComparison(input);
    expect(model.timings.every(row => row.comparable && row.delta === 0)).toBe(true);
    expect(model.usage.every(row => row.target === null && row.delta === null)).toBe(true);
    const codes = model.warnings.map(warning => warning.code);
    expect(codes).toContain('original_deleted'); expect(codes).toContain('retention_incomplete'); expect(codes).toContain('processing_incomplete');
  });
  it.each(['incomplete', 'not_completed', 'accounting_unknown', 'accounting_mismatch', 'unavailable'] as const)('keeps usage values descriptive but blocks noncomparable differences: %s', cause => {
    const input = fixture();
    if (cause === 'incomplete') input.target.analysis!.completeness.complete = false;
    if (cause === 'not_completed') input.target.analysis!.state = 'incomplete';
    if (cause === 'accounting_unknown') input.target.analysis!.usage.accounting = 'unknown';
    if (cause === 'accounting_mismatch') input.target.analysis!.usage.accounting = 'anthropic_additive_input';
    if (cause === 'unavailable') { input.target.analysis = null; input.target.analysisUnavailableReason = 'metadata_only'; }
    const model = buildCaptureComparison(input);
    expect(model.usage.every(row => row.delta === null && !row.comparable)).toBe(true);
    expect(model.usage[0]!.target).toBe(cause === 'unavailable' ? null : 100);
  });
  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid native counts instead of substituting metadata usage: %s', invalid => {
    const input = fixture(); input.target.analysis!.usage.inputTokens = invalid;
    const row = buildCaptureComparison(input).usage[0]!;
    expect(row.target).toBeNull(); expect(row.delta).toBeNull(); expect(row.reasons).toContain('invalid_value');
  });
  it('requires a recognized accounting domain even when two unknown future domains happen to have equal names', () => {
    const input = fixture(); Object.assign(input.base.analysis!.usage, { accounting: 'future_vendor_equation' });
    Object.assign(input.target.analysis!.usage, { accounting: 'future_vendor_equation' });
    const model = buildCaptureComparison(input);
    expect(model.usage.every(row => row.delta === null && row.reasons.includes('accounting_unknown'))).toBe(true);
    expect(model.warnings.some(warning => warning.code === 'accounting_unknown')).toBe(true);
  });
  it('does not fabricate legacy timing/counters from request metadata or pretend unknown accounting/model/protocol is comparable', () => {
    const input = fixture(); input.target.evidence.transport = undefined; input.target.evidence.processing = undefined;
    input.target.evidence.request = null; input.target.evidence.response = null; input.target.request.model = null;
    input.target.request.requestFormat = 'unknown'; input.target.analysis = null; input.target.analysisUnavailableReason = 'analysis_unavailable';
    const model = buildCaptureComparison(input);
    expect(model.timings.every(row => row.target === null && row.delta === null)).toBe(true); expect(model.usage.every(row => row.target === null)).toBe(true);
    const codes = model.warnings.map(warning => warning.code);
    for (const code of ['timing_unavailable', 'processing_unknown', 'retention_unknown', 'analysis_unavailable', 'model_unknown', 'protocol_unknown', 'accounting_unknown']) expect(codes).toContain(code);
  });
  it('flags all cross-source/context confounders without inferring causality, speed ratios, hidden cost or charge identity', () => {
    const input = fixture(); input.target.analysis!.model = 'another-model'; input.target.analysis!.requestFormat = 'openai_responses';
    input.target.evidence.processing!.status = 'preview_truncated'; input.target.evidence.response!.status = 'interrupted';
    input.target.analysis!.parserVersion = 3; input.target.analysis!.completeness.complete = false;
    timing(input.target).firstContentKind = 'tool_arguments';
    const model = buildCaptureComparison(input); const codes = model.warnings.map(warning => warning.code);
    for (const code of ['model_mismatch', 'protocol_mismatch', 'processing_mismatch', 'retention_mismatch', 'analysis_mismatch', 'completeness_mismatch', 'measurement_mismatch',
      'task_tool_parameters_quality_unproven', 'natural_comparison_not_causal', 'cost_unknown']) expect(codes).toContain(code);
    expect(model.cost.base).toBeNull(); expect(model.cost.target).toBeNull();
    expect(model).not.toHaveProperty('speedup'); expect(model).not.toHaveProperty('verdict'); expect(model).not.toHaveProperty('costTotal');
  });
  it('is deterministic, immutable, pure and carries bounded metadata paths rather than observed content', () => {
    const input = fixture(); const before = structuredClone(input);
    const first = buildCaptureComparison(input); const second = buildCaptureComparison(input);
    expect(input).toEqual(before); expect(second).toEqual(first);
    expect(first.warnings.every(warning => warning.sides.every(side => side === 'base' || side === 'target'))).toBe(true);
    expect(first.warnings.some(warning => warning.code === 'natural_comparison_not_causal')).toBe(true);
  });
});
