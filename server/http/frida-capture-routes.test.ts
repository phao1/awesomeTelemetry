import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { initSchema } from '../storage/schema.js';
import { insertFridaCapture } from '../storage/frida-captures.js';
import { Router } from './router.js';
import { registerFridaCaptureRoutes } from './frida-capture-routes.js';
let db: Database.Database, server: Server, base: string;
beforeEach(async () => {
  db = new Database(':memory:'); initSchema(db);
  const router = new Router(); registerFridaCaptureRoutes(router, db);
  server = createServer((req, res) => { const match = router.match(req.method!, new URL(req.url!, 'http://127.0.0.1').pathname); if (match) void match.handler(req, res, match.params); else { res.statusCode = 404; res.end(); } });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); }); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/frida/captures`;
});
afterEach(async () => { await new Promise<void>(resolve => server.close(() => resolve())); db.close(); });
describe('Frida real HTTP and SQLite', () => {
  it('serves saved preview then explicit full detail', async () => {
    const jsonData = JSON.stringify({ content: '中'.repeat(2000) }); const id = insertFridaCapture(db, { pid: 1, jsonData, model: null, sessionId: null });
    const list = await (await fetch(base)).json() as { items: Array<{ jsonData: string }> }; expect(list.items[0]!.jsonData).toHaveLength(500);
    const detail = await fetch(base + '/' + id); expect(detail.status).toBe(200); expect((await detail.json() as { jsonData: string }).jsonData).toBe(jsonData);
  });
  it.each(['?limit=0','?limit=501','?limit=1e2','?limit=01','?cursor=x','?limit=1&limit=2','?offset=1','/1.5','/-1','/9007199254740992'])('rejects invalid query/id %s', async path => {
    const response = await fetch(base + path); expect(response.status).toBe(400); expect(await response.json()).toMatchObject({ error: { code: 'BAD_REQUEST' } });
  });
  it('returns unified safe missing/storage/limit errors', async () => {
    const missing = await fetch(base + '/123'); expect(missing.status).toBe(404); expect(await missing.json()).toMatchObject({ error: { code: 'ROUTE_NOT_FOUND' } });
    const id = insertFridaCapture(db, { pid: 1, jsonData: '{}', model: null, sessionId: null });
    db.prepare('UPDATE frida_captures SET json_data=? WHERE id=?').run('x'.repeat(262145), id);
    const limited = await fetch(base + '/' + id); expect(limited.status).toBe(503); expect(await limited.json()).toMatchObject({ error: { details: { reason: 'limit' } } });
    db.exec('DROP TABLE frida_captures'); const failure = await fetch(base); expect(failure.status).toBe(503); expect(await failure.json()).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Frida capture unavailable', details: { reason: 'storage_failed' } } });
  });
});
