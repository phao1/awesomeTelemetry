import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { initSchema } from '../storage/schema.js';
import { handleTraceExport, readTraceExportPage, traceExportIds } from './trace-export-route.js';
import { readTraceExportCoverage } from '../../src/core/trace-export.js';
import type { OtlpTraceExport } from '../../src/core/trace-export.js';

let db: Database.Database;
let server: Server;
let url: string;
const queries: string[] = [];
const stamp = '2026-10-19T00:00:00.000Z';
beforeEach(async () => {
  db = new Database(':memory:', { verbose: sql => queries.push(String(sql)) }); initSchema(db);
  const insertSession = db.prepare('INSERT INTO sessions (id, provider, source_agent, started_at, updated_at, source_path, detail_loaded, event_count, system_prompt, title, duration_source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  insertSession.run('scan-a', 'codex', 'Codex', stamp, stamp, '/SECRET/PATH', 1, 3, 'SECRET PROMPT', 'SECRET TITLE', 'derived');
  insertSession.run('scan-b', 'codex', 'Codex', stamp, stamp, '/SECRET/OTHER', 0, 0, null, 'b', 'unknown');
  insertSession.run('proxy', 'codex', 'Codex', stamp, stamp, '/SECRET/PROXY', 1, 0, null, 'proxy', 'unknown');
  db.prepare("UPDATE sessions SET data_source = 'proxy' WHERE id = 'proxy'").run();
  const insert = db.prepare('INSERT INTO events (session_id, id, sequence, kind, phase, started_at, duration_ms, status, title, input_summary, output_summary, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (let i = 1; i <= 3; i++) insert.run('scan-a', 'event-' + i, i, 'tool', 'implement', stamp, 5, i === 3 ? 'unknown' : 'success', 'SECRET TITLE', 'SECRET INPUT', 'SECRET OUTPUT', 'SECRET ERROR');
  db.prepare('INSERT INTO event_raw (session_id, event_id, raw) VALUES (?, ?, ?)').run('scan-a', 'event-1', 'SECRET RAW');
  server = createServer((req, res) => {
    const key = decodeURIComponent(new URL(req.url!, 'http://127.0.0.1').pathname.split('/')[3]!);
    handleTraceExport(req, res, db, key);
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/sessions`;
  queries.length = 0;
});
afterEach(async () => { if (server?.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); db?.close(); });

async function read(key = 'scan-a', query = '') { return fetch(url + '/' + key + '/trace-export' + query); }

describe('real retained SQLite to local HTTP OTLP export', () => {
  it('exports one strictly bounded small-session page, gzip/no-store/attachment and zero bodies', async () => {
    const response = await read('scan-a', '?offset=0&limit=2');
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-disposition')).toMatch(/^attachment; filename="scan-trace-[a-f0-9]{32}-0.otlp.json"$/);
    expect(response.headers.get('content-type')).toContain('application/json'); expect(response.headers.get('content-encoding')).toBe('gzip');
    const text = await response.text(); expect(text).not.toContain('SECRET');
    const result = JSON.parse(text) as OtlpTraceExport;
    expect(readTraceExportCoverage(result, 'scan-a', 0, 2)).toMatchObject({ returned: 2, nextOffset: 2, hasMore: true, partial: true });
    expect(queries.filter(query => query.startsWith('SELECT'))).toHaveLength(3);
    expect(queries.join('\n')).not.toMatch(/input_summary|output_summary|system_prompt|event_raw|source_path|proxy_requests|INSERT|UPDATE|DELETE/);
  });
  it('keeps stable generated identity across pages and independent session ownership', async () => {
    const first = await (await read('scan-a', '?offset=0&limit=2')).json() as OtlpTraceExport;
    const second = await (await read('scan-a', '?offset=1&limit=2')).json() as OtlpTraceExport;
    expect(first.resourceSpans[0]!.scopeSpans[0]!.spans[1]).toEqual(second.resourceSpans[0]!.scopeSpans[0]!.spans[0]);
    expect(traceExportIds('scan-a').traceId).not.toBe(traceExportIds('scan-b').traceId);
    expect(traceExportIds('scan-a').spanId('event-1')).not.toBe(traceExportIds('scan-b').spanId('event-1'));
    expect(readTraceExportCoverage(second, 'scan-a', 1, 2)).toMatchObject({ nextOffset: null, hasMore: false, partial: true });
  });
  it('reports unloaded empty data and invalid timestamps accurately without triggering scans', async () => {
    const empty = await (await read('scan-b')).json() as OtlpTraceExport;
    expect(readTraceExportCoverage(empty, 'scan-b', 0, 100)).toMatchObject({ returned: 0, partial: true, detailLoaded: false });
    db.prepare("UPDATE events SET started_at = 'bad' WHERE id = 'event-2'").run();
    const invalid = await (await read()).json() as OtlpTraceExport;
    expect(readTraceExportCoverage(invalid, 'scan-a', 0, 100)).toMatchObject({ returned: 3, omittedInvalidTime: 1, partial: true });
  });
  it.each(['?limit=201', '?limit=0', '?offset=-1', '?offset=01', '?offset=1000001', '?offset=9007199254740993', '?limit=1&limit=2', '?unknown=x', '?limit=1e2'])('rejects malformed query %s with unified envelope', async query => {
    const response = await read('scan-a', query); expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: 'BAD_REQUEST', message: 'Invalid trace export query' } });
    expect(queries.filter(query => query.startsWith('SELECT'))).toHaveLength(0);
  });
  it('returns safe missing/non-scan envelopes and does not expose internal database errors', async () => {
    for (const key of ['absent', 'proxy']) { const response = await read(key); expect(response.status).toBe(404); expect(await response.json()).toMatchObject({ error: { code: 'SESSION_NOT_FOUND' } }); }
    db.exec('DROP TABLE events'); const failure = await read(); expect(failure.status).toBe(500);
    expect(await failure.json()).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Trace export could not read retained metadata' } });
  });
  it('fails at the byte bound without a clipped downloadable document', async () => {
    db.prepare('UPDATE events SET id = ? WHERE id = ?').run('x'.repeat(600_000), 'event-1');
    const response = await read(); expect(response.status).toBe(503); expect(response.headers.get('content-disposition')).toBeNull();
    expect(await response.json()).toMatchObject({ error: { code: 'EXECUTION_METADATA_LIMIT' } });
  });
  it('checks direct reader bounds and preserves DB event rows after export', () => {
    expect(() => readTraceExportPage(db, 'scan-a', 0, 201)).toThrow();
    expect(readTraceExportPage(db, 'scan-a', 2, 1)?.events.map(event => event.id)).toEqual(['event-3']);
    expect(db.prepare('SELECT COUNT(*) AS count FROM events').get()).toEqual({ count: 3 });
  });
});
