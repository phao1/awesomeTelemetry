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
    const r = await getMission(db, {
      range: 'all',
      dataSource: 'scan',
      tz: 480,
      ctx: {
        providers: [],
        proxy: { running: false, starting: false, port: null },
        frida: { running: false, pid: null },
        startedAt: Date.now(),
      },
    });
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
      if (w.available === false) {
        expect(w.data).toBeNull();
        expect(w.unavailableReason).not.toBeNull();
      } else {
        expect(w.data).not.toBeNull();
      }
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

describe('逐 widget 口径断言（design.md §10 R8：防 SQL 改写悄悄漂移）', () => {
  function seedP1Fixture(): void {
    // 两个会话：s1 有 Bash×3（1 错）、Read×1；s2 有 Bash×1（错）、Write×1（成功）、test×1（verify）
    const sessions = [
      { id: 's1', started: '2026-08-01T02:00:00.000Z', messageCount: 3, status: 'success' },
      { id: 's2', started: '2026-08-01T03:30:00.000Z', messageCount: 5, status: 'error' },
    ];
    const insertSession = db.prepare(
      `INSERT INTO sessions (id, provider, source_agent, title, started_at, updated_at, status,
         message_count, event_count, token_total, cost_usd, data_source, source_path,
         total_duration_ms, is_subagent, detail_loaded)
       VALUES (?, 'claude', 'Claude', 't', ?, ?, ?, ?, 4, 100, 0.01, 'scan', '/tmp/x', 60000, 0, 1)`,
    );
    for (const s of sessions) {
      insertSession.run(s.id, s.started, s.started, s.status, s.messageCount);
    }
    const insertEvent = db.prepare(
      `INSERT INTO events (session_id, id, sequence, kind, phase, title, started_at, duration_ms,
         status, actor, tool, input_summary, output_summary, tokens_json, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const ev = (
      sessionId: string,
      id: string,
      seq: number,
      kind: string,
      phase: string,
      startedAt: string,
      status: string,
      tool: string | null,
      inputSummary: string | null,
    ): void => {
      insertEvent.run(sessionId, id, seq, kind, phase, 't', startedAt, 100, status, 'assistant', tool, inputSummary, null, null, status === 'error' ? 'boom' : null);
    };
    ev('s1', 'e1', 1, 'tool', 'implement', '2026-08-01T02:00:01.000Z', 'success', 'Bash', null);
    ev('s1', 'e2', 2, 'tool', 'implement', '2026-08-01T02:00:02.000Z', 'error', 'Bash', null);
    ev('s1', 'e3', 3, 'tool', 'implement', '2026-08-01T02:00:03.000Z', 'success', 'Bash', null);
    ev('s1', 'e4', 4, 'file_read', 'understand', '2026-08-01T02:00:04.000Z', 'success', 'Read', null);
    ev('s2', 'e1', 1, 'tool', 'implement', '2026-08-01T03:30:01.000Z', 'error', 'Bash', null);
    ev('s2', 'e2', 2, 'file_write', 'implement', '2026-08-01T03:30:02.000Z', 'success', 'Write', null);
    ev('s2', 'e3', 3, 'agent', 'plan', '2026-08-01T03:30:03.000Z', 'success', null, JSON.stringify({ subagentType: 'Task' }));
    ev('s2', 'e4', 4, 'test', 'verify', '2026-08-01T03:30:04.000Z', 'success', 'Test', null);
    db.prepare('INSERT INTO scan_state (source_path, provider, file_size, file_mtime_ms, content_hash, last_scan_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run('/tmp/x.jsonl', 'claude', 10, 1, 'h', '2026-08-01T00:00:00.000Z');
  }

  it('A1 工具 TOP 榜：calls/errors 精确匹配', async () => {
    seedP1Fixture();
    const r = await getMission(db, { range: 'all', dataSource: 'scan', tz: 0 });
    const rows = r.usage.toolTop.data!;
    const bash = rows.find((row) => row.tool === 'Bash')!;
    expect(bash.calls).toBe(4);
    expect(bash.errors).toBe(2);
    expect(rows.find((row) => row.tool === 'Read')?.calls).toBe(1);
  });

  it('B4 工具失败率：分子只含 error', async () => {
    seedP1Fixture();
    const r = await getMission(db, { range: 'all', dataSource: 'scan', tz: 0 });
    const rows = r.quality.toolFailure.data!;
    expect(rows.find((row) => row.tool === 'Bash')).toMatchObject({ attempts: 4, errors: 2, rate: 0.5 });
    expect(rows.find((row) => row.tool === 'Read')).toMatchObject({ attempts: 1, errors: 0, rate: 0 });
  });

  it('A3 Subagent 分布：kind=agent 按类型聚合，avg 分母为会话数', async () => {
    seedP1Fixture();
    const r = await getMission(db, { range: 'all', dataSource: 'scan', tz: 0 });
    const data = r.usage.subagent.data!;
    expect(data.rows).toEqual([{ name: 'Task', count: 1 }]);
    expect(data.sessionsWithSubagent).toBe(1);
    expect(data.avgPerSession).toBe(0.5);
  });

  it('B14 任务纵深：metrics.tool_call_count 分桶（无 metrics 行则桶为 0）', async () => {
    seedP1Fixture();
    db.prepare(
      `INSERT INTO metrics (session_id, total_steps, duration_by_phase, tool_call_count, calc_version)
       VALUES ('s1', 4, '{}', 3, 3), ('s2', 4, '{}', 0, 3)`,
    ).run();
    const r = await getMission(db, { range: 'all', dataSource: 'scan', tz: 0 });
    const data = r.quality.depth.data!;
    expect(data.find((row) => row.name === '1-5')?.count).toBe(1);
    expect(data.find((row) => row.name === '0')?.count).toBe(1);
  });

  it('C3 任务日历：按日会话数与 hasError 精确匹配', async () => {
    seedP1Fixture();
    const r = await getMission(db, { range: 'all', dataSource: 'scan', tz: 0 });
    const data = r.health.calendar.data!;
    expect(data.find((row) => row.day === '2026-08-01')).toMatchObject({ sessions: 2, hasError: true });
  });

  it('C1 采集健康：scan_state 0 行告警数据 + 外部状态注入', async () => {
    seedP1Fixture();
    const r = await getMission(db, {
      range: 'all',
      dataSource: 'scan',
      tz: 0,
      ctx: {
        providers: [{ key: 'claude', enabled: true, sessionCount: 2, lastScanAt: '2026-08-01T00:00:00.000Z', ready: true, blockedBy: null }],
        proxy: { running: true, starting: false, port: 8080 },
        frida: { running: false, pid: null },
        startedAt: Date.now(),
      },
    });
    const data = r.health.collectors.data!;
    expect(data.scanStateRows).toBe(1);
    expect(data.providers[0]).toMatchObject({ key: 'claude', sessionCount: 2, ready: true });
    expect(data.proxy).toEqual({ running: true, starting: false, port: 8080 });
    expect(data.schemaVersion).toBe(2);
  });

  it('A4 热力图与 A7 活跃曲线：tz=0 时按 UTC 分桶', async () => {
    seedP1Fixture();
    const r = await getMission(db, { range: 'all', dataSource: 'scan', tz: 0 });
    const heat = r.usage.heatmap.data!;
    // 2026-08-01 是周六：UTC 02:00 / 03:30 → weekday 5
    expect(heat.grid[5]![2]).toBe(1);
    expect(heat.grid[5]![3]).toBe(1);
    expect(heat.peak).toBe(1);
    const activity = r.usage.activity.data!;
    expect(activity.find((p) => p.hour === '2026-08-01T02:00:00')).toMatchObject({ sessions: 1, messages: 3 });
    expect(activity.find((p) => p.hour === '2026-08-01T03:00:00')).toMatchObject({ sessions: 1, messages: 5 });
  });
});
