import { describe, expect, it } from 'vitest';

import { deriveCaptureDiagnostics } from './capture-diagnostics.js';
import type { CaptureComparisonResponse, CaptureComparisonSide, CaptureNetworkTiming } from './trace-types.js';

function side(id: number): CaptureComparisonSide {
  return {
    request: { id, requestId: 'request-' + id, method: 'POST', url: 'https://example.test/v1/chat/completions', hostname: 'example.test',
      responseStatus: 200, contentType: 'text/event-stream', isStreaming: true, startedAt: '2026-10-16T00:00:00.000Z', completedAt: '2026-10-16T00:00:30.000Z',
      durationMs: 999999, captureMethod: 'mitm', ttnetEncrypted: false, systemPromptLen: 0, model: 'same-model', inputTokens: 9999, outputTokens: 9999,
      parsedSessionId: null, parserRoute: '/v1/chat/completions', captureGroupId: null, requestFormat: 'openai_chat', hasSystemPrompt: false },
    evidence: { request: { id: 'req-body-' + id, bytes: 100, sha256: 'a'.repeat(64), status: 'complete', error: null },
      response: { id: 'res-body-' + id, bytes: 200, sha256: 'b'.repeat(64), status: 'complete', error: null },
      requestPreviewTruncated: false, responsePreviewTruncated: false, processing: { version: 1, status: 'ok', error: null },
      transport: { version: 1, state: 'completed', error: null, requestEnded: true, responseEnded: true, statusCode: 200,
        timing: { version: 1, clock: 'proxy_monotonic', responseHeadersMs: 10, firstBodyByteMs: 20, firstContentMs: 10000,
          firstContentKind: 'text', firstContentBasis: 'sse_event_dispatch', completedMs: 30000, contentTimingStatus: 'observed', serverTiming: null, serverTimingTruncated: false } } },
    originalDeletion: null, analysisUnavailableReason: 'metadata_only', analysis: null,
  };
}
function fixture(): CaptureComparisonResponse { return { base: side(1), target: side(2), generatedAt: '2026-10-16T00:00:31.000Z' }; }
function timing(value: CaptureComparisonSide): CaptureNetworkTiming { return value.evidence.transport!.timing!; }
function slow(input: CaptureComparisonResponse) { return deriveCaptureDiagnostics(input).findings.filter(item => item.code !== 'repeated_encoded_request'); }

