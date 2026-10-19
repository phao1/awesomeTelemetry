import { describe, expect, it } from 'vitest';

import {
  parseCodexTeam,
  codexTeamCapabilities,
  type CodexThreadFile,
} from './team-codex.js';
import { canonicalRunId } from './team-codearts.js';

// ══════════════════════════════════════════════════════════════════════════
// fixtures（§4.12）：Codex 三种代际线程形状 + 活动。
// ══════════════════════════════════════════════════════════════════════════

const ROOT = '01a00001-0000-0000-0000-000000000000';
const SUB1 = '01a00002-0000-0000-0000-000000000000';
const SUB2 = '01a00003-0000-0000-0000-000000000000';

function file(threadId: string, rows: unknown[]): CodexThreadFile {
  return { sourcePath: `/tmp/${threadId}.jsonl`, rows };
}

function rootMeta(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    timestamp: '2026-08-16T07:27:48.000Z',
    type: 'session_meta',
    payload: {
      session_id: ROOT,
      id: ROOT,
      timestamp: '2026-08-16T07:27:48.000Z',
      source: 'vscode',
      thread_source: 'user',
      model_provider: 'openai',
      ...overrides,
    },
  };
}

function subMeta(
  threadId: string,
  opts: { forkedFrom?: string; nickname?: string; depth?: number; noParent?: boolean } = {},
): Record<string, unknown> {
  const parent = opts.forkedFrom ?? ROOT;
  const payload: Record<string, unknown> = {
    session_id: ROOT,
    id: threadId,
    forked_from_id: parent,
    parent_thread_id: parent,
    timestamp: '2026-08-16T07:29:13.000Z',
    source: {
      subagent: {
        thread_spawn: {
          parent_thread_id: parent,
          depth: opts.depth ?? 1,
          agent_path: `/root/${threadId}`,
          agent_nickname: opts.nickname ?? 'Euclid',
          agent_role: null,
        },
      },
      thread_source: 'subagent',
      agent_nickname: opts.nickname ?? 'Euclid',
      agent_path: `/root/${threadId}`,
      model_provider: 'openai',
    },
  };
  if (opts.noParent === true) {
    // 08-07/08 代际真实形状：thread_source=subagent 仅此一项，无 forked_from_id /
    // parent_thread_id / source.subagent.thread_spawn（evidence §2.4）。
    return {
      timestamp: '2026-08-16T07:29:13.000Z',
      type: 'session_meta',
      payload: {
        session_id: ROOT,
        id: threadId,
        timestamp: '2026-08-16T07:29:13.000Z',
        source: {
          thread_source: 'subagent',
          agent_nickname: opts.nickname ?? 'Euclid',
          agent_path: `/root/${threadId}`,
          model_provider: 'openai',
        },
      },
    };
  }
  return { timestamp: '2026-08-16T07:29:13.000Z', type: 'session_meta', payload };
}

function activityRow(
  kind: string,
  agentThreadId: string,
  eventId: string,
  occurredAtMs: number,
): Record<string, unknown> {
  return {
    timestamp: '2026-08-16T07:29:13.000Z',
    type: 'event_msg',
    payload: {
      type: 'sub_agent_activity',
      event_id: eventId,
      occurred_at_ms: occurredAtMs,
      agent_thread_id: agentThreadId,
      agent_path: '/root/x',
      kind,
    },
  };
}

