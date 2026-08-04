// Step 2：服务端分段耗时（镜像 query-engine.ts 的 SQL）。
// 预算参考：listSessions < 1ms；最差详情 slim < 15ms；event 下钻 < 20ms。
import { createSyntheticDb } from './lib/synthetic-db.mjs';
import {
  EVENT_FULL_COLS,
  EVENT_SLIM_COLS,
  PROXY_LIST_COLS,
  SESSION_LIST_COLS,
} from '../server/storage/columns.ts';

const fixture = createSyntheticDb();
try {
  const { db } = fixture;
  const stmts = {
    listSessions: db.prepare(
      `SELECT ${SESSION_LIST_COLS} FROM sessions WHERE data_source = ? ORDER BY started_at DESC LIMIT ?`,
    ),
    worstDetailSlim: db.prepare(
      `SELECT ${EVENT_SLIM_COLS} FROM events WHERE session_id = ? ORDER BY sequence LIMIT ? OFFSET ?`,
    ),
    eventDetail: db.prepare(
      `SELECT ${EVENT_FULL_COLS} FROM events WHERE session_id = ? AND id = ?`,
    ),
    systemPrompt: db.prepare(
      `SELECT system_prompt FROM proxy_requests WHERE started_at BETWEEN ? AND ? AND system_prompt_len > 0 ORDER BY system_prompt_len DESC LIMIT 1`,
    ),
    proxyList: db.prepare(
      `SELECT ${PROXY_LIST_COLS} FROM proxy_requests ORDER BY started_at DESC LIMIT ?`,
    ),
  };

  const runs = 7;
  function medianMs(fn) {
    const samples = [];
    for (let i = 0; i < runs; i += 1) {
      const t0 = performance.now();
      fn();
      samples.push(performance.now() - t0);
    }
    samples.sort((a, b) => a - b);
    return samples[Math.floor(samples.length / 2)].toFixed(3);
  }

  console.log(`中位耗时（${runs} 次）:`);
  console.log(`listSessions(500)          ${medianMs(() => stmts.listSessions.all('scan', 500))} ms`);
  console.log(`worstDetailSlim(9,590)     ${medianMs(() => stmts.worstDetailSlim.all('codex-worst', -1, 0))} ms`);
  console.log(`eventDetail                ${medianMs(() => stmts.eventDetail.get('codex-worst', 'ev-1'))} ms`);
  console.log(`getSystemPromptForSession  ${medianMs(() => stmts.systemPrompt.get('2026-08-01T00:00:00.000Z', '2026-08-01T23:59:59.999Z'))} ms`);
  console.log(`proxyList(50)              ${medianMs(() => stmts.proxyList.all(50))} ms`);
} finally {
  fixture.cleanup();
}
