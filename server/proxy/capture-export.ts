import type { CaptureEvidenceExport } from '../../src/core/trace-types.js';

/** Caller obtains this fresh synchronous snapshot AFTER any asynchronous analysis. */
export type CaptureExportInput = Omit<CaptureEvidenceExport, 'format' | 'formatVersion' | 'limitations'>;
export const CAPTURE_EXPORT_MAX_BYTES = 4 * 1024 * 1024;

export class CaptureExportLimitError extends Error {
  readonly code = 'CAPTURE_EXPORT_LIMIT';
  constructor() { super('Capture evidence export exceeds the 4 MiB limit'); this.name = 'CaptureExportLimitError'; }
}

/** Pure local snapshot assembly: no DB/file reads, external calls, or original-body copies. */
export function assembleCaptureEvidenceExport(input: CaptureExportInput): CaptureEvidenceExport {
  const request = input.request;
  const deleted = input.originalDeletion !== null;
  const analysis = deleted ? null : input.analysis;
  const reason = deleted ? 'original_deleted' : analysis === null ? input.analysisUnavailableReason ?? 'analysis_unavailable' : null;
  const identityOverflow = input.identities.items.length > 100;
  const linkOverflow = input.traceLinks.items.length > 100;
  const identities = structuredClone({ ...input.identities, items: input.identities.items.slice(0, 100) });
  const traceLinks = structuredClone({ ...input.traceLinks, items: input.traceLinks.items.slice(0, 100) });
  if (identityOverflow) {
    identities.hasMore = true;
    identities.nextCursor = identities.items.at(-1)!.id;
  }
  if (linkOverflow) {
    traceLinks.hasMore = true;
    traceLinks.nextCursor = traceLinks.items.at(-1)!.sessionKey;
  }
  const limitations = [
    'bounded_snapshot_not_full_execution_trace',
    'original_bodies_not_included: save separately downloaded encoded <ref.id>.body files with matching ref.sha256/bytes/status',
    'original_refs_describe_observed_prefix_not_current_file_availability',
    'analysis_bounded: 2MiB per encoded/decoded source, 1MiB projected result; public reasoning only',
    'identity_and_trace_link_first_100_only; association evidence may refer to entries beyond the included page',
    'candidate_links_and_model_tool_proposals_are_not_confirmed_execution_or_billing_identity',
    'offline_import_not_supported; saved JSON can be inspected and analyzed independently',
    'external_downloads_are_not_revoked_by_later_local_deletion',
  ];
  if (reason !== null) limitations.push(reason);
  if (analysis !== null && !analysis.completeness.complete) limitations.push('analysis_incomplete: ' + analysis.completeness.reasons.join(', '));
  if (!identities.completeness.complete) limitations.push('identities_incomplete: ' + identities.completeness.reasons.join(', '));
  if (identities.hasMore) limitations.push('identity_page_has_more');
  if (traceLinks.hasMore) limitations.push('trace_link_page_has_more');
  if (input.capture.request === null || input.capture.response === null) limitations.push('original_reference_missing');
  if (input.capture.processing === undefined) limitations.push('legacy_processing_unknown');
  if (input.capture.transport === undefined) limitations.push('legacy_transport_unknown');
  return {
    format: 'awesome-telemetry.capture-evidence', formatVersion: 1,
    exportedAt: input.exportedAt, schemaVersion: input.schemaVersion,
    // Explicit allowlist also rejects extra runtime fields on a ProxyRequest passed by old callers.
    request: {
      id: request.id, requestId: request.requestId, method: request.method, url: request.url, hostname: request.hostname,
      requestHeaders: structuredClone(request.requestHeaders), responseStatus: request.responseStatus, contentType: request.contentType,
      isStreaming: request.isStreaming, startedAt: request.startedAt, completedAt: request.completedAt, durationMs: request.durationMs,
      captureMethod: request.captureMethod, ttnetEncrypted: request.ttnetEncrypted, systemPromptLen: request.systemPromptLen,
      model: request.model, inputTokens: request.inputTokens, outputTokens: request.outputTokens, parsedSessionId: request.parsedSessionId,
      parserRoute: request.parserRoute, captureGroupId: request.captureGroupId, requestFormat: request.requestFormat,
    },
    capture: structuredClone(input.capture), originalDeletion: structuredClone(input.originalDeletion),
    analysis: analysis === null ? null : structuredClone(analysis), analysisUnavailableReason: reason,
    identities, traceLinks, limitations,
  };
}

/** Serialization refuses oversized evidence atomically; never redacts/clips headers to fit. */
export function stringifyCaptureEvidenceExport(value: CaptureEvidenceExport): string {
  const encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded, 'utf8') > CAPTURE_EXPORT_MAX_BYTES) throw new CaptureExportLimitError();
  return encoded;
}