describe('§4.8–§4.10 parseCodexTeam', () => {
  it('minimal：run=根线程 id correlated，root→subagent native 边', () => {
    const r = parseCodexTeam(
      [file(ROOT, [rootMeta()]), file(SUB1, [subMeta(SUB1)])],
      '~/.codex/sessions',
    );

    expect(r.run.runId).toBe(canonicalRunId('codex', ROOT));
    expect(r.run.nativeRunId).toBe(ROOT);
    expect(r.run.runIdentityConfidence).toBe('correlated');
    expect(r.run.provider).toBe('codex');

    expect(r.agents).toHaveLength(2);
    const leader = r.agents.find((a) => a.nativeId === ROOT)!;
    const sub = r.agents.find((a) => a.nativeId === SUB1)!;
    expect(leader.roleClass).toBe('leader');
    expect(sub.roleClass).toBe('subagent');
    expect(sub.displayName).toBe('Euclid');

    expect(r.agentEdges).toHaveLength(1);
    expect(r.agentEdges[0]!.fromAgentId).toBe(leader.id);
    expect(r.agentEdges[0]!.toAgentId).toBe(sub.id);
    expect(r.agentEdges[0]!.kind).toBe('supervises');
    expect(r.agentEdges[0]!.confidence).toBe('native');
  });

  it('multi-level：root + 2 并行 subagent，深度来自 edges 非 provider 名（§4.11）', () => {
    const r = parseCodexTeam(
      [
        file(ROOT, [rootMeta()]),
        file(SUB1, [subMeta(SUB1, { nickname: 'Euclid' })]),
        file(SUB2, [subMeta(SUB2, { nickname: 'Gauss' })]),
      ],
      '~/.codex/sessions',
    );
    expect(r.agents).toHaveLength(3);
    expect(r.agentEdges).toHaveLength(2);
    // 两个 subagent 的父都是 root → two_level（数据决定，非 codex 名称假设）
    expect(r.agentEdges.every((e) => e.confidence === 'native')).toBe(true);
  });

  it('老代际无父链接：sub_agent_activity 关联父 → correlated 边（G12.5）', () => {
    // 父文件里有 sub_agent_activity 指向 SUB1；子文件无 forked_from_id/parent_thread_id
    const r = parseCodexTeam(
      [
        file(ROOT, [rootMeta(), activityRow('started', SUB1, 'call_start_1', 1786865345593)]),
        file(SUB1, [subMeta(SUB1, { noParent: true })]),
      ],
      '~/.codex/sessions',
    );
    expect(r.agentEdges).toHaveLength(1);
    expect(r.agentEdges[0]!.confidence).toBe('correlated');
  });

  it('无父链接且无 sub_agent_activity → topology 降级（无边，不伪造 parent）', () => {
    const r = parseCodexTeam(
      [file(ROOT, [rootMeta()]), file(SUB1, [subMeta(SUB1, { noParent: true })])],
      '~/.codex/sessions',
    );
    expect(r.agentEdges).toHaveLength(0);
  });

  it('activities：sub_agent_activity → agent_lifecycle；task_started/complete → round', () => {
    const r = parseCodexTeam(
      [
        file(ROOT, [
          rootMeta(),
          activityRow('started', SUB1, 'call_start_1', 1786865345593),
          {
            timestamp: '2026-08-16T07:27:50.000Z',
            type: 'event_msg',
            payload: { type: 'task_started', turn_id: 'turn-1', started_at: 1786865270 },
          },
          {
            timestamp: '2026-08-16T07:43:11.000Z',
            type: 'event_msg',
            payload: {
              type: 'task_complete',
              turn_id: 'turn-1',
              started_at: 1786865270,
              completed_at: 1786866191,
              duration_ms: 921514,
            },
          },
        ]),
        file(SUB1, [subMeta(SUB1)]),
      ],
      '~/.codex/sessions',
    );
    const lifecycle = r.activities.find((a) => a.kind === 'agent_lifecycle')!;
    expect(lifecycle.status).toBe('running'); // kind=started
    expect(lifecycle.agentId).toBe(r.agents.find((x) => x.nativeId === SUB1)!.id);

    const complete = r.activities.find((a) => a.kind === 'round' && a.status === 'success')!;
    expect(complete.turnKey).toBe('turn-1');
    expect(complete.hasOutput).toBe(true);
    expect(complete.orderConfidence).toBe('ambiguous'); // 跨线程/跨时钟无共享序列
  });

  it('token_count：native tokenUsage，cost 恒 unavailable（G12.3）', () => {
    const r = parseCodexTeam(
      [
        file(ROOT, [
          rootMeta(),
          {
            timestamp: '2026-08-16T07:31:05.000Z',
            type: 'event_msg',
            payload: {
              type: 'token_count',
              info: {
                total_token_usage: {
                  input_tokens: 21027,
                  cached_input_tokens: 11008,
                  cache_write_input_tokens: 0,
                  output_tokens: 334,
                  reasoning_output_tokens: 130,
                  total_tokens: 21361,
                },
                last_token_usage: {
                  input_tokens: 21027,
                  cached_input_tokens: 11008,
                  cache_write_input_tokens: 0,
                  output_tokens: 334,
                  reasoning_output_tokens: 130,
                  total_tokens: 21361,
                },
              },
              rate_limits: { credits: { balance: '0' } },
            },
          },
        ]),
        file(SUB1, [subMeta(SUB1)]),
      ],
      '~/.codex/sessions',
    );
    expect(r.run.tokenAvailable).toBe(true);
    const tokenActivity = r.activities.find((a) => a.tokenUsage !== null)!;
    expect(tokenActivity.tokenUsage!.total).toBe(21361);
    expect(tokenActivity.tokenUsage!.netInput).toBe(21027 - 11008);
    // cost 不可观测：即使 rate_limits.credits.balance="0" 也不伪造 $0.0000
    expect(r.run.costAvailable).toBe(false);
    expect(r.run.costCurrency).toBeNull();
    expect(tokenActivity.costUsd).toBeNull();
  });

  it('无 session_meta 线程 → throw（无稳定 run 身份）', () => {
    expect(() =>
      parseCodexTeam(
        [file(ROOT, [{ timestamp: 'x', type: 'event_msg', payload: { type: 'foo' } }])],
        '~/.codex/sessions',
      ),
    ).toThrow(/无稳定 run 身份/);
  });

  it('sessionKey 关联（§4.10）：resolveSessionKey 回填 sessionKeys，不复制不重编号', () => {
    const r = parseCodexTeam(
      [file(ROOT, [rootMeta()]), file(SUB1, [subMeta(SUB1)])],
      '~/.codex/sessions',
      (id) => `codex-${id.slice(0, 8)}`,
    );
    const sub = r.agents.find((a) => a.nativeId === SUB1)!;
    expect(sub.sessionKeys).toEqual([`codex-${SUB1.slice(0, 8)}`]);
  });

  it('canonical id 稳定 + 跨 run 分离（§4.2）', () => {
    const a = parseCodexTeam([file(ROOT, [rootMeta()]), file(SUB1, [subMeta(SUB1)])], '~/.codex/sessions');
    const b = parseCodexTeam([file(ROOT, [rootMeta()]), file(SUB1, [subMeta(SUB1)])], '~/.codex/sessions');
    expect(a.run.runId).toBe(b.run.runId);
    expect(a.agents.map((x) => x.id)).toEqual(b.agents.map((x) => x.id));

    const other = parseCodexTeam([file('01a00009-0000-0000-0000-000000000000', [rootMeta({ id: '01a00009-0000-0000-0000-000000000000', session_id: '01a00009-0000-0000-0000-000000000000' })])], '~/.codex/sessions');
    expect(other.run.runId).not.toBe(a.run.runId);
  });
});

