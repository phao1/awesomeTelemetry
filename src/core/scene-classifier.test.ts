import { describe, expect, it } from 'vitest';

import { classifyScene } from './scene-classifier.js';

describe('classifyScene（add-mission-control B7）', () => {
  it('常见 prompt 命中对应场景', () => {
    expect(classifyScene('Fix the login bug')).toBe('bug-fix');
    expect(classifyScene('Write unit tests for the parser')).toBe('test-writing');
    expect(classifyScene('Refactor this function to be simpler')).toBe('refactor');
    expect(classifyScene('Explain how this code works')).toBe('explanation');
    expect(classifyScene('Implement a new endpoint for health')).toBe('feature-dev');
    expect(classifyScene('Configure docker-compose for postgres')).toBe('config-setup');
  });

  it('逃生舱：空 → unclassified，未命中 → other', () => {
    expect(classifyScene(null)).toBe('unclassified');
    expect(classifyScene('')).toBe('unclassified');
    expect(classifyScene('zzz qqq wwww')).toBe('other');
  });
});
