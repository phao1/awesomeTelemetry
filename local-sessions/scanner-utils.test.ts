import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import Database from 'better-sqlite3';

import type { ProviderConfig } from '../src/core/trace-types.js';
import { claudeFixture } from '../src/adapters/__fixtures__/claude.js';
import { codexFixture } from '../src/adapters/__fixtures__/codex.js';
import { codeagentFixture } from '../src/adapters/__fixtures__/codeagent.js';
import { qoderFixture } from '../src/adapters/__fixtures__/qoder.js';
import { workbuddyFixture } from '../src/adapters/__fixtures__/workbuddy.js';
import { initSchema } from '../server/storage/schema.js';
import { claudeScanner } from './claude.js';
import { codeagentScanner } from './codeagent.js';
import { codexScanner } from './codex.js';
import { qoderScanner } from './qoder.js';
import { workbuddyScanner } from './workbuddy.js';
import type { ScannerContext } from './scanner-utils.js';

type Db = InstanceType<typeof Database>;

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'scanner-jsonl-'));
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

function config(key: string, path: string): ProviderConfig {
  return {
    key: key as ProviderConfig['key'],
    enabled: true,
    path,
    sourceKind: 'jsonl',
    watchStrategy: 'chokidar',
    pollIntervalMs: 0,
    label: key,
  };
}

function ctx(db: Db): ScannerContext {
  return { db, traeKeyPath: null };
}

describe('REQ-010 JSONL 系 scanner', () => {
  it('claude scanner：写入会话/事件/event_raw/scan_state，重扫零写入', async () => {
    const dir = tempDir();
    const filePath = join(dir, 'claude-s1.jsonl');
    writeFileSync(filePath, claudeFixture.events.map((r) => JSON.stringify(r)).join('\n') + '\n');
    const db = newDb();

    const first = await claudeScanner.scanProvider(config('claude', dir), ctx(db));
    expect(first.files).toBe(1);
    expect(first.scanned).toBe(1);
    expect(first.eventCount).toBe(4);

    const session = db
      .prepare('SELECT id, provider, source_agent, event_count, detail_loaded FROM sessions')
      .get() as { id: string; provider: string; source_agent: string; event_count: number; detail_loaded: number };
    expect(session.id).toMatch(/^claude-[0-9a-f]{14}$/);
    expect(session.provider).toBe('claude');
    expect(session.detail_loaded).toBe(1);
    const rawCount = db.prepare('SELECT COUNT(*) AS c FROM event_raw').get() as { c: number };
    expect(rawCount.c).toBe(4);
    const state = db.prepare('SELECT COUNT(*) AS c FROM scan_state').get() as { c: number };
    expect(state.c).toBe(1);

    const second = await claudeScanner.scanProvider(config('claude', dir), ctx(db));
    expect(second.scanned).toBe(0);
    expect(second.skipped).toBe(1);
    expect(second.eventCount).toBe(0);
    db.close();
  });

  it('codex scanner 快照', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'codex-s1.jsonl'), codexFixture.events.map((r) => JSON.stringify(r)).join('\n') + '\n');
    const db = newDb();
    const result = await codexScanner.scanProvider(config('codex', dir), ctx(db));
    expect(result.eventCount).toBe(4);
    const row = db.prepare('SELECT provider, cwd FROM sessions').get() as { provider: string; cwd: string };
    expect(row.provider).toBe('codex');
    expect(row.cwd).toBe('/tmp/proj');
    db.close();
  });

  it('codeagent scanner：drop file-history-snapshot', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'ca.jsonl'), codeagentFixture.events.map((r) => JSON.stringify(r)).join('\n') + '\n');
    const db = newDb();
    const result = await codeagentScanner.scanProvider(config('codeagent', dir), ctx(db));
    expect(result.eventCount).toBe(2); // snapshot 行被 drop
    const row = db.prepare('SELECT provider, source_agent FROM sessions').get() as {
      provider: string;
      source_agent: string;
    };
    expect(row.provider).toBe('codeagent');
    expect(row.source_agent).toBe('CodeAgent');
    db.close();
  });

  it('qoder scanner 快照', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'q.jsonl'), qoderFixture.events.map((r) => JSON.stringify(r)).join('\n') + '\n');
    const db = newDb();
    const result = await qoderScanner.scanProvider(config('qoder', dir), ctx(db));
    expect(result.eventCount).toBe(3);
    const row = db.prepare('SELECT provider FROM sessions').get() as { provider: string };
    expect(row.provider).toBe('qoder');
    db.close();
  });

  it('workbuddy scanner 快照（costUsd 累计）', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'wb.jsonl'), workbuddyFixture.events.map((r) => JSON.stringify(r)).join('\n') + '\n');
    const db = newDb();
    const result = await workbuddyScanner.scanProvider(config('workbuddy', dir), ctx(db));
    expect(result.eventCount).toBe(3);
    const row = db.prepare('SELECT provider, cost_usd FROM sessions').get() as {
      provider: string;
      cost_usd: number;
    };
    expect(row.provider).toBe('workbuddy');
    expect(row.cost_usd).toBeCloseTo(0.003);
    db.close();
  });
});
