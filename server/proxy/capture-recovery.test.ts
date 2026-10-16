import { fork, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { cp, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer, request, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'vite';
import { openWritable } from '../storage/db.js';
import type { CaptureJournalEntry, ProxyCaptureBodies, ProxyRequestListItem } from '../../src/core/trace-types.js';

let buildDirectory: string;
beforeAll(async () => {
  buildDirectory = await mkdtemp(join(tmpdir(), 'capture-recovery-build-'));
  await build({ configFile: false, logLevel: 'error', build: { ssr: join(process.cwd(), 'server/proxy/capture-recovery.fixture.mjs'), target: 'node20', outDir: buildDirectory, emptyOutDir: false,
    rollupOptions: { external: ['better-sqlite3', 'chokidar', 'http-mitm-proxy', 'node-forge'], output: { entryFileNames: 'fixture.mjs' } } } });
  await cp(join(process.cwd(), 'server-dist/capture-worker.js'), join(buildDirectory, 'capture-worker.js'));
  await cp(join(process.cwd(), 'server-dist/assets'), join(buildDirectory, 'assets'), { recursive: true });
  await writeFile(join(buildDirectory, 'package.json'), '{"type":"module"}');
  await symlink(join(process.cwd(), 'node_modules'), join(buildDirectory, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
}, 15_000);
afterAll(async () => { if (buildDirectory !== undefined) await rm(buildDirectory, { recursive: true, force: true }); });

interface Probe { type: string; port?: number; savedEvents?: number; rows?: number; check?: string; statusRequestCounts?: number[]; activity?: { pendingWrites: number; captureErrors: number }; storage?: { pendingBytes: number }; entries?: CaptureJournalEntry[]; files?: Array<{ name: string; bytes: number }> }
async function child(directory: string, mode: string, fault = '') {
  const process = fork(join(buildDirectory, 'fixture.mjs'), [directory, mode, fault], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  const messages: Probe[] = []; let stderr = '';
  process.stderr?.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-16 * 1024); });
  process.on('message', message => messages.push(message as Probe));
  const next = async (type: string): Promise<Probe> => {
    const deadline = Date.now() + 7000;
    for (;;) {
      const index = messages.findIndex(message => message.type === type); if (index >= 0) return messages.splice(index, 1)[0]!;
      if (Date.now() > deadline || process.exitCode !== null || process.signalCode !== null || messages.some(message => message.type === 'failure')) throw new Error('Controlled recovery child did not reach ' + type + ': ' + stderr);
      await delay(5);
    }
  };
  return { process, next, port: (await next('ready')).port!, async probe() { process.send('probe'); return next('probe'); } };
}
async function stop(process: ChildProcess) {
  if (process.exitCode !== null || process.signalCode !== null) return;
  const exit = once(process, 'exit'); process.send('quit');
  const watchdog = setTimeout(() => process.kill('SIGKILL'), 5000);
  try { await exit; } finally { clearTimeout(watchdog); }
}
async function get(port: number, path: string): Promise<{ status: number; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path }, res => {
      const chunks: Buffer[] = []; res.on('data', chunk => chunks.push(chunk as Buffer)); res.on('error', reject);
      res.once('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }));
    }); req.on('error', reject); req.end();
  });
}
describe('actual process death and capture recovery over the production HTTP API', () => {
  it('does not resurrect explicitly expired captures from a stale real-capture journal, even after retention is disabled', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'capture-retention-real-'));
    const prefix = Buffer.from('data: {"type":"synthetic-retention","text":"原文🙂"}\n\n'), requestBytes = Buffer.from('{"model":"synthetic","messages":[]}');
    let response: ServerResponse | undefined, originCalls = 0;
    const origin = createServer((req, res) => { originCalls += 1; req.resume(); req.once('end', () => { response = res; res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write(prefix); }); });
    await new Promise<void>(resolve => origin.listen(0, '127.0.0.1', resolve)); const originPort = (origin.address() as AddressInfo).port;
    let capture: Awaited<ReturnType<typeof child>> | undefined, app: Awaited<ReturnType<typeof child>> | undefined, client: ReturnType<typeof request> | undefined;
    try {
      capture = await child(directory, 'proxy'); let received = Buffer.alloc(0);
      client = request({ host: '127.0.0.1', port: capture.port, method: 'POST', path: `http://127.0.0.1:${originPort}/v1/messages`, headers: { 'content-type': 'application/json' } }, res => { res.on('data', chunk => { received = Buffer.concat([received, chunk as Buffer]); }); res.on('error', () => {}); });
      client.on('error', () => {}); client.end(requestBytes);
      let probe: Probe; const deadline = Date.now() + 7000;
      do { await delay(5); probe = await capture.probe(); if (Date.now() > deadline) throw new Error('Controlled capture did not reach its durable journal'); }
      while (!(received.equals(prefix) && probe.entries?.length === 1 && probe.entries[0]?.requestEnded === true && probe.entries[0].responseStatus === 200 && probe.storage?.pendingBytes === 0));
      const observed = probe.entries![0]!; response!.end();
      do { await delay(5); probe = await capture.probe(); if (Date.now() > deadline) throw new Error('Controlled capture did not commit'); }
      while (!(probe.rows === 1 && probe.savedEvents === 1 && probe.activity?.pendingWrites === 0));
      const exit = once(capture.process, 'exit'); capture.process.kill('SIGKILL'); expect((await exit)[1]).toBe('SIGKILL');
      // Inject a valid older journal snapshot left by failed cleanup, and age only
      // this isolated fixture to model elapsed retention time without waiting days.
      const aged = { ...observed, startedAt: '2000-01-01T00:00:00.000Z' }, db = openWritable(join(directory, 'state.sqlite'));
      let id: number;
      try { db.prepare('UPDATE proxy_requests SET started_at=? WHERE request_id=?').run(aged.startedAt, aged.requestId); id = (db.prepare('SELECT id FROM proxy_requests WHERE request_id=?').get(aged.requestId) as { id: number }).id; }
      finally { db.close(); }
      const journalPath = join(directory, 'bodies/.capture-journal', aged.captureId + '.json'); await writeFile(journalPath, JSON.stringify(aged));
      const expectedUsed = requestBytes.length + prefix.length;
      for (const policy of ['retention', ''] as const) {
        app = await child(directory, 'server', policy);
        expect(JSON.parse((await get(app.port, '/api/proxy/requests')).body.toString()).items).toEqual([]);
        expect((await get(app.port, `/api/proxy/requests/${id}/body/request`)).status).toBe(404);
        expect(JSON.parse((await get(app.port, '/api/proxy/storage')).body.toString()).usedBytes).toBe(expectedUsed);
        expect((await app.probe()).statusRequestCounts).toEqual([]);
        for (const [bodyId, bytes] of [[aged.requestBodyId, requestBytes], [aged.responseBodyId, prefix]] as const) expect(await readFile(join(directory, 'bodies', bodyId + '.body'))).toEqual(bytes);
        expect(originCalls).toBe(1); await stop(app.process); expect((await app.next('closed')).check).toBe('ok');
        expect(await readdir(join(directory, 'bodies/.capture-journal'))).toEqual([]);
        if (policy === 'retention') await writeFile(journalPath, JSON.stringify(aged));
      }
    } finally {
      client?.destroy(); response?.destroy(); if (capture !== undefined) await stop(capture.process); if (app !== undefined) await stop(app.process);
      origin.closeAllConnections(); await new Promise<void>(resolve => origin.close(() => resolve())); await rm(directory, { recursive: true, force: true });
    }
  }, 20_000);
  it.each(['during-stream', 'failed-final-commit', 'expired-before-commit'] as const)('recovers %s without upstream replay, duplicate rows or false saved notifications', async scenario => {
    const directory = await mkdtemp(join(tmpdir(), 'capture-recovery-real-'));
    const prefix = Buffer.from('data: ' + JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '原文🙂 synthetic-secret' } }) + '\n\n');
    const requestBytes = Buffer.from('{"model":"synthetic","system":"原文🙂","messages":[]}');
    let originCalls = 0, response: ServerResponse | undefined;
    const origin = createServer((req, res) => { originCalls += 1; req.resume(); req.once('end', () => { response = res; res.writeHead(200, { 'content-type': 'text/event-stream', 'set-cookie': ['original=one', 'original=two'] }); res.write(prefix); if (scenario === 'failed-final-commit') res.end(); }); });
    await new Promise<void>(resolve => origin.listen(0, '127.0.0.1', resolve));
    const originPort = (origin.address() as AddressInfo).port;
    let first: Awaited<ReturnType<typeof child>> | undefined, recovered: Awaited<ReturnType<typeof child>> | undefined;
    let client: ReturnType<typeof request> | undefined;
    try {
      first = await child(directory, 'proxy', scenario === 'failed-final-commit' ? 'fail' : '');
      let received = Buffer.alloc(0);
      client = request({ host: '127.0.0.1', port: first.port, method: 'POST', path: `http://127.0.0.1:${originPort}/v1/messages`, headers: { 'content-type': 'application/json', authorization: 'Bearer synthetic-unredacted' } }, res => {
        res.on('data', chunk => { received = Buffer.concat([received, chunk as Buffer]); }); res.on('error', () => {});
      }); client.on('error', () => {}); client.end(requestBytes);
      let probe: Probe | undefined; const deadline = Date.now() + 7000;
      do {
        await delay(5); probe = await first.probe();
        if (Date.now() > deadline) throw new Error('Actual capture did not reach durable kill point');
      } while (!(received.equals(prefix) && probe.rows === 0 && probe.savedEvents === 0 && probe.storage?.pendingBytes === 0 && probe.entries?.length === 1 && probe.entries[0]?.responseStatus === 200 && probe.entries[0]?.requestEnded === true && probe.files?.some(file => file.bytes === prefix.length) && (scenario !== 'failed-final-commit' || (probe.activity?.pendingWrites === 0 && probe.activity.captureErrors > 0))));
      expect(originCalls).toBe(1); expect(probe.savedEvents).toBe(0);
      const entry = probe.entries![0]!;
      if (scenario === 'failed-final-commit') expect(entry.transport?.state).toBe('completed');
      const exit = once(first.process, 'exit'); first.process.kill('SIGKILL'); expect((await exit)[1]).toBe('SIGKILL');
      response?.destroy(); client.destroy();
      if (scenario === 'expired-before-commit') {
        const journalPath = join(directory, 'bodies/.capture-journal', entry.captureId + '.json');
        // Explicit fixture clock aging, preserving the real capture identity/prefixes.
        const aged = { ...entry, startedAt: '2000-01-01T00:00:00.000Z' }; await writeFile(journalPath, JSON.stringify(aged));
        recovered = await child(directory, 'server', 'retention');
        const health = await Promise.all(Array.from({ length: 10 }, () => get(recovered!.port, '/api/health')));
        expect(health.every(result => result.status === 200)).toBe(true);
        expect(JSON.parse((await get(recovered.port, '/api/proxy/requests')).body.toString()).items).toEqual([]);
        expect((await recovered.probe()).statusRequestCounts).toEqual([]);
        expect(JSON.parse((await get(recovered.port, '/api/proxy/storage')).body.toString()).usedBytes).toBe(requestBytes.length + prefix.length);
        for (const [id, bytes] of [[entry.requestBodyId, requestBytes], [entry.responseBodyId, prefix]] as const) expect(await readFile(join(directory, 'bodies', id + '.part'))).toEqual(bytes);
        await stop(recovered.process); expect((await recovered.next('closed')).check).toBe('ok'); expect(recovered.process.exitCode).toBe(0);
        await writeFile(journalPath, JSON.stringify(aged)); recovered = await child(directory, 'server');
        expect(JSON.parse((await get(recovered.port, '/api/proxy/requests')).body.toString()).items).toEqual([]); expect(originCalls).toBe(1);
        await stop(recovered.process); expect((await recovered.next('closed')).check).toBe('ok');
        return;
      }
      recovered = await child(directory, 'server', scenario === 'failed-final-commit' ? 'repair' : '');
      const list = await get(recovered.port, '/api/proxy/requests'); expect(list.status).toBe(200);
      const payload = JSON.parse(list.body.toString()) as { items: ProxyRequestListItem[] };
      expect(payload.items).toHaveLength(1); const row = payload.items[0]!;
      expect((await recovered.probe()).statusRequestCounts).toEqual([1]);
      for (const field of ['requestHeaders', 'requestBody', 'responseBody', 'rawRequestBody', 'rawResponseBody', 'systemPrompt']) expect(row).not.toHaveProperty(field);
      expect(row).toMatchObject({ requestId: entry.requestId, responseStatus: 200, inputTokens: null, outputTokens: null, model: null });
      if (scenario === 'during-stream') expect(row).toMatchObject({ completedAt: null, durationMs: null });
      else { expect(row.completedAt).toBe(entry.completedAt); expect(row.durationMs).toBe(entry.durationMs); }
      const metadata = await get(recovered.port, `/api/proxy/requests/${row.id}/capture`); expect(metadata.status).toBe(200);
      const capture = JSON.parse(metadata.body.toString()) as ProxyCaptureBodies;
      expect(JSON.parse((await get(recovered.port, `/api/proxy/requests/${row.id}`)).body.toString()).requestHeaders.authorization).toBe('Bearer synthetic-unredacted');
      expect(capture.transport?.state).toBe(scenario === 'during-stream' ? 'interrupted' : 'completed'); expect(capture.processing?.status).toBe('closed');
      expect(capture.responseHeaders['set-cookie']).toEqual(['original=one', 'original=two']);
      for (const [direction, expected] of [['request', requestBytes], ['response', prefix]] as const) {
        const ref = capture[direction]!;
        expect(ref.status).toBe(scenario === 'during-stream' ? 'interrupted' : 'complete');
        const body = await get(recovered.port, `/api/proxy/requests/${row.id}/body/${direction}`); expect(body.status).toBe(200); expect(body.body).toEqual(expected);
        expect(ref.sha256).toBe(createHash('sha256').update(body.body).digest('hex')); expect(ref.bytes).toBe(expected.length);
      }
      expect(JSON.parse((await get(recovered.port, '/api/proxy/requests')).body.toString()).items).toHaveLength(1); expect(originCalls).toBe(1);
      const process = recovered.process; await stop(process); expect(process.exitCode).toBe(0);
      expect((await recovered.next('closed')).check).toBe('ok');
      recovered = await child(directory, 'server'); expect(JSON.parse((await get(recovered.port, '/api/proxy/requests')).body.toString()).items).toHaveLength(1); expect(originCalls).toBe(1);
      await stop(recovered.process); expect((await recovered.next('closed')).check).toBe('ok');
    } finally {
      client?.destroy(); response?.destroy(); if (first !== undefined) await stop(first.process); if (recovered !== undefined) await stop(recovered.process);
      origin.closeAllConnections(); await new Promise<void>(resolve => origin.close(() => resolve())); await rm(directory, { recursive: true, force: true });
    }
  }, 20_000);
  it('reports damaged journal recovery with a unified503 while health stays available and evidence survives', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'capture-recovery-corrupt-')); let app: Awaited<ReturnType<typeof child>> | undefined;
    try {
      app = await child(directory, 'server', 'corrupt');
      expect((await get(app.port, '/api/health')).status).toBe(200);
      const list = await get(app.port, '/api/proxy/requests'); expect(list.status).toBe(503);
      expect(JSON.parse(list.body.toString())).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'CAPTURE_RECOVERY_FAILED; original evidence was retained' } });
      await stop(app.process); expect((await app.next('closed')).check).toBe('ok');
      const journal = join(directory, 'bodies/.capture-journal'), names = await readdir(journal);
      expect(names).toHaveLength(1); expect(await readFile(join(journal, names[0]!), 'utf8')).toBe('{controlled-corrupt-journal');
    } finally { if (app !== undefined) await stop(app.process); await rm(directory, { recursive: true, force: true }); }
  });
});
