import { beforeEach, describe, expect, it } from 'vitest';

import type { TraceEventSlim } from './trace-types.js';
import { dirnameOf, extractPath, groupEvents } from './event-groups.js';

let seq = 0;
beforeEach(() => {
  seq = 0;
});
function ev(partial: Partial<TraceEventSlim>): TraceEventSlim {
  seq += 1;
  return {
    id: `e${seq}`,
    sessionId: 's1',
    sequence: seq,
    turnKey: null,
    kind: 'llm',
    phase: 'implement',
    title: `event ${seq}`,
    startedAt: `2026-08-01T00:00:0${Math.floor(seq / 10)}.${String(seq % 10).padStart(2, '0')}Z`,
    durationMs: 100,
    status: 'success',
    actor: 'assistant',
    tool: null,
    tokens: null,
    error: null,
    hasInput: false,
    hasOutput: false,
    hasRaw: false,
    ...partial,
  };
}

describe('extractPath / dirnameOf', () => {
  it('从工具标题提取文件路径', () => {
    expect(extractPath('Edit src/auth/jwt.ts')).toBe('src/auth/jwt.ts');
    expect(extractPath('ruoyi-admin/src/main/resources/templates/system/balance/dashboard.html')).toContain(
      'dashboard.html',
    );
    expect(extractPath('查看文档')).toBeNull();
  });

  it('dirname', () => {
    expect(dirnameOf('src/auth/jwt.ts')).toBe('src/auth');
    expect(dirnameOf('main.rs')).toBe('');
  });
});

describe('groupEvents 语义折叠', () => {
  it('repair_loop：W→F→W 两轮合成一组，默认含失败标记', () => {
    const events = [
      ev({ kind: 'file_write', title: 'Edit src/a.ts', tool: 'edit' }),
      ev({ kind: 'bash', title: 'npm test', tool: 'bash', status: 'error' }),
      ev({ kind: 'file_write', title: 'Edit src/a.ts', tool: 'edit' }),
      ev({ kind: 'bash', title: 'npm test', tool: 'bash', status: 'error' }),
      ev({ kind: 'file_write', title: 'Edit src/a.ts', tool: 'edit' }),
    ];
    const rows = groupEvents(events);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'group',
      group: { type: 'repair_loop', rounds: 2, failed: true, stepCount: 5 },
    });
  });

  it('retry_burst：同一工具连续 ≥3 次且含失败', () => {
    const events = [
      ev({ kind: 'tool', title: 'exec_command', tool: 'exec_command' }),
      ev({ kind: 'tool', title: 'exec_command', tool: 'exec_command', status: 'error' }),
      ev({ kind: 'tool', title: 'exec_command', tool: 'exec_command' }),
    ];
    const rows = groupEvents(events);
    expect(rows[0]).toMatchObject({
      kind: 'group',
      group: { type: 'retry_burst', toolName: 'exec_command', failCount: 1 },
    });
  });

  it('read_burst：连续 ≥3 个 Read/Glob/Grep', () => {
    const events = [
      ev({ kind: 'file_read', title: 'src/a.ts', tool: 'read' }),
      ev({ kind: 'file_read', title: 'src/b.ts', tool: 'read' }),
      ev({ kind: 'file_read', title: 'src/c.ts', tool: 'read' }),
    ];
    const rows = groupEvents(events);
    expect(rows[0]).toMatchObject({
      kind: 'group',
      group: { type: 'read_burst', stepCount: 3 },
    });
  });

  it('write_batch：连续 ≥3 个 Write/Edit 命中同一目录', () => {
    const events = [
      ev({ kind: 'file_write', title: 'Edit src/auth/a.ts', tool: 'edit' }),
      ev({ kind: 'file_write', title: 'Edit src/auth/b.ts', tool: 'edit' }),
      ev({ kind: 'file_write', title: 'Edit src/auth/c.ts', tool: 'edit' }),
    ];
    const rows = groupEvents(events);
    expect(rows[0]).toMatchObject({
      kind: 'group',
      group: { type: 'write_batch', dirName: 'src/auth' },
    });
  });

  it('subagent：subagent_prompt 起直到父级恢复', () => {
    const events = [
      ev({ kind: 'subagent_prompt', title: '搜索测试用例' }),
      ev({ kind: 'file_read', title: 'src/a.test.ts', tool: 'read' }),
      ev({ kind: 'llm', title: '' }),
      ev({ kind: 'user_prompt', title: '继续', actor: 'user' }),
      ev({ kind: 'llm', title: '收到' }),
    ];
    const rows = groupEvents(events);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      kind: 'group',
      group: { type: 'subagent', stepCount: 3 },
    });
    expect(rows[1]).toMatchObject({ kind: 'event' });
    expect(rows[2]).toMatchObject({ kind: 'event' });
  });

  it('规则优先级：repair_loop 先于 read_burst 命中', () => {
    const events = [
      ev({ kind: 'file_write', title: 'Edit src/a.ts', tool: 'edit' }),
      ev({ kind: 'bash', title: 'npm test', tool: 'bash', status: 'error' }),
      ev({ kind: 'file_write', title: 'Edit src/a.ts', tool: 'edit' }),
      ev({ kind: 'bash', title: 'npm test', tool: 'bash', status: 'error' }),
      ev({ kind: 'file_write', title: 'Edit src/a.ts', tool: 'edit' }),
      ev({ kind: 'file_read', title: 'x.ts', tool: 'read' }),
    ];
    const rows = groupEvents(events);
    expect(rows[0]!.kind).toBe('group');
    expect(rows[0]).toMatchObject({ group: { type: 'repair_loop' } });
    expect(rows[1]).toMatchObject({ kind: 'event' });
  });

  it('未命中规则的事件保持独立行', () => {
    const events = [
      ev({ kind: 'llm', title: '思考' }),
      ev({ kind: 'user_prompt', title: '继续', actor: 'user' }),
    ];
    expect(groupEvents(events)).toHaveLength(2);
  });
});
