import type { OpenCodeRawSample } from '../opencode.js';

/** 最小 OpenCode fixture：user + tool + llm，覆盖累积 cacheRead 与 subagent 标题。 */
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
