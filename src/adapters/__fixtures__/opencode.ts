import type { OpenCodeRawSample } from '../opencode.js';

/** 最小 OpenCode fixture：user + tool + llm，覆盖增量 cacheRead（#4）与 subagent 标题。 */
export const opencodeFixture: {
  sourceAgent: string;
  session: OpenCodeRawSample['session'];
  events: OpenCodeRawSample['messages'];
} = {
  sourceAgent: 'OpenCode',
  session: {
    id: 'oc-session-1',
    title: 'fix build (@main subagent)',
    directory: '/home/u/proj',
    time: { created: 1754000000000, updated: 1754000060000 },
  },
  events: [
    {
      id: 'm-user',
      role: 'user',
      sessionID: 'oc-session-1',
      time: { created: 1754000000000 },
      tokens: null,
      content: [{ type: 'text', text: 'please fix the failing test' }],
    },
    {
      id: 'm-tool',
      role: 'assistant',
      sessionID: 'oc-session-1',
      time: { created: 1754000010000, completed: 1754000030000 },
      tokens: { input: 10, output: 5, cache: { read: 100, write: 0 } },
      content: [
        {
          type: 'tool',
          tool: 'Bash',
          state: { status: 'completed', title: 'npm test', output: 'ok' },
        },
      ],
    },
    {
      id: 'm-llm',
      role: 'assistant',
      sessionID: 'oc-session-1',
      time: { created: 1754000040000 },
      tokens: { input: 15, output: 8, reasoning: 2, cache: { read: 150, write: 5 } },
      content: [{ type: 'text', text: 'tests pass now' }],
    },
  ],
};

/**
 * 归因专用 fixture（change calibrate-tokens-and-compare-report §2）：
 * 旧形状 `type === 'step'` 的 carrier（映射成 kind='agent' 并携带 token）+ 同消息
 * 的 text part（kind='llm'，无 token）。真实 OpenCode v2+ 的 part 是
 * step-start/reasoning/text/step-finish，direction 实测见 speed-metrics.ts
 * attributeTokensToLlmEvents 注释。
 */
export const opencodeCarrierFixture: {
  sourceAgent: string;
  session: OpenCodeRawSample['session'];
  events: OpenCodeRawSample['messages'];
} = {
  sourceAgent: 'OpenCode',
  session: {
    id: 'oc-carrier-1',
    title: 'carrier attribution',
    directory: '/home/u/proj',
    time: { created: 1754000100000, updated: 1754000120000 },
  },
  events: [
    {
      id: 'm-user',
      role: 'user',
      sessionID: 'oc-carrier-1',
      time: { created: 1754000100000 },
      tokens: null,
      content: [{ type: 'text', text: 'make it work' }],
    },
    {
      id: 'm-a',
      role: 'assistant',
      sessionID: 'oc-carrier-1',
      time: { created: 1754000110000 },
      tokens: { input: 40, output: 25, reasoning: 5, cache: { read: 60, write: 3 } },
      content: [
        { type: 'step', state: { status: 'completed', title: 'carrier A' } },
        { type: 'text', text: 'answer A' },
      ],
    },
    {
      id: 'm-b',
      role: 'assistant',
      sessionID: 'oc-carrier-1',
      time: { created: 1754000120000 },
      tokens: { input: 10, output: 7, cache: { read: 20, write: 0 } },
      content: [
        { type: 'step', state: { status: 'completed', title: 'carrier B' } },
        { type: 'text', text: 'answer B' },
      ],
    },
  ],
};
