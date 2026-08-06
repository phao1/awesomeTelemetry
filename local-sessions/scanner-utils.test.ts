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
import { deriveSessionKey } from './session-key.js';
import { workbuddyScanner } from './workbuddy.js';
import {
  buildIndexEntry,
  cleanupDuplicateSessionRows,
  upsertIndexEntries,
  type ScannerContext,
} from './scanner-utils.js';

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
    expect(result.eventCount).toBe(6);
    const row = db.prepare(
      'SELECT provider, cwd, token_total, status, primary_model FROM sessions',
    ).get() as {
      provider: string; cwd: string; token_total: number; status: string; primary_model: string;
    };
    expect(row.provider).toBe('codex');
    expect(row.cwd).toBe('/tmp/proj');
    // Codex 的用量在独立的 token_count 行里，曾因 adapter 读错字段而整源为 0
    expect(row.token_total).toBe(33);
    expect(row.primary_model).toBe('deepseek-v4-flash');
    expect(row.status).toBe('success');
    // metrics 曾因 adapter 不填 record.metrics 而整表为空
    const metrics = db.prepare('SELECT COUNT(*) c FROM metrics').get() as { c: number };
    expect(metrics.c).toBe(1);
    db.close();
  });

  it('索引扫描不得把详情扫描算好的 token / 成本 / 状态 / cwd 清回占位符', async () => {
    const dir = tempDir();
    const file = join(dir, 'codex-s1.jsonl');
    writeFileSync(file, codexFixture.events.map((r) => JSON.stringify(r)).join('\n') + '\n');
    const db = newDb();
    const cfg = config('codex', dir);
    await codexScanner.scanProvider(cfg, ctx(db));

    const cols = 'token_total, cost_usd, status, cwd, event_count';
    const before = db.prepare(`SELECT ${cols} FROM sessions`).get() as { token_total: number };
    expect(before.token_total).toBeGreaterThan(0);

    // 索引条目一律带占位符（tokenTotal 0 / status 'unknown' / cwd null）。
    // 文件监听每次变更都会重跑索引阶段 —— 它绝不能覆盖详情阶段的真值。
    const entry = buildIndexEntry(cfg, file);
    expect(entry.tokenTotal).toBe(0);
    expect(entry.status).toBe('unknown');
    expect(entry.id).toBe(deriveSessionKey('codex', file));
    upsertIndexEntries(db, [entry]);

    expect(db.prepare(`SELECT ${cols} FROM sessions`).get()).toEqual(before);
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

/**
 * 清理逻辑会回收「源文件已不存在且库里无事件」的死行，
 * 所以这些用例的 source_path 必须真实存在 —— 否则命中的是那条新规则，
 * 而不是它们本来要验证的 key 规范化逻辑。
 */
function realPath(name: string): string {
  const path = join(tempDir(), name);
  writeFileSync(path, '');
  return path;
}

describe('T-02 统一 session key', () => {
  it('同一文件先索引后详情：sessions 表只有 1 行且 detail_loaded=1、event_count>0', async () => {
    const dir = tempDir();
    const filePath = join(dir, 'claude-s1.jsonl');
    writeFileSync(filePath, claudeFixture.events.map((r) => JSON.stringify(r)).join('\n') + '\n');
    const db = newDb();
    const cfg = config('claude', dir);

    upsertIndexEntries(db, [buildIndexEntry(cfg, filePath)]);
    const afterIndex = db.prepare('SELECT COUNT(*) AS c FROM sessions').get() as { c: number };
    expect(afterIndex.c).toBe(1);

    const result = await claudeScanner.scanFile(cfg, filePath, ctx(db));
    expect(result.eventCount).toBe(4);
    const rows = db
      .prepare('SELECT id, detail_loaded, event_count FROM sessions')
      .all() as Array<{ id: string; detail_loaded: number; event_count: number }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.detail_loaded).toBe(1);
    expect(rows[0]!.event_count).toBe(4);
    db.close();
  });

  it('清理 JSONL 旧 bug 残留：canonical 0 行 + 非 canonical loaded 行都删，保留规范未打开行', () => {
    const db = newDb();
    const insert = db.prepare(
      `INSERT INTO sessions (id, provider, source_agent, title, started_at, updated_at, source_path)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const samePath = realPath('same.jsonl');
    const otherPath = realPath('other.jsonl');
    const canonical = deriveSessionKey('claude', samePath);
    insert.run(canonical, 'claude', 'Claude', 't', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', samePath);
    insert.run('claude-00000000000000', 'claude', 'Claude', 't', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', samePath);
    db.prepare("UPDATE sessions SET detail_loaded = 1 WHERE id = 'claude-00000000000000'").run();
    const legit = deriveSessionKey('claude', otherPath);
    insert.run(legit, 'claude', 'Claude', 't', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', otherPath);

    const removed = cleanupDuplicateSessionRows(db);
    expect(removed).toBe(2);
    const ids = db
      .prepare('SELECT id FROM sessions ORDER BY id')
      .all() as Array<{ id: string }>;
    expect(ids.map((r) => r.id)).toEqual([legit]);
    db.close();
  });

  it('清理 SQLite 文件级伪会话（basename key），保留 session 级规范行', () => {
    const db = newDb();
    const insert = db.prepare(
      `INSERT INTO sessions (id, provider, source_agent, title, started_at, updated_at, source_path)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const dbPath = realPath('opencode.db');
    const fileKey = deriveSessionKey('opencode', dbPath);
    const sessionKey = deriveSessionKey('opencode', dbPath, 'oc-s1');
    insert.run(fileKey, 'opencode', 'OpenCode', 'opencode.db', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', dbPath);
    insert.run(sessionKey, 'opencode', 'OpenCode', 'fix build', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', dbPath);

    const removed = cleanupDuplicateSessionRows(db);
    expect(removed).toBe(1);
    const ids = db
      .prepare('SELECT id FROM sessions')
      .all() as Array<{ id: string }>;
    expect(ids.map((r) => r.id)).toEqual([sessionKey]);
    db.close();
  });

  it('aggregate-native-sessions：Trae 清理文件占位并保留多个原生 session key', () => {
    const db = newDb();
    const insert = db.prepare(
      `INSERT INTO sessions (id, provider, source_agent, title, started_at, updated_at, source_path)
       VALUES (?, 'trae', 'Trae', ?, '2026-08-06T00:00:00.000Z', '2026-08-06T00:01:00.000Z', ?)` ,
    );
    const sourcePath = realPath('trae.db');
    const placeholder = deriveSessionKey('trae', sourcePath);
    const nativeA = deriveSessionKey('trae', sourcePath, 'native-a');
    const nativeB = deriveSessionKey('trae', sourcePath, 'native-b');
    insert.run(placeholder, 'trae session', sourcePath);
    insert.run(nativeA, 'Greeting', sourcePath);
    insert.run(nativeB, 'Greeting', sourcePath);

    expect(cleanupDuplicateSessionRows(db)).toBe(1);
    const ids = db.prepare('SELECT id FROM sessions ORDER BY id').all() as Array<{ id: string }>;
    expect(ids.map((row) => row.id)).toEqual([nativeA, nativeB].sort());
    db.close();
  });

  it('保留正常未打开的会话（canonical 0 行、无 loaded 兄弟行）', () => {
    const db = newDb();
    const codexPath = realPath('a.jsonl');
    const canonical = deriveSessionKey('codex', codexPath);
    db.prepare(
      `INSERT INTO sessions (id, provider, source_agent, title, started_at, updated_at, source_path)
       VALUES (?, 'codex', 'Codex', 't', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', ?)`,
    ).run(canonical, codexPath);
    expect(cleanupDuplicateSessionRows(db)).toBe(0);
    const count = db.prepare('SELECT COUNT(*) AS c FROM sessions').get() as { c: number };
    expect(count.c).toBe(1);
    db.close();
  });

  /**
   * 用户删掉了 agent 的历史目录后，库里会残留指向已消失文件的行。
   * 这类空壳行在列表里点开必然 500（SESSION_PARSE_FAILED / Failed to fetch），
   * 扫描时就该回收；但已经存下事件的行不能删 —— DB 就是它最后的归宿。
   */
  it('源文件已删除：无事件的空壳行回收，有事件的行保留', () => {
    const db = newDb();
    const gonePath = join(tempDir(), 'deleted.jsonl');
    const emptyId = deriveSessionKey('claude', gonePath);
    const keptPath = join(tempDir(), 'also-deleted.jsonl');
    const keptId = deriveSessionKey('claude', keptPath);
    const insert = db.prepare(
      `INSERT INTO sessions (id, provider, source_agent, title, started_at, updated_at, source_path)
       VALUES (?, 'claude', 'Claude Code', 't', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', ?)`,
    );
    insert.run(emptyId, gonePath);
    insert.run(keptId, keptPath);
    db.prepare(
      `INSERT INTO events (session_id, id, sequence, kind, phase, title, started_at,
         duration_ms, status, actor, content_hash, input_len, output_len)
       VALUES (?, 'e1', 1, 'llm', 'implement', 't', '2026-01-01T00:00:00.000Z',
         0, 'success', 'assistant', 'h', 0, 0)`,
    ).run(keptId);

    expect(cleanupDuplicateSessionRows(db)).toBe(1);
    const ids = db.prepare('SELECT id FROM sessions').all() as Array<{ id: string }>;
    expect(ids.map((r) => r.id)).toEqual([keptId]);
    db.close();
  });
});
