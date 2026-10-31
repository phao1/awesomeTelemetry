import { describe, expect, it } from 'vitest';

import { normalizeOpenCode, type OpenCodeMessage, type OpenCodeOtelSpan } from './opencode.js';
import { opencodeCarrierFixture, opencodeFixture, opencodeNativeTimingFixture } from './__fixtures__/opencode.js';
import { codeartsFixture } from './__fixtures__/codearts.js';
import { codeartsAdapter } from './codearts.js';
import { codeagent2Adapter } from './codeagent2.js';
import { computeTokenBreakdown } from '../core/token-breakdown.js';
import { attributeTokensToLlmEvents } from '../core/speed-metrics.js';

const SRC = '/tmp/oc.sqlite';

function sample(events: OpenCodeMessage[]): Parameters<typeof normalizeOpenCode>[0] {
  return {
    sourceAgent: 'OpenCode',
    session: opencodeFixture.session,
    events,
  };
}

function msg(over: Partial<OpenCodeMessage> & { id: string; role: 'user' | 'assistant' }): OpenCodeMessage {
  const { id, role, ...rest } = over;
  return {
    id,
    role,
    sessionID: 'oc-session-1',
    time: { created: 1754000000000 },
    tokens: null,
    content: [{ type: 'text', text: 'x' }],
    ...rest,
  };
}

