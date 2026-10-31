import { describe, expect, it } from 'vitest';

import { assembleCaptureEvidenceExport, CAPTURE_EXPORT_MAX_BYTES, CaptureExportLimitError, stringifyCaptureEvidenceExport } from './capture-export.js';
import type { CaptureExportInput } from './capture-export.js';
import type { ProxyRequest } from '../../src/core/trace-types.js';

function fixture(): CaptureExportInput {
  const request: ProxyRequest = { id: 7, requestId: 'req-7', method: 'POST', url: 'https://example.test/v1/messages?token=original', hostname: 'example.test',
    requestHeaders: { authorization: 'Bearer ORIGINAL_VALUE', cookie: 'session=ORIGINAL_COOKIE' }, requestBody: 'REQUEST_BODY_PRIVATE',
    responseStatus: 200, responseBody: 'RESPONSE_BODY_PRIVATE', contentType: 'text/event-stream', isStreaming: true,
    startedAt: '2026-10-16T00:00:00.000Z', completedAt: '2026-10-16T00:00:01.000Z', durationMs: 1000,
    captureMethod: 'mitm', ttnetEncrypted: false, systemPrompt: 'SYSTEM_PROMPT_PRIVATE', systemPromptLen: 21, model: 'demo', inputTokens: 0, outputTokens: null,
    parsedSessionId: null, parserRoute: '/v1/messages', captureGroupId: null, requestFormat: 'anthropic_messages',
    rawRequestBody: 'RAW_REQUEST_PRIVATE', rawResponseBody: 'RAW_RESPONSE_PRIVATE' };
  return { exportedAt: '2026-10-16T00:01:00.000Z', schemaVersion: 17, request,
    capture: { request: { id: '11111111-1111-4111-8111-111111111111', bytes: 12, sha256: 'a'.repeat(64), status: 'complete', error: null },
      response: { id: '22222222-2222-4222-8222-222222222222', bytes: 5, sha256: 'b'.repeat(64), status: 'interrupted', error: null },
      requestPreviewTruncated: false, responsePreviewTruncated: true, responseHeaders: { 'set-cookie': ['first=ORIGINAL', 'second=ORIGINAL'] } },
    originalDeletion: null, analysis: { parserVersion: 2, requestFormat: 'anthropic_messages', model: 'demo', responseId: null, state: 'incomplete', stopReason: null,
      system: 'BOUNDED_ANALYSIS_SYSTEM', declarations: [], items: [], errors: [], unknownEvents: 1,
      usage: { inputTokens: 0, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null, reasoningTokens: null, nativeTotalTokens: null, totalTokens: null, accounting: 'anthropic_additive_input', snapshots: [] },
      completeness: { complete: false, omittedCount: 1, reasons: ['response:interrupted'] } }, analysisUnavailableReason: null,
    identities: { source: 'proxy', sourceKey: '7', parserVersion: 1, items: [], completeness: { complete: false, omittedCount: 0, reasons: ['not_collected'] }, nextCursor: null, hasMore: false },
    traceLinks: { proxyId: 7, items: [], nextCursor: null, hasMore: false } };
}

