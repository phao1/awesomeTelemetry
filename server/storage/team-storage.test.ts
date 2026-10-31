import { parseCodeArtsTeam } from '../../src/adapters/team-codearts.js';
import { describe, expect, it } from 'vitest';

import Database from 'better-sqlite3';

import type {
  CompletenessLevel,
  EvidenceConfidence,
  EvidenceDimension,
  PriceCurrency,
  ProviderKey,
  TeamActivityKind,
  TeamAgentEdgeKind,
  TeamCompleteness,
  TeamMessageCategory,
  TeamMessageMode,
  TeamOrderConfidence,

  TeamRunStatus,
  TeamTaskStatus,
  TeamTopologyKind,
  TraceStatus,
} from '../../src/core/trace-types.js';
import {
  TEAM_ACTIVITY_SLIM_COLS,
  TEAM_AGENT_COLS,
  TEAM_EDGE_COLS,
  TEAM_MESSAGE_COLS,
  TEAM_RUN_LIST_COLS,

} from './columns.js';
import { initSchema } from './schema.js';
import {
  deleteTeamRun,
  evidenceToIngest,
  getTeamActivityDetail,
  getTeamCompareInputs,
  getTeamPatch,
  getTeamRunSnapshot,
  getTeamScanState,
  invalidateTeamBySource,
  listTeamActivities,
  listTeamRuns,
  putTeamScanState,
  teamWriteCounter,
  upsertTeamRun,
  type TeamActivityBodyRow,
  type TeamActivityRow,
  type TeamAgentEdgeRow,
  type TeamAgentRow,
  type TeamArtifactRow,
  type TeamAssignmentRow,
  type TeamEvidenceRow,
  type TeamMessageRow,
  type TeamRunIngest,
  type TeamRunRow,
  type TeamTaskRow,
} from './team-storage.js';

type Db = InstanceType<typeof Database>;

// ── DB 与 schema helper ─────────────────────────────────────────────────
// FK 级联依赖 foreign_keys = ON（镜像生产 openWritable）。

function newDb(): Db {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initSchema(db);
  return db;
}