describe('OpenCode adapter（REQ-005）', () => {
  it('P1 legacy fixtures keep their complete normalized output', () => {
    expect([
      normalizeOpenCode(sample(opencodeFixture.events), SRC),
      codeartsAdapter.normalize(codeartsFixture, SRC),
    ]).toMatchInlineSnapshot(`
      [
        {
          "events": [
            {
              "actor": "user",
              "durationMs": 0,
              "error": null,
              "hasInput": true,
              "hasOutput": false,
              "hasRaw": true,
              "id": "m-user-0",
              "inputSummary": "please fix the failing test",
              "kind": "user_prompt",
              "model": null,
              "outputSummary": null,
              "phase": "verify",
              "raw": "{"type":"text","text":"please fix the failing test"}",
              "sequence": 1,
              "sessionId": "oc-session-1",
              "startedAt": "2025-07-31T22:13:20.000Z",
              "status": "success",
              "title": "please fix the failing test",
              "tokens": null,
              "tool": null,
              "turnKey": "m-user",
            },
            {
              "actor": "assistant",
              "durationMs": 30000,
              "error": null,
              "hasInput": false,
              "hasOutput": true,
              "hasRaw": true,
              "id": "m-tool-0",
              "inputSummary": null,
              "kind": "bash",
              "model": null,
              "outputSummary": "ok",
              "phase": "verify",
              "raw": "{"type":"tool","tool":"Bash","state":{"status":"completed","title":"npm test","output":"ok"}}",
              "sequence": 2,
              "sessionId": "oc-session-1",
              "startedAt": "2025-07-31T22:13:30.000Z",
              "status": "success",
              "title": "npm test",
              "tokens": {
                "cacheRead": 100,
                "cacheWrite": 0,
                "input": 10,
                "netInput": 0,
                "output": 5,
                "reasoning": 0,
                "total": 115,
              },
              "tool": "Bash",
              "turnKey": "m-tool",
            },
            {
              "actor": "assistant",
              "durationMs": 0,
              "error": null,
              "hasInput": false,
              "hasOutput": true,
              "hasRaw": true,
              "id": "m-llm-0",
              "inputSummary": null,
              "kind": "llm",
              "model": null,
              "outputSummary": "tests pass now",
              "phase": "verify",
              "raw": "{"type":"text","text":"tests pass now"}",
              "sequence": 3,
              "sessionId": "oc-session-1",
              "startedAt": "2025-07-31T22:14:00.000Z",
              "status": "success",
              "title": "tests pass now",
              "tokens": {
                "cacheRead": 150,
                "cacheWrite": 5,
                "input": 15,
                "netInput": 0,
                "output": 8,
                "reasoning": 2,
                "total": 180,
              },
              "tool": null,
              "turnKey": "m-llm",
            },
          ],
          "nativeIdentities": {
            "completeness": {
              "complete": true,
              "omittedCount": 0,
              "reasons": [],
            },
            "items": [
              {
                "eventId": null,
                "kind": "session",
                "namespace": "agent:opencode",
                "scope": null,
                "sourcePath": "session.id",
                "value": "oc-session-1",
              },
              {
                "eventId": "m-user-0",
                "kind": "message",
                "namespace": "agent:opencode",
                "scope": "oc-session-1",
                "sourcePath": "messages[0].id",
                "value": "m-user",
              },
              {
                "eventId": "m-tool-0",
                "kind": "message",
                "namespace": "agent:opencode",
                "scope": "oc-session-1",
                "sourcePath": "messages[1].id",
                "value": "m-tool",
              },
              {
                "eventId": "m-llm-0",
                "kind": "message",
                "namespace": "agent:opencode",
                "scope": "oc-session-1",
                "sourcePath": "messages[2].id",
                "value": "m-llm",
              },
            ],
            "parserVersion": 3,
          },
          "session": {
            "costCurrency": "USD",
            "costSource": "unknown",
            "costUsd": 0,
            "cwd": "/home/u/proj",
            "dataSource": "scan",
            "durationSource": "derived",
            "eventCount": 3,
            "id": "oc-session-1",
            "isSubagent": true,
            "messageCount": 3,
            "primaryModel": null,
            "provider": "opencode",
            "sourceAgent": "OpenCode",
            "sourcePath": "/tmp/oc.sqlite",
            "startedAt": "2025-07-31T22:13:20.000Z",
            "status": "success",
            "systemPrompt": null,
            "title": "fix build (@main subagent)",
            "tokenUsage": {
              "cacheRead": 250,
              "cacheWrite": 5,
              "input": 25,
              "netInput": 0,
              "output": 13,
              "reasoning": 2,
              "total": 295,
            },
            "totalDurationMs": 40000,
            "updatedAt": "2025-07-31T22:14:00.000Z",
          },
          "tokenSemantics": {
            "cacheRead": "incremental",
            "reasoning": "incremental",
            "reasoningInTotal": true,
          },
          "turnKeySource": "message_identity",
        },
        {
          "events": [
            {
              "actor": "user",
              "durationMs": 0,
              "error": null,
              "hasInput": true,
              "hasOutput": false,
              "hasRaw": true,
              "id": "ca2-m1-0",
              "inputSummary": "write a parser",
              "kind": "user_prompt",
              "model": null,
              "outputSummary": null,
              "phase": "implement",
              "raw": "{"type":"text","text":"write a parser"}",
              "sequence": 1,
              "sessionId": "ca2-s1",
              "startedAt": "2025-07-31T22:13:20.000Z",
              "status": "success",
              "title": "write a parser",
              "tokens": null,
              "tool": null,
              "turnKey": "ca2-m1",
            },
            {
              "actor": "assistant",
              "durationMs": 0,
              "error": null,
              "hasInput": false,
              "hasOutput": false,
              "hasRaw": true,
              "id": "ca2-m2-0",
              "inputSummary": null,
              "kind": "file_write",
              "model": null,
              "outputSummary": null,
              "phase": "implement",
              "raw": "{"type":"tool","tool":"Write","state":{"status":"completed","title":"write parser.ts"}}",
              "sequence": 2,
              "sessionId": "ca2-s1",
              "startedAt": "2025-07-31T22:13:30.000Z",
              "status": "success",
              "title": "write parser.ts",
              "tokens": {
                "cacheRead": 50,
                "cacheWrite": 0,
                "input": 20,
                "netInput": 0,
                "output": 10,
                "reasoning": 0,
                "total": 80,
              },
              "tool": "Write",
              "turnKey": "ca2-m2",
            },
          ],
          "nativeIdentities": {
            "completeness": {
              "complete": true,
              "omittedCount": 0,
              "reasons": [],
            },
            "items": [
              {
                "eventId": null,
                "kind": "session",
                "namespace": "agent:codearts",
                "scope": null,
                "sourcePath": "session.id",
                "value": "ca2-s1",
              },
              {
                "eventId": "ca2-m1-0",
                "kind": "message",
                "namespace": "agent:codearts",
                "scope": "ca2-s1",
                "sourcePath": "messages[0].id",
                "value": "ca2-m1",
              },
              {
                "eventId": "ca2-m2-0",
                "kind": "message",
                "namespace": "agent:codearts",
                "scope": "ca2-s1",
                "sourcePath": "messages[1].id",
                "value": "ca2-m2",
              },
            ],
            "parserVersion": 3,
          },
          "session": {
            "costCurrency": "USD",
            "costSource": "unknown",
            "costUsd": 0,
            "cwd": null,
            "dataSource": "scan",
            "durationSource": "derived",
            "eventCount": 2,
            "id": "ca2-s1",
            "isSubagent": false,
            "messageCount": 2,
            "primaryModel": null,
            "provider": "codearts",
            "sourceAgent": "CodeArts",
            "sourcePath": "/tmp/oc.sqlite",
            "startedAt": "2025-07-31T22:13:20.000Z",
            "status": "success",
            "systemPrompt": null,
            "title": "agent task",
            "tokenUsage": {
              "cacheRead": 50,
              "cacheWrite": 0,
              "input": 20,
              "netInput": 0,
              "output": 10,
              "reasoning": 0,
              "total": 80,
            },
            "totalDurationMs": 10000,
            "updatedAt": "2025-07-31T22:13:30.000Z",
          },
          "tokenSemantics": {
            "cacheRead": "incremental",
            "reasoning": "incremental",
            "reasoningInTotal": false,
          },
          "turnKeySource": "message_identity",
        },
      ]
    `);
  });

  it.each(['opencode', 'codearts', 'codeagent2'] as const)('P1 %s reads native intervals without capping long tools', (provider) => {
    const fixture = opencodeNativeTimingFixture;
    const input = { ...fixture, sourceAgent: provider };
    const r = provider === 'opencode' ? normalizeOpenCode(input, SRC)
      : (provider === 'codearts' ? codeartsAdapter : codeagent2Adapter).normalize(input, SRC);
    expect(r.session.provider).toBe(provider);
    expect(r.session.durationSource).toBe('measured');
    expect(r.events.find(e => e.tool === 'Bash')).toMatchObject({
      startedAt: new Date(1754000005000).toISOString(), durationMs: 601000,
    });
    expect(r.events.find(e => e.title === 'plan')).toMatchObject({
      kind: 'llm', startedAt: new Date(1754000002000).toISOString(), durationMs: 1000,
    });
    expect(r.events.find(e => e.title === 'testing')).toMatchObject({
      startedAt: new Date(1754000003000).toISOString(), durationMs: 2000,
    });
    expect(r.events.every(e => Object.getOwnPropertySymbols(e).length === 0)).toBe(true);
  });

  it('P1 partial timing retains native durations and derives missing parts', () => {
    const r = normalizeOpenCode(sample([
      msg({ id: 'missing', role: 'assistant', time: { created: 1000, completed: 999999 }, content: [{ type: 'text', text: 'missing' }] }),
      msg({ id: 'native', role: 'assistant', content: [{ type: 'text', text: 'native', time: { start: 6000, end: 8000 } }] }),
    ]), SRC);
    expect(r.session.durationSource).toBe('derived');
    expect(r.events.map(e => [e.id, e.startedAt, e.durationMs])).toEqual([
      ['missing-0', new Date(1000).toISOString(), 5000],
      ['native-0', new Date(6000).toISOString(), 2000],
    ]);
  });

  it('P1 unfinished native running tool stays at zero even before another event', () => {
    const r = normalizeOpenCode(sample([
      msg({ id: 'running', role: 'assistant', content: [{ type: 'tool', tool: 'Bash', state: { status: 'running', time: { start: 1000 } } }] }),
      msg({ id: 'later', role: 'assistant', content: [{ type: 'text', time: { start: 5000, end: 6000 } }] }),
    ]), SRC);
    expect(r.session.durationSource).toBe('derived');
    expect(r.events[0]).toMatchObject({ startedAt: new Date(1000).toISOString(), status: 'running', durationMs: 0 });
  });

  it('P1 native zero-length intervals survive derivation and equal starts retain source sequence', () => {
    const r = normalizeOpenCode(sample([msg({
      id: 'same', role: 'assistant', content: [
        { type: 'text', text: 'zero', time: { start: 1000, end: 1000 } },
        { type: 'tool', tool: 'Read', state: { time: { start: 1000, end: 2000 } } },
        { type: 'text', text: 'later', time: { start: 5000, end: 5000 } },
        { type: 'text', text: 'last', time: { start: 9000, end: 10000 } },
      ],
    })]), SRC);
    expect(r.session.durationSource).toBe('measured');
    expect(r.events.map(e => [e.id, e.sequence, e.durationMs])).toEqual([
      ['same-0', 1, 0], ['same-1', 2, 1000], ['same-2', 3, 0], ['same-3', 4, 1000],
    ]);
  });

  it('P1 keeps the existing OTel mixed-source path without deriving untimed message gaps', () => {
    const r = normalizeOpenCode({
      ...sample(opencodeFixture.events),
      events: [...opencodeFixture.events, { name: 'tool', startTime: 1754000080000, endTime: 1754000780000 }],
    }, SRC);
    expect(r.session.durationSource).toBe('measured');
    expect(r.events.map(e => e.durationMs)).toEqual([0, 0, 0, 700000]);
  });

  it.each([
    { start: 1000 }, { end: 5000 }, { start: 5000, end: 1000 },
    { start: NaN, end: 5000 }, { start: 1000, end: Infinity },
  ])('P1 incomplete or invalid native timing falls back: %j', (time) => {
    const r = normalizeOpenCode(sample([
      msg({ id: 'fallback', role: 'assistant', time: { created: 1000 }, content: [{ type: 'text', time }] }),
      msg({ id: 'later', role: 'assistant', time: { created: 401000 } }),
    ]), SRC);
    expect(r.session.durationSource).toBe('derived');
    expect(r.events[0]).toMatchObject({ startedAt: new Date(1000).toISOString(), durationMs: 300000 });
  });

  it('binds native message and call ids to exact part events without promoting generated ids to native identity', () => {
    const result = normalizeOpenCode(sample([msg({ id: 'native-message', role: 'assistant', content: [{ type: 'text', text: 'thinking' }, { type: 'tool', callID: 'native-call', tool: 'Read', state: { status: 'completed', input: {}, output: 'ok' } }] })]), SRC);
    expect(result.nativeIdentities?.items.find(item => item.kind === 'tool_call')).toMatchObject({ value: 'native-call', eventId: 'native-message-1' });
    expect(result.nativeIdentities?.items.filter(item => item.kind === 'message').map(item => item.eventId)).toEqual(['native-message-0', 'native-message-1']);
    expect(result.nativeIdentities?.items.some(item => item.value === 'native-message-1')).toBe(false);
    expect(result.events.every(event => Object.getOwnPropertySymbols(event).length === 0)).toBe(true);
  });
  it('fixture 完整 TraceRecord 快照', () => {
    const r = normalizeOpenCode(sample(opencodeFixture.events), SRC);
    expect(r.session.provider).toBe('opencode');
    expect(r.session.sourceAgent).toBe('OpenCode');
    expect(r.session.id).toBe('oc-session-1');
    expect(r.session.isSubagent).toBe(true); // 标题匹配 (@...subagent)
    expect(r.session.eventCount).toBe(3);
    expect(r.session.messageCount).toBe(3);
    expect(r.session.totalDurationMs).toBe(40000); // wall-clock
    // #4：cacheRead 100 + 150 = 250（增量求和）；#8：total 含 cacheWrite
    expect(r.session.tokenUsage).toEqual({
      input: 25, output: 13, reasoning: 2, cacheRead: 250, cacheWrite: 5, netInput: 0, total: 295,
    });
    expect(r.events.map((e) => e.kind)).toEqual(['user_prompt', 'bash', 'llm']);
    expect(r.events[1]?.phase).toBe('verify'); // Bash npm test
    expect(r.tokenSemantics).toEqual({
      cacheRead: 'incremental',
      reasoning: 'incremental',
      reasoningInTotal: true, // #6：OpenCode 实测 total 含 reasoning
    });
  });

  it('#4 cacheRead 用 sum 而非 max，reasoning 用 sum', () => {
    const events = [
      msg({ id: 'm1', role: 'assistant', tokens: { input: 1, output: 1, cache: { read: 10, write: 1 } } }),
      msg({ id: 'm2', role: 'assistant', tokens: { input: 1, output: 1, reasoning: 3, cache: { read: 30, write: 1 } } }),
    ];
    const r = normalizeOpenCode(sample(events), SRC);
    expect(r.session.tokenUsage.cacheRead).toBe(40);
    expect(r.session.tokenUsage.reasoning).toBe(3);
    expect(r.session.tokenUsage.cacheWrite).toBe(2);
    expect(r.session.tokenUsage.total).toBe(2 + 2 + 3 + 40 + 2);
  });

  it('fusion 9.2 retains the calibrated 6016+4000+2000 incremental cache total', () => {
    const events = [6016, 4000, 2000].map((read, i) => msg({ id: 'cache-step-' + i, role: 'assistant', tokens: { input: 1, output: 2, reasoning: 1, cache: { read, write: 0 } } }));
    const r = normalizeOpenCode(sample(events), SRC);
    expect(r.session.tokenUsage.cacheRead).toBe(12016);
    expect(r.session.tokenUsage.total).toBe(12028);
    expect(r.tokenSemantics.cacheRead).toBe('incremental');
  });

  it('#5 多 part 消息的 token 只计一次（step 或最后一个 part 挂载）', () => {
    const events = [
      msg({
        id: 'multi',
        role: 'assistant',
        tokens: { input: 10, output: 5, reasoning: 2, cache: { read: 7, write: 1 } },
        content: [
          { type: 'step', state: { status: 'completed', title: 'think' } },
          { type: 'tool', tool: 'Bash', state: { status: 'completed', title: 'npm test' } },
          { type: 'tool', tool: 'Read', state: { status: 'completed', title: 'read x' } },
        ],
      }),
    ];
    const r = normalizeOpenCode(sample(events), SRC);
    expect(r.events).toHaveLength(3);
    // 只有 step part 挂 token，其余为 null → 会话聚合只计一次
    const withTokens = r.events.filter((e) => e.tokens !== null);
    expect(withTokens).toHaveLength(1);
    expect(r.session.tokenUsage.input).toBe(10);
    expect(r.session.tokenUsage.output).toBe(5);
    expect(r.session.tokenUsage.cacheRead).toBe(7);
    // §3：netInput = max(0, input − cacheRead)
    expect(r.session.tokenUsage.netInput).toBe(3);
    expect(r.session.tokenUsage.total).toBe(10 + 5 + 2 + 7 + 1);
  });

  it('§4.1 回归护栏：computeTokenBreakdown 在归因前后完全相等（归因禁止写回 event.tokens）', () => {
    const r = normalizeOpenCode(
      {
        sourceAgent: 'OpenCode',
        session: opencodeCarrierFixture.session,
        events: opencodeCarrierFixture.events,
      },
      SRC,
    );
    const before = computeTokenBreakdown(r).total;
    const attributed = attributeTokensToLlmEvents(r);
    expect(attributed.size).toBeGreaterThan(0);
    const after = computeTokenBreakdown(r).total;
    // 一旦有人把归因结果写回 event.tokens，这里就会红（双计 bug 的锁死测试）
    expect(after).toBe(before);
  });

  it('状态归一化四类映射', () => {
    const statuses = ['completed', 'failed', 'paused', 'canceled'];
    const events = statuses.map((status, i) =>
      msg({
        id: `s${i}`,
        role: 'assistant',
        content: [{ type: 'tool', tool: 'Bash', state: { status, title: 'x' } }],
      }),
    );
    const r = normalizeOpenCode(sample(events), SRC);
    expect(r.events.map((e) => e.status)).toEqual(['success', 'error', 'running', 'cancelled']);
  });

  it('fix-session-detail-display 2.1：tool part 的 state.input/output 进 full 档', () => {
    const events = [
      msg({
        id: 'm-tool',
        role: 'assistant',
        content: [
          {
            type: 'tool',
            tool: 'glob',
            state: {
              status: 'completed',
              title: 'glob src',
              input: { pattern: '*', cwd: '/tmp' },
              output: '/tmp/a.ts\n/tmp/b.ts',
            },
          },
        ],
      }),
    ];
    const r = normalizeOpenCode(sample(events), SRC);
    expect(r.events).toHaveLength(1);
    const toolEvent = r.events[0]!;
    expect(toolEvent.hasInput).toBe(true);
    expect(toolEvent.hasOutput).toBe(true);
    expect(JSON.parse(toolEvent.inputSummary ?? '')).toEqual({ pattern: '*', cwd: '/tmp' });
    expect(toolEvent.outputSummary).toBe('/tmp/a.ts\n/tmp/b.ts');
    // raw 仍是原始 part
    expect(JSON.parse((toolEvent as unknown as { raw?: string }).raw ?? '{}').tool).toBe('glob');
  });

  it('fix-session-detail-display 2.2：纯 step-start/step-finish 标记不产出事件', () => {
    const events = [
      msg({
        id: 'm1',
        role: 'user',
        content: [{ type: 'text', text: '启动项目' }],
      }),
      msg({
        id: 'm2',
        role: 'assistant',
        tokens: null,
        content: [
          { type: 'step-start' },
          { type: 'tool', tool: 'Bash', state: { status: 'completed', title: 'npm test' } },
          { type: 'step-finish' },
        ],
      }),
    ];
    const r = normalizeOpenCode(sample(events), SRC);
    expect(r.events.map((e) => e.kind)).toEqual(['user_prompt', 'bash']);
    expect(r.session.eventCount).toBe(2);
    expect(r.session.messageCount).toBe(2);
  });

  it('fix-session-detail-display 2.3：step-finish part 自带 tokens → 保留为 agent 事件', () => {
    const events = [
      msg({
        id: 'm1',
        role: 'assistant',
        tokens: null,
        content: [
          { type: 'step-start' },
          {
            type: 'step-finish',
            tokens: { input: 14451, output: 138, reasoning: 86, cache: { read: 0, write: 0 } },
          },
        ],
      }),
    ];
    const r = normalizeOpenCode(sample(events), SRC);
    expect(r.events).toHaveLength(1);
    expect(r.events[0]!.kind).toBe('agent');
    expect(r.events[0]!.title).toBe('agent step: success');
    expect(r.events[0]!.tokens?.input).toBe(14451);
    expect(r.session.tokenUsage.input).toBe(14451); // 不膨胀：只计一次
  });

  it('fix-session-detail-display 2.2：failed step 保留为 agent step: error', () => {
    const events = [
      msg({
        id: 'm1',
        role: 'assistant',
        content: [{ type: 'step-finish', state: { status: 'failed' } }],
      }),
    ];
    const r = normalizeOpenCode(sample(events), SRC);
    expect(r.events).toHaveLength(1);
    expect(r.events[0]!.kind).toBe('agent');
    expect(r.events[0]!.title).toBe('agent step: error');
    expect(r.events[0]!.status).toBe('error');
  });

  it('重复 event id 追加 :sequence 后缀', () => {
    const events = [
      msg({ id: 'dup', role: 'assistant' }),
      msg({ id: 'dup', role: 'assistant' }),
    ];
    const r = normalizeOpenCode(sample(events), SRC);
    expect(r.events.map((e) => e.id)).toEqual(['dup-0', 'dup-0:2']);
  });

  it('title 截断到 200 字符', () => {
    const long = 'a'.repeat(250);
    const r = normalizeOpenCode(sample([msg({ id: 'm1', role: 'user', content: [{ type: 'text', text: long }] })]), SRC);
    expect(r.events[0]?.title.length).toBe(200);
  });

  it('raw 与正文分离返回', () => {
    const r = normalizeOpenCode(
      sample([
        msg({
          id: 'm1',
          role: 'assistant',
          content: [{ type: 'tool', tool: 'Bash', state: { status: 'completed', title: 'npm test' } }],
        }),
      ]),
      SRC,
    );
    const ev = r.events[0] as unknown as { raw?: string };
    expect(ev.raw).toBeDefined();
    expect(ev.raw).toContain('"tool"');
    expect(r.events[0]?.title).not.toContain(ev.raw ?? '');
  });

  it('OTel span 三源支持', () => {
    const otel: OpenCodeOtelSpan[] = [
      { name: 'POST /chat', startTime: 1754000000000, endTime: 1754000001000, status: 'completed' },
    ];
    const r = normalizeOpenCode(
      { sourceAgent: 'OpenCode', session: opencodeFixture.session, events: [...opencodeFixture.events, ...otel] },
      SRC,
    );
    expect(r.events.length).toBe(4);
    const otelEvent = r.events.find((e) => (e as unknown as { raw?: string }).raw?.includes('POST /chat'));
    expect(otelEvent?.durationMs).toBe(1000);
  });

  // fix-adapter-turn-semantics A4 opencode 行：fixture 的消息自带 id（边界信号），
  // key = 源 message id；无活数据背书，规则由 fixture 派生（A1：opencode 仅 15 事件）。
  it('fix-adapter-turn-semantics A4：turnKey = 源 message id，同一消息的 part 共享', () => {
    const events = [
      msg({ id: 'turn-a', role: 'user', content: [{ type: 'text', text: 'q1' }] }),
      msg({
        id: 'turn-b',
        role: 'assistant',
        content: [
          { type: 'tool', tool: 'Bash', state: { status: 'completed', title: 'npm test' } },
          { type: 'text', text: 'done' },
        ],
      }),
    ];
    const r = normalizeOpenCode(sample(events), SRC);
    // user 消息 → 'turn-a'；assistant 消息的两个 part → 都 'turn-b'（不按 part 序号拆分）
    expect(r.events.map((e) => e.turnKey)).toEqual(['turn-a', 'turn-b', 'turn-b']);
    expect(r.turnKeySource).toBe('message_identity');
  });

  it('fix-adapter-turn-semantics A4：OTel span 无 message id → turnKey null', () => {
    const otel: OpenCodeOtelSpan[] = [
      { name: 'POST /chat', startTime: 1754000000000, endTime: 1754000001000 },
    ];
    const r = normalizeOpenCode(
      { sourceAgent: 'OpenCode', session: opencodeFixture.session, events: [...opencodeFixture.events, ...otel] },
      SRC,
    );
    const otelEvent = r.events.find((e) => (e as unknown as { raw?: string }).raw?.includes('POST /chat'));
    expect(otelEvent?.turnKey).toBeNull();
    expect(r.turnKeySource).toBe('message_identity');
  });
});
