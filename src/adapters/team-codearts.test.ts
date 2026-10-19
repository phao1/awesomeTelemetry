import { join } from 'node:path';
import { homedir } from 'node:os';

import { describe, expect, it } from 'vitest';

import {
  canonicalEntityId,
  canonicalRunId,
  codeArtsTeamCapabilities,
  goalFingerprintOf,
  makeOccurrenceCounter,
  normalizeLocalStringUtc8,
  normalizeTeamRunStatus,
  parseCodeArtsTeam,
  redactLocator,
  type CodeArtsTeamRaw,
} from './team-codearts.js';

// ══════════════════════════════════════════════════════════════════════════
// fixtures（§4.12）：内联构造 raw 输入，覆盖 9 种场景 + 负向断言。
// ══════════════════════════════════════════════════════════════════════════

const LEADER = 'ses_lead_0001';
const MATE = 'ses_mate_0001';

function raw(overrides: Partial<CodeArtsTeamRaw> = {}): CodeArtsTeamRaw {
  return {
    sourceLocator: '~/.codeartsdoer/agent-team/session/ses_lead_0001',
    contact: {
      'team-leader': {
        sessionID: LEADER,
        modelInfo: { providerID: 'deepseek', modelID: 'deepseek-v4-pro' },
        agent_type: 'team-leader',
        description: 'team-leader',
        agent_name: 'team-leader',
        status: 'running',
        startedAt: '2026-08-17T15:27:54.292Z',
      },
      'member-1': {
        sessionID: MATE,
        parentSessionID: LEADER,
        modelInfo: { providerID: 'deepseek', modelID: 'deepseek-v4-pro' },
        agent_type: 'team-mate',
        description: '证据调查与范围冻结',
        agent_name: 'member-1',
        status: 'running',
        startedAt: '2026-08-17T15:31:52.004Z',
      },
    },
    teamTask: [
      {
        id: 1,
        blocked_by: [],
        content: '证据调查与范围冻结',
        status: 'in_progress',
        owner: MATE,
        owner_name: 'member-1',
        createdAt: 1786980679948,
        startedAt: '2026-08-17T15:31:52.004Z',
      },
      {
        id: 2,
        blocked_by: [1],
        content: '权威契约冻结',
        status: 'pending',
        owner: '',
        createdAt: 1786980679948,
      },
    ],
    ...overrides,
  };
}

describe('§4.1–§4.2 共享边界与规范化 helpers', () => {
  it('canonicalRunId 确定性 + 跨 run 分离', () => {
    const a = canonicalRunId('codearts', 'ses_lead_0001');
    const b = canonicalRunId('codearts', 'ses_lead_0001');
    const c = canonicalRunId('codearts', 'ses_other_0001');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toBe('team:codearts:run:ses_lead_0001');
  });

  it('canonicalEntityId 无原生 id 时用 kind 定位，ordinal 区分重复 occurrence', () => {
    const base = canonicalEntityId('codearts', 'r1', 'edge', null);
    const withOrdinal = canonicalEntityId('codearts', 'r1', 'edge', null, 1);
    expect(base).not.toBe(withOrdinal);
    expect(withOrdinal).toContain('#1');
  });

  it('makeOccurrenceCounter 同 native key 稳定递增 ordinal', () => {
    const counter = makeOccurrenceCounter();
    expect(counter.next('dup')).toBe(0);
    expect(counter.next('dup')).toBe(1);
    expect(counter.next('other')).toBe(0);
  });

  it('normalizeLocalStringUtc8：本地串按 UTC+8 归一到 ISO UTC', () => {
    // 23:31:52 +08:00 == 15:31:52Z（evidence §7 决策 1）
    expect(normalizeLocalStringUtc8('8/17/2026, 11:31:52 PM')).toBe('2026-08-17T15:31:52.000Z');
    // 12 AM → 00:00 本地 → 前一日 16:00Z
    expect(normalizeLocalStringUtc8('8/17/2026, 12:00:00 AM')).toBe('2026-08-16T16:00:00.000Z');
    // 12 PM → 12:00 本地 → 04:00Z
    expect(normalizeLocalStringUtc8('8/17/2026, 12:00:00 PM')).toBe('2026-08-17T04:00:00.000Z');
    expect(normalizeLocalStringUtc8('not a date')).toBeNull();
    expect(normalizeLocalStringUtc8(123)).toBeNull();
  });

  it('normalizeTeamRunStatus 闭合映射', () => {
    expect(normalizeTeamRunStatus('running')).toBe('running');
    expect(normalizeTeamRunStatus('in_progress')).toBe('running');
    expect(normalizeTeamRunStatus('completed')).toBe('success');
    expect(normalizeTeamRunStatus('failed')).toBe('error');
    expect(normalizeTeamRunStatus('weird-value')).toBe('unknown');
  });

  it('redactLocator 用 ~ 替换 home 前缀，非 home 路径原样', () => {
    expect(redactLocator(join(homedir(), 'x', 'y'))).toBe('~/x/y');
    expect(redactLocator('/not/home/x')).toBe('/not/home/x');
  });

  it('goalFingerprintOf 脱敏归一化 + 空值 null', () => {
    const f = goalFingerprintOf('  Hello   WORLD ');
    expect(f).toBe(goalFingerprintOf('hello world'));
    expect(f).toHaveLength(24);
    expect(goalFingerprintOf('')).toBeNull();
    expect(goalFingerprintOf(null)).toBeNull();
  });

  it('codeArtsTeamCapabilities 能力基线：communication/verification 恒 unavailable', () => {
    const caps = codeArtsTeamCapabilities();
    expect(caps.topology).toBe('complete');
    expect(caps.cost).toBe('complete');
    expect(caps.communication).toBe('unavailable');
    expect(caps.verification).toBe('unavailable');
  });
});

