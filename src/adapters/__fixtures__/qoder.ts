import type { QoderRawRow } from '../qoder.js';

export const qoderFixture: {
  sourceAgent: string;
  session: { id?: string; title?: string };
  events: QoderRawRow[];
} = {
  sourceAgent: 'Qoder',
  session: { id: 'qoder-s1', title: 'fix slow query' },
  events: [
    {
      id: 'q1',
      role: 'user',
      timestamp: '2026-08-01T00:00:00.000Z',
      content: 'why is it slow',
    },
    {
      id: 'q2',
      type: 'bash',
      timestamp: '2026-08-01T00:00:02.000Z',
      toolName: 'Bash',
      command: 'npm test',
      tokens: { input: 10, output: 2, reasoning: 0 },
    },
    {
      id: 'q3',
      type: 'llm',
      timestamp: '2026-08-01T00:00:05.000Z',
      content: 'missing index',
      tokens: { input: 5, output: 8, reasoning: 1 },
    },
  ],
};