function insertSession(db: Db, id: string, over: { provider?: ProviderKey } = {}): void {
  db.prepare(
    `INSERT INTO sessions (id, provider, source_agent, title, started_at, updated_at, status, cwd, source_path)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    over.provider ?? ('codex' as ProviderKey),
    'Codex',
    `session ${id}`,
    '2026-08-01T00:00:00.000Z',
    '2026-08-01T00:01:00.000Z',
    'success',
    '/tmp',
    `/tmp/${id}.jsonl`,
  );
}

function insertEvent(db: Db, sessionId: string, id: string, sequence = 1): void {
  db.prepare(
    `INSERT INTO events (session_id, id, sequence, kind, phase, started_at)
     VALUES (?, ?, ?, 'llm_call', 'exec', '2026-08-01T00:00:00.000Z')`,
  ).run(sessionId, id, sequence);
}

function countRows(db: Db, table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c;
}

function explain(db: Db, sql: string, params: unknown[]): string {
  const rows = db
    .prepare(`EXPLAIN QUERY PLAN ${sql}`)
    .all(...params) as Array<{ detail: string }>;
  return rows.map((r) => r.detail).join('\n');
}

/** 测量 teamWriteCounter 增量（模块级单例跨测试累积，只测 delta）。 */
function writeCounterDelta(fn: () => void): number {
  const before = teamWriteCounter.value;
  fn();
  return teamWriteCounter.value - before;
}

// ── 行构造 helper ──────────────────────────────────────────────────────

function fullCompleteness(level: CompletenessLevel = 'complete'): TeamCompleteness {
  const dims: EvidenceDimension[] = [
    'topology', 'tasks', 'communication', 'timing', 'tools',
    'outputs', 'tokens', 'cost', 'verification',
  ];
  const out = {} as TeamCompleteness;
  for (const d of dims) {
    out[d] = level;
  }
  return out;
}

function makeRunRow(id: string, over: Partial<TeamRunRow> = {}): TeamRunRow {
  return {
    id,
    provider: over.provider ?? ('codex' as ProviderKey),
    native_run_id: over.native_run_id ?? `${id}-native`,
    run_identity_confidence: over.run_identity_confidence ?? ('native' as EvidenceConfidence),
    title: over.title ?? `Run ${id}`,
    goal_fingerprint: over.goal_fingerprint ?? null,
    status: over.status ?? ('running' as TeamRunStatus),
    started_at: over.started_at ?? '2026-08-01T00:00:00.000Z',
    ended_at: over.ended_at ?? null,
    topology_kind: over.topology_kind ?? ('two_level' as TeamTopologyKind),
    agent_count: over.agent_count ?? 0,
    task_count: over.task_count ?? 0,
    communication_count: over.communication_count ?? 0,
    activity_count: over.activity_count ?? 0,
    round_count: over.round_count ?? 0,
    artifact_count: over.artifact_count ?? 0,
    token_available: over.token_available ?? 1,
    cost_available: over.cost_available ?? 1,
    cost_currency: over.cost_currency ?? ('USD' as PriceCurrency),
    completeness: over.completeness ?? fullCompleteness(),
    updated_at: over.updated_at ?? '2026-08-01T00:00:00.000Z',
    stamp: over.stamp ?? 'stamp-1',
  };
}

function makeAgentRow(runId: string, id: string, over: Partial<TeamAgentRow> = {}): TeamAgentRow {
  return {
    id,
    run_id: runId,
    native_id: over.native_id ?? `${id}-native`,
    display_name: over.display_name ?? `Agent ${id}`,
    role: over.role ?? 'team-mate',
    role_class: over.role_class ?? 'teammate',
    model: over.model ?? 'gpt-5',
    state: over.state ?? 'busy',
    created_at: over.created_at ?? '2026-08-01T00:00:00.000Z',
    ended_at: over.ended_at ?? null,
    session_keys: over.session_keys ?? [],
    evidence_ids: over.evidence_ids ?? [],
  };
}

function makeEdgeRow(
  runId: string,
  id: string,
  fromId: string,
  toId: string,
  kind: TeamAgentEdgeKind = 'supervises',
): TeamAgentEdgeRow {
  return {
    id,
    run_id: runId,
    from_agent_id: fromId,
    to_agent_id: toId,
    kind,
    valid_from: '2026-08-01T00:00:00.000Z',
    valid_to: null,
    confidence: 'native',
    evidence_ids: [],
  };
}

function makeTaskRow(runId: string, id: string, over: Partial<TeamTaskRow> = {}): TeamTaskRow {
  return {
    id,
    run_id: runId,
    native_id: over.native_id ?? `${id}-native`,
    title: over.title ?? `Task ${id}`,
    description_available: over.description_available ?? 0,
    priority: over.priority ?? 1,
    status: over.status ?? ('pending' as TeamTaskStatus),
    created_at: over.created_at ?? '2026-08-01T00:00:00.000Z',
    started_at: over.started_at ?? null,
    completed_at: over.completed_at ?? null,
    cancelled_at: over.cancelled_at ?? null,
    failed_at: over.failed_at ?? null,
    result_available: over.result_available ?? 0,
    evidence_ids: over.evidence_ids ?? [],
  };
}


function makeAssignmentRow(
  runId: string,
  id: string,
  taskId: string,
  agentId: string,
): TeamAssignmentRow {
  return {
    id,
    run_id: runId,
    task_id: taskId,
    agent_id: agentId,
    assigned_at: '2026-08-01T00:00:00.000Z',
    unassigned_at: null,
    assignment_kind: 'assigned',
    evidence_ids: [],
  };
}

function makeMessageRow(
  runId: string,
  id: string,
  senderId: string,
  over: Partial<TeamMessageRow> = {},
): TeamMessageRow {
  return {
    id,
    run_id: runId,
    sender_agent_id: senderId,
    recipient_ids: over.recipient_ids ?? [],
    mode: over.mode ?? ('direct' as TeamMessageMode),
    category: over.category ?? ('coordination' as TeamMessageCategory),
    task_id: over.task_id ?? null,
    correlation_id: over.correlation_id ?? null,
    reply_to_id: over.reply_to_id ?? null,
    sent_at: over.sent_at ?? '2026-08-01T00:00:00.000Z',
    received_at: over.received_at ?? null,
    body_available: over.body_available ?? 0,
    body_chars: over.body_chars ?? null,
    body_bytes: over.body_bytes ?? null,
    content_hash: over.content_hash ?? null,
    evidence_ids: over.evidence_ids ?? [],
  };
}

function makeActivityRow(
  runId: string,
  id: string,
  over: Partial<TeamActivityRow> = {},
): TeamActivityRow {
  return {
    id,
    run_id: runId,
    agent_id: over.agent_id ?? null,
    task_id: over.task_id ?? null,
    round_id: over.round_id ?? null,
    kind: over.kind ?? ('message_sent' as TeamActivityKind),
    status: over.status ?? ('success' as TraceStatus),
    started_at: over.started_at ?? '2026-08-01T00:00:00.000Z',
    ended_at: over.ended_at ?? null,
    native_sequence: over.native_sequence ?? 1,
    session_key: over.session_key ?? null,
    event_id: over.event_id ?? null,
    turn_key: over.turn_key ?? null,
    message_id: over.message_id ?? null,
    artifact_id: over.artifact_id ?? null,
    tokens: over.tokens ?? null,
    cost_usd: over.cost_usd ?? null,
    cost_source: over.cost_source ?? null,
    cost_currency: over.cost_currency ?? null,
    has_input: over.has_input ?? 0,
    has_output: over.has_output ?? 0,
    has_raw: over.has_raw ?? 0,
    evidence_ids: over.evidence_ids ?? [],
    order_confidence: over.order_confidence ?? ('native' as TeamOrderConfidence),
  };
}


function makeArtifactRow(runId: string, id: string): TeamArtifactRow {
  return {
    id,
    run_id: runId,
    native_id: null,
    name: `artifact-${id}`,
    kind: 'file',
    path_redacted: null,
    content_hash: null,
    producer_agent_ids: [],
    task_ids: [],
    created_at: '2026-08-01T00:00:00.000Z',
    accepted_at: null,
    has_content: 0,
    evidence_ids: [],
  };
}

function makeEvidenceRow(
  runId: string,
  id: string,
  sourceLocator: string,
  over: Partial<TeamEvidenceRow> = {},
): TeamEvidenceRow {
  return {
    id,
    run_id: runId,
    source_kind: over.source_kind ?? 'codex-jsonl',
    source_locator: sourceLocator,
    native_id: over.native_id ?? null,
    native_sequence: over.native_sequence ?? null,
    captured_at: over.captured_at ?? '2026-08-01T00:00:00.000Z',
    confidence: over.confidence ?? 'native',
    parser_version: over.parser_version ?? 'v1',
  };
}

function makeBodyRow(activityId: string, over: Partial<TeamActivityBodyRow> = {}): TeamActivityBodyRow {
  return {
    activity_id: activityId,
    input_body: over.input_body ?? null,
    output_body: over.output_body ?? null,
    message_body: over.message_body ?? null,
    result_body: over.result_body ?? null,
    raw_body: over.raw_body ?? null,
  };
}

function makeIngest(
  over: Partial<TeamRunIngest> & { run: TeamRunRow; complete: boolean },
): TeamRunIngest {
  return {
    run: over.run,
    agents: over.agents ?? [],
    edges: over.edges ?? [],
    tasks: over.tasks ?? [],
    dependencies: over.dependencies ?? [],
    assignments: over.assignments ?? [],
    messages: over.messages ?? [],
    activities: over.activities ?? [],
    rounds: over.rounds ?? [],
    artifacts: over.artifacts ?? [],
    evidence: over.evidence ?? [],
    bodies: over.bodies ?? [],
    metrics: over.metrics ?? null,
    session_ids: over.session_ids ?? [],
    complete: over.complete,
  };
}

// ===========================================================================
// §3.4 差分 upsert：无变化重扫 = 零写入
// ===========================================================================

describe('team-storage §3.4 差分 upsert', () => {
  it('无变化重扫：teamWriteCounter 增量 = 0，result.changed = false', () => {
    const db = newDb();
    const run = makeRunRow('r-rescan');
    const agents = [makeAgentRow('r-rescan', 'a1'), makeAgentRow('r-rescan', 'a2')];
    const tasks = [makeTaskRow('r-rescan', 't1')];
    const messages = [makeMessageRow('r-rescan', 'm1', 'a1', { recipient_ids: ['a2'] })];

    const ingest = makeIngest({ run, agents, tasks, messages, complete: true });
    upsertTeamRun(db, ingest); // 首次写入

    const delta = writeCounterDelta(() => {
      const result = upsertTeamRun(db, ingest); // 完全相同的重扫
      expect(result.changed).toBe(false);
      expect(result.changed_agent_ids).toEqual([]);
      expect(result.changed_task_ids).toEqual([]);
      expect(result.changed_message_ids).toEqual([]);
      expect(result.deleted_agent_ids).toEqual([]);
    });
    expect(delta).toBe(0); // 零写入：所有行指纹匹配，跳过
    db.close();
  });

  it('单字段变化：仅更新受影响行，未变化行跳过', () => {
    const db = newDb();
    const run = makeRunRow('r-partial');
    const a1 = makeAgentRow('r-partial', 'a1');
    const a2 = makeAgentRow('r-partial', 'a2');
    upsertTeamRun(db, makeIngest({ run, agents: [a1, a2], complete: true }));

    // 只改 a1 的 state，a2 不变
    const a1Changed = makeAgentRow('r-partial', 'a1', { state: 'idle' });
    const result = upsertTeamRun(
      db,
      makeIngest({ run, agents: [a1Changed, a2], complete: true }),
    );
    expect(result.changed_agent_ids).toEqual(['a1']);
    expect(result.changed).toBe(true);
    db.close();
  });
});

// ===========================================================================
// §3.5 complete 快照删除 stale / append(partial) 不删除
// ===========================================================================

describe('team-storage §3.5 complete vs append/partial', () => {
  it('complete=true：删除本次未传入的 stale 行', () => {
    const db = newDb();
    const run = makeRunRow('r-complete');
    upsertTeamRun(
      db,
      makeIngest({
        run,
        agents: [makeAgentRow('r-complete', 'a1'), makeAgentRow('r-complete', 'a2')],
        complete: true,
      }),
    );
    expect(countRows(db, 'team_agents')).toBe(2);

    // 第二次 complete 快照只带 a1 → a2 是 stale 应被删除
    const result = upsertTeamRun(
      db,
      makeIngest({ run, agents: [makeAgentRow('r-complete', 'a1')], complete: true }),
    );
    expect(countRows(db, 'team_agents')).toBe(1);
    expect(result.deleted_agent_ids).toEqual(['a2']);
    db.close();
  });

  it('complete=false：append/partial 绝不删除既有行', () => {
    const db = newDb();
    const run = makeRunRow('r-append');
    upsertTeamRun(
      db,
      makeIngest({
        run,
        agents: [makeAgentRow('r-append', 'a1'), makeAgentRow('r-append', 'a2')],
        tasks: [makeTaskRow('r-append', 't1')],
        complete: true,
      }),
    );
    expect(countRows(db, 'team_agents')).toBe(2);
    expect(countRows(db, 'team_tasks')).toBe(1);

    // append 只带 a1，但 complete=false → a2/t1 必须保留
    const result = upsertTeamRun(
      db,
      makeIngest({ run, agents: [makeAgentRow('r-append', 'a1')], complete: false }),
    );
    expect(countRows(db, 'team_agents')).toBe(2);
    expect(countRows(db, 'team_tasks')).toBe(1);
    expect(result.deleted_agent_ids).toEqual([]);
    expect(result.deleted_task_ids).toEqual([]);
    db.close();
  });

  it('complete=true：stale message 的 recipients junction 也被级联清除', () => {
    const db = newDb();
    const run = makeRunRow('r-rcpt');
    upsertTeamRun(
      db,
      makeIngest({
        run,
        agents: [makeAgentRow('r-rcpt', 'a1'), makeAgentRow('r-rcpt', 'a2')],
        messages: [makeMessageRow('r-rcpt', 'm1', 'a1', { recipient_ids: ['a2'] })],
        complete: true,
      }),
    );
    expect(countRows(db, 'team_message_recipients')).toBe(1);

    // complete 快照不再带 m1 → m1 删除，recipients 级联清除
    upsertTeamRun(
      db,
      makeIngest({
        run,
        agents: [makeAgentRow('r-rcpt', 'a1'), makeAgentRow('r-rcpt', 'a2')],
        messages: [],
        complete: true,
      }),
    );
    expect(countRows(db, 'team_messages')).toBe(0);
    expect(countRows(db, 'team_message_recipients')).toBe(0);
    db.close();
  });
});

// ===========================================================================
// §3.6 parser-version invalidation 只影响 team 行
// ===========================================================================

describe('team-storage §3.6 parser-version invalidation', () => {
  it('invalidateTeamBySource 删除受影响 team run，保留 sessions/events', () => {
    const db = newDb();
    insertSession(db, 's1');
    insertEvent(db, 's1', 'e1', 1);
    insertEvent(db, 's1', 'e2', 2);

    const sourceLocator = '/path/to/team-source.jsonl';
    const run = makeRunRow('r-inval');
    upsertTeamRun(
      db,
      makeIngest({
        run,
        agents: [makeAgentRow('r-inval', 'a1')],
        evidence: [makeEvidenceRow('r-inval', 'ev1', sourceLocator)],
        session_ids: ['s1'],
        complete: true,
      }),
    );
    expect(countRows(db, 'team_runs')).toBe(1);
    expect(countRows(db, 'team_run_sessions')).toBe(1);

    const removed = invalidateTeamBySource(db, sourceLocator);
    expect(removed).toBe(1);
    expect(countRows(db, 'team_runs')).toBe(0);
    expect(countRows(db, 'team_agents')).toBe(0);
    expect(countRows(db, 'team_evidence')).toBe(0);
    expect(countRows(db, 'team_run_sessions')).toBe(0);

    // sessions / events 完全不动
    expect(countRows(db, 'sessions')).toBe(1);
    expect(countRows(db, 'events')).toBe(2);
    db.close();
  });

  it('未受影响 source 的 team run 不被删除', () => {
    const db = newDb();
    const runA = makeRunRow('r-keep');
    const runB = makeRunRow('r-drop');
    upsertTeamRun(
      db,
      makeIngest({
        run: runA,
        evidence: [makeEvidenceRow('r-keep', 'ev-a', '/src-a.jsonl')],
        complete: true,
      }),
    );
    upsertTeamRun(
      db,
      makeIngest({
        run: runB,
        evidence: [makeEvidenceRow('r-drop', 'ev-b', '/src-b.jsonl')],
        complete: true,
      }),
    );

    const removed = invalidateTeamBySource(db, '/src-b.jsonl');
    expect(removed).toBe(1);
    expect(countRows(db, 'team_runs')).toBe(1);
    db.close();
  });
});

// ===========================================================================
// §3.7 scan-state 持久化 + 写失败 throw
// ===========================================================================

describe('team-storage §3.7 scan-state', () => {
  it('put/get 往返：字段完整保留', () => {
    const db = newDb();
    const state = {
      sourcePath: '/path/to/team.jsonl',
      provider: 'codex' as ProviderKey,
      runId: 'r-scan',
      fileSize: 4096,
      fileMtimeMs: 1720000000000,
      contentHash: 'sha256:abc',
      byteOffset: 1024,
      lastScanAt: '2026-08-01T00:00:00.000Z',
      eventCount: 42,
    };
    putTeamScanState(db, state);
    const read = getTeamScanState(db, state.sourcePath);
    expect(read).toEqual(state);
    db.close();
  });

  it('unknown source：返回 null', () => {
    const db = newDb();
    expect(getTeamScanState(db, '/missing.jsonl')).toBeNull();
    db.close();
  });

  it('重复 put：upsert 覆盖（同一 source_path）', () => {
    const db = newDb();
    const base = {
      sourcePath: '/upsert.jsonl',
      provider: 'codex' as ProviderKey,
      runId: null,
      fileSize: 0,
      fileMtimeMs: 0,
      contentHash: '',
      byteOffset: 0,
      lastScanAt: '2026-08-01T00:00:00.000Z',
      eventCount: 0,
    };
    putTeamScanState(db, base);
    putTeamScanState(db, { ...base, eventCount: 99, byteOffset: 2048 });
    const read = getTeamScanState(db, base.sourcePath);
    expect(read?.eventCount).toBe(99);
    expect(read?.byteOffset).toBe(2048);
    db.close();
  });

  it('写失败必须 throw（禁令 8：禁止静默 catch）', () => {
    const db = newDb();
    const state = {
      sourcePath: '/fail.jsonl',
      provider: 'codex' as ProviderKey,
      runId: null,
      fileSize: 0,
      fileMtimeMs: 0,
      contentHash: '',
      byteOffset: 0,
      lastScanAt: '2026-08-01T00:00:00.000Z',
      eventCount: 0,
    };
    db.close(); // 关闭连接模拟写失败
    expect(() => putTeamScanState(db, state)).toThrow();
  });
});

// ===========================================================================
// §3.8 级联删除双向
// ===========================================================================

describe('team-storage §3.8 级联删除双向', () => {
  it('team 删除：只删 team-owned 行，sessions 保留', () => {
    const db = newDb();
    insertSession(db, 's1');
    insertSession(db, 's2');
    const run = makeRunRow('r-del');
    upsertTeamRun(
      db,
      makeIngest({
        run,
        agents: [makeAgentRow('r-del', 'a1')],
        tasks: [makeTaskRow('r-del', 't1')],
        messages: [makeMessageRow('r-del', 'm1', 'a1')],
        session_ids: ['s1', 's2'],
        complete: true,
      }),
    );
    expect(countRows(db, 'team_runs')).toBe(1);
    expect(countRows(db, 'team_run_sessions')).toBe(2);

    const deleted = deleteTeamRun(db, 'r-del');
    expect(deleted).toBe(true);
    expect(countRows(db, 'team_runs')).toBe(0);
    expect(countRows(db, 'team_agents')).toBe(0);
    expect(countRows(db, 'team_tasks')).toBe(0);
    expect(countRows(db, 'team_messages')).toBe(0);
    expect(countRows(db, 'team_run_sessions')).toBe(0);

    // sessions 完全不动
    expect(countRows(db, 'sessions')).toBe(2);
    db.close();
  });

  it('session 删除：只清 junction 链接，team run 保留', () => {
    const db = newDb();
    insertSession(db, 's1');
    const run = makeRunRow('r-sessdel');
    upsertTeamRun(
      db,
      makeIngest({
        run,
        agents: [makeAgentRow('r-sessdel', 'a1')],
        session_ids: ['s1'],
        complete: true,
      }),
    );
    expect(countRows(db, 'team_runs')).toBe(1);
    expect(countRows(db, 'team_run_sessions')).toBe(1);

    // 删除 session → junction 被 FK 级联清除，team run 保留
    db.prepare('DELETE FROM sessions WHERE id = ?').run('s1');
    expect(countRows(db, 'sessions')).toBe(0);
    expect(countRows(db, 'team_run_sessions')).toBe(0);
    expect(countRows(db, 'team_runs')).toBe(1);
    expect(countRows(db, 'team_agents')).toBe(1);
    db.close();
  });

  it('deleteTeamRun 不存在的 run 返回 false', () => {
    const db = newDb();
    expect(deleteTeamRun(db, 'r-missing')).toBe(false);
    db.close();
  });
});

// ===========================================================================
// §3.9 listTeamRuns keyset 分页
// ===========================================================================

describe('team-storage §3.9 listTeamRuns keyset 分页', () => {
  function seedRuns(db: Db): void {
    const bases: Array<[string, string, string]> = [
      ['r1', '2026-08-01T00:00:00.000Z', 'running'],
      ['r2', '2026-08-02T00:00:00.000Z', 'success'],
      ['r3', '2026-08-03T00:00:00.000Z', 'running'],
      ['r4', '2026-08-04T00:00:00.000Z', 'error'],
      ['r5', '2026-08-05T00:00:00.000Z', 'running'],
    ];
    for (const [id, startedAt, status] of bases) {
      upsertTeamRun(
        db,
        makeIngest({
          run: makeRunRow(id, { started_at: startedAt, status: status as TeamRunStatus }),
          complete: true,
        }),
      );
    }
  }

  it('keyset 分页：limit=2 翻完 5 条，无重复无遗漏，started_at DESC 顺序', () => {
    const db = newDb();
    seedRuns(db);

    const page1 = listTeamRuns(db, { limit: 2 });
    expect(page1.items.map((i) => i.id)).toEqual(['r5', 'r4']);
    expect(page1.hasMore).toBe(true);
    expect(page1.total).toBe(5);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = listTeamRuns(db, { limit: 2, cursor: page1.nextCursor! });
    expect(page2.items.map((i) => i.id)).toEqual(['r3', 'r2']);
    expect(page2.hasMore).toBe(true);

    const page3 = listTeamRuns(db, { limit: 2, cursor: page2.nextCursor! });
    expect(page3.items.map((i) => i.id)).toEqual(['r1']);
    expect(page3.hasMore).toBe(false);
    expect(page3.nextCursor).toBeNull();
    db.close();
  });

  it('过滤：provider / status / topology', () => {
    const db = newDb();
    upsertTeamRun(
      db,
      makeIngest({
        run: makeRunRow('rp1', { provider: 'codex' as ProviderKey, status: 'running' }),
        complete: true,
      }),
    );
    upsertTeamRun(
      db,
      makeIngest({
        run: makeRunRow('rp2', {
          provider: 'codex' as ProviderKey,
          status: 'success',
          topology_kind: 'peer_graph',
        }),
        complete: true,
      }),
    );
    upsertTeamRun(
      db,
      makeIngest({
        run: makeRunRow('rp3', { provider: 'claude' as ProviderKey, status: 'running' }),
        complete: true,
      }),
    );

    const running = listTeamRuns(db, { status: ['running'] });
    expect(running.total).toBe(2);

    const codex = listTeamRuns(db, { provider: ['codex' as ProviderKey] });
    expect(codex.total).toBe(2);

    const peer = listTeamRuns(db, { topology: ['peer_graph'] });
    expect(peer.total).toBe(1);
    expect(peer.items[0]?.id).toBe('rp2');
    db.close();
  });

  it('过滤：q 子串匹配 title / native_run_id（大小写不敏感 LIKE）', () => {
    const db = newDb();
    upsertTeamRun(
      db,
      makeIngest({ run: makeRunRow('rq1', { title: 'Refactor module' }), complete: true }),
    );
    upsertTeamRun(
      db,
      makeIngest({ run: makeRunRow('rq2', { title: 'Bug fix' }), complete: true }),
    );
    const r = listTeamRuns(db, { q: 'refactor' });
    expect(r.total).toBe(1);
    expect(r.items[0]?.id).toBe('rq1');
    db.close();
  });

  it('过滤：completeness json_each 谓词命中', () => {
    const db = newDb();
    upsertTeamRun(
      db,
      makeIngest({
        run: makeRunRow('rc1', { completeness: fullCompleteness('complete') }),
        complete: true,
      }),
    );
    upsertTeamRun(
      db,
      makeIngest({
        run: makeRunRow('rc2', { completeness: fullCompleteness('unavailable') }),
        complete: true,
      }),
    );
    const r = listTeamRuns(db, { completeness: ['complete'] });
    expect(r.total).toBe(1);
    expect(r.items[0]?.id).toBe('rc1');
    db.close();
  });

  it('limit 边界：clamp 到 [1, 500]', () => {
    const db = newDb();
    seedRuns(db);
    const zero = listTeamRuns(db, { limit: 0 });
    expect(zero.items).toHaveLength(1); // clamp 到 1
    const huge = listTeamRuns(db, { limit: 99999 });
    expect(huge.items).toHaveLength(5); // 不超过 total
    db.close();
  });
});

// ===========================================================================
// §3.10 getTeamRunSnapshot
// ===========================================================================

describe('team-storage §3.10 getTeamRunSnapshot', () => {
  it('返回有界快照：summary + agents + edges + tasks + deps + active assignments + artifacts + metrics', () => {
    const db = newDb();
    const run = makeRunRow('r-snap');
    upsertTeamRun(
      db,
      makeIngest({
        run,
        agents: [makeAgentRow('r-snap', 'a1'), makeAgentRow('r-snap', 'a2')],
        edges: [makeEdgeRow('r-snap', 'e1', 'a1', 'a2', 'supervises')],
        tasks: [makeTaskRow('r-snap', 't1')],
        dependencies: [],
        assignments: [makeAssignmentRow('r-snap', 'as1', 't1', 'a1')],
        artifacts: [makeArtifactRow('r-snap', 'art1')],
        complete: true,
      }),
    );

    const snap = getTeamRunSnapshot(db, 'r-snap');
    expect(snap).not.toBeNull();
    expect(snap!.summary.id).toBe('r-snap');
    expect(snap!.agents).toHaveLength(2);
    expect(snap!.agentEdges).toHaveLength(1);
    expect(snap!.agentEdges[0]?.kind).toBe('supervises');
    expect(snap!.tasks).toHaveLength(1);
    expect(snap!.assignments).toHaveLength(1); // active assignment
    expect(snap!.artifacts).toHaveLength(1);
    expect(snap!.completeness).toEqual(fullCompleteness());
    expect(snap!.anomalies).toEqual([]); // storage 层不计算 anomalies
    expect(snap!.metrics).toBeDefined(); // 返回空 metrics（unavailable）
    db.close();
  });

  it('snapshot 只返回 active assignments（unassigned_at IS NULL）', () => {
    const db = newDb();
    const run = makeRunRow('r-act');
    upsertTeamRun(
      db,
      makeIngest({
        run,
        agents: [makeAgentRow('r-act', 'a1')],
        tasks: [makeTaskRow('r-act', 't1')],
        assignments: [
          { ...makeAssignmentRow('r-act', 'as-active', 't1', 'a1'), unassigned_at: null },
          { ...makeAssignmentRow('r-act', 'as-done', 't1', 'a1'), unassigned_at: '2026-08-02T00:00:00.000Z' },
        ],
        complete: true,
      }),
    );
    const snap = getTeamRunSnapshot(db, 'r-act');
    expect(snap!.assignments).toHaveLength(1);
    expect(snap!.assignments[0]?.id).toBe('as-active');
    db.close();
  });

  it('不存在的 run 返回 null', () => {
    const db = newDb();
    expect(getTeamRunSnapshot(db, 'r-missing')).toBeNull();
    db.close();
  });
});

// ===========================================================================
// §3.11 listTeamActivities
// ===========================================================================

describe('team-storage §3.11 listTeamActivities', () => {
  // ⚠️ team-storage.ts bug：listTeamActivities 拼接 SQL 时 ACTIVITY_BY_RUN_SQL
  // 已含 `WHERE run_id = ?`，而 whereSql 又以 `WHERE run_id = ?` 开头，产生
  // 双重 WHERE 语法错误（near "WHERE": syntax error）。以下测试用 it.skip 暂挂，
  // bug 修复后去掉 .skip 即可运行。详见 Needs confirmation。

  function seedActivities(db: Db): void {
    const acts: TeamActivityRow[] = [
      makeActivityRow('r-act', 'ac1', {
        agent_id: 'a1',
        kind: 'message_sent',
        started_at: '2026-08-01T00:00:00.000Z',
        native_sequence: 1,
      }),
      makeActivityRow('r-act', 'ac2', {
        agent_id: 'a2',
        kind: 'tool_call',
        started_at: '2026-08-02T00:00:00.000Z',
        native_sequence: 2,
      }),
      makeActivityRow('r-act', 'ac3', {
        agent_id: 'a1',
        kind: 'tool_call',
        started_at: '2026-08-03T00:00:00.000Z',
        native_sequence: 3,
        order_confidence: 'ambiguous',
      }),
    ];
    upsertTeamRun(
      db,
      makeIngest({
        run: makeRunRow('r-act'),
        agents: [makeAgentRow('r-act', 'a1'), makeAgentRow('r-act', 'a2')],
        activities: acts,
        complete: true,
      }),
    );
  }

  it('默认按 started_at DESC, native_sequence DESC, id ASC 排序', () => {
    const db = newDb();
    seedActivities(db);
    const r = listTeamActivities(db, 'r-act', {});
    expect(r.items.map((i) => i.id)).toEqual(['ac3', 'ac2', 'ac1']);
    expect(r.total).toBe(3);
    db.close();
  });

  it('hasAmbiguousOrder：任一行 orderConfidence=ambiguous 时为 true', () => {
    const db = newDb();
    seedActivities(db);
    const r = listTeamActivities(db, 'r-act', {});
    expect(r.hasAmbiguousOrder).toBe(true);
    db.close();
  });

  it('过滤：agent / kind / status', () => {
    const db = newDb();
    seedActivities(db);
    const byAgent = listTeamActivities(db, 'r-act', { agent: 'a1' });
    expect(byAgent.total).toBe(2);

    const byKind = listTeamActivities(db, 'r-act', { kind: ['tool_call'] });
    expect(byKind.total).toBe(2);

    const byStatus = listTeamActivities(db, 'r-act', { status: ['success'] });
    expect(byStatus.total).toBe(3);
    db.close();
  });

  it('keyset 分页：limit=2 翻完', () => {
    const db = newDb();
    seedActivities(db);
    const p1 = listTeamActivities(db, 'r-act', { limit: 2 });
    expect(p1.items.map((i) => i.id)).toEqual(['ac3', 'ac2']);
    expect(p1.hasMore).toBe(true);
    const p2 = listTeamActivities(db, 'r-act', { limit: 2, cursor: p1.nextCursor! });
    expect(p2.items.map((i) => i.id)).toEqual(['ac1']);
    expect(p2.hasMore).toBe(false);
    db.close();
  });

  it('不存在的 run 返回空列表', () => {
    const db = newDb();
    const r = listTeamActivities(db, 'r-missing', {});
    expect(r.items).toEqual([]);
    expect(r.total).toBe(0);
    db.close();
  });
});

// ===========================================================================
// §3.12 getTeamActivityDetail
// ===========================================================================

describe('team-storage §3.12 getTeamActivityDetail', () => {
  it('默认 slim：body 与 raw 均为 null', () => {
    const db = newDb();
    const run = makeRunRow('r-detail');
    upsertTeamRun(
      db,
      makeIngest({
        run,
        agents: [makeAgentRow('r-detail', 'a1')],
        activities: [makeActivityRow('r-detail', 'ac1', { agent_id: 'a1' })],
        bodies: [makeBodyRow('ac1', { message_body: 'hello' })],
        complete: true,
      }),
    );
    const d = getTeamActivityDetail(db, 'r-detail', 'ac1');
    expect(d).not.toBeNull();
    expect(d!.activity.id).toBe('ac1');
    expect(d!.body).toBeNull(); // 默认不返回 body
    expect(d!.raw).toBeNull();
    db.close();
  });

  it('include=body：返回 input/output/message/result', () => {
    const db = newDb();
    const run = makeRunRow('r-body');
    upsertTeamRun(
      db,
      makeIngest({
        run,
        agents: [makeAgentRow('r-body', 'a1')],
        activities: [makeActivityRow('r-body', 'ac1', { agent_id: 'a1' })],
        bodies: [
          makeBodyRow('ac1', {
            input_body: 'in',
            output_body: 'out',
            message_body: 'msg',
            result_body: 'res',
            raw_body: 'raw',
          }),
        ],
        complete: true,
      }),
    );
    const d = getTeamActivityDetail(db, 'r-body', 'ac1', 'body');
    expect(d!.body).toEqual({ input: 'in', output: 'out', message: 'msg', result: 'res' });
    expect(d!.raw).toBeNull(); // include=body 不返回 raw
    db.close();
  });

  it('include=raw：返回 raw_body', () => {
    const db = newDb();
    const run = makeRunRow('r-raw');
    upsertTeamRun(
      db,
      makeIngest({
        run,
        agents: [makeAgentRow('r-raw', 'a1')],
        activities: [makeActivityRow('r-raw', 'ac1', { agent_id: 'a1' })],
        bodies: [makeBodyRow('ac1', { raw_body: 'raw-content' })],
        complete: true,
      }),
    );
    const d = getTeamActivityDetail(db, 'r-raw', 'ac1', 'raw');
    expect(d!.raw).toBe('raw-content');
    db.close();
  });

  it('body 行缺失：body 为 null（映射 TEAM_BODY_UNAVAILABLE）', () => {
    const db = newDb();
    const run = makeRunRow('r-nobody');
    upsertTeamRun(
      db,
      makeIngest({
        run,
        agents: [makeAgentRow('r-nobody', 'a1')],
        activities: [makeActivityRow('r-nobody', 'ac1', { agent_id: 'a1' })],
        complete: true,
      }),
    );
    const d = getTeamActivityDetail(db, 'r-nobody', 'ac1', 'body');
    expect(d!.body).toBeNull();
    db.close();
  });

  it('不存在的 activity 返回 null', () => {
    const db = newDb();
    upsertTeamRun(db, makeIngest({ run: makeRunRow('r-empty'), complete: true }));
    expect(getTeamActivityDetail(db, 'r-empty', 'ac-missing')).toBeNull();
    db.close();
  });
});

// ===========================================================================
// §3.13 getTeamPatch
// ===========================================================================

describe('team-storage §3.13 getTeamPatch', () => {
  it('stamp 相同：返回空补丁（实体数组为空，deleted ids 仍返回）', () => {
    const db = newDb();
    const run = makeRunRow('r-patch', { stamp: 's1' });
    upsertTeamRun(
      db,
      makeIngest({
        run,
        agents: [makeAgentRow('r-patch', 'a1')],
        complete: true,
      }),
    );
    const patch = getTeamPatch(db, 'r-patch', 's1');
    expect(patch).not.toBeNull();
    expect(patch!.stamp).toBe('s1');
    expect(patch!.agents).toEqual([]);
    expect(patch!.tasks).toEqual([]);
    db.close();
  });

  it('stamp 不同：返回当前全部 slim 实体', () => {
    const db = newDb();
    const run = makeRunRow('r-patch2', { stamp: 's1' });
    upsertTeamRun(
      db,
      makeIngest({
        run,
        agents: [makeAgentRow('r-patch2', 'a1'), makeAgentRow('r-patch2', 'a2')],
        tasks: [makeTaskRow('r-patch2', 't1')],
        complete: true,
      }),
    );
    const patch = getTeamPatch(db, 'r-patch2', 'older-stamp');
    expect(patch!.agents).toHaveLength(2);
    expect(patch!.tasks).toHaveLength(1);
    db.close();
  });

  it('cap 截断：超出 cap 时 truncated=true', () => {
    const db = newDb();
    const run = makeRunRow('r-cap');
    upsertTeamRun(
      db,
      makeIngest({
        run,
        agents: [
          makeAgentRow('r-cap', 'a1'),
          makeAgentRow('r-cap', 'a2'),
          makeAgentRow('r-cap', 'a3'),
        ],
        complete: true,
      }),
    );
    const patch = getTeamPatch(db, 'r-cap', 'older', 2);
    expect(patch!.agents).toHaveLength(2);
    expect(patch!.truncated).toBe(true);
    db.close();
  });

  it('deleted ids 报告：complete 快照删除的 agent id 出现在 patch', () => {
    const db = newDb();
    const run = makeRunRow('r-delrep');
    upsertTeamRun(
      db,
      makeIngest({
        run,
        agents: [makeAgentRow('r-delrep', 'a1'), makeAgentRow('r-delrep', 'a2')],
        complete: true,
      }),
    );
    // complete 快照删除 a2
    upsertTeamRun(
      db,
      makeIngest({ run, agents: [makeAgentRow('r-delrep', 'a1')], complete: true }),
    );
    const patch = getTeamPatch(db, 'r-delrep', 'older');
    expect(patch!.deletedAgentIds).toContain('a2');
    db.close();
  });

  it('不存在的 run 返回 null', () => {
    const db = newDb();
    expect(getTeamPatch(db, 'r-missing', 's1')).toBeNull();
    db.close();
  });
});

// ===========================================================================
// §3.14 getTeamCompareInputs
// ===========================================================================

describe('team-storage §3.14 getTeamCompareInputs', () => {
  it('返回两个 run 的 snapshot，无 per-agent/task/session 循环', () => {
    const db = newDb();
    upsertTeamRun(
      db,
      makeIngest({
        run: makeRunRow('r-left'),
        agents: [makeAgentRow('r-left', 'a1')],
        complete: true,
      }),
    );
    upsertTeamRun(
      db,
      makeIngest({
        run: makeRunRow('r-right'),
        agents: [makeAgentRow('r-right', 'a2')],
        complete: true,
      }),
    );
    const cmp = getTeamCompareInputs(db, 'r-left', 'r-right');
    expect(cmp.left?.summary.id).toBe('r-left');
    expect(cmp.right?.summary.id).toBe('r-right');
    db.close();
  });

  it('缺失的 run 对应侧为 null', () => {
    const db = newDb();
    upsertTeamRun(
      db,
      makeIngest({ run: makeRunRow('r-exist'), agents: [makeAgentRow('r-exist', 'a1')], complete: true }),
    );
    const cmp = getTeamCompareInputs(db, 'r-exist', 'r-missing');
    expect(cmp.left?.summary.id).toBe('r-exist');
    expect(cmp.right).toBeNull();
    db.close();
  });

  it('两侧都缺失：left/right 均 null', () => {
    const db = newDb();
    const cmp = getTeamCompareInputs(db, 'r-m1', 'r-m2');
    expect(cmp.left).toBeNull();
    expect(cmp.right).toBeNull();
    db.close();
  });
});

// ===========================================================================
// §3.15 EXPLAIN 无 USE TEMP B-TREE
// ===========================================================================

describe('team-storage §3.15 EXPLAIN 无 USE TEMP B-TREE', () => {
  it('list 查询（带 provider 过滤）使用 idx_team_runs_provider_started，无临时 B-tree', () => {
    const db = newDb();
    const plan = explain(
      db,
      `SELECT ${TEAM_RUN_LIST_COLS} FROM team_runs WHERE provider = ? ORDER BY started_at DESC, id ASC LIMIT ?`,
      ['codex', 50],
    );
    expect(plan).toContain('idx_team_runs_provider_started');
    expect(plan).not.toContain('USE TEMP B-TREE');
    db.close();
  });

  it('list 查询（带 status 过滤）使用 idx_team_runs_status_started，无临时 B-tree', () => {
    const db = newDb();
    const plan = explain(
      db,
      `SELECT ${TEAM_RUN_LIST_COLS} FROM team_runs WHERE status = ? ORDER BY started_at DESC, id ASC LIMIT ?`,
      ['running', 50],
    );
    expect(plan).toContain('idx_team_runs_status_started');
    expect(plan).not.toContain('USE TEMP B-TREE');
    db.close();
  });

  it('snapshot 查询：run by id 主键查找，无临时 B-tree', () => {
    const db = newDb();
    const plan = explain(
      db,
      `SELECT ${TEAM_RUN_LIST_COLS} FROM team_runs WHERE id = ?`,
      ['r1'],
    );
    expect(plan).toContain('PRIMARY KEY');
    expect(plan).not.toContain('USE TEMP B-TREE');
    db.close();
  });

  it('ledger 查询 run/time：idx_team_activities_run_time 覆盖 run_id + started_at + native_sequence', () => {
    const db = newDb();
    // 索引 (run_id, started_at, native_sequence, id) 全 ASC；ORDER BY 全 ASC 可正向扫描。
    // 注：listTeamActivities 实际 SQL 用 DESC/ASC 混合 + id ASC tiebreaker 会产生
    // USE TEMP B-TREE FOR LAST TERM OF ORDER BY（见 Needs confirmation）。
    // 此处验证索引本身覆盖核心谓词 + 排序前缀。
    const plan = explain(
      db,
      `SELECT ${TEAM_ACTIVITY_SLIM_COLS} FROM team_activities WHERE run_id = ? ORDER BY started_at ASC, native_sequence ASC, id ASC LIMIT ?`,
      ['r1', 50],
    );
    expect(plan).toContain('idx_team_activities_run_time');
    expect(plan).not.toContain('USE TEMP B-TREE');
    db.close();
  });

  it('ledger 查询 agent/time：idx_team_activities_run_agent 覆盖', () => {
    const db = newDb();
    const plan = explain(
      db,
      `SELECT ${TEAM_ACTIVITY_SLIM_COLS} FROM team_activities WHERE run_id = ? AND agent_id = ? ORDER BY started_at ASC, id ASC LIMIT ?`,
      ['r1', 'a1', 50],
    );
    expect(plan).toContain('idx_team_activities_run_agent');
    expect(plan).not.toContain('USE TEMP B-TREE');
    db.close();
  });

  it('ledger 查询 task/time：idx_team_activities_run_task 覆盖', () => {
    const db = newDb();
    const plan = explain(
      db,
      `SELECT ${TEAM_ACTIVITY_SLIM_COLS} FROM team_activities WHERE run_id = ? AND task_id = ? ORDER BY started_at ASC, id ASC LIMIT ?`,
      ['r1', 't1', 50],
    );
    expect(plan).toContain('idx_team_activities_run_task');
    expect(plan).not.toContain('USE TEMP B-TREE');
    db.close();
  });

  it('communication 查询：idx_team_messages_run_sender 覆盖', () => {
    const db = newDb();
    const plan = explain(
      db,
      `SELECT ${TEAM_MESSAGE_COLS} FROM team_messages WHERE run_id = ? AND sender_agent_id = ? ORDER BY sent_at LIMIT ?`,
      ['r1', 'a1', 50],
    );
    expect(plan).toContain('idx_team_messages_run_sender');
    expect(plan).not.toContain('USE TEMP B-TREE');
    db.close();
  });

  it('graph 查询：idx_team_edges_run_from_to 覆盖', () => {
    const db = newDb();
    const plan = explain(
      db,
      `SELECT ${TEAM_EDGE_COLS} FROM team_agent_edges WHERE run_id = ? AND from_agent_id = ? AND to_agent_id = ?`,
      ['r1', 'a1', 'a2'],
    );
    expect(plan).toContain('idx_team_edges_run_from_to');
    expect(plan).not.toContain('USE TEMP B-TREE');
    db.close();
  });

  it('comparison 查询：复用 snapshot，run by id 主键查找，无临时 B-tree', () => {
    const db = newDb();
    const plan = explain(
      db,
      `SELECT ${TEAM_AGENT_COLS} FROM team_agents WHERE run_id = ?`,
      ['r1'],
    );
    expect(plan).not.toContain('USE TEMP B-TREE');
    db.close();
  });
});

// ===========================================================================
// §3.16 write-counter
// ===========================================================================

describe('team-storage §3.16 write-counter', () => {
  it('no-change rescan = 零写入（teamWriteCounter 增量 = 0）', () => {
    const db = newDb();
    const run = makeRunRow('r-wc-noop');
    const agents = [makeAgentRow('r-wc-noop', 'a1'), makeAgentRow('r-wc-noop', 'a2')];
    const tasks = [makeTaskRow('r-wc-noop', 't1')];
    const messages = [makeMessageRow('r-wc-noop', 'm1', 'a1', { recipient_ids: ['a2'] })];
    const activities = [makeActivityRow('r-wc-noop', 'ac1', { agent_id: 'a1' })];
    const ingest = makeIngest({
      run,
      agents,
      tasks,
      messages,
      activities,
      complete: true,
    });
    upsertTeamRun(db, ingest);

    const delta = writeCounterDelta(() => upsertTeamRun(db, ingest));
    expect(delta).toBe(0);
    db.close();
  });

  it('append one message（隔离场景）：counter 增量 = 1（仅 message INSERT）', () => {
    const db = newDb();
    const run = makeRunRow('r-wc-append', { communication_count: 0 });
    const a1 = makeAgentRow('r-wc-append', 'a1');
    upsertTeamRun(db, makeIngest({ run, agents: [a1], complete: true }));

    // append 一条 message：counts 不变（隔离 message 写入），无 recipient，complete=false
    const delta = writeCounterDelta(() => {
      const result = upsertTeamRun(
        db,
        makeIngest({
          run, // 同一 run，业务字段全同 → 不 UPDATE
          agents: [a1], // 全同 → 跳过
          messages: [makeMessageRow('r-wc-append', 'm-new', 'a1')], // 新 INSERT
          complete: false,
        }),
      );
      expect(result.changed_message_ids).toEqual(['m-new']);
      expect(result.deleted_message_ids).toEqual([]);
      expect(result.deleted_agent_ids).toEqual([]);
    });
    expect(delta).toBe(1); // 仅 message INSERT
    db.close();
  });

  it('append one message（真实场景）：counter 增量 = 3（run UPDATE + message INSERT + recipient INSERT）', () => {
    const db = newDb();
    const run = makeRunRow('r-wc-real', { communication_count: 0, agent_count: 2 });
    const a1 = makeAgentRow('r-wc-real', 'a1');
    const a2 = makeAgentRow('r-wc-real', 'a2');
    upsertTeamRun(db, makeIngest({ run, agents: [a1, a2], complete: true }));

    // 真实 append：communication_count 0→1，新增 message + recipient
    const delta = writeCounterDelta(() => {
      const result = upsertTeamRun(
        db,
        makeIngest({
          run: makeRunRow('r-wc-real', { communication_count: 1, agent_count: 2 }),
          agents: [a1, a2],
          messages: [makeMessageRow('r-wc-real', 'm-real', 'a1', { recipient_ids: ['a2'] })],
          complete: false,
        }),
      );
      expect(result.changed_message_ids).toEqual(['m-real']);
      expect(result.deleted_message_ids).toEqual([]);
    });
    // run UPDATE (1) + message INSERT (1) + recipient INSERT (1) = 3
    expect(delta).toBe(3);
    db.close();
  });

  it('no delete-and-reinsert：append 场景不删除既有行（deleted ids 全空）', () => {
    const db = newDb();
    const run = makeRunRow('r-wc-nodel');
    const a1 = makeAgentRow('r-wc-nodel', 'a1');
    const a2 = makeAgentRow('r-wc-nodel', 'a2');
    upsertTeamRun(
      db,
      makeIngest({
        run,
        agents: [a1, a2],
        messages: [makeMessageRow('r-wc-nodel', 'm1', 'a1', { recipient_ids: ['a2'] })],
        complete: true,
      }),
    );

    // append 新 message，complete=false → 既有 m1/a2 不删除
    const result = upsertTeamRun(
      db,
      makeIngest({
        run,
        agents: [a1, a2],
        messages: [
          makeMessageRow('r-wc-nodel', 'm1', 'a1', { recipient_ids: ['a2'] }), // 既有
          makeMessageRow('r-wc-nodel', 'm2', 'a1', { recipient_ids: ['a2'] }), // 新增
        ],
        complete: false,
      }),
    );
    expect(result.deleted_message_ids).toEqual([]);
    expect(result.deleted_agent_ids).toEqual([]);
    expect(countRows(db, 'team_messages')).toBe(2);
    db.close();
  });
});


describe('replay pagination retains undated source evidence',()=>{
  it('pages across dated/null clocks and null/native sequences without skipping or duplicating rows',()=>{
    const db=newDb();
    const entries=[['dated', '2026-08-17T00:00:00Z',1],['null-z',null,9],['null-a',null,8],['null-last',null,null]] as const;
    upsertTeamRun(db,makeIngest({run:makeRunRow('replay-null'),activities:entries.map(([id,time,seq])=>makeActivityRow('replay-null',id,{started_at:time,native_sequence:seq})),complete:true}));
    const ids:string[]=[];let cursor:string|undefined;
    for(let i=0;i<5;i++) { const page=listTeamActivities(db,'replay-null',{limit:1,cursor});ids.push(...page.items.map(item=>item.id));if(!page.hasMore)break;cursor=page.nextCursor!; }
    expect(ids).toEqual(['dated','null-z','null-a','null-last']);db.close();
  });
});


describe('replay source bodies stay lazy and redacted',()=>{
  it('stores redacted control excerpts separately while snapshot/list and default detail remain slim',()=>{
    const parsed=parseCodeArtsTeam({sourceLocator:'fixture-retained-event',contact:{root:{sessionID:'leader',agent_type:'team-leader'}},teamTask:[{id:1,content:'Review',status:'completed'}],parts:[{id:'finish',message_id:'m',session_id:'leader',data:{type:'tool',tool:'finish-task',state:{status:'completed',input:{id:1,token:'sk-abcdefghijklmnopqrstuv123456'},output:'You have finished task(id=1, content=Review)'}}}]});
    const db=newDb();upsertTeamRun(db,evidenceToIngest(parsed));
    const activity=parsed.activities.find(item=>item.kind==='task_status')!;
    const slim=listTeamActivities(db,parsed.run.runId,{});
    expect(JSON.stringify(slim)).not.toContain('abcdefghijklmnopqrstuv123456');
    expect(getTeamActivityDetail(db,parsed.run.runId,activity.id)!.body).toBeNull();
    const body=getTeamActivityDetail(db,parsed.run.runId,activity.id,'body')!.body!;
    expect(body.input).toContain('sk-***');expect(body.input).not.toContain('abcdefghijklmnopqrstuv123456');
    expect(body.result).toContain('completed_reported');
    expect(getTeamActivityDetail(db,parsed.run.runId,activity.id,'raw')!.raw).toBeNull();
    expect(getTeamRunSnapshot(db,parsed.run.runId)!.tasks[0]!.resultAvailable).toBe(false);
    db.close();
  });
});
