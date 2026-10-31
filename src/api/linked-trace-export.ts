import { TRACE_EXPORT_MAX_BYTES, TraceExportLimitError } from '../core/trace-export.js';
import { readLinkedTraceExportCoverage, validateLinkedExportOptions } from '../core/linked-trace-export.js';
import type { LinkedOtlpTraceExport, LinkedExportCoverage, LinkedExportOptions } from '../core/linked-trace-export.js';

export class LinkedTraceExportReadError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}

/** One bounded local GET; caller owns timeout, abort and stale response suppression. */
export async function fetchLinkedTraceExport(sessionKey: string, options: LinkedExportOptions, signal: AbortSignal): Promise<{ blob: Blob; coverage: LinkedExportCoverage }> {
  validateLinkedExportOptions(options);
  const query = new URLSearchParams({ eventOffset: String(options.eventOffset), eventLimit: String(options.eventLimit), captureLimit: String(options.captureLimit) });
  if (options.captureCursor !== undefined) query.set('captureCursor', String(options.captureCursor));
  const response = await fetch('/api/sessions/' + encodeURIComponent(sessionKey) + '/linked-trace-export?' + query.toString(),
    { signal, cache: 'no-store', headers: { accept: 'application/json' } });
  if (signal.aborted || !response.body || (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase() !== 'application/json') {
    await response.body?.cancel();
    signal.throwIfAborted();
    throw new LinkedTraceExportReadError('INVALID_EXPORT');
  }
  const reader = response.body.getReader();
  let length = 0;
  const parts: Uint8Array<ArrayBuffer>[] = [];
  const abort = (): void => { void reader.cancel().catch(() => { /* Abort already rejects the owned operation. */ }); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    for (;;) {
      signal.throwIfAborted();
      const item = await reader.read();
      signal.throwIfAborted();
      if (item.done) break;
      length += item.value.byteLength;
      if (length > TRACE_EXPORT_MAX_BYTES) { await reader.cancel(); throw new LinkedTraceExportReadError('EXECUTION_METADATA_LIMIT'); }
      parts.push(new Uint8Array(item.value));
    }
  } finally { signal.removeEventListener('abort', abort); reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let cursor = 0;
  for (const part of parts) { bytes.set(part, cursor); cursor += part.byteLength; }
  let data: LinkedOtlpTraceExport;
  try { data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as LinkedOtlpTraceExport; }
  catch { throw new LinkedTraceExportReadError('INVALID_EXPORT'); }
  signal.throwIfAborted();
  if (!response.ok) {
    const error = data as unknown as { error?: { code?: unknown } };
    const code = error?.error?.code;
    throw new LinkedTraceExportReadError(typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(code) ? code : 'EXPORT_UNAVAILABLE');
  }
  try {
    const coverage = readLinkedTraceExportCoverage(data, sessionKey, options);
    return { blob: new Blob([bytes], { type: 'application/json' }), coverage };
  } catch (error) {
    if (error instanceof TraceExportLimitError || error instanceof TypeError) throw new LinkedTraceExportReadError('INVALID_EXPORT');
    throw error;
  }
}
