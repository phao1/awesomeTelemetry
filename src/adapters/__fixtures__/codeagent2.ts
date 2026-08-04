import type { OpenCodeRawSample } from '../opencode.js';

export const codeagent2Fixture: {
  sourceAgent: string;
  session: OpenCodeRawSample['session'];
  events: OpenCodeRawSample['messages'];
} = {
  sourceAgent: 'CodeMate',
  session: { id: 'cm-s1', title: 'fix types' },
  events: [
    {
      id: 'cm-m1',
      role: 'user',
      sessionID: 'cm-s1',
      time: { created: 1754000000000 },
      tokens: null,
      content: [{ type: 'text', text: 'fix the type error' }],
    },
    {
      id: 'cm-m2',
      role: 'assistant',
      sessionID: 'cm-s1',
      time: { created: 1754000010000 },
      tokens: { input: 8, output: 4, cache: { read: 30, write: 0 } },
      content: [{ type: 'tool', tool: 'Grep', state: { status: 'completed', title: 'grep usage' } }],
    },
  ],
};
