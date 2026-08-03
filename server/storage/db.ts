import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import Database from 'better-sqlite3';

import { SCHEMA_VERSION, initSchema } from './schema.js';

type Db = InstanceType<typeof Database>;

const GET_SCHEMA_VERSION_SQL = 'SELECT value FROM _meta WHERE key = ?';

/**
 * REQ-001：先创建父目录，再按 contracts/database.md §1 的顺序设置全部 8 项 PRAGMA。
 * REQ-003：若库由更新版本创建，MUST 中止并提示，不得降级改写。
 */
export function openWritable(path: string): Db {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL'); // WAL 下崩溃安全，写入快数倍
  db.pragma('wal_autocheckpoint = 2000');
  db.pragma('cache_size = -65536'); // 64MB page cache（负数 = KB）
  db.pragma('mmap_size = 268435456'); // 256MB
  db.pragma('temp_store = MEMORY');
  db.pragma('busy_timeout = 5000');

  let existingVersion: number | null = null;
  try {
    const row = db
      .prepare(GET_SCHEMA_VERSION_SQL)
      .get('schema_version') as { value: string } | undefined;
    if (row !== undefined) {
      existingVersion = Number(row.value);
    }
  } catch {
    // _meta 尚不存在（全新库），版本检查跳过
  }
  if (existingVersion !== null && existingVersion > SCHEMA_VERSION) {
    db.close();
    throw new Error('数据库由更新版本创建');
  }

  initSchema(db);
  return db;
}

export function openReadonly(path: string): Db {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  db.pragma('mmap_size = 268435456');
  db.pragma('busy_timeout = 5000');
  return db;
}

/** REQ-002：主动 checkpoint。有活跃读事务时返回 busy，捕获后跳过，不得重试阻塞。 */
export function checkpointWal(db: Db): void {
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
  } catch {
    // 下轮再来
  }
}
