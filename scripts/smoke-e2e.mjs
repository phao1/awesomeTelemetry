#!/usr/bin/env node
/**
 * 端到端冒烟（tasks 5.3）：真实启动服务，验证五视图数据链路。
 * 端口要求见 RUNBOOK.md：本脚本占用一个本地端口（默认 4215，可用 --port 覆盖），
 * CI 需放行 127.0.0.1 回环。
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const port = Number(process.argv.find((arg) => arg.startsWith('--port='))?.split('=')[1] ?? 4215);

function request(path, init = {}) {
  return fetch(`http://127.0.0.1:${port}${path}`, init).then(async (res) => ({
    status: res.status,
    contentType: res.headers.get('content-type') ?? '',
    text: await res.text(),
  }));
}

function assert(condition, message) {
  if (!condition) {
    console.error(`✗ ${message}`);
    process.exitCode = 1;
    throw new Error(message);
  }
  console.log(`✓ ${message}`);
}

const child = spawn(process.execPath, [join(root, 'bin', 'agent-observe.js'), '--no-open', '--port', String(port), '--config-root', root], {
  stdio: ['ignore', 'pipe', 'pipe'],
});

let stdout = '';
child.stdout.on('data', (chunk) => {
  stdout += chunk.toString();
});
child.stderr.on('data', (chunk) => {
  stdout += chunk.toString();
});

const deadline = Date.now() + 30_000;
while (!stdout.includes('Agent Observability is running')) {
  if (Date.now() > deadline) {
    console.error('启动超时');
    child.kill();
    process.exit(1);
  }
  await new Promise((resolve) => setTimeout(resolve, 200));
}
console.log('✓ 服务启动');

try {
  const home = await request('/');
  assert(home.status === 200 && home.contentType.includes('text/html'), 'GET / 200 text/html');

  const list = JSON.parse((await request('/api/sessions?limit=5')).text);
  assert(list.items.length > 0, '列表非空');
  const badTitles = list.items.filter(
    (item) => /\.(jsonl|db)$/.test(item.title) || item.title.startsWith('rollout-') || item.eventCount === 0,
  );
  assert(badTitles.length === 0, '首屏 title 非文件名且 eventCount > 0');

  const firstKey = list.items[0].id;
  const detail = JSON.parse((await request(`/api/sessions/${firstKey}?mode=slim&limit=2000`)).text);
  assert(detail.events.length > 0, `点开会话有事件（${detail.events.length}）`);

  const overview = await request('/api/agent-overview');
  assert(overview.status === 200, 'agent 视图端点 200');
  const proxy = await request('/api/proxy/status');
  assert(proxy.status === 200, 'proxy 视图端点 200');
  const frida = await request('/api/frida/status');
  assert(frida.status === 200, 'frida 视图端点 200');

  const compare = await request('/api/compare', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ leftKey: firstKey, rightKey: firstKey }),
  });
  const compareBody = JSON.parse(compare.text);
  assert(compare.status === 200 && compareBody.left.events.length > 0, 'compare 端点 200 且有事件');

  console.log('\nsmoke-e2e 全部通过');
} catch (err) {
  console.error(`\nsmoke-e2e 失败: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  child.kill();
}