describe('§4.3–§4.7 parseCodeArtsTeam', () => {
  it('minimal：run=leader sessionID native，agent/edge/task/dependency/assignment 完整', () => {
    const r = parseCodeArtsTeam(raw());

    expect(r.run.runId).toBe(canonicalRunId('codearts', LEADER));
    expect(r.run.nativeRunId).toBe(LEADER);
    expect(r.run.runIdentityConfidence).toBe('native');
    expect(r.run.provider).toBe('codearts');

    // agents：leader + mate
    expect(r.agents).toHaveLength(2);
    const leader = r.agents.find((a) => a.nativeId === LEADER)!;
    const mate = r.agents.find((a) => a.nativeId === MATE)!;
    expect(leader.roleClass).toBe('leader');
    expect(leader.role).toBe('team-leader');
    expect(leader.model).toBe('deepseek/deepseek-v4-pro');
    expect(mate.roleClass).toBe('teammate');

    // edges：leader→mate（native supervises）
    expect(r.agentEdges).toHaveLength(1);
    expect(r.agentEdges[0]!.fromAgentId).toBe(leader.id);
    expect(r.agentEdges[0]!.toAgentId).toBe(mate.id);
    expect(r.agentEdges[0]!.kind).toBe('supervises');
    expect(r.agentEdges[0]!.confidence).toBe('native');

    // tasks + dependency（blocked_by [1]）
    expect(r.tasks).toHaveLength(2);
    expect(r.taskDependencies).toHaveLength(1);
    const dep = r.taskDependencies[0]!;
    expect(dep.upstreamTaskId).toBe(r.tasks.find((t) => t.nativeId === '1')!.id);
    expect(dep.downstreamTaskId).toBe(r.tasks.find((t) => t.nativeId === '2')!.id);

    // assignment：task 1 owner=MATE → assigned
    expect(r.assignments).toHaveLength(1);
    expect(r.assignments[0]!.agentId).toBe(mate.id);
    expect(r.assignments[0]!.assignmentKind).toBe('assigned');

    // status 归一化：in_progress → running；pending → pending（不伪造 success）
    expect(r.tasks.find((t) => t.nativeId === '1')!.status).toBe('running');
    expect(r.tasks.find((t) => t.nativeId === '2')!.status).toBe('pending');
  });

  it('parallel-task：多任务无依赖，dependencies 为空', () => {
    const r = parseCodeArtsTeam(
      raw({
        teamTask: [
          { id: 1, blocked_by: [], content: 'A', status: 'pending' },
          { id: 2, blocked_by: [], content: 'B', status: 'pending' },
          { id: 3, blocked_by: [], content: 'C', status: 'pending' },
        ],
      }),
    );
    expect(r.tasks).toHaveLength(3);
    expect(r.taskDependencies).toHaveLength(0);
  });

  it('failure/replacement：agent 状态归一化为 failed/replaced，run status=error', () => {
    const r = parseCodeArtsTeam(
      raw({
        contact: {
          'team-leader': {
            sessionID: LEADER,
            agent_type: 'team-leader',
            status: 'failed',
            startedAt: '2026-08-17T15:27:54.292Z',
          },
          'member-1': {
            sessionID: MATE,
            parentSessionID: LEADER,
            agent_type: 'team-mate',
            status: 'replaced',
            startedAt: '2026-08-17T15:31:52.004Z',
          },
        },
        teamTask: [{ id: 1, blocked_by: [], content: 'A', status: 'failed' }],
      }),
    );
    expect(r.run.status).toBe('error');
    expect(r.agents.find((a) => a.nativeId === MATE)!.state).toBe('replaced');
    expect(r.tasks[0]!.status).toBe('failed');
  });

  it('incomplete：缺 model/时间戳 → null，不伪造', () => {
    const r = parseCodeArtsTeam(
      raw({
        contact: {
          'team-leader': { sessionID: LEADER, agent_type: 'team-leader' },
          'member-1': { sessionID: MATE, parentSessionID: LEADER, agent_type: 'team-mate' },
        },
        teamTask: [{ id: 1, blocked_by: [], content: 'A', status: 'pending' }],
      }),
    );
    const leader = r.agents.find((a) => a.nativeId === LEADER)!;
    expect(leader.model).toBeNull();
    expect(leader.createdAt).toBeNull();
    expect(r.run.startedAt).toBeNull();
  });

  it('token/cost（step-finish）：native USD，tokenAvailable/costAvailable=true', () => {
    const r = parseCodeArtsTeam(
      raw({
        messages: [{ id: 'msg1', session_id: LEADER, time_created: 1786980474319, data: {} }],
        parts: [
          {
            id: 'part_step_1',
            message_id: 'msg1',
            session_id: LEADER,
            data: {
              type: 'step-finish',
              tokens: { total: 100, input: 90, output: 10, reasoning: 5, cache: { read: 0, write: 0 } },
              cost: 0.013163535,
            },
          },
        ],
      }),
    );
    expect(r.run.tokenAvailable).toBe(true);
    expect(r.run.costAvailable).toBe(true);
    expect(r.run.costCurrency).toBe('USD');
    const round = r.activities.find((a) => a.kind === 'round')!;
    expect(round.tokenUsage?.total).toBe(100);
    expect(round.costUsd).toBeCloseTo(0.013163535);
    expect(round.costSource).toBe('reported');
    expect(round.costCurrency).toBe('USD');
  });

  it('tool_call activity：kind=tool_call，hasInput/hasOutput 按 state 判定', () => {
    const r = parseCodeArtsTeam(
      raw({
        messages: [{ id: 'msg1', session_id: LEADER, time_created: 1786980474319, data: {} }],
        parts: [
          {
            id: 'part_tool_1',
            message_id: 'msg1',
            session_id: LEADER,
            data: { type: 'tool', tool: 'get-team-setup', state: { status: 'completed', input: { scene: 'coding' } } },
          },
        ],
      }),
    );
    const tool = r.activities.find((a) => a.kind === 'tool_call')!;
    expect(tool.hasInput).toBe(true);
    expect(tool.hasOutput).toBe(false); // 无 output → false，不伪造
    expect(tool.orderConfidence).toBe('native');
  });

  it('get-my-task 的显式 claimed 状态及 owner 才建立 claimed 快照', () => {
    const r = parseCodeArtsTeam(
      raw({
        parts: [
          {
            id: 'part_claim',
            message_id: 'msg1',
            session_id: MATE,
            data: {
              type: 'tool',
              tool: 'get-my-task',
              state: { output: 'You have 1 tasks.\n[ { "id": 1, "content": "x", "owner": "ses_mate_0001", "status": "claimed" } ]' },
            },
          },
        ],
      }),
    );
    expect(r.assignments[0]!.assignmentKind).toBe('claimed');
  });

  it('multi-level：拓扑只来自 normalized edges，不按 provider 名假设深度（§4.11）', () => {
    const r = parseCodeArtsTeam(
      raw({
        contact: {
          'team-leader': { sessionID: LEADER, agent_type: 'team-leader' },
          'member-1': { sessionID: MATE, parentSessionID: LEADER, agent_type: 'team-mate' },
          'member-2': { sessionID: 'ses_mate_0002', parentSessionID: MATE, agent_type: 'team-mate' },
        },
        teamTask: [{ id: 1, blocked_by: [], content: 'A', status: 'pending' }],
      }),
    );
    // A(leader)→B(mate)→C(mate) 两条边；深度是数据决定的，不是 codearts 名称决定的
    expect(r.agentEdges).toHaveLength(2);
    const parents = new Set(r.agentEdges.map((e) => e.fromAgentId));
    expect(parents.size).toBe(2); // leader + mate 都是父
  });

  it('contradictory-parent：parentSessionID 指向自身或不存在 agent → 跳过，不伪造边', () => {
    const selfRef = parseCodeArtsTeam(
      raw({
        contact: {
          'team-leader': { sessionID: LEADER, agent_type: 'team-leader' },
          'member-1': { sessionID: MATE, parentSessionID: MATE, agent_type: 'team-mate' },
        },
        teamTask: [{ id: 1, blocked_by: [], content: 'A', status: 'pending' }],
      }),
    );
    expect(selfRef.agentEdges).toHaveLength(0);

    const dangling = parseCodeArtsTeam(
      raw({
        contact: {
          'team-leader': { sessionID: LEADER, agent_type: 'team-leader' },
          'member-1': { sessionID: MATE, parentSessionID: 'ses_ghost', agent_type: 'team-mate' },
        },
        teamTask: [{ id: 1, blocked_by: [], content: 'A', status: 'pending' }],
      }),
    );
    expect(dangling.agentEdges).toHaveLength(0);
  });

  it('malformed：blocked_by 引用缺失 task / owner 引用缺失 agent → 跳过，邻居存活（§4.14）', () => {
    const r = parseCodeArtsTeam(
      raw({
        teamTask: [
          { id: 1, blocked_by: [], content: 'A', status: 'pending', owner: MATE },
          { id: 2, blocked_by: [999], content: 'B', status: 'pending', owner: 'ses_ghost' },
          { id: 3, blocked_by: [1], content: 'C', status: 'pending' },
        ],
      }),
    );
    // 3 个 task 都存活
    expect(r.tasks).toHaveLength(3);
    // 依赖：只有 3←1 成立；2←999 被跳过
    expect(r.taskDependencies).toHaveLength(1);
    // assignment：只有 task1→MATE 成立；task2→ghost 被跳过
    expect(r.assignments).toHaveLength(1);
  });

  it('无 team-leader 且无根 session → throw（无稳定 run 身份）', () => {
    expect(() =>
      parseCodeArtsTeam(
        raw({
          contact: {
            'member-1': { sessionID: MATE, parentSessionID: LEADER, agent_type: 'team-mate' },
          },
        }),
      ),
    ).toThrow(/无稳定 run 身份/);
  });

  it('无 team-leader 但 sessions 有根（claw 辅助）→ 从根 session 取 run 身份', () => {
    const r = parseCodeArtsTeam(
      raw({
        contact: {
          'member-1': { sessionID: MATE, parentSessionID: LEADER, agent_type: 'team-mate' },
        },
        sessions: [
          { id: LEADER, parent_id: null, title: '团队任务', time_created: 1786980474008 },
          { id: MATE, parent_id: LEADER, title: '子任务', time_created: 1786980711999 },
        ],
        cagSessionExtra: [{ session_id: LEADER, type: 'claw' }],
      }),
    );
    expect(r.run.nativeRunId).toBe(LEADER);
    expect(r.run.title).toBe('团队任务');
  });

  it('canonical id 稳定：相同 raw 两次 parse 产出相同实体 id（§4.2）', () => {
    const a = parseCodeArtsTeam(raw());
    const b = parseCodeArtsTeam(raw());
    expect(a.run.runId).toBe(b.run.runId);
    expect(a.agents.map((x) => x.id)).toEqual(b.agents.map((x) => x.id));
    expect(a.tasks.map((x) => x.id)).toEqual(b.tasks.map((x) => x.id));
    expect(a.agentEdges.map((x) => x.id)).toEqual(b.agentEdges.map((x) => x.id));
  });

  it('跨 run 分离：不同 leader sessionID → 不同 runId/agent id', () => {
    const a = parseCodeArtsTeam(raw());
    const b = parseCodeArtsTeam(
      raw({
        contact: {
          'team-leader': { sessionID: 'ses_lead_9999', agent_type: 'team-leader' },
          'member-1': { sessionID: 'ses_mate_9999', parentSessionID: 'ses_lead_9999', agent_type: 'team-mate' },
        },
      }),
    );
    expect(a.run.runId).not.toBe(b.run.runId);
    expect(a.agents[0]!.id).not.toBe(b.agents[0]!.id);
  });
});

