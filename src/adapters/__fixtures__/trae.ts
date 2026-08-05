import type { TraeRecordShape } from '../trae.js';

export const traeFixture: {
  sourceAgent: string;
  session: TraeRecordShape['session'];
  events: TraeRecordShape['turns'];
} = {
  sourceAgent: 'Trae',
  session: { id: 'trae-s1', title: 'debug login' },
  events: [
    {
      id: 't1',
      sessionId: 'trae-s1',
      type: 'user',
      status: 'completed',
      startTime: 1754000000,
      content: 'login is broken',
    },
    {
      id: 't2',
      sessionId: 'trae-s1',
      type: 'read_file',
      status: 'completed',
      startTime: 1754000010,
      endTime: 1754000020,
    },
    {
      id: 't3',
      sessionId: 'trae-s1',
      type: 'llm',
      status: 'completed',
      startTime: 1754000030,
      endTime: 1754000050,
      contentSource: 'llm_default',
      tokenUsage: 200,
      itemTokenUsage: 120,
      content: 'found the bug',
    },
    {
      id: 't4',
      sessionId: 'trae-s1',
      type: 'bash',
      status: 'paused',
      startTime: 1754000060,
      command: 'npm test',
    },
  ],
};
