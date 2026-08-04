// Step 1：三条核心查询 EXPLAIN QUERY PLAN，检查 USE TEMP B-TREE。
// 与 contracts/database.md §5.3 对齐；DDL 直接复用 schema.ts。
import { createSyntheticDb } from './lib/synthetic-db.mjs';
import { EVENT_SLIM_COLS, SESSION_LIST_COLS } from '../server/storage/columns.ts';

const fixture = createSyntheticDb();
try {
  const { db } = fixture;
  const queries = [
    {
      name: 'listSessions',
      sql: `SELECT ${SESSION_LIST_COLS} FROM sessions WHERE data_source = ? ORDER BY started_at DESC LIMIT ?`,
      params: ['scan', 50],
    },
    {
      name: 'sessionDetailSlim',
      sql: `SELECT ${EVENT_SLIM_COLS} FROM events WHERE session_id = ? ORDER BY sequence LIMIT ? OFFSET ?`,
      params: ['codex-worst', 2000, 0],
    },
    {
      name: 'getSystemPromptForSession',
      sql: `SELECT system_prompt FROM proxy_requests WHERE started_at BETWEEN ? AND ? AND system_prompt_len > 0 ORDER BY system_prompt_len DESC LIMIT 1`,
      params: ['2026-08-01T00:00:00.000Z', '2026-08-01T23:59:59.999Z'],
    },
  ];

  let failed = false;
  for (const q of queries) {
    const plan = db
      .prepare(`EXPLAIN QUERY PLAN ${q.sql}`)
      .all(...q.params)
      .map((r) => r.detail);
    const hasTempBTree = plan.some((line) => line.includes('USE TEMP B-TREE'));
    console.log(`\n[${q.name}] ${hasTempBTree ? 'TEMP B-TREE!' : 'OK'}`);
    for (const line of plan) {
      console.log(`  ${line}`);
    }
    if (hasTempBTree) {
      failed = true;
    }
  }
  console.log(failed ? '\n存在 USE TEMP B-TREE，违反 contracts/database.md §5.3' : '\n三条核心查询均无临时 B 树');
} finally {
  fixture.cleanup();
}
