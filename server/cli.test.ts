import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import Database from 'better-sqlite3';

import { defaultDbPath, parseCliArgs, prewarmWarning, runStartupSelfCheck } from './cli.js';
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

describe('REQ-001 parseCliArgs', () => {
  it('默认值：prewarmRecent=0、host=127.0.0.1、open=true、retention=30', () => {
    const opts = parseCliArgs([]);
    expect(opts.host).toBe('127.0.0.1');
    expect(opts.port).toBe(4173);
    expect(opts.open).toBe(true);
    expect(opts.prewarmRecent).toBe(0);
    expect(opts.proxyRetentionDays).toBe(30);
    expect(opts.proxyPort).toBe(7779);
    expect(opts.enableProxy).toBe(false);
    expect(opts.noGzip).toBe(false);
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
    expect(opts.prewarmRecent).toBe(50);
    expect(opts.proxyRetentionDays).toBe(7);
    expect(opts.noGzip).toBe(true);
  });

  it('db-path 缺省为 config-root 下默认路径', () => {
    const opts = parseCliArgs(['--config-root', '/tmp/root']);
    expect(opts.dbPath).toBe(defaultDbPath('/tmp/root'));
  });

  it('非法值与未知 flag 抛错', () => {
    expect(() => parseCliArgs(['--port', 'abc'])).toThrow();
    expect(() => parseCliArgs(['--prewarm-recent', '-1'])).toThrow();
    expect(() => parseCliArgs(['--nope'])).toThrow(/Unknown flag/);
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
