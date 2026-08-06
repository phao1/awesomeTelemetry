import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import Database from 'better-sqlite3';

import type { LocalSessionConfig } from '../../src/core/trace-types.js';
import { initSchema } from '../storage/schema.js';
import { upsertSessionFromTrace } from '../storage/writers.js';
import { claudeScanner } from '../../local-sessions/claude.js';
import { upsertIndexEntries, type ProviderScanner } from '../../local-sessions/scanner-utils.js';
import { deriveSessionKey } from '../../local-sessions/session-key.js';
import { traeScanner } from '../../local-sessions/trae.js';
import { initialScanAndStore, scanLocalSessions } from './scan-scheduler.js';

type Db = InstanceType<typeof Database>;

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'scheduler-'));
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

function newDb(): Db {
  const db = new Database(':memory:');
  initSchema(db);
  return db;
}

function makeConfig(claudeDir: string, codexDir: string): LocalSessionConfig {
  return {
    prewarmRecent: 0,
    traeKeyPath: null,
    providers: {
      claude: {
        key: 'claude', enabled: true, path: claudeDir, sourceKind: 'jsonl',
        watchStrategy: 'chokidar', pollIntervalMs: 0, label: 'Claude Code',
      },
      codex: {
        key: 'codex', enabled: true, path: codexDir, sourceKind: 'jsonl',
        watchStrategy: 'chokidar', pollIntervalMs: 0, label: 'Codex',
      },
      opencode: {
        key: 'opencode', enabled: false, path: '/none', sourceKind: 'sqlite',
        watchStrategy: 'poll', pollIntervalMs: 30000, label: 'OpenCode',
      },
      codearts: {
        key: 'codearts', enabled: false, path: '/none', sourceKind: 'sqlite',
        watchStrategy: 'poll', pollIntervalMs: 30000, label: 'CodeArts',
      },
      codeagent: {
        key: 'codeagent', enabled: false, path: '/none', sourceKind: 'jsonl',
        watchStrategy: 'chokidar', pollIntervalMs: 0, label: 'CodeAgent',
      },
      codeagent2: {
        key: 'codeagent2', enabled: false, path: '/none', sourceKind: 'sqlite',
        watchStrategy: 'poll', pollIntervalMs: 30000, label: 'CodeAgent 2.0',
      },
      trae: {
        key: 'trae', enabled: false, path: '/none', sourceKind: 'sqlcipher',
        watchStrategy: 'poll', pollIntervalMs: 30000, label: 'Trae',
      },
      qoder: {
        key: 'qoder', enabled: false, path: '/none', sourceKind: 'jsonl',
        watchStrategy: 'chokidar', pollIntervalMs: 0, label: 'Qoder',
      },
      workbuddy: {
        key: 'workbuddy', enabled: false, path: '/none', sourceKind: 'jsonl',
        watchStrategy: 'chokidar', pollIntervalMs: 0, label: 'WorkBuddy',
      },
    },
  };
}

function writeLine(dir: string, name: string, lines: unknown[]): void {
  writeFileSync(join(dir, name), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
}

describe('REQ-011 provider 并行扫描', () => {
  it('两个 provider 并行扫描均入库', async () => {
    const claudeDir = tempDir();
    const codexDir = tempDir();
    writeLine(claudeDir, 'c.jsonl', [{ type: 'user', sessionId: 's1', message: { content: [{ type: 'text', text: 'hi' }] } }]);
    writeLine(codexDir, 'x.jsonl', [{ type: 'response_item', payload: { type: 'message', role: 'user', content: 'hi', session_id: 'sx' } }]);
    const db = newDb();
    const config = makeConfig(claudeDir, codexDir);

    const results = await scanLocalSessions({ db, config });
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.provider).sort()).toEqual(['claude', 'codex']);
    expect(results.every((r) => r.error === undefined)).toBe(true);
    const rows = db.prepare('SELECT provider FROM sessions').all() as Array<{ provider: string }>;
    expect(rows.map((r) => r.provider).sort()).toEqual(['claude', 'codex']);
    db.close();
  });

  it('单个 provider 超时被跳过并记录，不阻塞其他', async () => {
    const claudeDir = tempDir();
    const codexDir = tempDir();
    writeLine(claudeDir, 'c.jsonl', [{ type: 'user', sessionId: 's1', message: { content: [{ type: 'text', text: 'hi' }] } }]);
    writeLine(codexDir, 'x.jsonl', [{ type: 'response_item', payload: { type: 'message', role: 'user', content: 'hi', session_id: 'sx' } }]);
    const db = newDb();
    const config = makeConfig(claudeDir, codexDir);

    const hanging: ProviderScanner = {
      ...claudeScanner,
      async scanProvider() {
        await new Promise((resolve) => setTimeout(resolve, 500));
        return { provider: 'claude', files: 0, scanned: 0, skipped: 0, eventCount: 0 };
      },
    };
    const results = await scanLocalSessions({
      db,
      config,
      timeoutMs: 50,
      scannerOverride: { claude: hanging },
    });
    const claude = results.find((r) => r.provider === 'claude');
    const codex = results.find((r) => r.provider === 'codex');
    expect(claude?.error).toContain('timed out');
    expect(codex?.error).toBeUndefined();
    expect(codex?.scanned).toBe(1);
    db.close();
  });
});

