import type { CodexRawRow } from '../codex.js';

/**
 * 48 行真实 rollout 的结构化转录（tasks.md 2.14 / design A1）：
 * ~/.codex/sessions/2026/08/05/rollout-2026-08-05T20-15-35-019fd1d9-bc0b-7cb0-93c9-b46cf3be52d4.jsonl
 *
 * 保留所有承载断言的行属性（顶层 type、payload type/id/role/call_id/name、
 * 时间戳、token_count 的全部用量数字、turn_context 的 model/cwd）；超长正文
 * （系统提示词、工具输出、base_instructions）被截断为代表性片段，不改变结构。
 * 该文件验证：48 行 → 9 个决策周期，边界由 response_item 链（紧邻前一条为
 * function_call_output）推导，`task_started` 不是边界（A1 结论 1）。
 */
export const codexRollout2026_08_05Fixture: {
  sourceAgent: string;
  session: Record<string, never>;
  events: CodexRawRow[];
} = {
  sourceAgent: 'Codex',
  session: {},
  events: [
    // 1  session_meta —— 不是事件（A6），但其 session_id/cwd 供会话元数据使用
    {
      timestamp: '2026-08-05T12:15:35.997Z',
      type: 'session_meta',
      payload: {
        id: '019fd1d9-bc0b-7cb0-93c9-b46cf3be52d4',
        session_id: '019fd1d9-bc0b-7cb0-93c9-b46cf3be52d4',
        cwd: '/Users/howell/Documents/Coding/awesomeTelemetry/awesomeTelemetry',
        model_provider: 'deepseek',
      },
    },
    // 2  task_started —— 用户提交标记，不是周期边界（A1 结论 1）
    {
      timestamp: '2026-08-05T12:15:35.998Z',
      type: 'event_msg',
      payload: { type: 'task_started', turn_id: '019fd1d9-bccb-74b3-9f0d-6126b5aa86ed' },
    },
    // 3  response_item message role=developer —— 系统提示词（A6：→ system）
    {
      timestamp: '2026-08-05T12:15:39.698Z',
      type: 'response_item',
      payload: {
        type: 'message',
        id: 'msg_019fd1d9-ccb2-7170-869b-413413308ce0',
        role: 'developer',
        content: [{ type: 'input_text', text: '<app-context>\n# Codex desktop context\n- …(elided)' }],
      },
    },
    // 4  response_item message role=developer —— 系统提示词
    {
      timestamp: '2026-08-05T12:15:39.699Z',
      type: 'response_item',
      payload: {
        type: 'message',
        id: 'msg_019fd1d9-ccb2-7170-869b-4145825ba38e',
        role: 'developer',
        content: [{ type: 'input_text', text: 'You are `/root`, the primary agent …(elided)' }],
      },
    },
    // 5  response_item message role=developer —— 系统提示词
    {
      timestamp: '2026-08-05T12:15:39.699Z',
      type: 'response_item',
      payload: {
        type: 'message',
        id: 'msg_019fd1d9-ccb2-7170-869b-415b728382db',
        role: 'developer',
        content: [{ type: 'input_text', text: '<multi_agent_mode>…(elided)' }],
      },
    },
    // 6  response_item message role=user —— 回放的项目上下文
    {
      timestamp: '2026-08-05T12:15:39.699Z',
      type: 'response_item',
      payload: {
        type: 'message',
        id: 'msg_019fd1d9-ccb2-7170-869b-41683da835fe',
        role: 'user',
        content: [{ type: 'input_text', text: '# AGENTS.md instructions …(elided)' }],
      },
    },
    // 7  world_state —— 保持 system 事件（A6）
    {
      timestamp: '2026-08-05T12:15:39.699Z',
      type: 'world_state',
      payload: { full: true },
    },
    // 8  turn_context —— system 事件；model/cwd 供会话元数据（A6）
    {
      timestamp: '2026-08-05T12:15:39.699Z',
      type: 'turn_context',
      payload: {
        turn_id: '019fd1d9-bccb-74b3-9f0d-6126b5aa86ed',
        cwd: '/Users/howell/Documents/Coding/awesomeTelemetry/awesomeTelemetry',
        model: 'deepseek-v4-flash',
      },
    },
    // 9  response_item message role=user —— 真实提问
    {
      timestamp: '2026-08-05T12:15:39.714Z',
      type: 'response_item',
      payload: {
        type: 'message',
        id: 'msg_019fd1d9-ccc2-7cc2-afce-317b03151ba1',
        role: 'user',
        content: [{ type: 'input_text', text: '[@CodeArts Agent 2](plugin://…(elided)' }],
      },
    },
    // 10 event_msg user_message —— 保持 system（A6）
    {
      timestamp: '2026-08-05T12:15:39.714Z',
      type: 'event_msg',
      payload: { type: 'user_message', message: '[@CodeArts Agent 2](plugin://…(elided)' },
    },
    // 11 response_item reasoning —— 周期 0 的推理（A6：→ reasoning）
    {
      timestamp: '2026-08-05T12:15:42.593Z',
      type: 'response_item',
      payload: {
        type: 'reasoning',
        id: '8c7d4132-1673-4fed-9509-3085a0245e09',
        content: [{ type: 'reasoning_text', text: 'The user is asking me to use the CodeArts Agent 2 app…(elided)' }],
      },
    },
    // 12 response_item function_call —— 工具调用（→ tool）
    {
      timestamp: '2026-08-05T12:15:42.868Z',
      type: 'response_item',
      payload: {
        type: 'function_call',
        id: '0fc1f38e-dec5-4519-9529-b2490db1b732',
        name: 'exec_command',
        call_id: 'call_00_JAPFZI4HzvF1j5Rh9juD2655',
        arguments: '{"cmd": "cat …(elided)',
      },
    },
    // 13 response_item function_call_output —— 周期 0 的收尾：下一条 response_item 开启新周期
    {
      timestamp: '2026-08-05T12:15:42.937Z',
      type: 'response_item',
      payload: {
        type: 'function_call_output',
        id: 'fco_019fd1d9-d959-7a82-95f1-52a65b2ba913',
        call_id: 'call_00_JAPFZI4HzvF1j5Rh9juD2655',
        output: 'Chunk ID: cae15c\n…(elided)',
      },
    },
    // 14 event_msg token_count —— 用量挂载到周期 0（无 assistant 消息 → 单个 llm carrier）
    {
      timestamp: '2026-08-05T12:15:42.938Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          total_token_usage: {
            input_tokens: 18613, cached_input_tokens: 11776, cache_write_input_tokens: 0,
            output_tokens: 276, reasoning_output_tokens: 195, total_tokens: 18889,
          },
          last_token_usage: {
            input_tokens: 18613, cached_input_tokens: 11776, cache_write_input_tokens: 0,
            output_tokens: 276, reasoning_output_tokens: 195, total_tokens: 18889,
          },
          model_context_window: 996147,
        },
      },
    },
    // 15 response_item reasoning —— 新周期 1（紧邻前一条为 function_call_output）
    {
      timestamp: '2026-08-05T12:15:48.735Z',
      type: 'response_item',
      payload: {
        type: 'reasoning',
        id: 'a052b6cb-5973-4149-a1dd-6327338c6755',
        content: [{ type: 'reasoning_text', text: 'The user wants me to interact with the CodeArts Agent 2 app…(elided)' }],
      },
    },
    // 16 event_msg agent_message —— 与 17 行 response_item/message 成对（A6：丢弃镜像）
    {
      timestamp: '2026-08-05T12:15:49.014Z',
      type: 'event_msg',
      payload: { type: 'agent_message', message: '我先读取计算机控制技能并连接 CodeArts Agent 应用。' },
    },
    // 17 response_item message role=assistant —— 周期 1 的真实回复（承载该周期 token 用量）
    {
      timestamp: '2026-08-05T12:15:49.014Z',
      type: 'response_item',
      payload: {
        type: 'message',
        id: '2cb495b1-7ab2-4b47-8af3-842bcc05d5d4',
        role: 'assistant',
        content: [{ type: 'output_text', text: '我先读取计算机控制技能并连接 CodeArts Agent 应用。' }],
      },
    },
    // 18 response_item function_call
    {
      timestamp: '2026-08-05T12:15:49.281Z',
      type: 'response_item',
      payload: {
        type: 'function_call',
        id: '6a461ff0-ea73-4a07-8e53-9b793f3b5372',
        name: 'exec_command',
        call_id: 'call_00_gsA0ya5xBd0lgPGsKuHg1028',
        arguments: '{"cmd": "ls …(elided)',
      },
    },
    // 19 response_item function_call_output
    {
      timestamp: '2026-08-05T12:15:49.644Z',
      type: 'response_item',
      payload: {
        type: 'function_call_output',
        id: 'fco_019fd1d9-f38b-7e03-9e78-1111eec4432c',
        call_id: 'call_00_gsA0ya5xBd0lgPGsKuHg1028',
        output: 'Chunk ID: 03a2c3\n…(elided)',
      },
    },
    // 20 event_msg token_count —— 周期 1 的用量 → 挂到 17 行的 assistant 事件
    {
      timestamp: '2026-08-05T12:15:49.644Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          total_token_usage: {
            input_tokens: 41568, cached_input_tokens: 30592, cache_write_input_tokens: 0,
            output_tokens: 902, reasoning_output_tokens: 731, total_tokens: 42470,
          },
          last_token_usage: {
            input_tokens: 22955, cached_input_tokens: 18816, cache_write_input_tokens: 0,
            output_tokens: 626, reasoning_output_tokens: 536, total_tokens: 23581,
          },
          model_context_window: 996147,
        },
      },
    },
    // 21 response_item reasoning —— 新周期 2
    {
      timestamp: '2026-08-05T12:15:51.499Z',
      type: 'response_item',
      payload: {
        type: 'reasoning',
        id: '987ec1ba-9375-451d-966f-bbb673fef2ff',
        content: [{ type: 'reasoning_text', text: 'The computer-use client script exists. Now…(elided)' }],
      },
    },
    // 22 response_item function_call
    {
      timestamp: '2026-08-05T12:15:51.855Z',
      type: 'response_item',
      payload: {
        type: 'function_call',
        id: 'b076cbb2-2a3f-4690-a3b6-28f2abd4f0b0',
        name: 'exec_command',
        call_id: 'call_00_lQAnbDWq7x3SEVZFZpY79009',
        arguments: '{"cmd": "node -i …(elided)',
      },
    },
    // 23 response_item function_call_output
    {
      timestamp: '2026-08-05T12:15:53.036Z',
      type: 'response_item',
      payload: {
        type: 'function_call_output',
        id: 'fco_019fd1da-00cc-7ed2-b3ff-f0df4b8ed123',
        call_id: 'call_00_lQAnbDWq7x3SEVZFZpY79009',
        output: 'Chunk ID: 1c402e\n…(elided)',
      },
    },
    // 24 event_msg token_count —— 周期 2 无 assistant 消息 → 单个 llm carrier
    {
      timestamp: '2026-08-05T12:15:53.036Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          total_token_usage: {
            input_tokens: 65211, cached_input_tokens: 54144, cache_write_input_tokens: 0,
            output_tokens: 1048, reasoning_output_tokens: 788, total_tokens: 66259,
          },
          last_token_usage: {
            input_tokens: 23643, cached_input_tokens: 23552, cache_write_input_tokens: 0,
            output_tokens: 146, reasoning_output_tokens: 57, total_tokens: 23789,
          },
          model_context_window: 996147,
        },
      },
    },
    // 25 response_item reasoning —— 新周期 3
    {
      timestamp: '2026-08-05T12:15:55.492Z',
      type: 'response_item',
      payload: {
        type: 'reasoning',
        id: '107c607f-f678-4b12-be1e-500ae2e562e7',
        content: [{ type: 'reasoning_text', text: 'Now I have a node REPL session…(elided)' }],
      },
    },
    // 26 response_item function_call
    {
      timestamp: '2026-08-05T12:15:56.160Z',
      type: 'response_item',
      payload: {
        type: 'function_call',
        id: '996b1e59-338c-477e-891b-0a39abe2fae2',
        name: 'write_stdin',
        call_id: 'call_00_n7JhF2DoEMGIcVUd568u7545',
        arguments: '{"session_id": 35710, …(elided)',
      },
    },
    // 27 response_item function_call_output
    {
      timestamp: '2026-08-05T12:16:11.264Z',
      type: 'response_item',
      payload: {
        type: 'function_call_output',
        id: 'fco_019fd1da-4800-78b3-90a8-2e3149c9606a',
        call_id: 'call_00_n7JhF2DoEMGIcVUd568u7545',
        output: 'Chunk ID: bc70eb\n…(elided)',
      },
    },
    // 28 event_msg token_count —— 周期 3 无 assistant 消息 → carrier
    {
      timestamp: '2026-08-05T12:16:11.273Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          total_token_usage: {
            input_tokens: 89074, cached_input_tokens: 77824, cache_write_input_tokens: 0,
            output_tokens: 1406, reasoning_output_tokens: 991, total_tokens: 90480,
          },
          last_token_usage: {
            input_tokens: 23863, cached_input_tokens: 23680, cache_write_input_tokens: 0,
            output_tokens: 358, reasoning_output_tokens: 203, total_tokens: 24221,
          },
          model_context_window: 996147,
        },
      },
    },
    // 29 response_item reasoning —— 新周期 4
    {
      timestamp: '2026-08-05T12:16:13.401Z',
      type: 'response_item',
      payload: {
        type: 'reasoning',
        id: 'f0687cce-2137-4091-a52b-8646bde6007a',
        content: [{ type: 'reasoning_text', text: 'The error says "Computer Use requires nodeRepl…(elided)' }],
      },
    },
    // 30 response_item function_call
    {
      timestamp: '2026-08-05T12:16:13.767Z',
      type: 'response_item',
      payload: {
        type: 'function_call',
        id: '848b10d2-bb70-4135-bb1e-dd72de179bbf',
        name: 'exec_command',
        call_id: 'call_00_o4iJ5TQs8iYj2Tjb0rVC8833',
        arguments: '{"cmd": "sed -n …(elided)',
      },
    },
    // 31 response_item function_call_output
    {
      timestamp: '2026-08-05T12:16:13.817Z',
      type: 'response_item',
      payload: {
        type: 'function_call_output',
        id: 'fco_019fd1da-51f9-7582-b3fa-a07a4e408551',
        call_id: 'call_00_o4iJ5TQs8iYj2Tjb0rVC8833',
        output: 'Chunk ID: f6627d\n…(elided)',
      },
    },
    // 32 event_msg token_count —— 周期 4 无 assistant 消息 → carrier
    {
      timestamp: '2026-08-05T12:16:13.817Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          total_token_usage: {
            input_tokens: 113649, cached_input_tokens: 102016, cache_write_input_tokens: 0,
            output_tokens: 1600, reasoning_output_tokens: 1099, total_tokens: 115249,
          },
          last_token_usage: {
            input_tokens: 24575, cached_input_tokens: 24192, cache_write_input_tokens: 0,
            output_tokens: 194, reasoning_output_tokens: 108, total_tokens: 24769,
          },
          model_context_window: 996147,
        },
      },
    },
    // 33 response_item reasoning —— 新周期 5
    {
      timestamp: '2026-08-05T12:16:17.087Z',
      type: 'response_item',
      payload: {
        type: 'reasoning',
        id: 'ee54a307-976c-479e-a72f-0b8182e1c860',
        content: [{ type: 'reasoning_text', text: 'The computer-use client needs `nodeRepl…(elided)' }],
      },
    },
    // 34 event_msg agent_message —— 与 35 行成对（A6：丢弃镜像）
    {
      timestamp: '2026-08-05T12:16:17.364Z',
      type: 'event_msg',
      payload: { type: 'agent_message', message: '需要在 Node 会话里模拟 nodeRepl 环境。…(elided)' },
    },
    // 35 response_item message role=assistant —— 周期 5 的真实回复（承载该周期 token 用量）
    {
      timestamp: '2026-08-05T12:16:17.364Z',
      type: 'response_item',
      payload: {
        type: 'message',
        id: '873b490e-4f90-4ce8-a392-40fef3c6e761',
        role: 'assistant',
        content: [{ type: 'output_text', text: '需要在 Node 会话里模拟 nodeRepl 环境。…(elided)' }],
      },
    },
    // 36 response_item function_call
    {
      timestamp: '2026-08-05T12:16:18.070Z',
      type: 'response_item',
      payload: {
        type: 'function_call',
        id: '465f12bc-3d41-4fd9-80da-c82c43fab8a5',
        name: 'exec_command',
        call_id: 'call_00_sHXwhrZu3tXorC09xnJT1739',
        arguments: '{"cmd": "find …(elided)',
      },
    },
    // 37 response_item function_call_output
    {
      timestamp: '2026-08-05T12:16:34.580Z',
      type: 'response_item',
      payload: {
        type: 'function_call_output',
        id: 'fco_019fd1da-a314-7122-9b18-b2af316efb2f',
        call_id: 'call_00_sHXwhrZu3tXorC09xnJT1739',
        output: 'Chunk ID: 2f2fb7\n…(elided)',
      },
    },
    // 38 event_msg token_count —— 周期 5 的用量 → 挂到 35 行的 assistant 事件
    {
      timestamp: '2026-08-05T12:16:34.583Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          total_token_usage: {
            input_tokens: 139580, cached_input_tokens: 126720, cache_write_input_tokens: 0,
            output_tokens: 2104, reasoning_output_tokens: 1436, total_tokens: 141684,
          },
          last_token_usage: {
            input_tokens: 25931, cached_input_tokens: 24704, cache_write_input_tokens: 0,
            output_tokens: 504, reasoning_output_tokens: 337, total_tokens: 26435,
          },
          model_context_window: 996147,
        },
      },
    },
    // 39 response_item reasoning —— 新周期 6
    {
      timestamp: '2026-08-05T12:16:36.925Z',
      type: 'response_item',
      payload: {
        type: 'reasoning',
        id: '08f356f9-f390-4679-aabb-cf598691f778',
        content: [{ type: 'reasoning_text', text: 'Found it. The runtime is at `/Applications/…(elided)' }],
      },
    },
    // 40 response_item function_call（A1 引用的 call_00_FUHEa1XZOVIWinblpRnH4144）
    {
      timestamp: '2026-08-05T12:16:37.806Z',
      type: 'response_item',
      payload: {
        type: 'function_call',
        id: '4044c239-2882-4943-a662-8bc40554ad24',
        name: 'write_stdin',
        call_id: 'call_00_FUHEa1XZOVIWinblpRnH4144',
        arguments: '{"chars": "globalThis.nodeRepl…(elided)',
      },
    },
    // 41 response_item function_call_output（与 40 行同一 call_id；配对走 2.12）
    {
      timestamp: '2026-08-05T12:16:57.911Z',
      type: 'response_item',
      payload: {
        type: 'function_call_output',
        id: 'fco_019fd1da-fe37-7570-8e31-2a04a0e7371a',
        call_id: 'call_00_FUHEa1XZOVIWinblpRnH4144',
        output: 'Chunk ID: 90968f\n…(elided)',
      },
    },
    // 42 event_msg token_count —— 周期 6 无 assistant 消息 → carrier
    {
      timestamp: '2026-08-05T12:16:57.919Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          total_token_usage: {
            input_tokens: 166230, cached_input_tokens: 153088, cache_write_input_tokens: 0,
            output_tokens: 2500, reasoning_output_tokens: 1628, total_tokens: 168730,
          },
          last_token_usage: {
            input_tokens: 26650, cached_input_tokens: 26368, cache_write_input_tokens: 0,
            output_tokens: 396, reasoning_output_tokens: 192, total_tokens: 27046,
          },
          model_context_window: 996147,
        },
      },
    },
    // 43 response_item reasoning —— 新周期 7
    {
      timestamp: '2026-08-05T12:16:59.897Z',
      type: 'response_item',
      payload: {
        type: 'reasoning',
        id: '547c7168-3853-46e3-a912-ea06ca415022',
        content: [{ type: 'reasoning_text', text: 'The runtime is set up…(elided)' }],
      },
    },
    // 44 response_item function_call
    {
      timestamp: '2026-08-05T12:17:00.334Z',
      type: 'response_item',
      payload: {
        type: 'function_call',
        id: '0983e8c2-45ab-4f44-bfce-2238cbb36c7f',
        name: 'write_stdin',
        call_id: 'call_00_Xgdc63ELitW8t7S8ly628452',
        arguments: '{"chars": "typeof globalThis.sky…(elided)',
      },
    },
    // 45 response_item function_call_output —— 被用户中止
    {
      timestamp: '2026-08-05T12:17:05.367Z',
      type: 'response_item',
      payload: {
        type: 'function_call_output',
        id: 'fco_019fd1db-1b57-7d23-afec-8c2685425dfd',
        call_id: 'call_00_Xgdc63ELitW8t7S8ly628452',
        output: 'aborted by user after 5.0s',
      },
    },
    // 46 event_msg token_count —— 周期 7 无 assistant 消息 → carrier（末条累计快照即会话总量）
    {
      timestamp: '2026-08-05T12:17:05.376Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          total_token_usage: {
            input_tokens: 193534, cached_input_tokens: 180096, cache_write_input_tokens: 0,
            output_tokens: 2700, reasoning_output_tokens: 1722, total_tokens: 196234,
          },
          last_token_usage: {
            input_tokens: 27304, cached_input_tokens: 27008, cache_write_input_tokens: 0,
            output_tokens: 200, reasoning_output_tokens: 94, total_tokens: 27504,
          },
          model_context_window: 996147,
        },
      },
    },
    // 47 response_item message role=developer（<turn_aborted>）—— 新周期 8（A6：→ system）
    {
      timestamp: '2026-08-05T12:17:05.386Z',
      type: 'response_item',
      payload: {
        type: 'message',
        id: 'msg_019fd1db-1b6a-7880-aec8-9803ca626462',
        role: 'developer',
        content: [{ type: 'input_text', text: '<turn_aborted>\nThe previous turn was interrupted…(elided)' }],
      },
    },
    // 48 event_msg turn_aborted —— 周期 8 受影响事件置 cancelled（A6 / 2.5）
    {
      timestamp: '2026-08-05T12:17:05.390Z',
      type: 'event_msg',
      payload: {
        type: 'turn_aborted',
        turn_id: '019fd1d9-bccb-74b3-9f0d-6126b5aa86ed',
        reason: 'interrupted',
      },
    },
  ],
};
