import type { Database, Statement } from 'better-sqlite3';

import { checkpointWal } from './db.js';

const DEFAULT_PROXY_RETENTION_DAYS = 30;
const CHECKPOINT_THRESHOLD = 1000;

const statementCache = new WeakMap<Database, Map<string, Statement>>();

function cachedStmt(db: Database, sql: string): Statement {
  let cache = statementCache.get(db);
  if (cache === undefined) {
    cache = new Map();
    statementCache.set(db, cache);
  }
  let stmt = cache.get(sql);
  if (stmt === undefined) {
    stmt = db.prepare(sql);
    cache.set(sql, stmt);
  }
  return stmt;
}

// contracts/database.md §6：默认 30 天，0 表示不清理，删除行数 > 1000 时 checkpointWal。
const DELETE_OLD_PROXY_SQL =
  "DELETE FROM proxy_requests WHERE started_at < datetime('now', '-' || :retentionDays || ' days')";

/** REQ-017：按保留天数清理过期 proxy_requests，返回删除行数。 */
export function enforceProxyRetention(
  db: Database,
  retentionDays = DEFAULT_PROXY_RETENTION_DAYS,
): number {
  if (retentionDays <= 0) {
    return 0;
  }
  const info = cachedStmt(db, DELETE_OLD_PROXY_SQL).run({ retentionDays });
  const deleted = info.changes;
  if (deleted > CHECKPOINT_THRESHOLD) {
    checkpointWal(db);
  }
  return deleted;
}
