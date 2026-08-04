import type { Database, Statement } from 'better-sqlite3';

/** REQ-005：模块级 prepared statement 缓存。禁止在循环体内 prepare。 */
const statementCache = new WeakMap<Database, Map<string, Statement>>();

export function cachedStmt(db: Database, sql: string): Statement {
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