describe('REQ-013 两阶段启动', () => {
  it('索引阶段 < 3s @ 1500 文件，detail_loaded 全 0，prewarmRecent 默认 0 不读详情', () => {
    const dir = tempDir();
    for (let i = 0; i < 1500; i += 1) {
      writeFileSync(join(dir, `s${i}.jsonl`), '{}\n');
    }
    const db = newDb();
    const config = makeConfig(dir, tempDir());
    const events: string[] = [];

    const t0 = performance.now();
    const r = initialScanAndStore({
      db,
      config,
      emit: (e) => events.push(e.type),
    });
    const elapsed = performance.now() - t0;

    expect(r.indexCount).toBe(1500);
    expect(elapsed).toBeLessThan(3000);
    expect(events).toContain('scan_completed');
    const rows = db
      .prepare('SELECT detail_loaded FROM sessions')
      .all() as Array<{ detail_loaded: number }>;
    expect(rows).toHaveLength(1500);
    expect(rows.every((r) => r.detail_loaded === 0)).toBe(true);
    const states = db.prepare('SELECT COUNT(*) AS c FROM scan_state').get() as { c: number };
    expect(states.c).toBe(0);
    db.close();
  });

  it('aggregate-native-sessions：已有 Trae 原生会话时重启不再创建文件占位', () => {
    const traeDir = tempDir();
    const dbPath = join(traeDir, 'database.db');
    writeFileSync(dbPath, 'encrypted-placeholder');
    const config = makeConfig(tempDir(), tempDir());
    config.providers.claude.enabled = false;
    config.providers.codex.enabled = false;
    config.providers.trae = {
      ...config.providers.trae,
      enabled: true,
      path: traeDir,
    };
    const db = newDb();
    const placeholder = traeScanner.buildIndexEntries(config.providers.trae, dbPath)[0]!;
    upsertIndexEntries(db, [placeholder]);
    const nativeKey = deriveSessionKey('trae', dbPath, 'native-s1');
    upsertSessionFromTrace(db, {
      id: nativeKey,
      provider: 'trae',
      sourceAgent: 'Trae',
      title: '6666',
      startedAt: '2026-08-06T01:51:43.000Z',
      updatedAt: '2026-08-06T01:51:51.000Z',
      status: 'success',
      cwd: null,
      messageCount: 2,
      eventCount: 2,
      tokenUsage: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, netInput: 0, total: 0 },
      costUsd: 0,
      systemPrompt: null,
      dataSource: 'scan',
      sourcePath: dbPath,
      totalDurationMs: 8000,
      isSubagent: false,
    });
    db.prepare('UPDATE sessions SET detail_loaded = 1 WHERE id = ?').run(nativeKey);
    const notified: string[] = [];

    const result = initialScanAndStore({
      db,
      config,
      notify: (key) => notified.push(key),
    });

    expect(result.indexCount).toBe(0);
    expect(db.prepare('SELECT 1 FROM sessions WHERE id = ?').get(nativeKey)).toBeDefined();
    expect(db.prepare('SELECT 1 FROM sessions WHERE id = ?').get(placeholder.id)).toBeUndefined();
    expect(notified).toContain(placeholder.id);
    db.close();
  });
});