describe('versioned local capture export', () => {
  it('carries parser/native evidence, original prefix refs and bounded missing-state declarations', () => {
    const input = fixture(); const value = assembleCaptureEvidenceExport(input);
    expect(value.format).toBe('awesome-telemetry.capture-evidence'); expect(value.formatVersion).toBe(1);
    expect(value.schemaVersion).toBe(17); expect(value.exportedAt).toBe(input.exportedAt);
    expect(value.analysis?.parserVersion).toBe(2); expect(value.analysis?.usage.outputTokens).toBeNull(); expect(value.analysis?.usage.inputTokens).toBe(0);
    expect(value.capture.response).toEqual(input.capture.response); expect(value.capture.response?.status).toBe('interrupted');
    expect(value.limitations.join(' ')).toContain('original_bodies_not_included');
    expect(value.limitations.join(' ')).toContain('analysis_incomplete');
    expect(value.limitations.join(' ')).toContain('identities_incomplete');
  });
  it('explicitly excludes all five preview/body fields and unknown runtime-only request fields', () => {
    const input = fixture(); Object.assign(input.request, { storeDirectory: '/PRIVATE_STORE', caPrivateKey: 'PRIVATE_CA', journal: 'PRIVATE_JOURNAL' });
    const value = assembleCaptureEvidenceExport(input); const text = stringifyCaptureEvidenceExport(value);
    for (const key of ['requestBody', 'responseBody', 'rawRequestBody', 'rawResponseBody', 'systemPrompt', 'storeDirectory', 'caPrivateKey', 'journal']) expect(value.request).not.toHaveProperty(key);
    for (const marker of ['REQUEST_BODY_PRIVATE', 'RESPONSE_BODY_PRIVATE', 'SYSTEM_PROMPT_PRIVATE', 'RAW_REQUEST_PRIVATE', 'RAW_RESPONSE_PRIVATE', '/PRIVATE_STORE', 'PRIVATE_CA', 'PRIVATE_JOURNAL']) expect(text).not.toContain(marker);
  });
  it('preserves original sensitive URL/header values and response arrays without masking or header clipping', () => {
    const value = assembleCaptureEvidenceExport(fixture());
    expect(value.request.url).toContain('token=original'); expect(value.request.requestHeaders.authorization).toBe('Bearer ORIGINAL_VALUE');
    expect(value.request.requestHeaders.cookie).toBe('session=ORIGINAL_COOKIE');
    expect(value.capture.responseHeaders['set-cookie']).toEqual(['first=ORIGINAL', 'second=ORIGINAL']);
  });
  it.each(['pending', 'failed', 'complete'] as const)('removes stale analysis for every %s deletion intent while keeping header/native metadata', state => {
    const input = fixture(); input.originalDeletion = { id: 'deletion-1', proxyId: 7, requestId: 'req-7', state, error: state === 'failed' ? 'CAPTURE_DELETE_FAILED' : null,
      createdAt: input.exportedAt, updatedAt: input.exportedAt, completedAt: state === 'complete' ? input.exportedAt : null };
    const value = assembleCaptureEvidenceExport(input);
    expect(value.analysis).toBeNull(); expect(value.analysisUnavailableReason).toBe('original_deleted');
    expect(stringifyCaptureEvidenceExport(value)).not.toContain('BOUNDED_ANALYSIS_SYSTEM');
    expect(value.capture.request?.sha256).toBe('a'.repeat(64)); expect(value.request.requestHeaders.authorization).toBe('Bearer ORIGINAL_VALUE');
    expect(input.analysis?.system).toBe('BOUNDED_ANALYSIS_SYSTEM');
  });
  it('exports metadata when analysis failed without pretending unknown was successful or zero', () => {
    const input = fixture(); input.analysis = null; input.analysisUnavailableReason = 'analysis_unavailable';
    const value = assembleCaptureEvidenceExport(input);
    expect(value.analysis).toBeNull(); expect(value.analysisUnavailableReason).toBe('analysis_unavailable');
    expect(value.request.outputTokens).toBeNull(); expect(value.limitations).toContain('analysis_unavailable');
  });
  it('preserves an explicitly requested metadata-only omission independently of deletion', () => {
    const input = fixture(); input.analysis = null; input.analysisUnavailableReason = 'metadata_only';
    const value = assembleCaptureEvidenceExport(input);
    expect(value.analysis).toBeNull(); expect(value.originalDeletion).toBeNull();
    expect(value.analysisUnavailableReason).toBe('metadata_only'); expect(value.limitations).toContain('metadata_only');
  });
  it('bounds identity/link pages to 100 with truthful continuation and preserves evidence IDs', () => {
    const input = fixture(); input.identities.items = Array.from({ length: 101 }, (_, i) => ({ id: 'identity-' + i, source: 'proxy', sourceKey: '7',
      namespace: 'agent:codex', kind: 'session', value: 'native-' + i, scope: null, eventId: null, sourcePath: 'request.headers.x-agent-session-id' }));
    input.traceLinks.items = Array.from({ length: 101 }, (_, i) => ({ id: 'link-' + i, sessionKey: 'scan-' + i, proxyId: 7, state: 'candidate', reason: 'synthetic evidence', evidenceIds: ['identity-' + i], createdAt: input.exportedAt, updatedAt: input.exportedAt }));
    const value = assembleCaptureEvidenceExport(input);
    expect(value.identities.items).toHaveLength(100); expect(value.identities.hasMore).toBe(true); expect(value.identities.nextCursor).toBe('identity-99');
    expect(value.traceLinks.items).toHaveLength(100); expect(value.traceLinks.hasMore).toBe(true); expect(value.traceLinks.nextCursor).toBe('scan-99');
    expect(value.traceLinks.items[0]?.state).toBe('candidate'); expect(value.traceLinks.items[0]?.evidenceIds).toEqual(['identity-0']);
  });
  it('round-trips a self-contained analysis snapshot and does not alias later input mutations', () => {
    const input = fixture(); const value = assembleCaptureEvidenceExport(input);
    input.request.requestHeaders.authorization = 'MUTATED'; input.capture.responseHeaders['set-cookie'] = ['MUTATED']; input.analysis!.system = 'MUTATED';
    const roundTrip = JSON.parse(stringifyCaptureEvidenceExport(value)) as typeof value;
    expect(roundTrip).toEqual(value); expect(roundTrip.analysis?.system).toBe('BOUNDED_ANALYSIS_SYSTEM');
    expect(roundTrip.request.requestHeaders.authorization).toBe('Bearer ORIGINAL_VALUE');
  });
  it('enforces 4MiB as UTF-8 bytes rather than characters and never clips original values', () => {
    const value = assembleCaptureEvidenceExport(fixture()); value.request.requestHeaders.huge = '中'.repeat(Math.ceil(CAPTURE_EXPORT_MAX_BYTES / 3));
    expect(() => stringifyCaptureEvidenceExport(value)).toThrow(CaptureExportLimitError);
    expect(value.request.requestHeaders.huge.length).toBe(Math.ceil(CAPTURE_EXPORT_MAX_BYTES / 3));
  });
  it('accepts exactly the UTF-8 budget and rejects one extra byte', () => {
    const value = assembleCaptureEvidenceExport(fixture()); value.request.requestHeaders.padding = '';
    const initialBytes = Buffer.byteLength(stringifyCaptureEvidenceExport(value));
    value.request.requestHeaders.padding = 'x'.repeat(CAPTURE_EXPORT_MAX_BYTES - initialBytes);
    expect(Buffer.byteLength(stringifyCaptureEvidenceExport(value))).toBe(CAPTURE_EXPORT_MAX_BYTES);
    value.request.requestHeaders.padding += 'x';
    expect(() => stringifyCaptureEvidenceExport(value)).toThrow(CaptureExportLimitError);
  });
});
