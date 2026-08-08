import { describe, expect, it } from 'vitest';

import { normalizeCodexSample, type CodexRawRow } from './codex.js';
import { codexFixture } from './__fixtures__/codex.js';
import { codexRollout2026_08_05Fixture } from './__fixtures__/codex-rollout-2026-08-05.js';

const SRC = '/tmp/codex.jsonl';

// fix-adapter-turn-semantics A3 rule 3（§6 验证修复，2026-08-08）：codex 的
// payload id 与 `codex-N` 回退键并非全局唯一（实测 11 个会话共享 codex-2），
// 按契约以会话 id 加前缀。以下全部 turnKey 期望值按记录实际的 session.id
// 重算前缀（分组语义不变，仅键值加前缀；fixture / rollout / 合成行的会话 id
// 各不相同，故不从常量推断）。
const key = (record: { session: { id: string } }, k: string): string =>
  `${record.session.id}:${k}`;

function sample(events: CodexRawRow[]) {
  return { sourceAgent: 'Codex', session: {}, events };
}

/** 便捷构造：默认 completed 状态的 response_item。 */
function row(
  type: 'response_item' | 'event_msg' | 'session_meta' | 'turn_context' | 'world_state',
  payload: CodexRawRow['payload'],
  timestamp = '2026-08-01T00:00:00.000Z',
): CodexRawRow {
  return { timestamp, type, payload };
}

