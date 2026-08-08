import { describe, expect, it } from 'vitest';

import { normalizeTraeSample, type TraeRecordShape, type TraeTurn } from './trae.js';
import { traeFixture } from './__fixtures__/trae.js';

const SRC = '/tmp/trae.db';

function sample(turns: TraeTurn[]) {
  return { sourceAgent: 'Trae', session: traeFixture.session, events: turns };
}

describe('Trae adapter（REQ-006）', () => {
  it('fixture 完整 TraceRecord 快照', () => {
    const r = normalizeTraeSample(sample(traeFixture.events), SRC);
    expect(r.session.provider).toBe('trae');
    expect(r.session.sourceAgent).toBe('Trae');
    expect(r.session.id).toBe('trae-s1');
    expect(r.session.eventCount).toBe(4);
    expect(r.events.map((e) => e.status)).toEqual(['success', 'success', 'success', 'running']);
    expect(r.events.map((e) => e.phase)).toEqual(['understand', 'understand', 'implement', 'verify']);
    // #2/#3：token_usage 200 是真实总 token，item_token_usage 120 是 output，
    // input = 200 - 120 = 80（不再 /2）
    expect(r.events[2]?.tokens?.output).toBe(120);
    expect(r.events[2]?.tokens?.input).toBe(80);
    expect(r.session.tokenUsage.output).toBe(120);
    expect(r.session.tokenUsage.input).toBe(80);
    expect(r.session.tokenUsage.total).toBe(200);
    expect(r.events[2]?.startedAt).toBe(new Date(1754000030 * 1000).toISOString());
  });

  it('#2/#3 itemTokenUsage 缺失时退化为 output = tokenUsage（不再 /2）', () => {
    const turns: TraeTurn[] = [
      { id: 't1', type: 'llm', contentSource: 'llm_default', tokenUsage: 200, startTime: 1754000000 },
    ];
    const r = normalizeTraeSample(sample(turns), SRC);
    expect(r.events[0]?.tokens?.output).toBe(200);
    expect(r.events[0]?.tokens?.input).toBe(0);
    expect(r.session.tokenUsage.total).toBe(200);
  });

  it('非 llm_default 行的 token_usage 是 message size，跳过', () => {
    const turns: TraeTurn[] = [
      { id: 't1', type: 'bash', contentSource: 'tool', tokenUsage: 999, startTime: 1754000000 },
    ];
    const r = normalizeTraeSample(sample(turns), SRC);
    expect(r.events[0]?.tokens).toBeNull();
    expect(r.session.tokenUsage.output).toBe(0);
  });

  it('状态归一化四类映射', () => {
    const turns: TraeTurn[] = ['completed', 'failed', 'paused', 'canceled'].map((status, i) => ({
      id: `t${i}`, type: 'llm', status, startTime: 1754000000 + i,
    }));
    const r = normalizeTraeSample(sample(turns), SRC);
    expect(r.events.map((e) => e.status)).toEqual(['success', 'error', 'running', 'cancelled']);
  });

  it('重复 event id 追加 :sequence 后缀', () => {
    const turns: TraeTurn[] = [
      { id: 'dup', type: 'llm', startTime: 1754000000 },
      { id: 'dup', type: 'llm', startTime: 1754000001 },
    ];
    const r = normalizeTraeSample(sample(turns), SRC);
    expect(r.events.map((e) => e.id)).toEqual(['dup', 'dup:2']);
  });

  it('title 截断到 200 字符', () => {
    const turns: TraeTurn[] = [{ id: 't1', type: 'llm', content: 'c'.repeat(250), startTime: 1754000000 }];
    const r = normalizeTraeSample(sample(turns), SRC);
    expect(r.events[0]?.title.length).toBe(200);
  });

  it('raw 与正文分离返回', () => {
    const r = normalizeTraeSample(sample(traeFixture.events), SRC);
    expect((r.events[0] as unknown as { raw?: string }).raw).toContain('"type"');
    expect(r.events[0]?.title).not.toContain('"type"');
  });

  it('user turn 映射到 inputSummary，不伪装成 assistant output', () => {
    const turns: TraeTurn[] = [
      { id: 'u1', type: 'user', content: '新的消息', startTime: 1754000000 },
    ];
    const r = normalizeTraeSample(sample(turns), SRC);
    expect(r.events[0]).toMatchObject({
      kind: 'user_prompt',
      actor: 'user',
      title: '新的消息',
      hasInput: true,
      hasOutput: false,
      inputSummary: '新的消息',
      outputSummary: null,
    });
  });

  it('§5.1 toolName 二级映射：PascalCase 工具名按小写归一化分类，type 优先', () => {
    const turns: TraeTurn[] = [
      { id: 't1', type: 'tool', toolName: 'SearchReplace', startTime: 1754000000 },
      { id: 't2', type: 'tool', toolName: 'Terminal', startTime: 1754000001 },
      { id: 't3', type: 'tool', toolName: 'Grep', startTime: 1754000002 },
      { id: 't4', type: 'tool', toolName: 'UnknownThing', startTime: 1754000003 },
      // type 优先级高于 toolName：type='read_file' 时即使 toolName 像 bash 也归 file_read
      { id: 't5', type: 'read_file', toolName: 'Bash', startTime: 1754000004 },
    ];
    const r = normalizeTraeSample(sample(turns), SRC);
    expect(r.events.map((e) => e.kind)).toEqual([
      'file_write', 'bash', 'file_read', 'tool', 'file_read',
    ]);
  });

  it('§5.2 startTime 缺失时继承前一事件 startedAt，首个事件用会话 startedAt', () => {
    const turns: TraeTurn[] = [
      { id: 't1', type: 'llm', startTime: 1754000000 },
      { id: 't2', type: 'tool', toolName: 'Read' }, // 缺失 → 继承 t1
      { id: 't3', type: 'tool', toolName: 'Write' }, // 缺失 → 继承 t2
    ];
    const r = normalizeTraeSample(
      {
        sourceAgent: 'Trae',
        session: { id: 's', startTime: 1754000000 },
        events: turns,
      },
      SRC,
    );
    const times = r.events.map((e) => e.startedAt);
    expect(new Set(times).size).toBe(1);
    expect(times[0]).toBe(new Date(1754000000 * 1000).toISOString());
    expect(r.events[2]?.startedAt).toBe(times[0]);
  });

  it('§5.3 同时间戳组时长分摊：组内求和 == gap，余数给最后一个，user_prompt 不参与', () => {
    const turns: TraeTurn[] = [
      { id: 'u1', type: 'user', startTime: 1754000000 },
      { id: 'a1', type: 'tool', toolName: 'Read', startTime: 1754000010 },
      { id: 'a2', type: 'tool', toolName: 'Write', startTime: 1754000010 },
      { id: 'a3', type: 'tool', toolName: 'Bash', startTime: 1754000010 },
      { id: 'a4', type: 'llm', startTime: 1754000011 },
    ];
    const r = normalizeTraeSample(sample(turns), SRC);
    const byId = new Map(r.events.map((e) => [e.id, e]));
    // gap = a4(1754000011) − a1 组(1754000010) = 1000ms；1000 / 3 → 333/333/334
    expect(byId.get('a1')?.durationMs).toBe(333);
    expect(byId.get('a2')?.durationMs).toBe(333);
    expect(byId.get('a3')?.durationMs).toBe(334);
    expect((byId.get('a1')!.durationMs + byId.get('a2')!.durationMs + byId.get('a3')!.durationMs)).toBe(1000);
    // user_prompt 不参与分摊，保持 0
    expect(byId.get('u1')?.durationMs).toBe(0);
  });

  it('§5.4 status 有值时以它为准；缺失/为空时才用 toolResult 兜底（R6）', () => {
    const turns: TraeTurn[] = [
      // 成功的 grep "error"：status='completed' 必须判 success，不得被 toolResult 带偏
      { id: 't1', type: 'tool', toolName: 'Grep', status: 'completed', toolResult: 'error in app.log', startTime: 1754000000 },
      // status 缺失 + toolResult 含 Traceback → error
      { id: 't2', type: 'tool', toolName: 'Bash', toolResult: 'Traceback (most recent call last)', startTime: 1754000001 },
      // status 为空字符串 + toolResult 无关键词 → success（completed 兜底）
      { id: 't3', type: 'tool', toolName: 'Read', status: '', toolResult: 'ok', startTime: 1754000002 },
    ];
    const r = normalizeTraeSample(sample(turns), SRC);
    expect(r.events.map((e) => e.status)).toEqual(['success', 'error', 'success']);
  });

  it('B8 isSubagent：agent_type 命中已知子代理名单为 true，其余为 false', () => {
    const mk = (agentType: string | undefined): TraeRecordShape['session'] => ({
      ...traeFixture.session,
      agentType,
    });
    expect(
      normalizeTraeSample(
        { sourceAgent: 'Trae', session: mk('refactor_scoper'), events: traeFixture.events },
        SRC,
      ).session.isSubagent,
    ).toBe(true);
    expect(
      normalizeTraeSample(
        { sourceAgent: 'Trae', session: mk('refactor_finder'), events: traeFixture.events },
        SRC,
      ).session.isSubagent,
    ).toBe(true);
    expect(
      normalizeTraeSample(
        { sourceAgent: 'Trae', session: mk('solo_coder'), events: traeFixture.events },
        SRC,
      ).session.isSubagent,
    ).toBe(false);
    expect(
      normalizeTraeSample(
        { sourceAgent: 'Trae', session: mk(undefined), events: traeFixture.events },
        SRC,
      ).session.isSubagent,
    ).toBe(false);
  });

  // fix-adapter-turn-semantics A4 trae 行：fixture 的每条 turn 自带 id —— 源格式的
  // round/message 标识。规则由 fixture 派生，无活数据背书（A1：trae 43 事件）。
  it('fix-adapter-turn-semantics A4：turnKey = 源 turn id', () => {
    const r = normalizeTraeSample(sample(traeFixture.events), SRC);
    expect(r.events.map((e) => e.turnKey)).toEqual(['t1', 't2', 't3', 't4']);
    expect(r.turnKeySource).toBe('message_identity');
  });
});
