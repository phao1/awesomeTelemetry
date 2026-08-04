// Step 6：差分写入（347 + 1 → 只 1 条 INSERT）。
// 参考实现反面基线：1 DELETE + 347 INSERT = 348 语句 / 181.91ms。
import { createSyntheticDb } from './lib/synthetic-db.mjs';

const fixture = createSyntheticDb();
try {
  const { db } = fixture;
  const insertSession = db.prepare(
    `INSERT INTO sessions (id, provider, source_agent, title, started_at, updated_at, status, cwd, message_count, event_count, token_input, token_output, token_reasoning, token_cache_read, token_cache_write, token_total, cost_usd, system_prompt, source_path, data_source, total_duration_ms, is_subagent, detail_loaded)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertEvent = db.prepare(
    `INSERT INTO events (session_id, id, sequence, kind, phase, title, started_at, duration_ms, status, actor, tool, input_summary, output_summary, tokens_json, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const tx = db.transaction(() => {
    insertSession.run('s1', 'codex', 'Codex', 't', '2026-08-01T00:00:00.000Z', '2026-08-01T00:01:00.000Z',
      'success', null, 1, 347, 100, 80, 20, 10, 5, 200, 0.1, null, '/tmp/s1.jsonl', 'scan', 60000, 0, 1);
    for (let i = 1; i <= 347; i += 1) {
      insertEvent.run('s1', `ev-${i}`, i, 'llm', 'implement', `e${i}`, '2026-08-01T00:00:00.000Z',
        100, 'success', 'assistant', null, null, null, null, null);
    }
  });
  tx();

  let executions = 0;
  let inserts = 0;
  const original = db.prepare.bind(db);
  db.prepare = (sql) => {
    const stmt = original(sql);
    for (const method of ['run', 'get', 'all', 'iterate']) {
      const orig = stmt[method].bind(stmt);
      stmt[method] = (...args) => {
        executions += 1;
        if (String(sql).trimStart().startsWith('INSERT')) inserts += 1;
        return orig(...args);
      };
    }
    return stmt;
  };

  // 必须在打补丁之后 prepare，语句计数才生效
  const upsertEvent = db.prepare(
    `INSERT INTO events (session_id, id, sequence, kind, phase, title, started_at, duration_ms, status, actor, tool, input_summary, output_summary, tokens_json, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(session_id, id) DO UPDATE SET sequence = excluded.sequence, kind = excluded.kind,
       phase = excluded.phase, title = excluded.title, started_at = excluded.started_at,
       duration_ms = excluded.duration_ms, status = excluded.status, actor = excluded.actor,
       tool = excluded.tool, input_summary = excluded.input_summary,
       output_summary = excluded.output_summary, tokens_json = excluded.tokens_json, error = excluded.error`,
  );

  const t0 = performance.now();
  upsertEvent.run('s1', 'ev-348', 348, 'llm', 'implement', 'e348', '2026-08-01T00:00:01.000Z',
    100, 'success', 'assistant', null, null, null, null, null);
  const elapsed = performance.now() - t0;

  const total = db.prepare('SELECT COUNT(*) AS c FROM events WHERE session_id = ?').get('s1').c;
  console.log(`append 1: ${executions} 条语句执行（INSERT=${inserts}），耗时 ${elapsed.toFixed(2)} ms`);
  console.log(`events 总数=${total}（期望 348）`);
  console.log(`参考实现反面基线：348 语句 / 181.91ms`);
} finally {
  fixture.cleanup();
}
