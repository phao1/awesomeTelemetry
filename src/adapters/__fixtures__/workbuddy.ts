import type { WorkBuddyRawMessage } from '../workbuddy.js';

export const workbuddyFixture: {
  sourceAgent: string;
  session: { id?: string; title?: string };
  events: WorkBuddyRawMessage[];
} = {
  sourceAgent: 'WorkBuddy',
  session: { id: 'wb-s1' },
  events: [
    {
      id: 'wb-1',
      type: 'user',
      role: 'user',
      timestamp: '2026-08-01T00:00:00.000Z',
      content: '<user_query>optimize the loader</user_query>',
    },
    {
      id: 'wb-2',
      type: 'function_call',
      callId: 'call-1',
      toolName: 'Bash',
      timestamp: '2026-08-01T00:00:01.000Z',
      content: 'run: npm test',
    },
    {
      id: 'wb-3',
      type: 'function_call_result',
      callId: 'call-1',
      toolName: 'Bash',
      timestamp: '2026-08-01T00:00:03.000Z',
      content: 'Exit Code: 1\nfailure output',
      rawUsage: { credit: 0.002 },
    },
    {
      id: 'wb-4',
      type: 'function_call',
      callId: 'call-2',
      toolName: 'Edit',
      timestamp: '2026-08-01T00:00:04.000Z',
      content: 'edit loader.ts',
      rawUsage: { credit: 0.001 },
    },
  ],
};
