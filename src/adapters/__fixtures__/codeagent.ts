import type { ClaudeRawRow } from '../claude-code.js';

export const codeagentFixture: { sourceAgent: string; session: Record<string, never>; events: ClaudeRawRow[] } = {
  sourceAgent: 'CodeAgent',
  session: {},
  events: [
    {
      type: 'user',
      sessionId: 'ca-s1',
      timestamp: '2026-08-01T00:00:00.000Z',
      message: { id: 'u1', role: 'user', content: [{ type: 'text', text: 'refactor utils' }] },
    },
    {
      type: 'assistant',
      sessionId: 'ca-s1',
      timestamp: '2026-08-01T00:00:01.000Z',
      message: {
        id: 'a1',
        role: 'assistant',
        content: [{ type: 'text', text: 'doing it' }],
        usage: { input_tokens: 10, output_tokens: 5 },
      },
    },
    {
      type: 'assistant',
      sessionId: 'ca-s1',
      subtype: 'file-history-snapshot',
      timestamp: '2026-08-01T00:00:02.000Z',
      message: { id: 'snap-1', role: 'assistant', content: [{ type: 'snapshot', text: 'snapshot data' }] },
    },
  ],
};
