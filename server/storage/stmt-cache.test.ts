import Database from 'better-sqlite3';
import { expect, it } from 'vitest';

import { cachedStmt } from './stmt-cache.js';

it('caches object and raw statements independently for the same SQL', () => {
  const db = new Database(':memory:');
  try {
    const sql = 'SELECT ? AS value';
    const object = cachedStmt(db, sql);
    const raw = cachedStmt(db, sql, 'raw');

    expect(cachedStmt(db, sql)).toBe(object);
    expect(cachedStmt(db, sql, 'raw')).toBe(raw);
    expect(object.get(1)).toEqual({ value: 1 });
    expect(raw.get(2)).toEqual([2]);
    expect(object.get(3)).toEqual({ value: 3 });
  } finally {
    db.close();
  }
});
