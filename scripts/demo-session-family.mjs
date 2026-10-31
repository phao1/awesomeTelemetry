#!/usr/bin/env node
// Explicit synthetic acceptance fixture. No model/tool requests or real scans.
import { mkdir, writeFile, readFile, access, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
if (args.length !== 0 && !(args.length === 2 && args[0] === '--port' && /^[1-9]\d*$/.test(args[1]) && Number(args[1]) <= 65535)) throw new Error('Usage: node scripts/demo-session-family.mjs [--port 4187]');
const port = args[1] ?? '4187';
const directory = resolve(join(tmpdir(), 'awesomeTelemetry-family-acceptance'));
await access(join(root, 'server-dist/cli.js')).catch(() => { throw new Error('Run npm run build first'); });
process.env.XDG_CONFIG_HOME = join(directory, 'user-config');
process.env.APPDATA = join(directory, 'user-config');
const marker = join(directory, 'SYNTHETIC-FAMILY-DEMO.json');
let fresh = false;
try { await mkdir(directory); fresh = true; }
catch (error) { if (error.code !== 'EEXIST') throw error; }
if (!fresh) {
  const value = JSON.parse(await readFile(marker, 'utf8'));
  if (value.fixture !== 'native-family-v1' || value.synthetic !== true) throw new Error('Refusing to reuse an unrelated directory');
} else await writeFile(marker, JSON.stringify({ fixture: 'native-family-v1', synthetic: true }) + '\n', { flag: 'wx' });
await mkdir(join(directory, '.runtime'), { recursive: true });
const entry = join(directory, '.runtime', 'fixture-entry.mjs');
const imports = {
  openWritable: 'server/storage/db.ts', initSchema: 'server/storage/schema.ts',
  normalizeCodexSample: 'src/adapters/codex.ts', storeTraceRecord: 'local-sessions/scanner-utils.ts',
  writeNativeIdentities: 'server/storage/trace-links.ts', DEFAULT_LOCAL_SESSION_CONFIG: 'local-sessions/config.ts',
  deriveSessionKey: 'local-sessions/session-key.ts', loadLocalSessionConfig: 'local-sessions/config.ts',
};
const lines = Object.entries(imports).map(([name, path]) => `import { ${name} } from ${JSON.stringify(join(root, path))};`);
lines.push('export { ' + Object.keys(imports).join(', ') + ' };');
await writeFile(entry, lines.join('\n'));
await build({ configFile: false, root, logLevel: 'error', build: { ssr: entry, outDir: join(directory, '.runtime'), emptyOutDir: false, target: 'node20', rollupOptions: { external: ['better-sqlite3', 'chokidar', 'http-mitm-proxy', 'node-forge'], output: { entryFileNames: 'fixture.mjs' } } } });
try { await symlink(join(root, 'node_modules'), join(directory, '.runtime', 'node_modules'), 'dir'); }
catch (error) { if (error.code !== 'EEXIST') throw error; }
const runtime = await import(pathToFileURL(join(directory, '.runtime', 'fixture.mjs')).href);
const dbPath = join(directory, 'demo.sqlite');
{
  const keys = {};
  await mkdir(join(directory, 'sources'), { recursive: true });
  await mkdir(join(directory, 'config'), { recursive: true });
  const config = structuredClone(runtime.DEFAULT_LOCAL_SESSION_CONFIG);
  for (const provider of Object.values(config.providers)) { provider.enabled = false; provider.path = join(directory, 'sources'); }
  const projectConfigPath = join(directory, 'config', 'local-sessions.local.json');
  try { await writeFile(projectConfigPath, JSON.stringify(config, null, 2), { flag: 'wx' }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  const loaded = runtime.loadLocalSessionConfig({ projectConfigPath });
  if (Object.values(loaded.providers).some(provider => provider.enabled)) throw new Error('Refusing synthetic demo startup with an enabled real scanner');
  const db = runtime.openWritable(dbPath); runtime.initSchema(db);
  const epoch = Date.now() - 10 * 60 * 1000;
  const sessions = [
    ['demo-family-root', 'native-demo-root', null, '合成演示 · 编排接口核查任务'],
    ['demo-family-research', 'native-demo-research', 'native-demo-root', '合成演示 · 接口研究 Agent'],
    ['demo-family-review', 'native-demo-review', 'native-demo-root', '合成演示 · 审查 Agent'],
    ['demo-family-check', 'native-demo-check', 'native-demo-research', '合成演示 · 字段校验子 Agent'],
    ['demo-family-unlinked', 'native-demo-unlinked', null, '合成演示 · 未关联会话（空状态）'],
  ];
  const hasSession = db.prepare('SELECT id FROM sessions WHERE id=?');
  for (const [label, native, parent, title] of sessions) {
    const timestamp = new Date(epoch).toISOString();
    const rows = [
      { type: 'session_meta', timestamp, payload: { id: native, cwd: '/synthetic/family-demo', ...(parent === null ? {} : { parent_thread_id: parent }) } },
      { type: 'event_msg', timestamp: new Date(epoch + 1000).toISOString(), payload: { type: 'user_message', message: title + '。仅合成数据，不执行工具或发送模型请求。' } },
      { type: 'response_item', timestamp: new Date(epoch + 3000).toISOString(), payload: { type: 'message', role: 'assistant', id: 'message-' + label, response_id: 'response-' + label, content: [{ type: 'output_text', text: '合成结果：已核对请求字段与来源定位。<script>此文本不会执行</script>' }] } },
    ];
    const path = join(directory, 'sources', label + '.jsonl');
    const key = runtime.deriveSessionKey('codex', path); keys[label] = key;
    if (hasSession.get(key) !== undefined) continue;
    try { await writeFile(path, rows.map(row => JSON.stringify(row)).join('\n') + '\n', { flag: 'wx' }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    const retainedRows = [];
    for await (const line of createInterface({ input: createReadStream(path), crlfDelay: Infinity })) if (line.trim() !== '') retainedRows.push(JSON.parse(line));
    const record = runtime.normalizeCodexSample({ sourceAgent: 'Codex', session: {}, events: retainedRows }, path);
    record.session.title = title;
    runtime.storeTraceRecord(db, record, path, key);
  }
  const insert = db.prepare(`INSERT INTO proxy_requests(request_id,method,url,hostname,request_headers,request_body,response_status,response_body,content_type,is_streaming,started_at,completed_at,duration_ms,capture_method,request_format,model)
    VALUES (?,'POST','https://synthetic.invalid/v1/responses','synthetic.invalid',?,?,200,?,'application/json',0,?,?,?,'mitm','openai_responses','synthetic-model')`);
  const transport = db.prepare('INSERT INTO proxy_capture_transport(proxy_id,result_json) VALUES (?,?)');
  const existingAttempt = db.prepare('SELECT id FROM proxy_requests WHERE request_id=?');
  for (const [index, state] of ['network_error', 'completed'].entries()) {
    if (existingAttempt.get('synthetic-attempt-' + (index + 1)) !== undefined) continue;
    const native = 'native-demo-research', responseId = 'response-demo-family-research';
    const startedAt = new Date(epoch + 4000 + index * 3000).toISOString();
    const endedAt = new Date(epoch + 4500 + index * 3000).toISOString();
    const requestBody = JSON.stringify({ model: 'synthetic-model', input: '合成重试场景标签：网络中断后再次尝试；产品不据此自动断言重试。', metadata: { agent_provider: 'codex', session_id: native } });
    const responseBody = JSON.stringify({ id: responseId, status: state === 'completed' ? 'completed' : 'in_progress', output: [] });
    const id = Number(insert.run('synthetic-attempt-' + (index + 1), JSON.stringify({ 'x-agent-provider': 'codex', 'x-agent-session-id': native }), requestBody, responseBody, startedAt, endedAt, 500).lastInsertRowid);
    transport.run(id, JSON.stringify({ version: 1, state, error: state === 'completed' ? null : 'ECONNRESET', requestEnded: true, responseEnded: state === 'completed', statusCode: 200 }));
    runtime.writeNativeIdentities(db, { source: 'proxy', key: String(id) }, { parserVersion: 1, completeness: { complete: true, omittedCount: 0, reasons: [] }, items: [
      { namespace: 'agent:codex', kind: 'session', value: native, scope: null, eventId: null, sourcePath: 'request.metadata.session_id' },
      { namespace: 'protocol:openai', kind: 'response', value: responseId, scope: native, eventId: null, sourcePath: 'response.id' },
    ] }, endedAt);
  }
  db.close();
  await writeFile(join(directory, 'session-keys.json'), JSON.stringify(keys, null, 2));
}
// Only this process's app config is isolated; no HOME, global trust or proxy edits.
process.env.XDG_CONFIG_HOME = join(directory, 'user-config');
process.env.APPDATA = join(directory, 'user-config');
console.log('SYNTHETIC DATA ONLY — all real provider scanners are disabled.');
const keys = JSON.parse(await readFile(join(directory, 'session-keys.json'), 'utf8'));
console.log('Acceptance: http://127.0.0.1:' + port + '/#/session?key=' + keys['demo-family-root'] + '&time=all');
console.log('Fixture data retained at: ' + directory);
const { runCli } = await import(pathToFileURL(join(root, 'server-dist/cli.js')).href);
await runCli(['web', '--port', port, '--no-open', '--config-root', directory, '--db-path', dbPath, '--capture-directory', join(directory, 'captures'), '--prewarm-recent', '0']);
