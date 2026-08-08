import { describe, expect, it } from 'vitest';

import type { TurnKeySource } from '../core/trace-types.js';
import { codeartsAdapter } from './codearts.js';
import { codeagent2Adapter } from './codeagent2.js';
import { opencodeAdapter } from './opencode.js';
import { traeAdapter } from './trae.js';
import { qoderAdapter } from './qoder.js';
import { workbuddyAdapter } from './workbuddy.js';
import { codeAgentAdapter } from './codeagent.js';

import { codeartsFixture } from './__fixtures__/codearts.js';
import { codeagent2Fixture } from './__fixtures__/codeagent2.js';
import { opencodeFixture } from './__fixtures__/opencode.js';
import { traeFixture } from './__fixtures__/trae.js';
import { qoderFixture } from './__fixtures__/qoder.js';
import { workbuddyFixture } from './__fixtures__/workbuddy.js';
import { codeagentFixture } from './__fixtures__/codeagent.js';

const SRC = '/tmp/turn-keys';

const TURN_KEY_SOURCES: readonly TurnKeySource[] = [
  'native_boundary',
  'stream_structure',
  'message_identity',
  'unavailable',
];

// fix-adapter-turn-semantics tasks.md 4.7：每个 adapter 都必须声明 turn-key
// provenance（A5 封闭四值）。codex / claude 由 §2 / §3 各自窗口的测试覆盖。
describe('fix-adapter-turn-semantics 4.7：每个 adapter 声明 provenance', () => {
  it('七个 §4 adapter 的 fixture 记录都携带 closed-set provenance', () => {
    const sources: TurnKeySource[] = [
      codeartsAdapter.normalize(
        { sourceAgent: 'CodeArts', session: codeartsFixture.session, events: codeartsFixture.events },
        SRC,
      ).turnKeySource,
      opencodeAdapter.normalize(
        { sourceAgent: 'OpenCode', session: opencodeFixture.session, events: opencodeFixture.events },
        SRC,
      ).turnKeySource,
      codeagent2Adapter.normalize(
        { sourceAgent: 'CodeMate', session: codeagent2Fixture.session, events: codeagent2Fixture.events },
        SRC,
      ).turnKeySource,
      traeAdapter.normalize(
        { sourceAgent: 'Trae', session: traeFixture.session, events: traeFixture.events },
        SRC,
      ).turnKeySource,
      qoderAdapter.normalize(
        { sourceAgent: 'Qoder', session: qoderFixture.session, events: qoderFixture.events },
        SRC,
      ).turnKeySource,
      workbuddyAdapter.normalize(
        { sourceAgent: 'WorkBuddy', session: workbuddyFixture.session, events: workbuddyFixture.events },
        SRC,
      ).turnKeySource,
      codeAgentAdapter.normalize(
        { sourceAgent: 'CodeAgent', session: {}, events: codeagentFixture.events },
        SRC,
      ).turnKeySource,
    ];
    for (const source of sources) {
      expect(TURN_KEY_SOURCES).toContain(source);
    }
    // 本 change 的期望分布：opencode 系三个 + trae + codeagent 按源消息/回合 id
    // 分组（message_identity）；qoder / workbuddy 的 fixture 无边界信号（unavailable）。
    expect(sources).toEqual([
      'message_identity',
      'message_identity',
      'message_identity',
      'message_identity',
      'unavailable',
      'unavailable',
      'message_identity',
    ]);
  });
});

