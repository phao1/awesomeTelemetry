import Database from 'better-sqlite3';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_LOCAL_SESSION_CONFIG } from '../../local-sessions/config.js';
import type { ArchitectureDiagnosisReport } from '../../src/core/architecture-diagnosis-types.js';
import { createAgentObservabilityServer } from '../server.js';
import { initSchema } from '../storage/schema.js';
import { writeNativeIdentities } from '../storage/trace-links.js';
import { CaptureBodyStore } from '../proxy/body-store.js';
import { writeCaptureBodies } from '../proxy/capture-storage.js';
import { OriginalDeletionQueue } from '../proxy/original-deletions.js';
import { WS_ARCHIVE_MAGIC, wsRecordHeader } from '../proxy/websocket-archive.js';
import { captureResources } from '../proxy/capture-resources.js';

const when = '2026-10-29T00:00:00.000Z';
const resources: Array<{ db: Database.Database; directory: string; server: Server }> = [];
afterEach(async () => { for (const value of resources.splice(0)) { await new Promise<void>((resolve, reject) => value.server.close(error => error ? reject(error) : resolve())); value.db.close(); await rm(value.directory, { recursive: true, force: true }); } });
const frame = (sequence: number, value: unknown): Buffer => { const bytes = Buffer.from(JSON.stringify(value)); return Buffer.concat([wsRecordHeader('message', false, sequence, sequence * 10, bytes.length), bytes]); };
async function setup(mode: 'http' | 'ws' = 'http', count = 3, wsScope: 'linked' | 'no_owner' | 'separate_roots' | 'changed_identity' = 'linked') {
  const directory = await mkdtemp(join(tmpdir(), 'architecture-http-')), db = new Database(':memory:'); initSchema(db);
  db.prepare("INSERT INTO sessions(id,provider,source_agent,title,started_at,updated_at,source_path,detail_loaded) VALUES('main','codex','Codex','Fixture task',?,?,'/fixture/main',1)").run(when, when);
  if (wsScope !== 'no_owner') writeNativeIdentities(db, { source: 'scan', key: 'main' }, { parserVersion: 3, items: [{ namespace: 'agent:codex', kind: 'session', value: 'fixture-native', scope: null, eventId: null, sourcePath: 'session.id' }], completeness: { complete: true, omittedCount: 0, reasons: [] } }, when);
  if (wsScope === 'changed_identity') {
    db.prepare("INSERT INTO sessions(id,provider,source_agent,title,started_at,updated_at,source_path,detail_loaded) VALUES('child','codex','Codex','Child',?,?,'/fixture/child',1)").run(when, when);
    writeNativeIdentities(db, { source: 'scan', key: 'child' }, { parserVersion: 3, items: [
      { namespace: 'agent:codex', kind: 'session', value: 'fixture-child', scope: null, eventId: null, sourcePath: 'session.id' },
      { namespace: 'agent:codex', kind: 'parent_session', value: 'fixture-native', scope: 'fixture-child', eventId: null, sourcePath: 'session.parent_thread_id' },
    ], completeness: { complete: true, omittedCount: 0, reasons: [] } }, when);
  }
  const store = await CaptureBodyStore.create(join(directory, 'originals')), requestWriter = store.begin(), responseWriter = store.begin();
  if (mode === 'http') {
    requestWriter.append(Buffer.from(JSON.stringify({ model: 'fixture', input: [{ role: 'user', content: 'Inspect the task'.repeat(20) }, { role: 'user', content: 'Inspect the task'.repeat(20) }], tools: [
      { type: 'function', name: 'Read', parameters: { type: 'object', required: ['path'] } },
      { type: 'function', name: 'Read', parameters: { type: 'object', required: ['url'] } },
    ] })));
    responseWriter.append(Buffer.from(JSON.stringify({ id: 'response-one', status: 'completed', output: [{ type: 'function_call', call_id: 'read-one', name: 'Read', arguments: '{}' }], usage: { input_tokens: 200, output_tokens: 10 } })));
  } else {
    const requests: Buffer[] = [WS_ARCHIVE_MAGIC], responses: Buffer[] = [WS_ARCHIVE_MAGIC];
    for (let i = 0; i < count; i++) {
      const nativeId = wsScope === 'changed_identity' && i % 2 ? 'fixture-child' : 'fixture-native';
      requests.push(frame(i * 3 + 1, { type: 'response.create', model: 'fixture', client_metadata: { session_id: nativeId, 'x-codex-turn-metadata': JSON.stringify({ session_id: nativeId }) },
        ...(i > 0 && wsScope !== 'separate_roots' ? { previous_response_id: 'r' + (i - 1) } : {}), stream_id: 'reused-lane', input: [{ role: 'user', content: 'Actual call ' + i }] }));
      responses.push(frame(i * 3 + 2, { type: 'response.created', stream_id: 'reused-lane', response: { id: 'r' + i } }), frame(i * 3 + 3, { type: 'response.completed', stream_id: 'reused-lane', response: { id: 'r' + i, status: 'completed', output: [], usage: { input_tokens: 1000 + i * 20000, output_tokens: 10 } } }));
    }
    requestWriter.append(Buffer.concat(requests)); responseWriter.append(Buffer.concat(responses));
  }
  const [requestRef, responseRef] = await Promise.all([requestWriter.finish(), responseWriter.finish()]);
  db.prepare("INSERT INTO proxy_requests(id,request_id,method,url,hostname,started_at,request_format,request_headers,request_body,response_body) VALUES(1,'fixture-request',?,'https://fixture.invalid/v1/responses','fixture.invalid',?,'openai_responses','{}','LEGACY_PREVIEW_NOT_ORIGINAL','LEGACY_RESPONSE')").run(mode === 'ws' ? 'WS' : 'POST', when);
  writeCaptureBodies(db, 1, { request: requestRef, response: responseRef, requestPreviewTruncated: false, responsePreviewTruncated: false, responseHeaders: {},
    ...(mode === 'ws' ? { transport: { version: 1 as const, state: 'completed' as const, error: null, requestEnded: true, responseEnded: true, statusCode: 101,
      websocket: { version: 1 as const, scope: 'connection' as const, archive: 'awsp1' as const, requestMessages: count, responseMessages: count * 2, clientCloseCode: 1000, upstreamCloseCode: 1000 } } } : {}) });
  db.prepare("INSERT INTO trace_associations(id,session_key,proxy_id,state,reason,created_at,updated_at) VALUES('membership','main',1,'confirmed','explicit',?,?)").run(when, when);
  const config = structuredClone(DEFAULT_LOCAL_SESSION_CONFIG); Object.values(config.providers).forEach(value => { value.enabled = false; value.path = join(directory, 'absent'); });
  const server = createAgentObservabilityServer({ db, config, captureDirectory: store.directory, caDirectory: join(directory, 'ca'), userConfigPath: join(directory, 'config.json'), enableMonitoring: false });
  resources.push({ db, directory, server }); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`, path = '/api/tasks/collected%3Amain/architecture-diagnosis?member=all';
  return { db, base, path, store, requestRef, call: (suffix = '', options: RequestInit = {}) => fetch(base + path + suffix, options) };
}
describe('real task diagnosis HTTP integration', () => {
  it('reads verified HTTP originals, links actual facts, and leaves collection stopped and database unchanged', async () => {
    const f = await setup(), before = f.db.prepare('SELECT total_changes() AS n').get(), response = await f.call('&minContextChars=1&duplicateRatio=0.1');
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
    const report = await response.json() as ArchitectureDiagnosisReport;
    expect(report.coverage).toMatchObject({ captures: 1, logicalCalls: 1 });
    expect(report.categories.tool_conflict).toBe('findings');
    expect(report.evidence).toEqual(expect.arrayContaining([expect.objectContaining({ source: 'http_capture', captureId: 1, path: 'tools[0]' }), expect.objectContaining({ path: 'tools[1]' })]));
    expect(report.evidence).toEqual(expect.arrayContaining([expect.objectContaining({ source: 'http_capture', path: 'analysis.usage', excerpt: expect.stringContaining('inputTokens=200;') })]));
    expect(JSON.stringify(report)).not.toContain('LEGACY_PREVIEW'); expect(f.db.prepare('SELECT total_changes() AS n').get()).toEqual(before);
    expect(await (await fetch(f.base + '/api/monitoring')).json()).toMatchObject({ enabled: false });
    expect(await (await fetch(f.base + '/api/proxy/status')).json()).toMatchObject({ running: false });
    expect(await (await fetch(f.base + '/api/frida/status')).json()).toMatchObject({ running: false });
  });
  it('validates task/member/thresholds and applies real Host/Origin guards', async () => {
    const f = await setup();
    for (const suffix of ['&member=foreign', '&minSamples=2', '&growthRatio=NaN', '&unknown=1', '&minSamples=3&minSamples=4']) expect((await f.call(suffix)).status).toBe(400);
    expect((await fetch(f.base + '/api/tasks/collected%3Amain/architecture-diagnosis?member=foreign')).status).toBe(400);
    expect((await fetch(f.base + '/api/tasks/collected%3Amissing/architecture-diagnosis')).status).toBe(404);
    expect((await f.call('', { headers: { origin: 'https://untrusted.invalid' } })).status).toBe(400);
    const status = await new Promise<number>((resolve, reject) => { const req = request(f.base + f.path, { headers: { host: 'untrusted.invalid' } }, res => { res.resume(); res.once('end', () => resolve(res.statusCode!)); }); req.once('error', reject); req.end(); }); expect(status).toBe(400);
  });
  it('projects actual WS originals once into bounded logical calls, retaining real input usage and partial incremental context', async () => {
    const f = await setup('ws', 40), response = await f.call();
    expect(response.status).toBe(200); const report = await response.json() as ArchitectureDiagnosisReport;
    expect(report.coverage).toMatchObject({ captures: 1, logicalCalls: 32, context: 'partial' });
    expect(report.coverage.reasons).toContain('diagnosis_call_limit'); expect(report.coverage.reasons).toContain('incremental_request_context');
    expect(report.evidence.some(value => value.source === 'codex_call' && value.callSequence === 31)).toBe(true);
    expect(report.evidence).toEqual(expect.arrayContaining([expect.objectContaining({ source: 'codex_call', callSequence: 31, path: 'call.usage', excerpt: expect.stringContaining('inputTokens=621000;') })]));
    expect(report.categories.context_bloat).toBe('findings');
    expect(captureResources.snapshot()).toMatchObject({ workers: 0, queuedJobs: 0, queuedBytes: 0 });
  }, 15000);
  it('rejects deletion intent and refuses corrupted original bytes instead of trusting the retained preview', async () => {
    const f = await setup(); await writeFile(join(f.store.directory, f.requestRef.id + '.body'), 'damaged');
    const corrupt = await f.call(); expect(corrupt.status).toBe(200); const report = await corrupt.json() as ArchitectureDiagnosisReport;
    expect(report.categories.tool_conflict).toBe('insufficient'); expect(report.evidence.some(value => value.path === 'tools[0]')).toBe(false);
    await new OriginalDeletionQueue(f.db, f.store).request(1, 'fixture-request');
    expect((await f.call()).status).toBe(409);
  });
  it('never treats a shared WS lane or unverified/changing native identity as one context stream', async () => {
    for (const scope of ['no_owner', 'separate_roots', 'changed_identity'] as const) {
      const f = await setup('ws', 3, scope), response = await f.call(); expect(response.status).toBe(200);
      const report = await response.json() as ArchitectureDiagnosisReport;
      expect(report.coverage.logicalCalls).toBe(3); expect(report.categories.context_bloat).toBe('insufficient');
      expect(report.findings.filter(value => value.category === 'context_bloat')).toEqual([]);
    }
  });
  it('holds one owned job and aborts the actual WS worker on disconnect', async () => {
    const f = await setup('ws', 3000), controller = new AbortController();
    const running = f.call('', { signal: controller.signal }).catch(() => null);
    const deadline = Date.now() + 5000;
    while (!captureResources.snapshot().workers && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 1));
    expect(captureResources.snapshot().workers).toBe(1);
    expect((await f.call()).status).toBe(409); controller.abort(); await running;
    const cleanup = Date.now() + 5000;
    while (captureResources.snapshot().workers && Date.now() < cleanup) await new Promise(resolve => setTimeout(resolve, 1));
    expect(captureResources.snapshot()).toMatchObject({ workers: 0, queuedJobs: 0, queuedBytes: 0 });
  }, 15000);
});
