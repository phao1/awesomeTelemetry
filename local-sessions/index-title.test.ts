import { closeSync, mkdtempSync, openSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  extractTitleFromUserText,
  fallbackSessionTitle,
  JSONL_INDEX_LINE_CAP,
  readJsonlIndexMeta,
  TITLE_MAX_LENGTH,
} from './index-title.js';

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'index-title-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

function writeLines(dir: string, name: string, lines: unknown[]): string {
  const path = join(dir, name);
  writeFileSync(path, lines.map((line) => JSON.stringify(line)).join('\n') + '\n');
  return path;
}

describe('REQ-021 索引阶段真实标题（T-10）', () => {
  it('1.1 codex：跳过 # AGENTS.md / <environment_context> / <system-reminder>，取用户真正说的第一句', () => {
    const dir = tempDir();
    const path = writeLines(dir, 'rollout-real.jsonl', [
      { timestamp: '2026-08-04T06:06:28.142Z', type: 'session_meta', payload: { session_id: 's1' } },
      {
        timestamp: '2026-08-04T06:06:29.000Z',
        type: 'response_item',
        payload: { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'You are Codex...' }] },
      },
      {
        timestamp: '2026-08-04T06:06:30.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: '# AGENTS.md instructions for /home/developer/project' }],
        },
      },
      {
        timestamp: '2026-08-04T06:06:31.000Z',
        type: 'response_item',
        payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>' }] },
      },
      {
        timestamp: '2026-08-04T06:06:32.000Z',
        type: 'response_item',
        payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<system-reminder> 请先读 NEXT-TASKS.md' }] },
      },
      {
        timestamp: '2026-08-04T06:06:33.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: '读 NEXT-TASKS.md，然后按 T-01 → T-02 → T-03 的顺序执行。' }],
        },
      },
    ]);

    const meta = readJsonlIndexMeta(path, 'codex');
    expect(meta.title).toBe('读 NEXT-TASKS.md，然后按 T-01 → T-02 → T-03 的顺序执行。');
    expect(meta.title.startsWith('# AGENTS.md')).toBe(false);
    expect(meta.title.startsWith('<')).toBe(false);
    expect(meta.eventCount).toBeGreaterThan(0);
    expect(meta.startedAt).toBe('2026-08-04T06:06:28.142Z');
  });

  it('1.1 claude：跳过 <system-reminder> 注入块，取首条真实 user 消息', () => {
    const dir = tempDir();
    const path = writeLines(dir, 'claude-s1.jsonl', [
      { type: 'queue-operation', requestId: 'q1' },
      {
        type: 'user',
        message: { role: 'user', content: [{ type: 'text', text: '<system-reminder> Use the context below...' }] },
      },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: '好的。' }] } },
      {
        type: 'user',
        message: { role: 'user', content: [{ type: 'text', text: '1. 这个项目我启动了，但很多点击后都无法加载' }] },
      },
    ]);

    const meta = readJsonlIndexMeta(path, 'claude');
    expect(meta.title).toBe('1. 这个项目我启动了，但很多点击后都无法加载');
    expect(meta.eventCount).toBe(3);
  });

  it('1.1 codex：跳过 <codex_internal_context> 内部上下文注入块', () => {
    const dir = tempDir();
    const path = writeLines(dir, 'rollout-goal.jsonl', [
      { timestamp: '2026-08-04T06:06:28.142Z', type: 'session_meta', payload: { session_id: 's3' } },
      {
        timestamp: '2026-08-04T06:06:30.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: '<codex_internal_context source="goal">\nContinue working toward the active thread goal.' }],
        },
      },
      {
        timestamp: '2026-08-04T06:06:33.000Z',
        type: 'response_item',
        payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '总结下你做了哪些' }] },
      },
    ]);

    const meta = readJsonlIndexMeta(path, 'codex');
    expect(meta.title).toBe('总结下你做了哪些');
  });

  it('1.4 标题截断 120 字符', () => {
    const longText = `这条用户消息很长 ${'x'.repeat(200)} 后面还有内容`;
    const title = extractTitleFromUserText(longText);
    expect(title).not.toBeNull();
    expect(title!.length).toBe(TITLE_MAX_LENGTH);
  });

  it('1.2 无 user 消息的空会话回落为 `<provider> session · <时间>`，且不含 .jsonl', () => {
    const dir = tempDir();
    const path = writeLines(dir, 'rollout-empty.jsonl', [
      { timestamp: '2026-08-04T06:00:00.000Z', type: 'session_meta', payload: { session_id: 's2' } },
      { timestamp: '2026-08-04T06:00:01.000Z', type: 'event_msg', payload: { type: 'task_started' } },
      { timestamp: '2026-08-04T06:00:02.000Z', type: 'response_item', payload: { type: 'reasoning', role: 'assistant' } },
    ]);

    const meta = readJsonlIndexMeta(path, 'codex');
    expect(meta.title).toMatch(/^codex session · /);
    expect(meta.title).not.toContain('.jsonl');
    expect(meta.title).not.toMatch(/^rollout-/);
  });

  it('1.2 纯空行文件回落且 eventCount=0', () => {
    const dir = tempDir();
    const path = writeLines(dir, 'empty.jsonl', [{}, {}]);
    const meta = readJsonlIndexMeta(path, 'claude');
    expect(meta.title).toMatch(/^claude session · /);
    expect(meta.eventCount).toBe(0);
  });

  it('fix-session-detail-display 3.1：eventCount 数完全文件 message 行（标题找到后继续）', () => {
    const dir = tempDir();
    const rows: unknown[] = [
      { timestamp: '2026-08-04T06:00:00.000Z', type: 'session_meta', payload: { session_id: 's1' } },
      {
        timestamp: '2026-08-04T06:00:01.000Z',
        type: 'response_item',
        payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '首条真实提问' }] },
      },
    ];
    for (let i = 0; i < 7; i += 1) {
      rows.push({
        timestamp: `2026-08-04T06:00:0${i + 2}.000Z`,
        type: 'response_item',
        payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: `reply ${i}` }] },
      });
    }
    const path = writeLines(dir, 'full-count.jsonl', rows);
    const meta = readJsonlIndexMeta(path, 'codex');
    expect(meta.title).toBe('首条真实提问');
    expect(meta.eventCount).toBe(8); // 1 user + 7 assistant
    expect(meta.approximate).toBe(false);
  });

  it('fix-session-detail-display 3.1：超过行数上限标记 approximate', () => {
    const dir = tempDir();
    const path = join(dir, 'huge.jsonl');
    const line = JSON.stringify({
      timestamp: '2026-08-04T06:00:00.000Z',
      type: 'response_item',
      payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'x' }] },
    });
    const chunk = (line + '\n').repeat(1000);
    const handle = openSync(path, 'w');
    for (let i = 0; i < Math.ceil((JSONL_INDEX_LINE_CAP + 5) / 1000); i += 1) {
      writeSync(handle, chunk);
    }
    closeSync(handle);
    const meta = readJsonlIndexMeta(path, 'codex');
    expect(meta.approximate).toBe(true);
    expect(meta.eventCount).toBe(JSONL_INDEX_LINE_CAP);
  });

  it('fallbackSessionTitle 包含 provider 且不含文件名', () => {
    const title = fallbackSessionTitle('opencode', 1754000000000);
    expect(title.startsWith('opencode session · ')).toBe(true);
    expect(title).not.toContain('.db');
  });
});
