import { parentPort, workerData } from 'node:worker_threads';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { detectImport, parseOtlp, obj, str, invalid, limit, TelemetryError } from './mapping.js';
const data = workerData as { bytes: Uint8Array; mode: 'otlp' | 'json' | 'jsonl' };
async function run() {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(data.bytes);
  let result;
  if (data.mode === 'jsonl') {
    const rows: unknown[] = [], traces: unknown[] = [];
    for await (const line of createInterface({ input: Readable.from([text]), crlfDelay: Infinity })) {
      if (!line.trim()) continue;
      if (Buffer.byteLength(line) > 1024 * 1024 || rows.length + traces.length >= 1000) limit();
      const row = JSON.parse(line) as unknown, r = obj(row);
      if (str(r.id) && !r.type && !r.run_type && !r.resourceSpans) traces.push(row); else rows.push(row);
    }
    if(!rows.length)invalid('Export contains no observations or runs');
    result = rows.every(r => obj(r).resourceSpans) ? { format: 'OpenTelemetry' as const, spans: rows.flatMap(parseOtlp) }
      : traces.length ? detectImport({ traces, observations: rows }) : detectImport(rows);
  } else {
    const json = JSON.parse(text) as unknown;
    result = data.mode === 'otlp' ? { format: 'OpenTelemetry' as const, spans: parseOtlp(json) } : detectImport(json);
  }
  if (result.spans.length > 1000) limit();
  if (result.spans.some(s => Buffer.byteLength(JSON.stringify(s)) > 12288)) limit();
  parentPort!.postMessage({ ok: true, result });
}
void run().catch((error: unknown) => {
  const e = error instanceof TelemetryError ? error : new TelemetryError(400, 'TELEMETRY_INVALID', 'Malformed JSON/JSONL telemetry export');
  parentPort!.postMessage({ ok: false, status: e.status, code: e.code, message: e.message });
});