describe('selected capture evidence diagnostics (metrics REQ-016)', () => {
  it('reports four independent threshold-qualified observations and one encoded-body candidate with exact evidence', () => {
    const model = deriveCaptureDiagnostics(fixture());
    expect(model).toEqual({ thresholdMs: 10000, repeat: 'same_encoded_request', findings: [
      { code: 'slow_network', classification: 'derived', evidence: [{ side: 'base', requestId: 1, path: 'base.evidence.transport.timing.completedMs', value: 30000 }] },
      { code: 'slow_first_content', classification: 'derived', evidence: [{ side: 'base', requestId: 1, path: 'base.evidence.transport.timing.firstContentMs', value: 10000 }] },
      { code: 'slow_network', classification: 'derived', evidence: [{ side: 'target', requestId: 2, path: 'target.evidence.transport.timing.completedMs', value: 30000 }] },
      { code: 'slow_first_content', classification: 'derived', evidence: [{ side: 'target', requestId: 2, path: 'target.evidence.transport.timing.firstContentMs', value: 10000 }] },
      { code: 'repeated_encoded_request', classification: 'derived', evidence: [
        { side: 'base', requestId: 1, path: 'base.evidence.request.sha256', value: 'a'.repeat(64) },
        { side: 'base', requestId: 1, path: 'base.evidence.request.bytes', value: 100 },
        { side: 'target', requestId: 2, path: 'target.evidence.request.sha256', value: 'a'.repeat(64) },
        { side: 'target', requestId: 2, path: 'target.evidence.request.bytes', value: 100 },
      ] },
    ] });
  });
  it.each([0, -1, 0.5, NaN, Infinity, 3600001, Number.MAX_SAFE_INTEGER + 1])('uses documented default for invalid threshold %s', threshold => {
    expect(deriveCaptureDiagnostics(fixture(), threshold)).toEqual(deriveCaptureDiagnostics(fixture(), 10000));
  });
  it('accepts both threshold endpoints and qualifies equality without interpreting zero as missing', () => {
    const input = fixture();
    expect(deriveCaptureDiagnostics(input, 1).thresholdMs).toBe(1);
    expect(deriveCaptureDiagnostics(input, 3600000)).toMatchObject({ thresholdMs: 3600000, findings: [expect.objectContaining({ code: 'repeated_encoded_request' })] });
    Object.assign(timing(input.base), { responseHeadersMs: 0, firstBodyByteMs: 0, firstContentMs: 0, completedMs: 0 });
    expect(slow(input)).toHaveLength(2);
    Object.assign(timing(input.base), { firstContentMs: 1, completedMs: 1 });
    expect(deriveCaptureDiagnostics(input, 1).findings.filter(item => item.evidence[0]!.side === 'base' && item.code !== 'repeated_encoded_request')).toHaveLength(2);
  });
  it('validates each side independently even when content basis and kind differ across the pair', () => {
    const input = fixture(); timing(input.target).firstContentBasis = 'json_document_complete'; timing(input.target).firstContentKind = 'reasoning';
    expect(slow(input)).toHaveLength(4);
    input.base.evidence.transport = undefined;
    expect(slow(input).map(item => item.evidence[0]!.side)).toEqual(['target', 'target']);
  });
  it.each(['missing_clock', 'wrong_clock', 'future_version', 'interrupted', 'upload_open', 'response_open', 'bad_order'] as const)('rejects invalid per-side timing domain: %s', cause => {
    const input = fixture();
    if (cause === 'missing_clock') Reflect.deleteProperty(timing(input.target), 'clock');
    if (cause === 'wrong_clock') Object.assign(timing(input.target), { clock: 'vendor_clock' });
    if (cause === 'future_version') Object.assign(timing(input.target), { version: 2 });
    if (cause === 'interrupted') input.target.evidence.transport!.state = 'interrupted';
    if (cause === 'upload_open') input.target.evidence.transport!.requestEnded = false;
    if (cause === 'response_open') input.target.evidence.transport!.responseEnded = false;
    if (cause === 'bad_order') timing(input.target).completedMs = 1;
    expect(slow(input).map(item => item.evidence[0]!.side)).toEqual(['base', 'base']);
  });
  it.each([null, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('does not substitute request duration for unknown/invalid completion %s', value => {
    const input = fixture(); timing(input.target).completedMs = value;
    expect(slow(input).filter(item => item.code === 'slow_network').map(item => item.evidence[0]!.side)).toEqual(['base']);
  });
  it('requires observed known first-content evidence without suppressing valid network timing', () => {
    const input = fixture(); timing(input.target).contentTimingStatus = 'preview_limit'; timing(input.target).firstContentBasis = null; timing(input.target).firstContentKind = null;
    expect(slow(input).map(item => [item.code, item.evidence[0]!.side])).toEqual([['slow_network', 'base'], ['slow_first_content', 'base'], ['slow_network', 'target']]);
  });
  it('keeps completed HTTP errors as observations and keeps timings after deletion/processing failure', () => {
    const input = fixture(); input.target.evidence.transport!.state = 'http_error'; input.target.evidence.transport!.statusCode = 429;
    input.target.evidence.processing!.status = 'worker_error'; input.target.evidence.response!.status = 'body_limit';
    input.target.originalDeletion = { id: 'deletion', proxyId: 2, requestId: 'request-2', state: 'pending', error: null, createdAt: input.generatedAt, updatedAt: input.generatedAt, completedAt: null };
    const model = deriveCaptureDiagnostics(input);
    expect(slow(input)).toHaveLength(4); expect(model.repeat).toBe('unavailable');
    expect(model.findings.some(item => item.code === 'repeated_encoded_request')).toBe(false);
  });
  it.each(['digest', 'bytes'] as const)('reports a proven encoded request difference in %s without creating a repeated finding', change => {
    const input = fixture(); if (change === 'digest') input.target.evidence.request!.sha256 = 'c'.repeat(64); else input.target.evidence.request!.bytes = 101;
    const model = deriveCaptureDiagnostics(input); expect(model.repeat).toBe('different_encoded_request');
    expect(model.findings.some(item => item.code === 'repeated_encoded_request')).toBe(false);
  });
  it.each(['same_id', 'invalid_id', 'no_ref', 'incomplete', 'empty', 'fractional_bytes', 'unsafe_bytes', 'bad_sha', 'upper_sha', 'method', 'host', 'url', 'protocol', 'unknown_endpoint'] as const)('keeps repeated request unavailable without required retained evidence: %s', cause => {
    const input = fixture();
    if (cause === 'same_id') input.target.request.id = 1;
    if (cause === 'invalid_id') input.target.request.id = 0;
    if (cause === 'no_ref') input.target.evidence.request = null;
    if (cause === 'incomplete') input.target.evidence.request!.status = 'body_limit';
    if (cause === 'empty') input.target.evidence.request!.bytes = 0;
    if (cause === 'fractional_bytes') input.target.evidence.request!.bytes = 0.5;
    if (cause === 'unsafe_bytes') input.target.evidence.request!.bytes = Number.MAX_SAFE_INTEGER + 1;
    if (cause === 'bad_sha') input.target.evidence.request!.sha256 = 'g'.repeat(64);
    if (cause === 'upper_sha') input.target.evidence.request!.sha256 = 'A'.repeat(64);
    if (cause === 'method') input.target.request.method = 'PUT';
    if (cause === 'host') input.target.request.hostname = 'other.test';
    if (cause === 'url') input.target.request.url += '?different=1';
    if (cause === 'protocol') input.target.request.requestFormat = 'unknown';
    if (cause === 'unknown_endpoint') { input.base.request.method = ''; input.target.request.method = ''; }
    expect(deriveCaptureDiagnostics(input).repeat).toBe('unavailable');
  });
  it('accepts all three supported formats using metadata only without requiring response bodies or analysis', () => {
    for (const format of ['openai_chat', 'openai_responses', 'anthropic_messages'] as const) {
      const input = fixture(); input.base.request.requestFormat = format; input.target.request.requestFormat = format;
      input.base.evidence.response = null; input.target.evidence.response = null;
      input.base.evidence.processing = undefined; input.target.evidence.processing = undefined;
      expect(deriveCaptureDiagnostics(input).repeat).toBe('same_encoded_request');
    }
  });
  it('keeps all deletion intent states unavailable while preserving independently observed timing', () => {
    for (const state of ['pending', 'failed', 'complete'] as const) {
      const input = fixture();
      input.base.originalDeletion = { id: 'intent', proxyId: 1, requestId: 'request-1', state, error: null, createdAt: input.generatedAt, updatedAt: input.generatedAt, completedAt: null };
      expect(deriveCaptureDiagnostics(input).repeat).toBe('unavailable'); expect(slow(input)).toHaveLength(4);
    }
  });
  it('requires valid distinct capture IDs and positive safe byte counts on either side', () => {
    for (const name of ['base', 'target'] as const) {
      for (const invalid of [-1, 0, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
        const badId = fixture(); badId[name].request.id = invalid;
        expect(deriveCaptureDiagnostics(badId).repeat).toBe('unavailable');
        const badBytes = fixture(); badBytes[name].evidence.request!.bytes = invalid;
        expect(deriveCaptureDiagnostics(badBytes).repeat).toBe('unavailable');
      }
    }
  });
  it('rejects unknown content measurement representations while allowing meaningful network duration', () => {
    for (const mutation of [{ firstContentKind: null }, { firstContentBasis: null }, { firstContentKind: 'future_kind' },
      { firstContentBasis: 'vendor_clock' }, { contentTimingStatus: 'not_observed' }, { firstContentMs: null }]) {
      const input = fixture(); Object.assign(timing(input.base), mutation);
      expect(slow(input).filter(item => item.code === 'slow_first_content').map(item => item.evidence[0]!.side)).toEqual(['target']);
      expect(slow(input).filter(item => item.code === 'slow_network')).toHaveLength(2);
    }
  });
  it('does not turn absent timings into zero, legacy duration, timestamps or model metrics', () => {
    const input = fixture(); input.base.evidence.transport = undefined; input.target.evidence.transport = undefined;
    expect(slow(input)).toEqual([]); expect(deriveCaptureDiagnostics(input).repeat).toBe('same_encoded_request');
  });
  it('requires matching supported protocol and nonblank known endpoint values without normalization', () => {
    const formats = fixture(); formats.target.request.requestFormat = 'openai_responses';
    expect(deriveCaptureDiagnostics(formats).repeat).toBe('unavailable');
    for (const key of ['method', 'hostname', 'url'] as const) {
      for (const value of ['', '  ', 'unknown']) {
        const input = fixture(); input.base.request[key] = value; input.target.request[key] = value;
        expect(deriveCaptureDiagnostics(input).repeat).toBe('unavailable');
      }
      const input = fixture(); input.target.request[key] = key === 'method' ? input.base.request[key].toLowerCase() : input.base.request[key].toUpperCase();
      expect(deriveCaptureDiagnostics(input).repeat).toBe('unavailable');
    }
  });
  it('is deterministic, immutable and bounded without exposing request headers, bodies or unsupported conclusions', () => {
    const input = fixture(); Object.assign(input.target.request, { requestHeaders: { Authorization: 'secret-credential' }, requestBody: 'private-body' });
    const before = structuredClone(input); Object.freeze(input); Object.freeze(input.base.request); Object.freeze(input.target.request);
    const result = deriveCaptureDiagnostics(input); expect(deriveCaptureDiagnostics(input)).toEqual(result); expect(input).toEqual(before);
    expect(result.findings.length).toBeLessThanOrEqual(5); expect(result.findings.flatMap(item => item.evidence).length).toBeLessThanOrEqual(10);
    expect(JSON.stringify(result)).not.toMatch(/secret-credential|private-body|retry|cost|accuracy|speedup/);
    expect(Object.keys(result).sort()).toEqual(['findings', 'repeat', 'thresholdMs']);
  });
});
