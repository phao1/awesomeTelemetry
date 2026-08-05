import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import Database from 'better-sqlite3';

import { initSchema } from './schema.js';
import { clearMissionCache, getMission } from './mission.js';

type Db = InstanceType<typeof Database>;

let db: Db;
let dir: string;

function seedSession(
  id: string,
  over: Partial<{ updatedAt: string; startedAt: string; provider: string; dataSource: string }> = {},
): void {
  db.prepare(
    `INSERT INTO sessions (id, provider, source_agent, title, started_at, updated_at, status,
       message_count, event_count, token_total, cost_usd, data_source, source_path,
       total_duration_ms, is_subagent, detail_loaded)
     VALUES (?, ?, ?, ?, ?, ?, 'success', 1, 2, 100, 0.01, ?, '/tmp/x.jsonl', 1000, 0, 1)`,
  ).run(
    id,
    over.provider ?? 'claude',
    'Claude',
    `session ${id}`,
    over.startedAt ?? '2026-08-01T00:00:00.000Z',
    over.updatedAt ?? '2026-08-01T00:01:00.000Z',
    over.dataSource ?? 'scan',
  );
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mission-test-'));
  db = new Database(join(dir, 'test.sqlite'));
  initSchema(db);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('getMission 信封', () => {
  it('返回全部 widget，每个都有非空 criteria；available=false 时 data 为 null 且 reason 非空', async () => {
    seedSession('claude-1');
    const r = await getMission(db, { range: 'all', dataSource: 'scan', tz: 480 });
    const widgets = [
      ...Object.values(r.usage),
      ...Object.values(r.quality),
      ...Object.values(r.health),
    ];
    expect(widgets.length).toBe(25);
    expect(r.meta.widgetCount).toBe(25);
    expect(typeof r.meta.stamp).toBe('string');
    expect(r.meta.range).toBe('all');
    expect(r.meta.tz).toBe(480);
    for (const w of widgets) {
      expect(w.criteria.length).toBeGreaterThan(0);
      expect(w.available).toBe(false);
      expect(w.data).toBeNull();
      expect(w.unavailableReason).not.toBeNull();
    }
  });

  it('stamp 未变时缓存命中（cached:true），stamp 变化后重算', async () => {
    seedSession('claude-1');
    const first = await getMission(db, { range: 'all', dataSource: 'scan', tz: 0 });
    expect(first.meta.cached).toBe(false);

    const hit = await getMission(db, { range: 'all', dataSource: 'scan', tz: 0 });
    expect(hit.meta.cached).toBe(true);
    expect(hit.meta.stamp).toBe(first.meta.stamp);

    db.prepare("UPDATE sessions SET updated_at = '2026-08-02T00:00:00.000Z' WHERE id = 'claude-1'").run();
    const recomputed = await getMission(db, { range: 'all', dataSource: 'scan', tz: 0 });
    expect(recomputed.meta.cached).toBe(false);
    expect(recomputed.meta.stamp).toBe('2026-08-02T00:00:00.000Z');
  });

  it('不同 dataSource / range / tz 是独立缓存键', async () => {
    seedSession('claude-1', { dataSource: 'scan' });
    await getMission(db, { range: 'all', dataSource: 'scan', tz: 0 });
    const proxy = await getMission(db, { range: 'all', dataSource: 'proxy', tz: 0 });
    expect(proxy.meta.cached).toBe(false);
    const tz = await getMission(db, { range: 'all', dataSource: 'scan', tz: 480 });
    expect(tz.meta.cached).toBe(false);
  });

  it('clearMissionCache 清空缓存', async () => {
    seedSession('claude-1');
    await getMission(db, { range: 'all', dataSource: 'scan', tz: 0 });
    clearMissionCache(db);
    const r = await getMission(db, { range: 'all', dataSource: 'scan', tz: 0 });
    expect(r.meta.cached).toBe(false);
  });
});
