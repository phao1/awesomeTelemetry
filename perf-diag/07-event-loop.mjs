// Step 3/4 附属：事件循环延迟（200 次请求压测，p99）。
// 预算：p99 < 50ms（contracts/nfr.md §2）。
import { monitorEventLoopDelay } from 'node:perf_hooks';

import { createSyntheticDb } from './lib/synthetic-db.mjs';
import { SESSION_LIST_COLS } from '../server/storage/columns.ts';

const fixture = createSyntheticDb();
try {
  const { db } = fixture;
  const list = db.prepare(
    `SELECT ${SESSION_LIST_COLS} FROM sessions WHERE data_source = ? ORDER BY started_at DESC LIMIT ?`,
  );

  const hist = monitorEventLoopDelay({ resolution: 10 });
  hist.enable();
  for (let i = 0; i < 200; i += 1) {
    list.all('scan', 50);
  }
  hist.disable();
  const p99ms = hist.percentile(99) / 1e6;
  console.log(`200 次 listSessions 压测: 事件循环 p99 = ${p99ms.toFixed(2)} ms（预算 < 50ms）`);
  console.log(`最大单次延迟 = ${(hist.max / 1e6).toFixed(2)} ms`);
} finally {
  fixture.cleanup();
}
