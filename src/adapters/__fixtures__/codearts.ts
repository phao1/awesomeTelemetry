import type { OpenCodeRawSample } from '../opencode.js';

export const codeartsFixture: {
  sourceAgent: string;
  session: OpenCodeRawSample['session'];
  events: OpenCodeRawSample['messages'];
} = {
  sourceAgent: 'CodeArts',
  session: { id: 'ca2-s1', title: 'agent task' },
  events: [
    {
      id: 'ca2-m1',
      role: 'user',
      sessionID: 'ca2-s1',
      time: { created: 1754000000000 },
      tokens: null,
      content: [{ type: 'text', text: 'write a parser' }],
    },
    {
      id: 'ca2-m2',
      role: 'assistant',
      sessionID: 'ca2-s1',
      time: { created: 1754000010000 },
      tokens: { input: 20, output: 10, cache: { read: 50, write: 0 } },
      content: [{ type: 'tool', tool: 'Write', state: { status: 'completed', title: 'write parser.ts' } }],
    },
  ],
};
