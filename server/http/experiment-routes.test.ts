import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Router } from './router.js';
import { registerExperimentRoutes } from './experiment-routes.js';
import { ExperimentRegistry } from '../experiments/registry.js';
const resources: { server: Server; dir: string }[] = [];
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'experiment-http-')), registry = new ExperimentRegistry(dir), router = new Router();
  const batches: string[][] = [];
  registerExperimentRoutes(router, registry, keys => { batches.push(keys); return keys.filter(key => key === 'scan-a' || key === 'scan-b'); });
  const server = createServer((req, res) => { const match = router.match(req.method!, new URL(req.url!, 'http://127.0.0.1').pathname); if (match) void match.handler(req, res, match.params); else { res.statusCode = 404; res.end(); } });
  resources.push({ server, dir }); await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address(); if (!address || typeof address === 'string') throw Error('No test port');
  const base = `http://127.0.0.1:${address.port}/api/experiment-records`;
  const request = (method: string, body?: unknown, id = '') => fetch(base + (id ? '/' + id : ''), { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { registry, base, batches, request };
}
const input = { name: 'Trial', task: null, inputVersion: null, modelParameters: null, toolSet: null, mode: 'controlled', runs: [{ sessionKey: 'scan-a', label: 'unrated', note: null }, { sessionKey: 'scan-b', label: 'mixed', note: 'User review' }] };
afterEach(async () => { for (const { server, dir } of resources.splice(0)) { if (server.listening) await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve())); await rm(dir, { recursive: true, force: true }); } });
describe('experiment HTTP handlers using real local registry', () => {
  it('round trips CRUD with explicit confirmation, batch scan lookup and no-store', async () => {
    const f = await fixture(); const empty = await f.request('GET'); expect(empty.headers.get('cache-control')).toBe('no-store'); expect(await empty.json()).toEqual({ version: 1, revision: 0, records: [] });
    const created = await f.request('POST', { confirmed: true, expectedRevision: 0, record: input }); expect(created.status).toBe(201); const body = await created.json() as { records: Array<{ id: string }> }; expect(f.batches).toEqual([['scan-a', 'scan-b']]);
    const id = body.records[0]!.id;
    const updated = await f.request('PUT', { confirmed: true, expectedRevision: 1, record: { ...input, name: 'Edited' } }, id); expect(updated.status).toBe(200);
    const deleted = await f.request('DELETE', { confirmed: true, expectedRevision: 2 }, id); expect(await deleted.json()).toEqual({ version: 1, revision: 3, records: [] });
  });
  it('rejects missing confirmation and unknown fields without writing', async () => {
    const f = await fixture(); for (const body of [{ expectedRevision: 0, record: input }, { confirmed: false, expectedRevision: 0, record: input }, { confirmed: true, expectedRevision: 0, record: input, extra: 1 }]) {
      const response = await f.request('POST', body); expect(response.status).toBe(400); expect(await response.json()).toMatchObject({ error: { code: 'BAD_REQUEST', details: { reason: 'INVALID' } } });
    } expect((await f.registry.list()).revision).toBe(0);
  });
  it('returns conflict and missing scan reference in unified envelopes', async () => {
    const f = await fixture(); await f.request('POST', { confirmed: true, expectedRevision: 0, record: input });
    const conflict = await f.request('POST', { confirmed: true, expectedRevision: 0, record: input }); expect(conflict.status).toBe(409); expect(await conflict.json()).toMatchObject({ error: { details: { reason: 'CONFLICT' } } });
    const missing = await f.request('POST', { confirmed: true, expectedRevision: 1, record: { ...input, runs: [{ sessionKey: 'not-scan', label: 'pass', note: null }] } }); expect(missing.status).toBe(400); expect(await missing.json()).toMatchObject({ error: { details: { reason: 'SESSION_UNAVAILABLE' } } });
  });
  it('bounds request bodies and rejects malformed JSON/content type', async () => {
    const f = await fixture();
    const large = await f.request('POST', { text: 'x'.repeat(21000) }); expect(large.status).toBe(413);
    const broken = await fetch(f.base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' }); expect(broken.status).toBe(400);
    const text = await fetch(f.base, { method: 'POST', body: '{}' }); expect(text.status).toBe(400);
  });
  it('hides filesystem details when local storage is unreadable', async () => {
    const f = await fixture(); await writeFile(f.registry.path, '{bad'); const response = await f.request('GET'); expect(response.status).toBe(503); const text = await response.text(); expect(text).not.toContain(f.registry.path); expect(JSON.parse(text)).toMatchObject({ error: { code: 'INTERNAL_ERROR', details: { reason: 'UNAVAILABLE' } } });
  });
});
