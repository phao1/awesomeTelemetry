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
if (args.length !== 0 && !(args.length === 2 && args[0] === '--port' && /^[1-9]\d*$/.test(args[1]) && Number(args[1]) <= 65535)) throw new Error('Usage: node scripts/demo-tool-execution.mjs [--port 4188]');
const port = args[1] ?? '4188';
const directory = resolve(join(tmpdir(), 'awesomeTelemetry-tools-acceptance'));
await access(join(root, 'server-dist/cli.js')).catch(() => { throw new Error('Run npm run build first'); });
process.env.XDG_CONFIG_HOME = join(directory, 'user-config');
process.env.APPDATA = join(directory, 'user-config');
const marker = join(directory, 'SYNTHETIC-TOOLS-DEMO.json');
let fresh = false;
try { await mkdir(directory); fresh = true; }
catch (error) { if (error.code !== 'EEXIST') throw error; }
if (!fresh) {
  const value = JSON.parse(await readFile(marker, 'utf8'));
  if (value.fixture !== 'native-tools-v1' || value.synthetic !== true) throw new Error('Refusing to reuse an unrelated directory');
} else await writeFile(marker, JSON.stringify({ fixture: 'native-tools-v1', synthetic: true }) + '\n', { flag: 'wx' });
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
  const epoch = Date.now() - 5 * 60 * 1000;
  const row = (offset, type, payload) => ({ type, timestamp: new Date(epoch + offset * 1000).toISOString(), payload });
  const main = [
    row(0, 'session_meta', { id: 'native-tools-main', cwd: '/synthetic/tool-demo' }),
    row(1, 'event_msg', { type: 'user_message', message: '合成任务：核对两个文件，再检查错误与缺失输出。不执行真实工具。' }),
    row(2, 'response_item', { type: 'message', id: 'model-plan', role: 'assistant', content: [{ type: 'output_text', text: '合成计划：并行读取两个文件；保留原生 call_id。' }] }),
    row(3, 'response_item', { type: 'function_call', id: 'input-a', call_id: 'call_demo_A', name: 'read_file', arguments: '{"path":"synthetic/alpha.ts"}' }),
    row(4, 'response_item', { type: 'function_call', id: 'input-b', call_id: 'call_demo_B', name: 'read_file', arguments: '{"path":"synthetic/beta.ts"}' }),
    row(5, 'response_item', { type: 'function_call_output', id: 'output-b', call_id: 'call_demo_B', output: '合成 beta 输出：export const beta = 2;\n<script>只是日志文字，不执行</script>' }),
    row(6, 'response_item', { type: 'function_call_output', id: 'output-a', call_id: 'call_demo_A', output: '合成 alpha 输出：export const alpha = 1;' }),
    row(7, 'response_item', { type: 'function_call', id: 'input-error', call_id: 'call_demo_ERROR', name: 'run_tests', arguments: '{"command":"synthetic-test --case schema"}' }),
    row(8, 'response_item', { type: 'function_call_output', id: 'output-error', call_id: 'call_demo_ERROR', output: 'Error: synthetic assertion failed: expected field is absent' }),
    row(9, 'response_item', { type: 'function_call', id: 'input-missing', call_id: 'call_demo_PENDING', name: 'write_file', arguments: '{"path":"synthetic/draft.ts","text":"synthetic only"}' }),
    row(10, 'response_item', { type: 'function_call', id: 'unbound-tool', name: 'read_file', arguments: '{"path":"synthetic/unknown.ts"}' }),
    row(11, 'response_item', { type: 'message', id: 'model-summary', role: 'assistant', content: [{ type: 'output_text', text: '合成总结：两个读取返回，测试记录错误；写文件的结果未知。' }] }),
    ...Array.from({ length: 96 }, (_, index) => row(12 + index, 'response_item', { type: 'reasoning', id: 'synthetic-context-' + index, summary: [{ text: '合成分页上下文 ' + (index + 1) }] })),
  ];
  const sets = [
    ['tools-main', '合成演示 · 交错工具调用调查', main],
    ['tools-empty', '合成演示 · 没有工具的会话', [row(0, 'session_meta', { id: 'native-tools-empty' }), row(1, 'event_msg', { type: 'user_message', message: '合成空工具场景' }), row(2, 'response_item', { type: 'message', id: 'empty-model', role: 'assistant', content: [{ type: 'output_text', text: '此合成记录没有工具。' }] })]],
    ['tools-other', '合成演示 · 同 ID 独立会话', [row(0, 'session_meta', { id: 'native-tools-other' }), row(1, 'response_item', { type: 'function_call', id: 'other-input', call_id: 'call_demo_A', name: 'read_file', arguments: '{"path":"other-session-only"}' }), row(2, 'response_item', { type: 'function_call_output', id: 'other-output', call_id: 'call_demo_A', output: '合成另一个会话结果，不应混入主会话' })]],
  ];
  const hasSession = db.prepare('SELECT id FROM sessions WHERE id=?');
  for (const [label, title, rows] of sets) {
    const path = join(directory, 'sources', label + '.jsonl');
    const key = runtime.deriveSessionKey('codex', path); keys[label] = key;
    if (hasSession.get(key) !== undefined) continue;
    try { await writeFile(path, rows.map(value => JSON.stringify(value)).join('\n') + '\n', { flag: 'wx' }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    const retained = [];
    for await (const line of createInterface({ input: createReadStream(path), crlfDelay: Infinity })) if (line.trim() !== '') retained.push(JSON.parse(line));
    const record = runtime.normalizeCodexSample({ sourceAgent: 'Codex', session: {}, events: retained }, path);
    record.session.title = title;
    runtime.storeTraceRecord(db, record, path, key);
  }
  db.close();
  await writeFile(join(directory, 'session-keys.json'), JSON.stringify(keys, null, 2));
}
// Only this process's app config is isolated; no HOME, global trust or proxy edits.
process.env.XDG_CONFIG_HOME = join(directory, 'user-config');
process.env.APPDATA = join(directory, 'user-config');
console.log('SYNTHETIC DATA ONLY — all real provider scanners are disabled.');
const keys = JSON.parse(await readFile(join(directory, 'session-keys.json'), 'utf8'));
console.log('Acceptance: http://127.0.0.1:' + port + '/#/session?key=' + keys['tools-main'] + '&time=all');
console.log('Fixture data retained at: ' + directory);
const { runCli } = await import(pathToFileURL(join(root, 'server-dist/cli.js')).href);
await runCli(['web', '--port', port, '--no-open', '--config-root', directory, '--db-path', dbPath, '--capture-directory', join(directory, 'captures'), '--prewarm-recent', '0']);
