import type { CodexRawRow } from '../codex.js';

export const codexFixture: { sourceAgent: string; session: Record<string, never>; events: CodexRawRow[] } = {
  sourceAgent: 'Codex',
  session: {},
  events: [
    {
      timestamp: '2026-08-01T00:00:00.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        session_id: 'codex-s1',
        cwd: '/tmp/proj',
        content: [{ type: 'input_text', text: 'run the tests' }],
      },
    },
    {
      timestamp: '2026-08-01T00:00:01.000Z',
      type: 'response_item',
      payload: {
        type: 'function_call',
        call_id: 'call-1',
        name: 'shell',
        arguments: 'npm test',
        usage: { input_tokens: 10, output_tokens: 0, reasoning_tokens: 2 },
      },
    },
    {
      timestamp: '2026-08-01T00:00:03.000Z',
      type: 'response_item',
      payload: {
        type: 'function_call_output',
        call_id: 'call-1',
        output: '1 passed',
      },
    },
    {
      timestamp: '2026-08-01T00:00:04.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'all green' }],
        usage: { input_tokens: 5, output_tokens: 8, reasoning_tokens: 1, cache_read_input_tokens: 3 },
      },
    },
  ],
};
