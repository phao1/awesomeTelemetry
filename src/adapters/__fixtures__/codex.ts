import type { CodexRawRow } from '../codex.js';

/**
 * 形状取自真实 rollout 文件（~/.codex/sessions/<date>/rollout-*.jsonl）：
 * - 会话元数据在 `session_meta`（cwd / session_id），模型在 `turn_context.model`；
 * - 用量**不挂在消息上**，而是独立的 `event_msg` / `token_count` 行，
 *   `total_token_usage` 累计、`last_token_usage` 增量；
 * - `input_tokens` 含 cached 与 cache_write，`reasoning_output_tokens` ⊂ `output_tokens`。
 */
export const codexFixture: { sourceAgent: string; session: Record<string, never>; events: CodexRawRow[] } = {
  sourceAgent: 'Codex',
  session: {},
  events: [
    {
      timestamp: '2026-08-01T00:00:00.000Z',
      type: 'session_meta',
      payload: {
        session_id: 'codex-s1',
        cwd: '/tmp/proj',
        model_provider: 'deepseek',
      },
    },
    {
      timestamp: '2026-08-01T00:00:00.100Z',
      type: 'turn_context',
      payload: {
        cwd: '/tmp/proj',
        model: 'deepseek-v4-flash',
      },
    },
    {
      timestamp: '2026-08-01T00:00:00.200Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
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
      timestamp: '2026-08-01T00:00:03.500Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          total_token_usage: {
            input_tokens: 10, cached_input_tokens: 3, cache_write_input_tokens: 0,
            output_tokens: 4, reasoning_output_tokens: 2, total_tokens: 14,
          },
          last_token_usage: {
            input_tokens: 10, cached_input_tokens: 3, cache_write_input_tokens: 0,
            output_tokens: 4, reasoning_output_tokens: 2, total_tokens: 14,
          },
        },
      },
    },
    {
      timestamp: '2026-08-01T00:00:04.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'all green' }],
      },
    },
    {
      timestamp: '2026-08-01T00:00:04.500Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          total_token_usage: {
            input_tokens: 25, cached_input_tokens: 8, cache_write_input_tokens: 0,
            output_tokens: 8, reasoning_output_tokens: 3, total_tokens: 33,
          },
          last_token_usage: {
            input_tokens: 15, cached_input_tokens: 5, cache_write_input_tokens: 0,
            output_tokens: 4, reasoning_output_tokens: 1, total_tokens: 19,
          },
        },
      },
    },
  ],
};