describe('§4.13 Codex 负向断言', () => {
  it('不伪造 message：communications 恒空，completeness.communication=unavailable', () => {
    const r = parseCodexTeam(
      [
        file(ROOT, [
          rootMeta(),
          // agent_message 存在但无 recipient → 不得当通信
          { timestamp: 'x', type: 'event_msg', payload: { type: 'agent_message', message: 'commentary', phase: 'commentary' } },
        ]),
        file(SUB1, [subMeta(SUB1)]),
      ],
      '~/.codex/sessions',
    );
    expect(r.communications).toHaveLength(0);
    expect(r.completeness.communication).toBe('unavailable');
  });

  it('不伪造 task：tasks/taskDependencies 恒空（Codex 无跨 agent Task DAG）', () => {
    const r = parseCodexTeam(
      [
        file(ROOT, [
          rootMeta(),
          { timestamp: 'x', type: 'event_msg', payload: { type: 'task_started', turn_id: 't1', started_at: 1 } },
        ]),
        file(SUB1, [subMeta(SUB1)]),
      ],
      '~/.codex/sessions',
    );
    expect(r.tasks).toHaveLength(0);
    expect(r.taskDependencies).toHaveLength(0);
    expect(r.assignments).toHaveLength(0);
  });

  it('不伪造 cost：costAvailable=false，costCurrency=null（禁止 $0.0000）', () => {
    const r = parseCodexTeam([file(ROOT, [rootMeta()]), file(SUB1, [subMeta(SUB1)])], '~/.codex/sessions');
    expect(r.run.costAvailable).toBe(false);
    expect(r.run.costCurrency).toBeNull();
  });

  it('不伪造 verification：completeness.verification=unavailable', () => {
    const r = parseCodexTeam([file(ROOT, [rootMeta()]), file(SUB1, [subMeta(SUB1)])], '~/.codex/sessions');
    expect(r.completeness.verification).toBe('unavailable');
  });

  it('codexTeamCapabilities：cost/communication 恒 unavailable', () => {
    const caps = codexTeamCapabilities();
    expect(caps.cost).toBe('unavailable');
    expect(caps.communication).toBe('unavailable');
    expect(caps.tokens).toBe('complete');
  });
});

describe('§4.14 Codex malformed 记录', () => {
  it('坏行（非对象/缺 type）被跳过，有效邻居存活', () => {
    const r = parseCodexTeam(
      [
        file(ROOT, [rootMeta(), 'not-an-object', null, 42, activityRow('started', SUB1, 'e1', 1)]),
        file(SUB1, [subMeta(SUB1)]),
      ],
      '~/.codex/sessions',
    );
    expect(r.agents).toHaveLength(2);
    expect(r.agentEdges).toHaveLength(1);
    // 坏行不产出活动
    expect(r.activities).toHaveLength(1);
  });

  it('重复 session_meta 幂等：取首个为身份锚点，后续不重复建 agent', () => {
    const r = parseCodexTeam(
      [file(ROOT, [rootMeta(), rootMeta(), rootMeta()]), file(SUB1, [subMeta(SUB1)])],
      '~/.codex/sessions',
    );
    expect(r.agents).toHaveLength(2);
  });
});
