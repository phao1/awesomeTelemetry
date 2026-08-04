import type { ClaudeRawRow } from '../claude-code.js';

export const claudeFixture: { sourceAgent: string; session: Record<string, never>; events: ClaudeRawRow[] } = {
  sourceAgent: 'Claude',
  session: {},
  events: [
    {
      type: 'user',
      sessionId: 'claude-s1',
      timestamp: '2026-08-01T00:00:00.000Z',
      message: {
        id: 'msg-user-1',
        role: 'user',
        content: [{ type: 'text', text: 'explain the bug in parse.ts' }],
      },
    },
    {
      type: 'assistant',
      sessionId: 'claude-s1',
      timestamp: '2026-08-01T00:00:05.000Z',
      message: {
        id: 'msg-a1',
        role: 'assistant',
        content: [
          { type: 'text', text: 'I will look at the parser' },
          { type: 'tool_use', id: 'toolu-1', name: 'Read', input: { file_path: 'parse.ts' } },
        ],
        usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 10, cache_creation_input_tokens: 0 },
      },
    },
    {
      type: 'assistant',
      sessionId: 'claude-s1',
      timestamp: '2026-08-01T00:00:10.000Z',
      message: {
        id: 'msg-a2',
        role: 'assistant',
        content: [{ type: 'text', text: 'Found it: missing null check' }],
        usage: { input_tokens: 50, output_tokens: 30, cache_read_input_tokens: 5, cache_creation_input_tokens: 2 },
      },
    },
  ],
};
