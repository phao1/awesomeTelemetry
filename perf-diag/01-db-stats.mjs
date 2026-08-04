// Step 0：DB 规模统计（表行数 / page 尺寸 / WAL 大小）。
// 参考实现依据：raw 占 64.2%、WAL 未 checkpoint 涨到 151.82MB。
import { existsSync, statSync } from 'node:fs';

import { createSyntheticDb } from './lib/synthetic-db.mjs';

const fixture = createSyntheticDb();
try {
  const { db, path } = fixture;
  const page = db.pragma('page_count', { simple: true });
  const pageSize = db.pragma('page_size', { simple: true });
  const tables = [
    'sessions', 'events', 'event_raw', 'metrics',
    'scan_state', 'proxy_requests', 'frida_captures',
  ];
  console.log(`DB: ${path}`);
  console.log(`page_count=${page} page_size=${pageSize} db_size=${((page * pageSize) / 1024 / 1024).toFixed(2)}MB`);
  const walPath = `${path}-wal`;
  if (existsSync(walPath)) {
    console.log(`WAL size=${(statSync(walPath).size / 1024 / 1024).toFixed(2)}MB`);
  } else {
    console.log('WAL size=n/a (已 checkpoint)');
  }
  for (const table of tables) {
    const row = db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get();
    console.log(`${table.padEnd(16)} ${row.c} rows`);
  }
} finally {
  fixture.cleanup();
}
