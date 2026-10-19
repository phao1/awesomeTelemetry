import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import Database from 'better-sqlite3';

import { initSchema } from '../server/storage/schema.js';
import { scanTeamSources, type TeamSink } from './team-scanner.js';
import type { NormalizedTeamEvidence } from '../src/adapters/team-codearts.js';

type Db = InstanceType<typeof Database>;

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'team-scanner-'));
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

/** 记录调用顺序的 TeamSink mock，不接真实 storage。 */
function recordingSink(): { sink: TeamSink; ingested: NormalizedTeamEvidence[] } {
  const ingested: NormalizedTeamEvidence[] = [];
  const sink: TeamSink = {
    ingestRun(evidence) {
      ingested.push(evidence);
      return { runId: evidence.run.runId, stamp: 'ts' };
    },
    deleteRun() {},
  };
  return { sink, ingested };
}

// ── CodeArts 源目录构造 ──────────────────────────────────────────────────

function writeCodeArtsSession(agentTeamRoot: string, leaderId: string, mateId: string): void {
  const dir = join(agentTeamRoot, 'session', leaderId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'contact.json'),
    JSON.stringify({
      'team-leader': {
        sessionID: leaderId,
        agent_type: 'team-leader',
        description: 'leader',
        agent_name: 'team-leader',
        status: 'running',
        startedAt: '2026-08-17T15:27:54.292Z',
      },
      'member-1': {
        sessionID: mateId,
        parentSessionID: leaderId,
        agent_type: 'team-mate',
        agent_name: 'member-1',
        status: 'running',
        startedAt: '2026-08-17T15:31:52.004Z',
      },
    }),
    'utf8',
  );
  writeFileSync(
    join(dir, 'team-task.json'),
    JSON.stringify([
      { id: 1, blocked_by: [], content: 'A', status: 'in_progress', owner: mateId },
      { id: 2, blocked_by: [1], content: 'B', status: 'pending', owner: '' },
    ]),
    'utf8',
  );
}

