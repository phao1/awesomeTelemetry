import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import Database from 'better-sqlite3';

import { initSchema } from '../storage/schema.js';
import { commitScanState, shouldRescan } from './scan-gate.js';

type Db = InstanceType<typeof Database>;

interface CountableStatement {
  run: (...args: unknown[]) => unknown;
  get: (...args: unknown[]) => unknown;
  all: (...args: unknown[]) => unknown;
  iterate: (...args: unknown[]) => unknown;
}

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'watch-gate-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

function newDb(): Db {
  const db = new Database(':memory:');
  initSchema(db);
  return db;
}

function withWriteCounter(db: Db): () => number {
  let writes = 0;
  const original = db.prepare.bind(db);
  const patched = ((sql: string) => {
    const stmt = original(sql) as CountableStatement;
    const run = stmt.run.bind(stmt);
    stmt.run = ((...args: unknown[]) => {
      writes += 1;
      return run(...args);
    }) as never;
    return stmt;
  }) as unknown as typeof db.prepare;
  (db as unknown as { prepare: typeof db.prepare }).prepare = patched;
  return () => writes;
}

describe('REQ-001/003 增量门禁', () => {
  it('REQ-001 首轮判定为变更，prevOffset = 0', () => {
    const db = newDb();
    const path = join(tempDir(), 's.jsonl');
    writeFileSync(path, '{"a":1}\n');

    const gate = shouldRescan(db, path);
    expect(gate.changed).toBe(true);
    expect(gate.prevOffset).toBe(0);
    expect(gate.fp.hash).toMatch(/^[0-9a-f]{40}$/);
    db.close();
  });

  it('REQ-001 无变更重扫：0 条 SQL 写语句', () => {
    const db = newDb();
    const path = join(tempDir(), 's.jsonl');
    writeFileSync(path, '{"a":1}\n{"a":2}\n');

    const first = shouldRescan(db, path);
    commitScanState(db, {
      sourcePath: path,
      provider: 'codex',
      sessionId: 'codex-abc',
      fp: first.fp,
      byteOffset: first.fp.size,
      eventCount: 2,
    });

    const countWrites = withWriteCounter(db);
    const second = shouldRescan(db, path);

    expect(second.changed).toBe(false);
    expect(countWrites()).toBe(0);
    db.close();
  });

  it('REQ-001 文件变更后判定为变更，且 prevOffset 取自上次 byte_offset', () => {
    const db = newDb();
    const path = join(tempDir(), 's.jsonl');
    writeFileSync(path, '{"a":1}\n{"a":2}\n');

    const first = shouldRescan(db, path);
    commitScanState(db, {
      sourcePath: path,
      provider: 'codex',
      sessionId: 'codex-abc',
      fp: first.fp,
      byteOffset: 18,
      eventCount: 2,
    });

    writeFileSync(path, '{"a":1}\n{"a":2}\n{"a":3}\n');
    const second = shouldRescan(db, path);

    expect(second.changed).toBe(true);
    expect(second.prevOffset).toBe(18);
    db.close();
  });

  it('REQ-003 commitScanState 后 scan_state 行数 > 0', () => {
    const db = newDb();
    const path = join(tempDir(), 's.jsonl');
    writeFileSync(path, '{"a":1}\n');

    const gate = shouldRescan(db, path);
    commitScanState(db, {
      sourcePath: path,
      provider: 'codex',
      sessionId: null,
      fp: gate.fp,
      byteOffset: gate.fp.size,
      eventCount: 1,
    });

    const row = db.prepare('SELECT COUNT(*) AS c FROM scan_state').get() as { c: number };
    expect(row.c).toBeGreaterThan(0);
    const state = db
      .prepare('SELECT content_hash, byte_offset FROM scan_state WHERE source_path = ?')
      .get(path) as { content_hash: string; byte_offset: number };
    expect(state.content_hash).toBe(gate.fp.hash);
    expect(state.byte_offset).toBe(gate.fp.size);
    db.close();
  });

  it('REQ-003 commitScanState 写入失败必须抛错', () => {
    const db = newDb();
    const path = join(tempDir(), 's.jsonl');
    writeFileSync(path, '{"a":1}\n');
    const gate = shouldRescan(db, path);

    expect(() =>
      commitScanState(db, {
        sourcePath: null as unknown as string, // NOT NULL 违反 → 必须抛错
        provider: 'codex',
        sessionId: null,
        fp: gate.fp,
        byteOffset: 0,
        eventCount: 1,
      }),
    ).toThrow();
    db.close();
  });
});
