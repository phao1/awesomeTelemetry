import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer as createHttpServer } from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

import Database from 'better-sqlite3';

import {
  defaultDbPath,
  parseCliArgs,
  prewarmWarning,
  probePort,
  runStartupSelfCheck,
} from './cli.js';
import { initSchema } from './storage/schema.js';

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cli-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('built CLI signal cleanup', () => {
  it.skipIf(process.platform === 'win32').each(['SIGINT', 'SIGTERM'] as const)('drains a real HTTP request before checkpoint/database close on %s', async signal => {
    const dbPath = join(tempDir(), 'shutdown.sqlite');
    const script = `
      import http from 'node:http';
      import Database from 'better-sqlite3';
      import { registerCliShutdown } from './server-dist/cli.js';
      const db = new Database(process.argv[1]);
      db.pragma('journal_mode = WAL');
      db.exec('CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID');
      let finish;
      const server = http.createServer((_req, res) => {
        res.writeHead(200); res.write('prefix');
        finish = () => { db.prepare('INSERT INTO _meta (key, value) VALUES (?, ?)').run('probe', 'drained'); res.end('suffix'); };
      });
      registerCliShutdown(server, db);
      process.on('${signal}', () => setTimeout(() => finish(), 30));
      server.listen(0, '127.0.0.1', () => {
        http.get({ host: '127.0.0.1', port: server.address().port, agent: false }, response => {
          response.once('data', () => console.log('PROBE_READY')); response.resume();
        }).on('error', error => { console.error(error.code); process.exitCode = 1; });
      });
    `;
    const child = spawn(process.execPath, ['--input-type=module', '-e', script, dbPath], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const ready = new Promise<void>((resolve, reject) => {
      child.stdout.on('data', chunk => { stdout += String(chunk); if (stdout.includes('PROBE_READY')) resolve(); });
      child.stderr.on('data', chunk => { stderr += String(chunk); });
      child.once('error', reject);
      child.once('exit', () => { if (!stdout.includes('PROBE_READY')) reject(new Error('CLI probe exited before readiness: ' + stderr)); });
    });
    const exited = new Promise<number | null>((resolve, reject) => { child.once('close', code => resolve(code)); child.once('error', reject); });
    try {
      await ready;
      child.kill(signal);
      expect(await exited).toBe(0);
      expect(stderr).toBe('');
      expect(stdout).toContain('capture writes flushed and database closed');
      const db = new Database(dbPath, { readonly: true });
      expect(db.prepare('SELECT value FROM _meta WHERE key = ?').get('probe')).toEqual({ value: 'drained' });
      expect(db.pragma('quick_check', { simple: true })).toBe('ok');
      db.close();
    } finally { if (child.exitCode === null) child.kill('SIGKILL'); }
  });
});

describe('built CLI read-only diagnostic failure paths', () => {
  const runDiagnostic = (port: number, cwd: string) => new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [join(process.cwd(), 'bin', 'agent-observe.js'), 'diagnose', '--server', `http://127.0.0.1:${port}`, '--profile', '00000000-0000-4000-8000-000000000001', '--revision', '1', '--json'], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += String(chunk); }); child.stderr.on('data', chunk => { stderr += String(chunk); });
    child.once('error', reject); child.once('close', code => resolve({ code, stdout, stderr }));
  });

  it('gives actionable control-server guidance on refusal without creating a DB or starting an Agent', async () => {
    const probe = createNetServer(); await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
    const port = (probe.address() as { port: number }).port; await new Promise<void>(resolve => probe.close(() => resolve()));
    const cwd = tempDir();
    const result = await runDiagnostic(port, cwd);
    expect(result.code).toBe(1); expect(result.stdout).toBe(''); expect(result.stderr).toContain('Start/check the observability Web server');
    const fs = await import('node:fs/promises'); expect(await fs.readdir(cwd)).toEqual([]);
  });

  it('bounds a real stalled local response at twelve seconds and leaves the directory unchanged', async () => {
    let requests = 0;
    const server = createHttpServer(req => { requests += 1; req.resume(); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const cwd = tempDir(); const start = performance.now();
    try {
      const result = await runDiagnostic((server.address() as { port: number }).port, cwd);
      const elapsed = performance.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(12000); expect(elapsed).toBeLessThan(14000);
      expect(result.code).toBe(1); expect(result.stdout).toBe(''); expect(result.stderr).toContain('timed out'); expect(result.stderr).toContain('Check the local Web server/status and retry');
      expect(requests).toBe(1);
      const fs = await import('node:fs/promises'); expect(await fs.readdir(cwd)).toEqual([]);
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
});

describe('REQ-001 parseCliArgs', () => {
  it('defaults preserve original records, with 10GB quota and 100MiB per body', () => {
    const opts = parseCliArgs([]);
    expect(opts.host).toBe('127.0.0.1');
    expect(opts.port).toBe(4173);
    expect(opts.open).toBe(true);
    expect(opts.prewarmRecent).toBe(0);
    expect(opts.proxyRetentionDays).toBe(0);
    expect(opts.captureQuotaBytes).toBe(10_000_000_000);
    expect(opts.captureMaxBodyBytes).toBe(104_857_600);
    expect(opts.proxyPort).toBe(7779);
    expect(opts.enableProxy).toBe(false);
    expect(opts.enableMonitoring).toBe(false);
    expect(opts.noGzip).toBe(false);
  });

  it('parses configurable original storage budgets and directory', () => {
    expect(parseCliArgs(['--capture-directory', '/tmp/originals', '--capture-quota-gb=20', '--capture-max-body-mib', '200'])).toMatchObject({
      captureDirectory: '/tmp/originals', captureQuotaBytes: 20_000_000_000, captureMaxBodyBytes: 209_715_200,
    });
  });

  it.each(['0', '-1', 'NaN', 'Infinity', '99999999999999999'])('rejects invalid original quota %s', value => {
    expect(() => parseCliArgs(['--capture-quota-gb', value])).toThrow();
  });

  it('解析全部 flag（含 = 与空格两种形式）', () => {
    const opts = parseCliArgs([
      '--host=0.0.0.0',
      '--port',
      '5000',
      '--no-open',
      '--config-root',
      '/tmp/cfg',
      '--db-path=/tmp/db.sqlite',
      '--proxy-port',
      '8888',
      '--enable-proxy',
      '--enable-monitoring',
      '--prewarm-recent=50',
      '--proxy-retention-days',
      '7',
      '--no-gzip',
    ]);
    expect(opts.host).toBe('0.0.0.0');
    expect(opts.port).toBe(5000);
    expect(opts.open).toBe(false);
    expect(opts.configRoot).toBe('/tmp/cfg');
    expect(opts.dbPath).toBe('/tmp/db.sqlite');
    expect(opts.proxyPort).toBe(8888);
    expect(opts.enableProxy).toBe(true);
    expect(opts.enableMonitoring).toBe(true);
    expect(opts.prewarmRecent).toBe(50);
    expect(opts.proxyRetentionDays).toBe(7);
    expect(opts.noGzip).toBe(true);
  });

  it('db-path 缺省为 config-root 下默认路径', () => {
    const opts = parseCliArgs(['--config-root', '/tmp/root']);
    expect(opts.dbPath).toBe(defaultDbPath('/tmp/root'));
  });

  it('B6 数据目录兼容回退：新目录不存在且旧目录存在 → 沿用旧目录，不静默建空库', () => {
    const root = tempDir();
    mkdirSync(join(root, 'agent-observe-data'), { recursive: true });
    expect(defaultDbPath(root)).toBe(join(root, 'agent-observe-data', 'observe.sqlite'));

    // 新目录存在时走新路径
    mkdirSync(join(root, 'awesome-telemetry-data'), { recursive: true });
    expect(defaultDbPath(root)).toBe(join(root, 'awesome-telemetry-data', 'observe.sqlite'));
  });

  it('非法值与未知 flag 抛错', () => {
    expect(() => parseCliArgs(['--port', 'abc'])).toThrow();
    expect(() => parseCliArgs(['--prewarm-recent', '-1'])).toThrow();
    expect(() => parseCliArgs(['--nope'])).toThrow(/Unknown flag/);
  });

  it('§7.1 端口占用预探测：报错含端口号与建议；释放后探测通过', async () => {
    const blocker = createNetServer();
    await new Promise<void>((resolve) => {
      blocker.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = blocker.address() as { port: number };
    try {
      await expect(probePort(addr.port, '127.0.0.1')).rejects.toThrow(
        new RegExp(`端口 ${addr.port} 已被占用`),
      );
      await expect(probePort(addr.port, '127.0.0.1')).rejects.toThrow(/--port/);
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    }
    await expect(probePort(addr.port, '127.0.0.1')).resolves.toBeUndefined();
  });

  it('prewarm-recent > 100 返回 stderr 告警，默认 0 无告警', () => {
    expect(prewarmWarning(0)).toBeNull();
    expect(prewarmWarning(100)).toBeNull();
    expect(prewarmWarning(101)).toContain('WARNING');
    expect(prewarmWarning(500)).toContain('200-1240x');
  });
});

describe('REQ-004 启动自检', () => {
  it('5 步自检通过并输出摘要', () => {
    const dir = tempDir();
    const dbPath = join(dir, 'observe.sqlite');
    const db = new Database(dbPath);
    initSchema(db);
    const summary = runStartupSelfCheck(db, {
      host: '127.0.0.1',
      port: 4173,
      open: false,
      configRoot: dir,
      dbPath,
      proxyPort: 7779,
      enableProxy: false,
      enableMonitoring: false,
      prewarmRecent: 0,
      proxyRetentionDays: 30,
      noGzip: false,
    });
    expect(summary.sessionCount).toBe(0);
    expect(summary.dbSizeBytes).toBeGreaterThan(0);
    db.close();
  });

  it('自检后关键索引齐全（幂等补建）', () => {
    const dir = tempDir();
    const dbPath = join(dir, 'selfcheck.sqlite');
    const db = new Database(dbPath);
    initSchema(db);
    db.exec('DROP INDEX idx_events_session_seq'); // 模拟索引缺失
    const summary = runStartupSelfCheck(db, {
      host: '127.0.0.1',
      port: 4173,
      open: false,
      configRoot: dir,
      dbPath,
      proxyPort: 7779,
      enableProxy: false,
      enableMonitoring: false,
      prewarmRecent: 0,
      proxyRetentionDays: 30,
      noGzip: false,
    });
    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
      .all() as Array<{ name: string }>;
    const names = indexes.map((r) => r.name);
    expect(names).toContain('idx_events_session_seq');
    expect(summary.sessionCount).toBe(0);
    db.close();
  });
});


describe('built Web CLI collection defaults', () => {
  it('starts with no scans, no automatic watching, and no proxy listener', async () => {
    const root = tempDir();
    const sessions = join(root, 'sessions');
    mkdirSync(sessions);
    mkdirSync(join(root, 'config'));
    const source = join(sessions, 'session.jsonl');
    const row = JSON.stringify({ type: 'response_item', timestamp: '2026-10-25T00:00:00Z', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'default-off regression' }] } }) + '\n';
    writeFileSync(source, row);
    writeFileSync(join(root, 'config', 'local-sessions.local.json'), JSON.stringify({ providers: { codex: { enabled: true, path: sessions, watchStrategy: 'poll', pollIntervalMs: 20 } } }));
    const child = spawn(process.execPath, ['bin/agent-observe.js', '--port=0', '--no-open', '--config-root', root], {
      cwd: process.cwd(), env: { ...process.env, XDG_CONFIG_HOME: join(root, 'user-config') }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const ready = new Promise<string>((resolve, reject) => {
      child.stdout.on('data', chunk => {
        output += String(chunk);
        const match = output.match(/AwesomeTelemetry is running at (http:\/\/127\.0\.0\.1:\d+\/)/);
        if (match) resolve(match[1]!);
      });
      child.stderr.on('data', chunk => { output += String(chunk); });
      child.once('error', reject);
      child.once('exit', () => reject(new Error('Web CLI exited before readiness: ' + output)));
    });
    const exited = new Promise<number | null>((resolve, reject) => { child.once('close', resolve); child.once('error', reject); });
    try {
      const url = await ready;
      const health = async () => { const response = await fetch(url + 'api/health'); expect(response.status).toBe(200); return response.json(); };
      expect(await health()).toMatchObject({ monitoringEnabled: false, sessionCount: 0, eventCount: 0 });
      const proxy = await fetch(url + 'api/proxy/status');
      expect(await proxy.json()).toMatchObject({ running: false, starting: false });
      appendFileSync(source, row);
      await new Promise(resolve => setTimeout(resolve, 700));
      expect(await health()).toMatchObject({ monitoringEnabled: false, sessionCount: 0, eventCount: 0 });
      child.kill('SIGTERM');
      expect(await exited).toBe(0);
    } finally { if (child.exitCode === null) { child.kill('SIGTERM'); await exited; } }
  });
});