describe('Codex adapter（REQ-007 + fix-adapter-turn-semantics §2）', () => {
  // ── 既有行为保持（期望值按修复后的分类重算，fix-adapter-turn-semantics A6）──
  it('fixture 完整 TraceRecord 快照（修复后 kind/turnKey 分布）', () => {
    const r = normalizeCodexSample(sample(codexFixture.events), SRC);
    expect(r.session.provider).toBe('codex');
    expect(r.session.sourceAgent).toBe('Codex');
    expect(r.session.id).toBe('codex-s1');
    expect(r.session.cwd).toBe('/tmp/proj');
    // session_meta 不是事件（A6）；turn_context 现在是 system 事件。
    expect(r.session.eventCount).toBe(6);
    expect(r.events.map((e) => e.kind)).toEqual([
      'system', 'user_prompt', 'tool', 'tool', 'llm', 'llm',
    ]);
    expect(r.events[2]?.tool).toBe('shell');
    expect(r.events[3]?.tool).toBe('shell');
    // 周期：msg-s1-u1 开周期 0（turn_context/用户消息/调用/结果/carrier），
    // msg-s1-a1 在其后的 function_call_output 之后开周期 1。
    expect(r.events.map((e) => e.turnKey)).toEqual([
      key(r, 'msg-s1-u1'), key(r, 'msg-s1-u1'), key(r, 'msg-s1-u1'), key(r, 'msg-s1-u1'),
      key(r, 'msg-s1-u1'), key(r, 'msg-s1-a1'),
    ]);
    expect(r.turnKeySource).toBe('stream_structure');
    // 取末条累计快照：input 25 已减去 cached 8 → 17；Codex 的 input 本就含 cached，
    // 减完之后 input 即净输入，netInput 不再二次相减。
    expect(r.session.tokenUsage).toEqual({
      input: 17, output: 8, reasoning: 3, cacheRead: 8, cacheWrite: 0, netInput: 17, total: 33,
    });
  });

  it('turn_context.model 标注到该轮之后的事件上', () => {
    const r = normalizeCodexSample(sample(codexFixture.events), SRC);
    expect(r.session.primaryModel).toBe('deepseek-v4-flash');
    expect(r.events.every((e) => e.model === 'deepseek-v4-flash')).toBe(true);
  });

  it('会话总量以末条 total_token_usage 累计快照为准', () => {
    const last = codexFixture.events.at(-1)?.payload?.info?.total_token_usage;
    const r = normalizeCodexSample(sample(codexFixture.events), SRC);
    expect(r.session.tokenUsage.total).toBe(last?.total_tokens);
  });

  it('累计快照与逐轮增量之和不一致时，取快照（重试轮会重复计入增量）', () => {
    const rows: CodexRawRow[] = [
      row('event_msg', {
        type: 'token_count',
        info: {
          last_token_usage: { input_tokens: 30, output_tokens: 1 },
          total_token_usage: { input_tokens: 30, output_tokens: 1, total_tokens: 31 },
        },
      }),
      row('event_msg', {
        type: 'token_count',
        info: {
          // 增量之和会得到 50+2；但 Codex 自报累计只有 45+2
          last_token_usage: { input_tokens: 20, output_tokens: 1 },
          total_token_usage: { input_tokens: 45, output_tokens: 2, total_tokens: 47 },
        },
      }),
    ];
    const r = normalizeCodexSample(sample(rows), SRC);
    expect(r.session.tokenUsage.total).toBe(47);
    // fix-adapter-turn-semantics A6：token_count 不再产生独立事件；无
    // response_item 的退化样本并入一个隐式周期，增量合并到单个 carrier 上。
    expect(r.events.map((e) => e.kind)).toEqual(['llm']);
    expect(r.events[0]?.tokens?.input).toBe(50);
    expect(r.events[0]?.turnKey).toBeNull();
  });

  it('无 token_count 行时退回逐事件求和', () => {
    const rows: CodexRawRow[] = [
      row('response_item', { type: 'message', role: 'user', content: 'hi' }),
    ];
    const r = normalizeCodexSample(sample(rows), SRC);
    expect(r.session.tokenUsage.total).toBe(0);
  });

  it('状态归一化四类映射', () => {
    const rows: CodexRawRow[] = ['completed', 'failed', 'paused', 'canceled'].map((status, i) =>
      row('response_item', { type: 'message', role: 'user', content: `hi${i}`, status }, `2026-08-01T00:00:0${i}.000Z`),
    );
    const r = normalizeCodexSample(sample(rows), SRC);
    expect(r.events.map((e) => e.status)).toEqual(['success', 'error', 'running', 'cancelled']);
  });

  it('重复 event id 追加 :sequence 后缀', () => {
    const rows: CodexRawRow[] = [
      row('response_item', { type: 'function_call', call_id: 'c1', name: 'shell' }),
      row('response_item', { type: 'function_call', call_id: 'c1', name: 'shell' }),
    ];
    const r = normalizeCodexSample(sample(rows), SRC);
    expect(r.events.map((e) => e.id)).toEqual(['c1', 'c1:2']);
  });

  it('title 截断到 200 字符', () => {
    const rows: CodexRawRow[] = [
      row('response_item', { type: 'message', role: 'user', content: 'z'.repeat(250) }),
    ];
    const r = normalizeCodexSample(sample(rows), SRC);
    expect(r.events[0]?.title.length).toBe(200);
  });

  it('raw 与正文分离返回', () => {
    const r = normalizeCodexSample(sample(codexFixture.events), SRC);
    const call = r.events.find((e) => e.tool === 'shell' && e.hasInput);
    expect((call as unknown as { raw?: string }).raw).toContain('function_call');
    expect(call?.inputSummary).not.toContain('"type"');
  });

  // ── §2.1 / §2.2 / §2.3 / §2.4：A6 分类修复 ──
  it('2.1 custom_tool_call / custom_tool_call_output → tool，名称取调用工具名', () => {
    const rows: CodexRawRow[] = [
      row('response_item', {
        type: 'custom_tool_call', id: 'ctc-1', call_id: 'call_00_A', name: 'apply_patch', input: '*** Begin Patch',
      }),
      row('response_item', {
        type: 'custom_tool_call_output', id: 'ctco-1', call_id: 'call_00_A', output: 'ok',
      }),
    ];
    const r = normalizeCodexSample(sample(rows), SRC);
    expect(r.events.map((e) => e.kind)).toEqual(['tool', 'tool']);
    expect(r.events[0]?.tool).toBe('apply_patch');
    expect(r.events[1]?.tool).toBe('apply_patch');
    expect(r.events[1]?.outputSummary).toBe('ok');
  });

  it('2.1 mcp_tool_call_end → tool，名称取自 invocation', () => {
    const rows: CodexRawRow[] = [
      row('event_msg', {
        type: 'mcp_tool_call_end',
        call_id: 'exec-1',
        invocation: { server: 'node_repl', tool: 'js', arguments: { code: '1+1' } },
        result: { Ok: { content: [{ type: 'text', text: '2' }] } },
      }),
    ];
    const r = normalizeCodexSample(sample(rows), SRC);
    expect(r.events[0]?.kind).toBe('tool');
    expect(r.events[0]?.tool).toBe('js');
    expect(r.events[0]?.inputSummary).toContain('1+1');
    expect(r.events[0]?.hasOutput).toBe(true);
  });

  it('2.1 web_search_call / web_search_end → tool', () => {
    const rows: CodexRawRow[] = [
      row('response_item', {
        type: 'web_search_call', id: 'call_00_WS', status: 'completed',
        action: { type: 'open_page', url: 'https://example.com' },
      }),
      row('event_msg', {
        type: 'web_search_end', call_id: 'call_00_WS', query: 'https://example.com',
        action: { type: 'open_page', url: 'https://example.com' },
      }),
    ];
    const r = normalizeCodexSample(sample(rows), SRC);
    expect(r.events.map((e) => e.kind)).toEqual(['tool', 'tool']);
    expect(r.events.map((e) => e.tool)).toEqual(['web_search', 'web_search']);
  });

  it('2.1 tool_search_call / tool_search_output → tool', () => {
    const rows: CodexRawRow[] = [
      row('response_item', {
        type: 'tool_search_call', id: 'tsc-1', call_id: 'call_00_TS', status: 'completed',
        arguments: '{"query":"memory"}',
      }),
      row('response_item', {
        type: 'tool_search_output', call_id: 'call_00_TS', status: 'completed',
        tools: [{ type: 'function', name: 'automation_update' }],
      }),
    ];
    const r = normalizeCodexSample(sample(rows), SRC);
    expect(r.events.map((e) => e.kind)).toEqual(['tool', 'tool']);
    expect(r.events.map((e) => e.tool)).toEqual(['tool_search', 'tool_search']);
  });

  it('2.2 patch_apply_end → file_write', () => {
    const rows: CodexRawRow[] = [
      row('event_msg', {
        type: 'patch_apply_end', call_id: 'call_00_P', status: 'completed', success: true,
        stdout: 'Success. Updated the following files:\nA openspec/x.md',
      }),
    ];
    const r = normalizeCodexSample(sample(rows), SRC);
    expect(r.events[0]?.kind).toBe('file_write');
    expect(r.events[0]?.outputSummary).toContain('Success.');
  });

  it('2.3 reasoning / agent_reasoning → reasoning', () => {
    const rows: CodexRawRow[] = [
      row('response_item', {
        type: 'reasoning', id: 'rs-1',
        content: [{ type: 'reasoning_text', text: 'thinking about the plan' }],
      }),
      row('event_msg', { type: 'agent_reasoning', text: 'second thought' }),
    ];
    const r = normalizeCodexSample(sample(rows), SRC);
    expect(r.events.map((e) => e.kind)).toEqual(['reasoning', 'reasoning']);
    expect(r.events.map((e) => e.title)).toEqual(['thinking about the plan', 'second thought']);
  });

  it('2.4 context_compacted → compact', () => {
    const rows: CodexRawRow[] = [
      row('event_msg', { type: 'context_compacted' }),
    ];
    const r = normalizeCodexSample(sample(rows), SRC);
    expect(r.events[0]?.kind).toBe('compact');
  });

  it('2.9 response_item/message role developer/system → system，不是模型回复', () => {
    const rows: CodexRawRow[] = [
      row('response_item', { type: 'message', role: 'developer', content: 'You are /root' }),
      row('response_item', { type: 'message', role: 'system', content: 'system rules' }),
      row('response_item', { type: 'message', role: 'assistant', content: 'my reply' }),
      row('response_item', { type: 'message', role: 'user', content: 'my prompt' }),
    ];
    const r = normalizeCodexSample(sample(rows), SRC);
    expect(r.events.map((e) => e.kind)).toEqual([
      'system', 'system', 'llm', 'user_prompt',
    ]);
    expect(r.events[2]?.outputSummary).toBe('my reply');
  });

  // ── §2.6 / §2.7：token_count 修复 ──
  it('2.6 token_count 不产生独立事件；周期有 assistant 消息时用量挂到它上面', () => {
    const rows: CodexRawRow[] = [
      row('response_item', { type: 'reasoning', id: 'rs-1', content: [{ type: 'reasoning_text', text: 'r' }] }),
      row('response_item', { type: 'message', id: 'msg-a1', role: 'assistant', content: 'answer' }),
      row('response_item', { type: 'function_call', id: 'fc-1', call_id: 'call_00_C', name: 'shell', arguments: 'ls' }),
      row('response_item', { type: 'function_call_output', id: 'fco-1', call_id: 'call_00_C', output: 'out' }),
      row('event_msg', {
        type: 'token_count',
        info: {
          last_token_usage: { input_tokens: 10, cached_input_tokens: 3, output_tokens: 4, total_tokens: 14 },
          total_token_usage: { input_tokens: 10, cached_input_tokens: 3, output_tokens: 4, total_tokens: 14 },
        },
      }),
    ];
    const r = normalizeCodexSample(sample(rows), SRC);
    // 无 token_count 事件、无 carrier：用量只出现在 assistant 消息事件上
    expect(r.events.filter((e) => e.title === 'token_count')).toHaveLength(0);
    const assistant = r.events.find((e) => e.kind === 'llm');
    expect(assistant?.tokens).toEqual({
      input: 7, output: 4, reasoning: 0, cacheRead: 3, cacheWrite: 0, netInput: 7, total: 14,
    });
  });

  it('2.6 周期无 assistant 消息时，token_count 只生成单个 llm carrier', () => {
    const rows: CodexRawRow[] = [
      row('response_item', { type: 'reasoning', id: 'rs-1', content: [{ type: 'reasoning_text', text: 'r' }] }),
      row('response_item', { type: 'function_call', id: 'fc-1', call_id: 'call_00_C', name: 'shell' }),
      row('response_item', { type: 'function_call_output', id: 'fco-1', call_id: 'call_00_C', output: 'out' }),
      row('event_msg', {
        type: 'token_count',
        info: {
          last_token_usage: { input_tokens: 10, cached_input_tokens: 3, output_tokens: 4, total_tokens: 14 },
          total_token_usage: { input_tokens: 10, cached_input_tokens: 3, output_tokens: 4, total_tokens: 14 },
        },
      }),
    ];
    const r = normalizeCodexSample(sample(rows), SRC);
    const carriers = r.events.filter((e) => e.title === 'token_count');
    expect(carriers).toHaveLength(1);
    expect(carriers[0]?.kind).toBe('llm');
    expect(carriers[0]?.tokens?.total).toBe(14);
    // 同一周期内另一个 token_count 不会产生第二个事件（单 carrier）
    const withTwo = normalizeCodexSample(
      sample([...rows, row('event_msg', {
        type: 'token_count',
        info: {
          last_token_usage: { input_tokens: 5, output_tokens: 1, total_tokens: 6 },
          total_token_usage: { input_tokens: 15, output_tokens: 5, total_tokens: 20 },
        },
      })]),
      SRC,
    );
    expect(withTwo.events.filter((e) => e.title === 'token_count')).toHaveLength(1);
    // 两个增量合并到同一个 carrier：净输入 7 + 5 = 12
    expect(withTwo.events.find((e) => e.title === 'token_count')?.tokens?.input).toBe(12);
    expect(withTwo.events.find((e) => e.title === 'token_count')?.tokens?.total).toBe(20);
  });

  it('2.7 逐会话 token 总量与修复前逐字节一致（期望值独立于 adapter 手算）', () => {
    const r = normalizeCodexSample(sample(codexRollout2026_08_05Fixture.events), SRC);
    // fix-adapter-turn-semantics A6：移除 6,492 个独立 token_count 事件后，
    // 会话总量不许移动。下面的期望值按源文件 46 行的 total_token_usage 手算：
    //   input_tokens 193534 − cached 180096 = 13438（净输入）
    //   output 2700 / reasoning 1722（⊂ output）
    //   total = 13438 + 2700 + 180096 + 0 = 196234 —— 与 Codex 自报 total_tokens 一致。
    // 该值与修复前 adapter 产出的会话总量完全相同（快照口径未变）。
    expect(r.session.tokenUsage).toEqual({
      input: 13438, output: 2700, reasoning: 1722, cacheRead: 180096,
      cacheWrite: 0, netInput: 13438, total: 196234,
    });
    // 事件级归因之和也必须等于会话总量（8 个 token 承载事件：2 个 assistant + 6 个 carrier）
    const tokenEvents = r.events.filter((e) => e.tokens !== null);
    expect(tokenEvents).toHaveLength(8);
    const sum = tokenEvents.reduce(
      (acc, e) => ({
        input: acc.input + e.tokens!.input,
        output: acc.output + e.tokens!.output,
        reasoning: acc.reasoning + e.tokens!.reasoning,
        cacheRead: acc.cacheRead + e.tokens!.cacheRead,
        total: acc.total + e.tokens!.total,
      }),
      { input: 0, output: 0, reasoning: 0, cacheRead: 0, total: 0 },
    );
    expect(sum).toEqual({ input: 13438, output: 2700, reasoning: 1722, cacheRead: 180096, total: 196234 });
  });

  // ── §2.8 / §2.13 / §2.15：turn key ──
  it('2.8 周期在紧邻前一条 response_item 为工具结果时开启；key 为开启项 payload id', () => {
    const rows: CodexRawRow[] = [
      row('response_item', { type: 'message', id: 'msg-u1', role: 'user', content: 'q1' }),
      row('response_item', { type: 'reasoning', id: 'rs-1', content: [{ type: 'reasoning_text', text: 'r1' }] }),
      row('response_item', { type: 'function_call', id: 'fc-1', call_id: 'call_00_1', name: 'shell' }),
      row('response_item', { type: 'function_call_output', id: 'fco-1', call_id: 'call_00_1', output: 'o1' }),
      row('response_item', { type: 'reasoning', id: 'rs-2', content: [{ type: 'reasoning_text', text: 'r2' }] }),
      row('response_item', { type: 'function_call', id: 'fc-2', call_id: 'call_00_2', name: 'shell' }),
      row('response_item', { type: 'function_call_output', id: 'fco-2', call_id: 'call_00_2', output: 'o2' }),
      row('response_item', { type: 'message', id: 'msg-a1', role: 'assistant', content: 'done' }),
    ];
    const r = normalizeCodexSample(sample(rows), SRC);
    expect(r.events.map((e) => e.turnKey)).toEqual([
      key(r, 'msg-u1'), key(r, 'msg-u1'), key(r, 'msg-u1'), key(r, 'msg-u1'), // 周期 0
      key(r, 'rs-2'), key(r, 'rs-2'), key(r, 'rs-2'),                        // 周期 1
      key(r, 'msg-a1'),                                                      // 周期 2
    ]);
    expect(new Set(r.events.map((e) => e.turnKey)).size).toBe(3);
  });

  it('2.8 event_msg 记录挂到开启中的周期；provenance 为 stream_structure', () => {
    const r = normalizeCodexSample(sample(codexRollout2026_08_05Fixture.events), SRC);
    expect(r.turnKeySource).toBe('stream_structure');
    // task_started（第 2 行）与 user_message（第 10 行）都挂到周期 0
    const taskStarted = r.events.find((e) => e.title === 'task_started');
    const userMessage = r.events.find((e) => e.title === 'user_message');
    const cycle0Key = key(r, 'msg_019fd1d9-ccb2-7170-869b-413413308ce0');
    expect(taskStarted?.turnKey).toBe(cycle0Key);
    expect(userMessage?.turnKey).toBe(cycle0Key);
  });

  it('2.13 完整决策周期的 turn-key 分组：推理/回复/调用/结果共用一个 key', () => {
    const rows: CodexRawRow[] = [
      row('response_item', { type: 'reasoning', id: 'rs-1', content: [{ type: 'reasoning_text', text: 'r1' }] }),
      row('response_item', { type: 'message', id: 'msg-a1', role: 'assistant', content: 'answer' }),
      row('response_item', { type: 'custom_tool_call', id: 'ctc-1', call_id: 'call_00_1', name: 'apply_patch' }),
      row('response_item', { type: 'custom_tool_call_output', id: 'ctco-1', call_id: 'call_00_1', output: 'ok' }),
      row('event_msg', { type: 'token_count', info: {
        last_token_usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 },
        total_token_usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 },
      } }),
      row('response_item', { type: 'reasoning', id: 'rs-2', content: [{ type: 'reasoning_text', text: 'r2' }] }),
    ];
    const r = normalizeCodexSample(sample(rows), SRC);
    const cycle1 = r.events.filter((e) => e.turnKey === key(r, 'rs-1'));
    expect(cycle1.map((e) => e.kind).sort()).toEqual(['llm', 'reasoning', 'tool', 'tool']);
    expect(r.events.find((e) => e.turnKey === key(r, 'rs-2'))?.kind).toBe('reasoning');
  });

  it('2.15 task_started 不开启周期：其数量与周期数无关', () => {
    // 3 条 task_started，但 response_item 链只切出 2 个周期
    const rows: CodexRawRow[] = [
      row('event_msg', { type: 'task_started' }),
      row('response_item', { type: 'message', id: 'msg-u1', role: 'user', content: 'q1' }),
      row('response_item', { type: 'reasoning', id: 'rs-1', content: [{ type: 'reasoning_text', text: 'r1' }] }),
      row('response_item', { type: 'function_call', id: 'fc-1', call_id: 'call_00_1', name: 'shell' }),
      row('response_item', { type: 'function_call_output', id: 'fco-1', call_id: 'call_00_1', output: 'o1' }),
      row('event_msg', { type: 'task_started' }),
      row('response_item', { type: 'reasoning', id: 'rs-2', content: [{ type: 'reasoning_text', text: 'r2' }] }),
      row('response_item', { type: 'function_call', id: 'fc-2', call_id: 'call_00_2', name: 'shell' }),
      row('response_item', { type: 'function_call_output', id: 'fco-2', call_id: 'call_00_2', output: 'o2' }),
      row('event_msg', { type: 'task_started' }),
    ];
    const r = normalizeCodexSample(sample(rows), SRC);
    const cycles = new Set(r.events.map((e) => e.turnKey));
    expect(cycles.size).toBe(2);
    expect(cycles.has(key(r, 'msg-u1'))).toBe(true);
    expect(cycles.has(key(r, 'rs-2'))).toBe(true);
    const taskStartedKeys = r.events.filter((e) => e.title === 'task_started').map((e) => e.turnKey);
    // 第二条 task_started 出现在 rs-2 开启新周期之前，挂到开启中的周期 0；
    // 第三条挂到 rs-2 周期。周期数（2）与 task_started 数（3）无关。
    expect(taskStartedKeys).toEqual([key(r, 'msg-u1'), key(r, 'msg-u1'), key(r, 'rs-2')]);
  });

  // ── §2.12：按源 call_id 配对，不按相邻 ──
  it('2.12 工具结果按 call_id 配对（call_X / call_X:N 形态），不依赖相邻', () => {
    // 输出行故意与调用行相隔、且 call_id 带 :N 后缀（A1 实测数据库形态）
    const rows: CodexRawRow[] = [
      row('response_item', { type: 'reasoning', id: 'rs-1', content: [{ type: 'reasoning_text', text: 'r' }] }),
      row('response_item', { type: 'custom_tool_call', id: 'ctc-1', call_id: 'call_00_FUHEa1XZOVIWinblpRnH4144', name: 'write_stdin' }),
      row('response_item', { type: 'reasoning', id: 'rs-2', content: [{ type: 'reasoning_text', text: 'r2' }] }),
      row('response_item', { type: 'custom_tool_call_output', id: 'ctco-1', call_id: 'call_00_FUHEa1XZOVIWinblpRnH4144:38', output: 'aborted' }),
    ];
    const r = normalizeCodexSample(sample(rows), SRC);
    const call = r.events.find((e) => e.id === 'ctc-1');
    const output = r.events.find((e) => e.id === 'ctco-1');
    expect(call?.tool).toBe('write_stdin');
    expect(output?.tool).toBe('write_stdin');
    // 两个事件同属 rs-1 开启的周期
    expect(output?.turnKey).toBe(key(r, 'rs-1'));
  });

  it('2.12 并发工具：两个调用的输出交错出现，仍按 call_id 各归其主且同属一个周期', () => {
    const rows: CodexRawRow[] = [
      row('response_item', { type: 'function_call', id: 'fc-a', call_id: 'call_00_A', name: 'read_file' }),
      row('response_item', { type: 'function_call', id: 'fc-b', call_id: 'call_01_B', name: 'grep' }),
      row('response_item', { type: 'function_call_output', id: 'fco-b', call_id: 'call_01_B', output: 'hits' }),
      row('response_item', { type: 'function_call_output', id: 'fco-a', call_id: 'call_00_A', output: 'file' }),
    ];
    const r = normalizeCodexSample(sample(rows), SRC);
    expect(r.events.find((e) => e.id === 'fco-b')?.tool).toBe('grep');
    expect(r.events.find((e) => e.id === 'fco-a')?.tool).toBe('read_file');
    // 连续工具结果不开启新周期：整批并发调用共享一把 key（A3）
    expect(new Set(r.events.map((e) => e.turnKey)).size).toBe(1);
    expect(r.events.every((e) => e.turnKey === key(r, 'fc-a'))).toBe(true);
  });

  // ── §2.5 / §2.10 / §2.11 ──
  it('2.5 turn_aborted 令受影响周期的事件携带 cancelled 状态', () => {
    const rows: CodexRawRow[] = [
      row('response_item', { type: 'reasoning', id: 'rs-1', content: [{ type: 'reasoning_text', text: 'r' }] }),
      row('response_item', { type: 'function_call', id: 'fc-1', call_id: 'call_00_1', name: 'shell' }),
      row('response_item', { type: 'function_call_output', id: 'fco-1', call_id: 'call_00_1', output: 'out' }),
      row('event_msg', { type: 'turn_aborted', turn_id: 't1', reason: 'interrupted' }),
    ];
    const r = normalizeCodexSample(sample(rows), SRC);
    expect(r.events.map((e) => e.status)).toEqual(['cancelled', 'cancelled', 'cancelled', 'cancelled']);
    expect(r.events.at(-1)?.kind).toBe('system');
    expect(r.events.at(-1)?.title).toBe('turn_aborted');
  });

  it('2.10 周期同时有 event_msg/agent_message 与 response_item/message 时只保留后者', () => {
    const rows: CodexRawRow[] = [
      row('event_msg', { type: 'agent_message', message: 'mirror text' }),
      row('response_item', { type: 'message', id: 'msg-a1', role: 'assistant', content: 'real text' }),
    ];
    const r = normalizeCodexSample(sample(rows), SRC);
    expect(r.events.filter((e) => e.kind === 'llm')).toHaveLength(1);
    expect(r.events.find((e) => e.kind === 'llm')?.outputSummary).toBe('real text');
  });

  it('2.10 周期没有 response_item/message 时保留 agent_message 为模型回复', () => {
    const rows: CodexRawRow[] = [
      row('response_item', { type: 'reasoning', id: 'rs-1', content: [{ type: 'reasoning_text', text: 'r' }] }),
      row('event_msg', { type: 'agent_message', message: 'kept commentary' }),
      row('response_item', { type: 'function_call', id: 'fc-1', call_id: 'call_00_1', name: 'shell' }),
      row('response_item', { type: 'function_call_output', id: 'fco-1', call_id: 'call_00_1', output: 'out' }),
    ];
    const r = normalizeCodexSample(sample(rows), SRC);
    const llm = r.events.filter((e) => e.kind === 'llm');
    expect(llm).toHaveLength(1);
    expect(llm[0]?.outputSummary).toBe('kept commentary');
  });

  it('2.11 session_meta 不是事件；turn_context / world_state 是 system 事件', () => {
    const rows: CodexRawRow[] = [
      row('session_meta', { session_id: 's9', cwd: '/tmp/proj', model_provider: 'deepseek' }),
      row('turn_context', { cwd: '/tmp/proj', model: 'deepseek-v4-flash' }),
      row('world_state', { full: true }),
      row('response_item', { type: 'message', id: 'msg-u1', role: 'user', content: 'q' }),
    ];
    const r = normalizeCodexSample(sample(rows), SRC);
    expect(r.session.id).toBe('s9');
    expect(r.session.cwd).toBe('/tmp/proj');
    expect(r.events.some((e) => String((e as unknown as { raw?: string }).raw).includes('session_meta'))).toBe(false);
    expect(r.events.map((e) => e.kind)).toEqual(['system', 'system', 'user_prompt']);
    expect(r.events[0]?.title).toBe('turn_context');
    expect(r.events[1]?.title).toBe('world_state');
    expect(r.events.map((e) => e.model)).toEqual(['deepseek-v4-flash', 'deepseek-v4-flash', 'deepseek-v4-flash']);
  });

  it('2.13 A6 未命名的 payload 类型仍回落 system（修复收窄兜底，不删除兜底）', () => {
    const rows: CodexRawRow[] = [
      row('response_item', { type: 'mystery_payload_type', id: 'x-1' }),
    ];
    const r = normalizeCodexSample(sample(rows), SRC);
    expect(r.events[0]?.kind).toBe('system');
    expect(r.events[0]?.title).toBe('mystery_payload_type');
  });

  // ── §2.14：48 行真实 rollout 转录 ──
  it('2.14 48 行 rollout 恰好切出 9 个周期，边界与 A1 一致', () => {
    const r = normalizeCodexSample(sample(codexRollout2026_08_05Fixture.events), SRC);
    const keys = r.events.map((e) => e.turnKey);
    const distinct = [...new Set(keys)];
    expect(distinct).toEqual([
      key(r, 'msg_019fd1d9-ccb2-7170-869b-413413308ce0'), // 周期 0：第 3 行 developer 消息开启
      key(r, 'a052b6cb-5973-4149-a1dd-6327338c6755'),     // 周期 1：第 15 行 reasoning
      key(r, '987ec1ba-9375-451d-966f-bbb673fef2ff'),     // 周期 2：第 21 行 reasoning
      key(r, '107c607f-f678-4b12-be1e-500ae2e562e7'),     // 周期 3：第 25 行 reasoning
      key(r, 'f0687cce-2137-4091-a52b-8646bde6007a'),     // 周期 4：第 29 行 reasoning
      key(r, 'ee54a307-976c-479e-a72f-0b8182e1c860'),     // 周期 5：第 33 行 reasoning
      key(r, '08f356f9-f390-4679-aabb-cf598691f778'),     // 周期 6：第 39 行 reasoning
      key(r, '547c7168-3853-46e3-a912-ea06ca415022'),     // 周期 7：第 43 行 reasoning
      key(r, 'msg_019fd1db-1b6a-7880-aec8-9803ca626462'), // 周期 8：第 47 行 developer（turn_aborted）
    ]);
    expect(keys.filter((k) => k === distinct[0])).toHaveLength(13);
    expect(keys.filter((k) => k === distinct[8])).toHaveLength(2);
    expect(keys).toHaveLength(43);
    // 周期 8 受 turn_aborted 影响 → cancelled
    expect(r.events.filter((e) => e.turnKey === distinct[8]!).map((e) => e.status)).toEqual([
      'cancelled', 'cancelled',
    ]);
  });

  it('2.14 两对镜像 agent_message/response_item 只各产出一条 assistant 消息', () => {
    const r = normalizeCodexSample(sample(codexRollout2026_08_05Fixture.events), SRC);
    const assistant = r.events.filter((e) => e.kind === 'llm' && e.title !== 'token_count');
    expect(assistant).toHaveLength(2);
    expect(assistant.map((e) => e.id)).toEqual([
      '2cb495b1-7ab2-4b47-8af3-842bcc05d5d4', // 第 17 行（镜像在第 16 行）
      '873b490e-4f90-4ce8-a392-40fef3c6e761', // 第 35 行（镜像在第 34 行）
    ]);
    // 两条真实回复各自承载其周期的 token 用量（第 20 / 38 行的增量）
    expect(assistant[0]?.tokens).toEqual({
      input: 4139, output: 626, reasoning: 536, cacheRead: 18816,
      cacheWrite: 0, netInput: 4139, total: 23581,
    });
    expect(assistant[1]?.tokens).toEqual({
      input: 1227, output: 504, reasoning: 337, cacheRead: 24704,
      cacheWrite: 0, netInput: 1227, total: 26435,
    });
    expect(r.events.some((e) => e.kind === 'llm' && e.title !== 'token_count' && e.id.startsWith('codex-'))).toBe(false);
  });

  // ── A3 rule 3 会话级唯一（§6 验证修复，2026-08-08）──
  it('A3 rule 3 回归：两个会话的 `codex-N` 回退键互不串扰', () => {
    // 无 payload.id / call_id 的行触发 cycleKeyOf 的 `codex-${rowIndex}` 回退，
    // 该键并非全局唯一（实测 11 个会话共享 codex-2）→ 必须以会话 id 加前缀。
    const rows: CodexRawRow[] = [
      row('response_item', { type: 'reasoning', content: [{ type: 'reasoning_text', text: 'x' }] }),
      row('response_item', { type: 'function_call', call_id: 'call_00_1', name: 'shell' }),
      row('response_item', { type: 'function_call_output', call_id: 'call_00_1', output: 'o' }),
    ];
    const a = normalizeCodexSample(sample(rows), '/tmp/session-a.jsonl');
    const b = normalizeCodexSample(sample(rows), '/tmp/session-b.jsonl');
    expect(a.session.id).not.toBe(b.session.id);
    const aKeys = [...new Set(a.events.map((e) => e.turnKey))];
    const bKeys = [...new Set(b.events.map((e) => e.turnKey))];
    expect(aKeys.length).toBeGreaterThan(0);
    expect(aKeys.every((k) => k !== null && k.startsWith(`${a.session.id}:`))).toBe(true);
    expect(aKeys.every((k) => !bKeys.includes(k))).toBe(true);
  });

  it('2.14 三条系统提示词 developer 消息（及 turn_aborted developer 消息）分类为 system', () => {
    const r = normalizeCodexSample(sample(codexRollout2026_08_05Fixture.events), SRC);
    const system = r.events.filter((e) => e.kind === 'system');
    // 第 3/4/5 行系统提示词 + 第 47 行 turn_aborted developer 消息 + 第 48 行
    // turn_aborted + task_started + world_state + turn_context + user_message = 9
    expect(system).toHaveLength(9);
    const systemPromptIds = [
      'msg_019fd1d9-ccb2-7170-869b-413413308ce0',
      'msg_019fd1d9-ccb2-7170-869b-4145825ba38e',
      'msg_019fd1d9-ccb2-7170-869b-415b728382db',
    ];
    for (const id of systemPromptIds) {
      const ev = r.events.find((e) => e.id === id);
      expect(ev?.kind).toBe('system');
      expect(ev?.actor).toBe('system');
    }
    const turnAbortedDeveloper = r.events.find((e) => e.id === 'msg_019fd1db-1b6a-7880-aec8-9803ca626462');
    expect(turnAbortedDeveloper?.kind).toBe('system');
  });

  it('2.14 事件总量与 kind 分布与手算一致（无幻影 token_count 事件）', () => {
    const r = normalizeCodexSample(sample(codexRollout2026_08_05Fixture.events), SRC);
    const counts = r.events.reduce<Record<string, number>>((acc, e) => {
      acc[e.kind] = (acc[e.kind] ?? 0) + 1;
      return acc;
    }, {});
    expect(counts).toEqual({
      system: 9, user_prompt: 2, reasoning: 8, tool: 16, llm: 8,
    });
    expect(r.events.filter((e) => e.title === 'token_count')).toHaveLength(6);
    expect(r.session.eventCount).toBe(43);
    expect(r.session.status).toBe('cancelled');
  });
});
