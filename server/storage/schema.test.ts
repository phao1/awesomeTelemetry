import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import Database from 'better-sqlite3';

import { EVENT_SLIM_COLS, SESSION_LIST_COLS } from './columns.js';
import { SCHEMA_VERSION, initSchema } from './schema.js';

type Db = InstanceType<typeof Database>;

const EXPECTED_TABLES = [
  '_meta',
  'sessions',
  'events',
  'event_raw',
  'metrics',
  'scan_state',
  'proxy_requests',
  'frida_captures',
];

const EXPECTED_INDEXES = [
  'idx_events_session_seq',
  'idx_events_session_phase',
  'idx_events_kind',
  'idx_events_phase',
  'idx_sessions_ds_started',
  'idx_sessions_started_at',
  'idx_sessions_provider',
  'idx_sessions_source_agent',
  'idx_scan_state_provider',
  'idx_scan_state_session',
  'idx_proxy_started_len',
  'idx_proxy_hostname',
  'idx_proxy_parsed_session',
  'idx_frida_captured_at',
  'idx_frida_session',
  'idx_frida_capture_session',
];

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'storage-schema-'));
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

function createDb(path: string): Db {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  return db;
}

function explain(db: Db, sql: string, params: unknown[]): string {
  const rows = db
    .prepare(`EXPLAIN QUERY PLAN ${sql}`)
    .all(...params) as Array<{ detail: string }>;
  return rows.map((row) => row.detail).join('\n');
}

describe('REQ-003 建库幂等', () => {
  it('REQ-003 连续三次 initSchema 无副作用无报错', () => {
    const db = createDb(join(tempDir(), 'schema.sqlite'));

    expect(() => {
      initSchema(db);
      initSchema(db);
      initSchema(db);
    }).not.toThrow();

    const meta = db
      .prepare('SELECT key, value FROM _meta')
      .all() as Array<{ key: string; value: string }>;
    expect(meta).toEqual([{ key: 'schema_version', value: String(SCHEMA_VERSION) }]);

    for (const table of EXPECTED_TABLES) {
      const row = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(table);
      expect(row, `表 ${table} 应存在`).toBeTruthy();
    }
    for (const index of EXPECTED_INDEXES) {
      const row = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
        .get(index);
      expect(row, `索引 ${index} 应存在`).toBeTruthy();
    }

    db.close();
  });

  it('REQ-003 三条核心查询 EXPLAIN QUERY PLAN 不含 USE TEMP B-TREE', () => {
    const db = createDb(join(tempDir(), 'plan.sqlite'));
    initSchema(db);

    const plans = [
      explain(
        db,
        `SELECT ${SESSION_LIST_COLS} FROM sessions WHERE data_source = ? ORDER BY started_at DESC LIMIT ?`,
        ['scan', 50],
      ),
      explain(
        db,
        `SELECT ${EVENT_SLIM_COLS} FROM events WHERE session_id = ? ORDER BY sequence LIMIT ? OFFSET ?`,
        ['s1', 2000, 0],
      ),
      explain(
        db,
        `SELECT system_prompt FROM proxy_requests WHERE started_at BETWEEN ? AND ? AND system_prompt_len > 0 ORDER BY system_prompt_len DESC LIMIT 1`,
        ['2026-01-01T00:00:00.000Z', '2026-12-31T00:00:00.000Z'],
      ),
    ];

    expect(plans.join('\n')).not.toContain('USE TEMP B-TREE');
    expect(plans[0]).toContain('idx_sessions_ds_started');
    expect(plans[1]).toContain('idx_events_session_seq');
    expect(plans[2]).toContain('idx_proxy_started_len');

    db.close();
  });
});
