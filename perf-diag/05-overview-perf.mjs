// Step 2 §4.2：Agent Overview 聚合（两条 SQL + stamp 缓存命中）。
// 预算：冷路径 < 400ms；缓存命中 < 20ms；只用两条聚合 SQL。
import { createSyntheticDb } from './lib/synthetic-db.mjs';

const SESSION_AGG =
  `SELECT provider, source_agent, COUNT(*) AS session_count, SUM(event_count) AS event_count, ` +
  `SUM(token_input) AS token_input, SUM(token_output) AS token_output, SUM(token_total) AS token_total, ` +
  `SUM(cost_usd) AS cost_usd, AVG(total_duration_ms) AS avg_wall_clock_ms, ` +
  `MAX(updated_at) AS latest_updated_at FROM sessions WHERE data_source = ? GROUP BY provider, source_agent`;

const EVENT_AGG =
  `SELECT s.provider AS provider, s.source_agent AS source_agent, ` +
  `AVG(CASE WHEN e.tool IS NOT NULL THEN e.duration_ms END) AS avg_tool_duration_ms, ` +
  `SUM(CASE WHEN e.status = 'error' THEN 1 ELSE 0 END) AS error_count, COUNT(*) AS event_count, ` +
  `SUM(CASE WHEN e.phase = 'verify' THEN 1 ELSE 0 END) AS verify_count, ` +
  `SUM(CASE WHEN e.phase = 'debug' THEN 1 ELSE 0 END) AS debug_count ` +
  `FROM events e JOIN sessions s ON s.id = e.session_id WHERE s.data_source = ? GROUP BY s.provider, s.source_agent`;

const fixture = createSyntheticDb();
try {
  const { db } = fixture;
  const agg1 = db.prepare(SESSION_AGG);
  const agg2 = db.prepare(EVENT_AGG);

  const cold = performance.now();
  const rows1 = agg1.all('scan');
  agg2.all('scan');
  const coldMs = performance.now() - cold;

  // 缓存命中路径：只跑会话级 SQL（stamp 判定），跳过 event 级聚合
  const hit = performance.now();
  agg1.all('scan');
  const hitMs = performance.now() - hit;

  console.log(`overview 冷路径（2 条 SQL）: ${coldMs.toFixed(2)} ms, 行数=${rows1.length}`);
  console.log(`overview 缓存命中（1 条 SQL）: ${hitMs.toFixed(3)} ms`);
  console.log(`预算：冷 < 400ms，命中 < 20ms`);
} finally {
  fixture.cleanup();
}
