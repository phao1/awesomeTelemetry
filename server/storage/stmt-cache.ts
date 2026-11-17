import type { Database, Statement } from 'better-sqlite3';

/** REQ-005：模块级 prepared statement 缓存。禁止在循环体内 prepare。 */
const objectStatements = new WeakMap<Database, Map<string, Statement>>();
const rawStatements = new WeakMap<Database, Map<string, Statement>>();

export function cachedStmt(
  db: Database,
  sql: string,
  rowMode: 'object' | 'raw' = 'object',
): Statement {
  // better-sqlite3 sets the row mode on the statement itself.
  const statementCache = rowMode === 'raw' ? rawStatements : objectStatements;
  let cache = statementCache.get(db);
  if (cache === undefined) {
    cache = new Map();
    statementCache.set(db, cache);
  }
  let stmt = cache.get(sql);
  if (stmt === undefined) {
    stmt = db.prepare(sql);
    if (rowMode === 'raw') {
      stmt.raw();
    }
    cache.set(sql, stmt);
  }
  return stmt;
}