describe('§4.13 负向断言：不伪造事实', () => {
  it('不伪造 parent：无 parentSessionID 的 member 不产生边', () => {
    const r = parseCodeArtsTeam(
      raw({
        contact: {
          'team-leader': { sessionID: LEADER, agent_type: 'team-leader' },
          'member-1': { sessionID: MATE, agent_type: 'team-mate' }, // 无 parentSessionID
        },
        teamTask: [{ id: 1, blocked_by: [], content: 'A', status: 'pending' }],
      }),
    );
    expect(r.agentEdges).toHaveLength(0);
  });

  it('不伪造 message：communications 恒空，completeness.communication=unavailable', () => {
    const r = parseCodeArtsTeam(raw());
    expect(r.communications).toHaveLength(0);
    expect(r.completeness.communication).toBe('unavailable');
  });

  it('不伪造 task success：pending 保持 pending', () => {
    const r = parseCodeArtsTeam(raw());
    expect(r.tasks.find((t) => t.nativeId === '2')!.status).toBe('pending');
  });

  it('不伪造 timing：缺时间戳字段 → null 而非估算', () => {
    const r = parseCodeArtsTeam(
      raw({
        teamTask: [{ id: 1, blocked_by: [], content: 'A', status: 'pending' }],
      }),
    );
    expect(r.tasks[0]!.createdAt).toBeNull();
    expect(r.tasks[0]!.startedAt).toBeNull();
  });

  it('不伪造 output：resultAvailable=false，无 artifact 清单', () => {
    const r = parseCodeArtsTeam(raw());
    expect(r.tasks.every((t) => !t.resultAvailable)).toBe(true);
    expect(r.artifacts).toHaveLength(0);
  });

  it('不伪造 verification：completeness.verification=unavailable', () => {
    const r = parseCodeArtsTeam(raw());
    expect(r.completeness.verification).toBe('unavailable');
  });

  it('不伪造 token/cost：无 step-finish part → tokenAvailable/costAvailable=false', () => {
    const r = parseCodeArtsTeam(raw());
    expect(r.run.tokenAvailable).toBe(false);
    expect(r.run.costAvailable).toBe(false);
    expect(r.run.costCurrency).toBeNull();
  });

  it('不伪造 outputSummary/正文：活动绝不携带正文字段', () => {
    const r = parseCodeArtsTeam(
      raw({
        parts: [
          {
            id: 'p1',
            message_id: 'msg1',
            session_id: LEADER,
            data: { type: 'tool', tool: 'get-team-setup', state: { output: '<redacted: proprietary template>' } },
          },
        ],
      }),
    );
    const tool = r.activities.find((a) => a.kind === 'tool_call')!;
    // hasOutput 只反映「是否存在」；不含 output 正文（TeamActivitySlim 无正文字段）
    expect(tool.hasOutput).toBe(true);
    expect('outputSummary' in tool).toBe(false);
    expect('raw' in tool).toBe(false);
  });
});


