import Database from 'better-sqlite3';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initSchema } from '../storage/schema.js';
import { normalizeClaudeSample } from '../../src/adapters/claude-code.js';
import { storeTraceRecord } from '../../local-sessions/scanner-utils.js';
import { writeNativeIdentities, decideTraceAssociation } from '../storage/trace-links.js';
import { extractNetworkIdentities } from '../proxy/identity-extractor.js';
import { writeCaptureTransport } from '../proxy/capture-storage.js';
import { handleLinkedTraceExport, readLinkedTraceExport, linkedNetworkExportIds } from './linked-trace-export-route.js';
import { handleTraceExport } from './trace-export-route.js';
import { readLinkedTraceExportCoverage } from '../../src/core/linked-trace-export.js';
import type { LinkedOtlpTraceExport } from '../../src/core/linked-trace-export.js';
import { readTraceExportCoverage } from '../../src/core/trace-export.js';
import type { OtlpTraceExport } from '../../src/core/trace-export.js';
let db: Database.Database, server: Server, url: string;
const log: string[] = [];
const stamp = '2026-10-19T00:00:00.000Z';
function scan(key: string, native: string) {
  const record = normalizeClaudeSample({ sourceAgent: 'Claude', session: {}, events: [
    { type: 'user', sessionId: native, timestamp: stamp, message: { id: 'user', content: [{ type: 'text', text: 'SECRET PROMPT' }] } },
    { type: 'assistant', sessionId: native, timestamp: stamp, message: { id: 'model-first', model: 'same-model', content: [{ type: 'tool_use', id: 'same-tool-id', name: 'Read', input: { path: 'SECRET INPUT' } }] } },
    { type: 'user', sessionId: native, timestamp: stamp, message: { content: [{ type: 'tool_result', tool_use_id: 'same-tool-id', content: 'SECRET OUTPUT' }] } },
  ] }, '/SECRET/' + key);
  storeTraceRecord(db, record, '/SECRET/' + key, key);
}
function proxy(id: number, native = 'native-a') {
  db.prepare(`INSERT INTO proxy_requests (id, request_id, method, url, hostname, started_at, completed_at, model, request_body, response_body, system_prompt, system_prompt_len)
    VALUES (?, ?, 'POST', 'SECRET URL', 'SECRET HOST', ?, ?, 'same-model', 'SECRET BODY', 'SECRET RESPONSE', 'SECRET PROMPT', 13)`)
    .run(id, 'request-' + id, stamp, '2026-10-19T00:00:02.000Z');
  writeNativeIdentities(db, { source: 'proxy', key: String(id) }, extractNetworkIdentities({ format: 'anthropic_messages',
    requestHeaders: { 'x-agent-provider': 'claude', 'x-agent-session-id': native }, requestBody: '{"messages":[]}',
    responseBody: JSON.stringify({ id: 'proxy-response-' + id, content: [{ type: 'tool_use', id: 'same-tool-id', name: 'Read', input: {} }] }) }), stamp);
}
async function read(query = '', key = 'scan-a') { return fetch(url + '/' + key + '/linked-trace-export' + query); }
const network = (r: LinkedOtlpTraceExport) => r.resourceSpans[0]!.scopeSpans[1]!.spans;
const defaults = { eventOffset: 0, eventLimit: 100, captureLimit: 20 };
beforeEach(async () => {
  db = new Database(':memory:', { verbose: sql => log.push(String(sql)) }); db.pragma('foreign_keys=ON'); initSchema(db);
  scan('scan-a', 'native-a'); scan('scan-b', 'native-b'); proxy(1); proxy(2, 'native-b');
  server = createServer((req, res) => {
    const path = new URL(req.url!, 'http://127.0.0.1').pathname.split('/');
    if (path[4] === 'trace-export') handleTraceExport(req, res, db, decodeURIComponent(path[3]!));
    else handleLinkedTraceExport(req, res, db, decodeURIComponent(path[3]!));
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/sessions`; log.length = 0;
});
afterEach(async () => { if (server?.listening) await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); db?.close(); });

describe('LTX real SQLite/HTTP boundary', () => {
  it('exports in one read-only snapshot with fixed11 SELECTs, gzip/no-store/attachment, no body or source reads/writes', async () => {
    db.pragma('query_only=ON'); const before = db.prepare('SELECT total_changes() AS n').get(); log.length = 0;
    const response = await read(); expect(response.status).toBe(200);
    expect(response.headers.get('content-encoding')).toBe('gzip'); expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-disposition')).toMatch(/^attachment; filename="linked-trace-[a-f0-9]{32}-0.otlp.json"$/);
    const text = await response.text(); expect(text).not.toMatch(/SECRET|same-model|sourcePath|parentSpanId|"links"/);
    const result = JSON.parse(text) as LinkedOtlpTraceExport;
    expect(readLinkedTraceExportCoverage(result, 'scan-a', defaults)).toMatchObject({ capture: { returned: 1, partial: false } });
    const reads = log.filter(sql => sql.startsWith('SELECT')); expect(reads).toHaveLength(11);
    expect(reads.join('\n')).not.toMatch(/SELECT\s+\*|\b(?:request_body|response_body|raw_request_body|raw_response_body|system_prompt)\b|SELECT raw\b/);
    expect(log.filter(sql => sql === 'BEGIN')).toHaveLength(1); expect(log.filter(sql => sql === 'COMMIT')).toHaveLength(1);
    expect(log.join('\n')).not.toMatch(/INSERT|UPDATE|DELETE/); expect(db.prepare('SELECT total_changes() AS n').get()).toEqual(before);
  });
  it('keeps same-model sessions separate, accepts direct/confirmed only, and preserves multi-owner network IDs', async () => {
    proxy(3); proxy(4); proxy(5);
    db.prepare("UPDATE trace_associations SET state='candidate' WHERE proxy_id=3").run();
    decideTraceAssociation(db, 4, 'scan-a', 'revoked'); decideTraceAssociation(db, 5, 'scan-a', 'confirmed');
    decideTraceAssociation(db, 1, 'scan-b', 'confirmed');
    const a = await (await read()).json() as LinkedOtlpTraceExport;
    const b = await (await read('', 'scan-b')).json() as LinkedOtlpTraceExport;
    expect(network(a).map(s => s.traceId)).toEqual([linkedNetworkExportIds(5).traceId, linkedNetworkExportIds(1).traceId]);
    expect(network(b).map(s => s.traceId)).toEqual([linkedNetworkExportIds(2).traceId, linkedNetworkExportIds(1).traceId]);
    expect(network(a)[1]!.spanId).toBe(network(b)[1]!.spanId);
    expect(readLinkedTraceExportCoverage(a, 'scan-a', defaults).identity.reasons).toContain('ambiguous_capture_membership');
    expect(JSON.stringify(a)).toContain('proxy-response-1');
  });
  it('advances native and capture pages independently, including an omitted-time last capture', async () => {
    proxy(3); proxy(4); db.prepare("UPDATE proxy_requests SET started_at='bad' WHERE id=3").run();
    const a = await (await read('?eventOffset=0&eventLimit=1&captureLimit=2')).json() as LinkedOtlpTraceExport;
    expect(readLinkedTraceExportCoverage(a, 'scan-a', { ...defaults, eventLimit: 1, captureLimit: 2 })).toMatchObject({ native: { nextOffset: 1, hasMore: true }, capture: { returned: 2, omittedInvalidTime: 1, nextCursor: 3, hasMore: true } });
    const b = await (await read('?eventOffset=1&eventLimit=1&captureCursor=3&captureLimit=2')).json() as LinkedOtlpTraceExport;
    expect(readLinkedTraceExportCoverage(b, 'scan-a', { eventOffset: 1, eventLimit: 1, captureCursor: 3, captureLimit: 2 })).toMatchObject({ capture: { returned: 1, nextCursor: null, hasMore: false, partial: true } });
    expect(network(b)[0]!.traceId).toBe(linkedNetworkExportIds(1).traceId);
  });
  it('exposes missing identity manifests, WS scope and unknown ends without synthetic success', async () => {
    db.prepare("DELETE FROM trace_identity_sources WHERE id='proxy:1'").run();
    db.prepare('UPDATE proxy_requests SET completed_at=NULL WHERE id=1').run();
    writeCaptureTransport(db, 1, { version: 1, state: 'completed', error: null, requestEnded: true, responseEnded: true, statusCode: 101,
      websocket: { version: 1, scope: 'connection', archive: 'awsp1', requestMessages: 2, responseMessages: 3, clientCloseCode: 1000, upstreamCloseCode: 1000 } });
    const r = await (await read()).json() as LinkedOtlpTraceExport;
    expect(readLinkedTraceExportCoverage(r, 'scan-a', defaults).identity).toMatchObject({ complete: false, reasons: expect.arrayContaining(['identity_not_collected']) });
    expect(JSON.stringify(network(r))).toContain('websocket_connection'); expect(JSON.stringify(network(r))).toContain('end_unknown');
    expect(network(r)[0]!.status.code).toBe(0);
  });
  it.each(['?eventOffset=-1', '?eventOffset=01', '?eventOffset=1000001', '?eventLimit=201', '?eventLimit=0', '?captureCursor=0', '?captureCursor=', '?captureCursor=9007199254740992', '?captureLimit=0', '?captureLimit=51', '?captureCursor=1&captureCursor=2', '?other=1', '?eventLimit=1e2', '?eventLimit=1&eventLimit=2'])('rejects %s before DB reads', async q => {
    const r = await read(q); expect(r.status).toBe(400); expect(await r.json()).toMatchObject({ error: { code: 'BAD_REQUEST' } });
    expect(log.filter(sql => sql.startsWith('SELECT'))).toHaveLength(0);
  });
  it('enforces method, owner and safe errors', async () => {
    expect((await fetch(url + '/scan-a/linked-trace-export', { method: 'POST' })).status).toBe(400);
    expect((await read('', 'absent')).status).toBe(404);
    db.prepare("UPDATE sessions SET data_source='proxy' WHERE id='scan-b'").run(); expect((await read('', 'scan-b')).status).toBe(404);
    db.exec('DROP TABLE trace_association_evidence'); const r = await read(); expect(r.status).toBe(500);
    expect(await r.json()).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Linked trace export could not read retained metadata' } });
  });
  it('fails the byte cap and reader truncation without downloadable partial JSON', async () => {
    db.prepare("UPDATE trace_identities SET value=? WHERE source_id='proxy:1'").run('x'.repeat(300_000));
    const r = await read(); expect(r.status).toBe(503); expect(r.headers.get('content-disposition')).toBeNull();
    expect(await r.json()).toMatchObject({ error: { code: 'EXECUTION_METADATA_LIMIT' } });
    db.prepare("UPDATE proxy_requests SET url=? WHERE id=1").run('x'.repeat(1024 * 1024));
    expect((await read()).status).toBe(503);
  });
  it('fails the1000 identity page limit and never mutates the retained source', () => {
    const insert = db.prepare('INSERT INTO trace_identities (id, source_id, namespace, kind, value, scope, event_id, source_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    const add = db.transaction(() => { for (let n = 0; n < 1001; n++) insert.run('extra-' + n, 'scan:scan-a', 'synthetic', 'message', 'id-' + n, null, null, 'SECRET PATH'); }); add();
    const count = db.prepare('SELECT COUNT(*) AS n FROM trace_identities').get();
    expect(() => readLinkedTraceExport(db, 'scan-a', defaults, stamp)).toThrow();
    expect(db.prepare('SELECT COUNT(*) AS n FROM trace_identities').get()).toEqual(count);
  });
  it('keeps the same11 SELECTs for50 captures without per-capture reads', async () => {
    for (let id = 3; id <= 51; id++) proxy(id);
    log.length = 0;
    const r = await read('?captureLimit=50'); expect(r.status).toBe(200);
    const result = await r.json() as LinkedOtlpTraceExport;
    expect(readLinkedTraceExportCoverage(result, 'scan-a', { ...defaults, captureLimit: 50 }).capture.returned).toBe(50);
    expect(log.filter(sql => sql.startsWith('SELECT'))).toHaveLength(11);
  });
  it('keeps native v1 HTTP export unchanged', async () => {
    const r = await fetch(url + '/scan-a/trace-export?offset=0&limit=1'); expect(r.status).toBe(200);
    const data = await r.json() as OtlpTraceExport; expect(data.resourceSpans[0]!.scopeSpans).toHaveLength(1);
    expect(readTraceExportCoverage(data, 'scan-a', 0, 1)).toMatchObject({ returned: 1 });
    expect(JSON.stringify(data)).not.toContain('identity.native');
  });
});