/** 真实 drizzle schema：message/part 的 data 是 JSON 字符串（验证 parseDataColumn）。 */
function createCodeArtsDb(dir: string): string {
  const dbPath = join(dir, 'opencode.db');
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE session (id TEXT PRIMARY KEY, parent_id TEXT, type TEXT, title TEXT, directory TEXT, time_created INTEGER, time_updated INTEGER);
    CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT);
    CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, data TEXT);
    CREATE TABLE cag_session_extra (session_id TEXT, type TEXT, extra_info TEXT);
  `);
  db.prepare(
    'INSERT INTO session (id, parent_id, type, title, directory, time_created, time_updated) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run('ses_lead_0001', null, null, '团队任务', '/tmp', 1786980474008, 1786980712098);
  db.prepare(
    'INSERT INTO session (id, parent_id, type, title, directory, time_created, time_updated) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run('ses_mate_0001', 'ses_lead_0001', null, '子任务', '/tmp', 1786980711999, 1786980742722);
  db.prepare('INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)').run(
    'msg1',
    'ses_lead_0001',
    1786980474319,
    JSON.stringify({ role: 'assistant' }),
  );
  db.prepare('INSERT INTO part (id, message_id, session_id, data) VALUES (?, ?, ?, ?)').run(
    'part_step_1',
    'msg1',
    'ses_lead_0001',
    JSON.stringify({
      type: 'step-finish',
      tokens: { total: 100, input: 90, output: 10, reasoning: 5, cache: { read: 0, write: 0 } },
      cost: 0.013163535,
    }),
  );
  db.prepare('INSERT INTO cag_session_extra (session_id, type, extra_info) VALUES (?, ?, ?)').run(
    'ses_lead_0001',
    'claw',
    null,
  );
  db.close();
  return dbPath;
}

// ── Codex 源目录构造 ─────────────────────────────────────────────────────

function writeCodexSessions(sessionsRoot: string): void {
  mkdirSync(sessionsRoot, { recursive: true });
  const root = '01a00001-0000-0000-0000-000000000000';
  const sub = '01a00002-0000-0000-0000-000000000000';
  writeFileSync(
    join(sessionsRoot, `${root}.jsonl`),
    [
      JSON.stringify({
        timestamp: '2026-08-16T07:27:48.000Z',
        type: 'session_meta',
        payload: { session_id: root, id: root, timestamp: '2026-08-16T07:27:48.000Z', source: 'vscode', thread_source: 'user', model_provider: 'openai' },
      }),
      JSON.stringify({
        timestamp: '2026-08-16T07:29:13.000Z',
        type: 'event_msg',
        payload: { type: 'sub_agent_activity', event_id: 'e1', occurred_at_ms: 1786865345593, agent_thread_id: sub, kind: 'started' },
      }),
    ].join('\n') + '\n',
    'utf8',
  );
  writeFileSync(
    join(sessionsRoot, `${sub}.jsonl`),
    [
      JSON.stringify({
        timestamp: '2026-08-16T07:29:13.000Z',
        type: 'session_meta',
        payload: {
          session_id: root,
          id: sub,
          forked_from_id: root,
          parent_thread_id: root,
          timestamp: '2026-08-16T07:29:13.000Z',
          source: {
            subagent: { thread_spawn: { parent_thread_id: root, depth: 1, agent_path: '/root/x', agent_nickname: 'Euclid', agent_role: null } },
            thread_source: 'subagent',
            agent_nickname: 'Euclid',
            agent_path: '/root/x',
            model_provider: 'openai',
          },
        },
      }),
    ].join('\n') + '\n',
    'utf8',
  );
}

describe('§4.15 scanner 集成', () => {
  it('CodeArts：发现 run、解析、摄入，coalesced 通知一次（单 run）', async () => {
    const dir = tempDir();
    const agentTeamRoot = join(dir, 'agent-team');
    writeCodeArtsSession(agentTeamRoot, 'ses_lead_0001', 'ses_mate_0001');
    const db = newDb();
    const { sink, ingested } = recordingSink();
    const notified: string[][] = [];

    const results = await scanTeamSources(
      [{ provider: 'codearts', root: agentTeamRoot, auxiliary: [] }],
      { db, sink, notify: (ids) => notified.push(ids) },
    );

    expect(results[0]!.runs).toBe(1);
    expect(results[0]!.skipped).toBe(false);
    expect(ingested).toHaveLength(1);
    expect(ingested[0]!.run.provider).toBe('codearts');
    // coalesced：一次 notify，含全部 runId
    expect(notified).toHaveLength(1);
    expect(notified[0]).toEqual([ingested[0]!.run.runId]);
    db.close();
  });

  it('CodeArts：多 run coalesced 成一次 affected-run 通知', async () => {
    const dir = tempDir();
    const agentTeamRoot = join(dir, 'agent-team');
    writeCodeArtsSession(agentTeamRoot, 'ses_lead_0001', 'ses_mate_0001');
    writeCodeArtsSession(agentTeamRoot, 'ses_lead_0002', 'ses_mate_0002');
    const db = newDb();
    const { sink } = recordingSink();
    const notified: string[][] = [];

    const results = await scanTeamSources(
      [{ provider: 'codearts', root: agentTeamRoot, auxiliary: [] }],
      { db, sink, notify: (ids) => notified.push(ids) },
    );

    expect(results[0]!.runs).toBe(2);
    expect(notified).toHaveLength(1); // coalesced：绝不逐 run 发射
    expect(notified[0]).toHaveLength(2);
    db.close();
  });

  it('fingerprint/no-change：第二次未变更扫描 skipped=true，不摄入不通知', async () => {
    const dir = tempDir();
    const agentTeamRoot = join(dir, 'agent-team');
    writeCodeArtsSession(agentTeamRoot, 'ses_lead_0001', 'ses_mate_0001');
    const db = newDb();
    const { sink, ingested } = recordingSink();
    const notified: string[][] = [];

    const first = await scanTeamSources(
      [{ provider: 'codearts', root: agentTeamRoot, auxiliary: [] }],
      { db, sink, notify: (ids) => notified.push(ids) },
    );
    expect(first[0]!.runs).toBe(1);
    expect(ingested).toHaveLength(1);

    const second = await scanTeamSources(
      [{ provider: 'codearts', root: agentTeamRoot, auxiliary: [] }],
      { db, sink, notify: (ids) => notified.push(ids) },
    );
    expect(second[0]!.skipped).toBe(true);
    expect(second[0]!.runs).toBe(0);
    expect(ingested).toHaveLength(1); // 无新增摄入
    expect(notified).toHaveLength(1); // 无新增通知
    db.close();
  });

  it('CodeArts：opencode.db data 列（JSON 字符串）被正确解析为 token/cost', async () => {
    const dir = tempDir();
    const agentTeamRoot = join(dir, 'agent-team');
    writeCodeArtsSession(agentTeamRoot, 'ses_lead_0001', 'ses_mate_0001');
    const dbPath = createCodeArtsDb(dir);
    const db = newDb();
    const { sink, ingested } = recordingSink();

    await scanTeamSources(
      [{ provider: 'codearts', root: agentTeamRoot, auxiliary: [dbPath] }],
      { db, sink },
    );

    expect(ingested).toHaveLength(1);
    expect(ingested[0]!.run.tokenAvailable).toBe(true);
    expect(ingested[0]!.run.costAvailable).toBe(true);
    expect(ingested[0]!.run.costCurrency).toBe('USD');
    db.close();
  });

  it('Codex：按 fork 森林分组，root+subagent 合成单 run', async () => {
    const dir = tempDir();
    const sessionsRoot = join(dir, 'sessions');
    writeCodexSessions(sessionsRoot);
    const db = newDb();
    const { sink, ingested } = recordingSink();
    const notified: string[][] = [];

    const results = await scanTeamSources(
      [{ provider: 'codex', root: sessionsRoot }],
      { db, sink, notify: (ids) => notified.push(ids) },
    );

    expect(results[0]!.runs).toBe(1);
    expect(results[0]!.skipped).toBe(false);
    expect(ingested).toHaveLength(1);
    expect(ingested[0]!.run.provider).toBe('codex');
    expect(ingested[0]!.agents).toHaveLength(2);
    expect(ingested[0]!.agentEdges).toHaveLength(1);
    expect(notified).toHaveLength(1);
    db.close();
  });

  it('Codex：fingerprint/no-change 第二次 skipped', async () => {
    const dir = tempDir();
    const sessionsRoot = join(dir, 'sessions');
    writeCodexSessions(sessionsRoot);
    const db = newDb();
    const { sink, ingested } = recordingSink();

    const first = await scanTeamSources([{ provider: 'codex', root: sessionsRoot }], { db, sink });
    expect(first[0]!.runs).toBe(1);

    const second = await scanTeamSources([{ provider: 'codex', root: sessionsRoot }], { db, sink });
    expect(second[0]!.skipped).toBe(true);
    expect(ingested).toHaveLength(1);
    db.close();
  });

  it('源目录不存在 → 0 runs，不抛异常', async () => {
    const db = newDb();
    const { sink } = recordingSink();
    const results = await scanTeamSources(
      [{ provider: 'codearts', root: '/nonexistent/agent-team', auxiliary: [] }],
      { db, sink },
    );
    expect(results[0]!.runs).toBe(0);
    db.close();
  });
});


describe('real-shape multi-run source regression', () => {
  it('scopes whole-db parts to each run and resolves call identities only inside the exact session and scope', async()=>{
    const dir=tempDir();const root=join(dir,'agent-team');
    writeCodeArtsSession(root,'ses_lead_0001','ses_mate_0001');
    writeCodeArtsSession(root,'ses_lead_0002','ses_mate_0002');
    const path=createCodeArtsDb(dir);const source=new Database(path);
    source.prepare('INSERT INTO message(id,session_id,time_created,data) VALUES(?,?,?,?)').run('m2','ses_mate_0002',1786980712000,'{}');
    source.prepare('INSERT INTO part(id,message_id,session_id,data) VALUES(?,?,?,?)').run('p2','m2','ses_mate_0002',JSON.stringify({type:'tool',tool:'finish-task',callID:'same-call',state:{status:'completed',input:{id:1},output:'You have finished task(id=1, content=A)'}}));
    source.prepare('INSERT INTO part(id,message_id,session_id,data) VALUES(?,?,?,?)').run('p1-control','m1','ses_mate_0001',JSON.stringify({type:'tool',tool:'finish-task',callID:'same-call',state:{status:'completed',input:{id:1},output:'You have finished task(id=1, content=A)'}}));
    source.close();
    const db=newDb();
    // Exact explicit native identities from the existing session scanner; IDs are not derived from part indexes.
    const {deriveSessionKey}=await import('./session-key.js');
    const addSession=db.prepare('INSERT INTO sessions(id,provider,source_agent,data_source,source_path,started_at,updated_at) VALUES(?,?,?,?,?,?,?)');
    const addEvent=db.prepare('INSERT INTO events(session_id,id,sequence,kind,phase,started_at) VALUES(?,?,?,?,?,?)');
    const addIdentitySource=db.prepare('INSERT INTO trace_identity_sources(id,session_key,parser_version,complete,omitted_count,reasons_json,content_sha256,updated_at) VALUES(?,?,3,1,0,?, ?,?)');
    const addIdentity=db.prepare('INSERT INTO trace_identities(id,source_id,namespace,kind,value,scope,event_id,source_path) VALUES(?,?,?,?,?,?,?,?)');
    for (const [index,native] of ['ses_mate_0001','ses_mate_0002'].entries()) {
      const key=deriveSessionKey('codearts',path,native);addSession.run(key,'codearts','CodeArts','scan',path,'2026-08-17T00:00:00Z','2026-08-17T00:00:00Z');
      addEvent.run(key,'normalized-'+index,0,'tool','execute','2026-08-17T00:00:00Z');
      addIdentitySource.run('source-'+index,key,'[]','hash','2026-08-17T00:00:00Z');
      addIdentity.run('identity-'+index,'source-'+index,'agent:codearts','tool_call','same-call',native,'normalized-'+index,'part.callID');
    }
    const {sink,ingested}=recordingSink();
    await scanTeamSources([{provider:'codearts',root,auxiliary:[path]}],{db,sink});
    expect(ingested).toHaveLength(2);
    const [a,b]=ingested;
    expect(a!.activities.filter(event=>event.kind==='task_status').map(event=>event.eventId)).toEqual(['normalized-0']);
    expect(b!.activities.filter(event=>event.kind==='task_status').map(event=>event.eventId)).toEqual(['normalized-1']);
    const ids=new Set(a!.evidence.map(ref=>ref.nativeId).filter(id=>id?.startsWith('p')));
    expect(b!.evidence.filter(ref=>ref.nativeId?.startsWith('p')).some(ref=>ids.has(ref.nativeId))).toBe(false);
    expect(b!.activities.every(event=>event.agentId!==null)).toBe(true);
    db.close();
  });
});