describe('retained real control shapes: run isolation and honest replay', () => {
  const part = (id: string, tool: string, session: string, args: unknown, output: string) => ({ id, session_id: session, message_id: 'message-'+id,
    data: { type: 'tool', tool, callID: 'call-'+id, state: { status: 'completed', input: args, output } } });
  it('same whole-db input cannot contaminate two runs, including token/cost and claim evidence', () => {
    const parts = [part('a','finish-task',MATE,{id:1},'You have finished task(id=1, content=A). Contact has been automatically updated and task publisher has been noticed'),
      part('b','get-my-task','other-mate',{},'[ {"id":1,"owner":"other-mate","status":"claimed"} ]'),
      {id:'other-cost',session_id:'other-mate',message_id:'other-msg',data:{type:'step-finish',tokens:{input:999},cost:99}}];
    const first = parseCodeArtsTeam(raw({parts}));
    const second = parseCodeArtsTeam(raw({contact:{leader:{sessionID:'other-root',agent_type:'team-leader'},mate:{sessionID:'other-mate',parentSessionID:'other-root'}},parts}));
    expect(first.activities.every(event => event.agentId !== null)).toBe(true);
    expect(first.run.tokenAvailable).toBe(false);
    expect(first.run.costAvailable).toBe(false);
    expect(first.assignments[0]!.assignmentKind).toBe('assigned');
    const firstEvidence=new Set(first.activities.flatMap(event=>event.evidenceIds).map(id=>first.evidence.find(ref=>ref.id===id)!.nativeId));
    const secondEvidence=second.activities.flatMap(event=>event.evidenceIds).map(id=>second.evidence.find(ref=>ref.id===id)!.nativeId);
    expect(secondEvidence.some(id=>firstEvidence.has(id))).toBe(false);
    expect(first.activities.find(event=>event.kind==='task_status')!.taskId).toBe(first.tasks[0]!.id);
  });
  it('retains task references, finish report and undefined-target send attempts without inventing delivery or results', () => {
    const parts=[part('assign','background-task',LEADER,{assign_task_id:[1,2]},'Background task launched.'),
      part('finish','finish-task',MATE,{id:1},'You have finished task(id=1, content=A). Contact has been automatically updated and task publisher has been noticed'),
      part('message','send-message',MATE,{message:'review done'},'message has been sent to {undefined session id}, session ID: undefined'),
      part('read','read',MATE,{filePath:'x'},'ok'),
      part('claim','claim-task',MATE,{id:1},'The task has already been assigned to you. You can start working on it.')];
    const result=parseCodeArtsTeam(raw({parts}));
    expect(result.activities.filter(event=>event.kind==='task_assignment')).toHaveLength(2);
    expect(result.activities.filter(event=>event.kind==='tool_call').every(event=>event.taskId===null)).toBe(true);
    expect(result.activities.find(event=>event.id.includes('claim:control'))!.kind).toBe('tool_result');
    expect(result.activities.find(event=>event.kind==='unknown')!.messageId).toBeNull();
    expect(result.communications).toEqual([]);
    expect(result.tasks[0]!.resultAvailable).toBe(false);
    expect(result.tasks[0]!.completedAt).toBeNull();
    expect(result.activities.every(event=>event.eventId===null)).toBe(true);
    expect(result.activityBodies!.some(body=>body.result_body?.includes('completed_reported'))).toBe(true);
    expect(result.activityBodies!.some(body=>body.result_body?.includes('unconfirmed'))).toBe(true);
    expect(JSON.stringify(result.activities)).not.toContain('review done');
  });
  it('reading get-my-task is not a claim and arbitrary nested IDs are ignored',()=>{
    const result=parseCodeArtsTeam(raw({parts:[part('readtasks','get-my-task',MATE,{},'[{"id":1,"owner":"ses_mate_0001","metadata":{"id":2}}]')]}));
    expect(result.assignments[0]!.assignmentKind).toBe('assigned');
  });
  it('republishing a known task is not a second creation event',()=>{
    const result=parseCodeArtsTeam(raw({parts:[part('publish1','publish-task',LEADER,{todos:[{id:1}]},'ok'),part('publish2','publish-task',LEADER,{todos:[{id:1}]},'ok')]}));
    expect(result.activities.filter(event=>event.kind==='task_created')).toHaveLength(1);
    expect(result.activities.filter(event=>event.kind==='tool_result')).toHaveLength(1);
  });

});
