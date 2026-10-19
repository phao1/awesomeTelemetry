// Diagnostic fixture only: actual SPA/API, generated synthetic evidence, no Agent/native access.
import process from 'node:process';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { statSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkpointWal, openReadonly, openWritable } from '../storage/db.js';
import { createAgentObservabilityServer } from '../server.js';
import { DEFAULT_LOCAL_SESSION_CONFIG } from '../../local-sessions/config.js';
import { CaptureBodyStore } from './body-store.js';
import { writeCaptureBodies } from './capture-storage.js';

if (process.argv.length > 3 || (process.argv[2] !== undefined && process.argv[2] !== '--capacity-proof')) throw new Error('Unknown synthetic fixture option');
const capacityProof = process.argv[2] === '--capacity-proof';
const directory = await mkdtemp(join(tmpdir(), 'body-deletion-web-data-'));
const dbPath = join(directory, 'state.sqlite'), captureDirectory = join(directory, 'bodies');
const db = openWritable(dbPath), store = await CaptureBodyStore.create(captureDirectory);
const requestBody = JSON.stringify({ model: 'synthetic-ui-fixture', system: '仅用于验收的合成系统提示词', messages: [{ role: 'user', content: '浏览器验收正文🙂 — synthetic only' }] }, null, 2);
const responseBody = JSON.stringify({ type: 'message', content: [{ type: 'text', text: '合成回复：不涉及真实 Agent 数据。' }], usage: { input_tokens: 7, output_tokens: 3 } }, null, 2);
const a = store.begin(), b = store.begin(); a.append(Buffer.from(requestBody)); b.append(Buffer.from(responseBody));
const [request, response] = await Promise.all([a.finish(), b.finish()]);
const now = new Date().toISOString();
const id = Number(db.prepare(`INSERT INTO proxy_requests(request_id,method,url,hostname,started_at,completed_at,response_status,request_format,request_headers,
  request_body,response_body,raw_request_body,raw_response_body,system_prompt,system_prompt_len,model,input_tokens,output_tokens)
  VALUES('browser-body-deletion-fixture','POST','http://synthetic.local/v1/messages','synthetic.local',?,?,200,'anthropic_messages',?,?,?,?,?,?,LENGTH(?),'synthetic-ui-fixture',7,3)`)
  .run(now, now, '{"x-synthetic-evidence":"retained header"}', requestBody, responseBody, requestBody, responseBody, '仅用于验收的合成系统提示词', '仅用于验收的合成系统提示词').lastInsertRowid);
writeCaptureBodies(db, id, { request, response, requestPreviewTruncated: false, responsePreviewTruncated: false, responseHeaders: { 'content-type': 'application/json' } });
let reader = null;
if (capacityProof) {
  checkpointWal(db); db.pragma('wal_autocheckpoint=0'); reader = openReadonly(dbPath);
  reader.exec('BEGIN'); reader.prepare('SELECT value FROM _meta WHERE key=?').get('schema_version');
  const insert = db.prepare('INSERT INTO _meta(key,value) VALUES(?,zeroblob(393216))');
  for (let index = 0; index < 100 && statSync(dbPath + '-wal').size < 12_000_000; index += 1) insert.run('capacity-proof-' + index);
  if (statSync(dbPath + '-wal').size < 12_000_000) throw new Error('Synthetic WAL pressure was not established');
}
const config = JSON.parse(JSON.stringify(DEFAULT_LOCAL_SESSION_CONFIG));
for (const provider of Object.values(config.providers)) { provider.enabled = false; provider.path = join(directory, 'no-native-sessions'); }
const server = createAgentObservabilityServer({ db, dbPath, captureDirectory, config, distDir: join(process.cwd(), 'dist'), caDirectory: join(directory, 'ca'), userConfigPath: join(directory, 'config.json'), ...(capacityProof ? { captureStorage: { quotaBytes: request.bytes + response.bytes } } : {}) });
const apiCalls = new Map();
server.prependListener('request', req => {
  if (['/api/proxy/capacity', '/api/proxy/storage'].includes(req.url)) apiCalls.set(req.url, (apiCalls.get(req.url) ?? 0) + 1);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
console.log(JSON.stringify({ type: 'ready', port: server.address().port, directory, dbPath, captureDirectory, id, bytes: request.bytes + response.bytes, capacityProof }));
const control = capacityProof ? createInterface({ input: process.stdin }) : null;
control?.on('line', line => {
  if (line === 'counts') console.log(JSON.stringify({ type: 'api-counts', counts: Object.fromEntries(apiCalls) }));
  if (line === 'release' && reader !== null) {
    reader.exec('ROLLBACK'); reader.close(); reader = null; checkpointWal(db);
    console.log(JSON.stringify({ type: 'pressure-released', walBytes: statSync(dbPath + '-wal').size, counts: Object.fromEntries(apiCalls) }));
  }
});
let closing = false;
async function close() {
  if (closing) return; closing = true;
  control?.close();
  try {
    await new Promise((resolve, reject) => server.close(error => error === undefined ? resolve() : reject(error)));
    if (reader !== null) { reader.exec('ROLLBACK'); reader.close(); reader = null; }
    const check = db.pragma('quick_check', { simple: true }); db.close(); await rm(directory, { recursive: true, force: true });
    console.log(JSON.stringify({ type: 'closed', check, syntheticDataRemoved: true, counts: Object.fromEntries(apiCalls) }));
  } catch { closing = false; console.error('Fixture cleanup failed; isolated evidence retained'); process.exitCode = 1; }
}
process.once('SIGINT', () => { void close(); }); process.once('SIGTERM', () => { void close(); });
