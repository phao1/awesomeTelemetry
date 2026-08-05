import { describe, expect, it } from 'vitest';

import { extractSubagentType } from './subagent-type.js';

describe('extractSubagentType（add-mission-control A3）', () => {
  it('JSON 字段优先', () => {
    expect(extractSubagentType(JSON.stringify({ subagentType: 'Task', prompt: 'x' }))).toBe('Task');
    expect(extractSubagentType(JSON.stringify({ kind: 'agent', role: 'SubAgent' }))).toBe('agent');
    expect(extractSubagentType(JSON.stringify({ subagent_type: 'Generalist' }))).toBe('Generalist');
  });

  it('非 JSON 文本走键值启发式', () => {
    expect(extractSubagentType('subagent_type: Planner started')).toBe('Planner');
    expect(extractSubagentType('"type":"Coder"')).toBe('Coder');
  });

  it('找不到或为空返回 unknown，不抛错', () => {
    expect(extractSubagentType(null)).toBe('unknown');
    expect(extractSubagentType('')).toBe('unknown');
    expect(extractSubagentType('plain text without markers')).toBe('unknown');
    expect(extractSubagentType('{broken json')).toBe('unknown');
  });
});
