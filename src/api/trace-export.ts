import { readTraceExportCoverage, TRACE_EXPORT_MAX_BYTES, TraceExportLimitError } from '../core/trace-export.js';
import type { OtlpTraceExport, TraceExportCoverage } from '../core/trace-export.js';

export class TraceExportReadError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}

/** One bounded local GET; caller owns timeout, abort and stale response suppression. */
export async function fetchTraceExport(sessionKey: string, offset: number, limit: number, signal: AbortSignal): Promise<{ blob: Blob; coverage: TraceExportCoverage }> {
  const response = await fetch('/api/sessions/' + encodeURIComponent(sessionKey) + '/trace-export?offset=' + offset + '&limit=' + limit,
    { signal, cache: 'no-store', headers: { accept: 'application/json' } });
  signal.throwIfAborted();
  if (!response.body || !(response.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) throw new TraceExportReadError('INVALID_EXPORT');
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
      if (length > TRACE_EXPORT_MAX_BYTES) { await reader.cancel(); throw new TraceExportReadError('EXECUTION_METADATA_LIMIT'); }
      parts.push(new Uint8Array(item.value));
    }
  } finally { signal.removeEventListener('abort', abort); reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let cursor = 0;
  for (const part of parts) { bytes.set(part, cursor); cursor += part.byteLength; }
  let data: OtlpTraceExport;
  try { data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as OtlpTraceExport; }
  catch { throw new TraceExportReadError('INVALID_EXPORT'); }
  signal.throwIfAborted();
  if (!response.ok) {
    const error = data as unknown as { error?: { code?: unknown } };
    const code = error?.error?.code;
    throw new TraceExportReadError(typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(code) ? code : 'EXPORT_UNAVAILABLE');
  }
  try {
    return { blob: new Blob([bytes], { type: 'application/json' }), coverage: readTraceExportCoverage(data, sessionKey, offset, limit) };
  } catch (error) {
    if (error instanceof TraceExportLimitError || error instanceof TypeError) throw new TraceExportReadError('INVALID_EXPORT');
    throw error;
  }
}