// fix-adapter-turn-semantics tasks.md 4.6：没有任何 adapter 允许用时间邻近或事件计数
// 合成 turn key。每个用例都构造「同时间戳 / 相邻时间戳」的输入，断言 key 仍然只由
// 源标识决定（或诚实地为 null）。
describe('fix-adapter-turn-semantics 4.6：禁止从时间邻近 / 事件计数合成 turn key', () => {
  it('opencode 系：同时间戳的不同消息 → key 不同；同消息多 part → key 相同', () => {
    const events = [
      {
        id: 'm-a',
        role: 'user' as const,
        sessionID: 'oc-s1',
        time: { created: 1754000000000 },
        tokens: null,
        content: [{ type: 'text', text: 'q' }],
      },
      {
        id: 'm-b',
        role: 'assistant' as const,
        sessionID: 'oc-s1',
        time: { created: 1754000000000 },
        tokens: null,
        content: [
          { type: 'tool', tool: 'Bash', state: { status: 'completed', title: 't' } },
          { type: 'text', text: 'a' },
        ],
      },
    ];
    for (const adapter of [opencodeAdapter, codeartsAdapter, codeagent2Adapter]) {
      const r = adapter.normalize(
        { sourceAgent: 'x', session: { id: 'oc-s1' }, events },
        SRC,
      );
      // 两个消息共享同一 created 时间戳：按时间邻近合成会得到相同 key；
      // 实际按源 message id —— 不同消息不同 key，同消息两个 part 同 key。
      expect(r.events.map((e) => e.turnKey)).toEqual(['m-a', 'm-b', 'm-b']);
    }
  });

  it('trae：同 startTime 的不同 turn → key 不同（按源 turn id，不按时间）', () => {
    const turns = [
      { id: 'r1', type: 'llm', startTime: 1754000000 },
      { id: 'r2', type: 'llm', startTime: 1754000000 },
    ];
    const r = traeAdapter.normalize(
      { sourceAgent: 'Trae', session: { id: 'trae-s1' }, events: turns },
      SRC,
    );
    expect(r.events.map((e) => e.turnKey)).toEqual(['r1', 'r2']);
  });

  it('qoder：同时间戳的多行 → 全部 null（fixture 无边界信号，禁止时间/计数合成）', () => {
    const rows = [
      { id: 'q1', type: 'llm', timestamp: '2026-08-01T00:00:00.000Z' },
      { id: 'q2', type: 'llm', timestamp: '2026-08-01T00:00:00.000Z' },
    ];
    const r = qoderAdapter.normalize(
      { sourceAgent: 'Qoder', session: { id: 'qoder-s1' }, events: rows },
      SRC,
    );
    expect(r.events.map((e) => e.turnKey)).toEqual([null, null]);
  });

  it('workbuddy：同时间戳的多条消息 → 全部 null（callId 不升级为周期 key）', () => {
    const messages = [
      { id: 'w1', type: 'function_call', callId: 'c1', toolName: 'Bash', timestamp: '2026-08-01T00:00:00.000Z' },
      { id: 'w2', type: 'function_call', callId: 'c2', toolName: 'Bash', timestamp: '2026-08-01T00:00:00.000Z' },
    ];
    const r = workbuddyAdapter.normalize(
      { sourceAgent: 'WorkBuddy', session: { id: 'wb-s1' }, events: messages },
      SRC,
    );
    expect(r.events.map((e) => e.turnKey)).toEqual([null, null]);
  });

  it('codeagent：同时间戳的不同 assistant 行 → key 不同（继承 claude 的 message.id 规则）', () => {
    const rows = [
      {
        type: 'assistant',
        sessionId: 'ca-s1',
        timestamp: '2026-08-01T00:00:00.000Z',
        message: { id: 'a1', role: 'assistant', content: [{ type: 'text', text: 'x' }] },
      },
      {
        type: 'assistant',
        sessionId: 'ca-s1',
        timestamp: '2026-08-01T00:00:00.000Z',
        message: { id: 'a2', role: 'assistant', content: [{ type: 'text', text: 'y' }] },
      },
    ];
    const r = codeAgentAdapter.normalize(
      { sourceAgent: 'CodeAgent', session: {}, events: rows },
      SRC,
    );
    // A3 rule 3（§6 验证修复）：claude 系 message.id 加会话 id 前缀。
    expect(r.events.map((e) => e.turnKey)).toEqual([
      `${r.session.id}:a1`, `${r.session.id}:a2`,
    ]);
  });
});
