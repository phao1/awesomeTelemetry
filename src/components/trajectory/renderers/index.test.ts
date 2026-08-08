import { describe, expect, it, vi } from 'vitest';

import {
  JSON_TREE_ARRAY_PREVIEW,
  JSON_TREE_DEFAULT_DEPTH,
  RENDER_MAX_CHARS,
  RENDER_MAX_LINES,
  limitLines,
  registerToolRenderer,
  resolveToolRenderer,
  tryParseJson,
  withinCharBound,
  type ToolRenderer,
  type ToolRenderResult,
} from './index.js';

const fallbackRenderer: ToolRenderer = {
  tool: 'custom',
  renderArguments: (): ToolRenderResult => ({ kind: 'fallback' }),
  renderResult: (): ToolRenderResult => ({ kind: 'fallback' }),
};

describe('renderer registry bounds (design D11)', () => {
  it('exports the four shared bounds verbatim', () => {
    expect(RENDER_MAX_LINES).toBe(200);
    expect(RENDER_MAX_CHARS).toBe(100_000);
    expect(JSON_TREE_DEFAULT_DEPTH).toBe(3);
    expect(JSON_TREE_ARRAY_PREVIEW).toBe(5);
  });

  it('withinCharBound gates RENDER_MAX_CHARS', () => {
    expect(withinCharBound('')).toBe(true);
    expect(withinCharBound('x'.repeat(RENDER_MAX_CHARS))).toBe(true);
    expect(withinCharBound('x'.repeat(RENDER_MAX_CHARS + 1))).toBe(false);
  });

  it('limitLines truncates at RENDER_MAX_LINES and reports the omission count', () => {
    const short = Array.from({ length: RENDER_MAX_LINES }, (_, i) => `l${i}`);
    expect(limitLines(short)).toEqual({ lines: short, omitted: 0 });

    const long = Array.from({ length: RENDER_MAX_LINES + 7 }, (_, i) => `l${i}`);
    const result = limitLines(long);
    expect(result.lines).toHaveLength(RENDER_MAX_LINES);
    expect(result.omitted).toBe(7);
    expect(result.lines[0]).toBe('l0');
    expect(result.lines[RENDER_MAX_LINES - 1]).toBe(`l${RENDER_MAX_LINES - 1}`);
  });

  it('tryParseJson never throws on malformed input', () => {
    expect(tryParseJson('not json')).toBeUndefined();
    expect(tryParseJson('{"a":')).toBeUndefined();
    expect(tryParseJson('')).toBeUndefined();
    expect(tryParseJson('{"a":1}')).toEqual({ a: 1 });
  });
});

describe('resolveToolRenderer (design D11, tasks 7.1 / 7.12)', () => {
  it('matches the seven built-ins case-insensitively after trimming', () => {
    expect(resolveToolRenderer('Bash')?.tool).toBe('bash');
    expect(resolveToolRenderer('  Read  ')?.tool).toBe('read');
    expect(resolveToolRenderer('TodoWrite')?.tool).toBe('todowrite');
    expect(resolveToolRenderer('GREP')?.tool).toBe('grep');
    expect(resolveToolRenderer('glob')?.tool).toBe('glob');
    expect(resolveToolRenderer('Edit')?.tool).toBe('edit');
    expect(resolveToolRenderer('Write')?.tool).toBe('write');
  });

  it('returns null for an unmatched tool, an empty name, and a null tool name', () => {
    expect(resolveToolRenderer('web_search')).toBeNull();
    expect(resolveToolRenderer('  ')).toBeNull();
    expect(resolveToolRenderer(null)).toBeNull();
  });

  it('registerToolRenderer overrides a built-in after the first resolve', () => {
    // The registry is already seeded by earlier resolve calls.
    expect(resolveToolRenderer('read')?.renderArguments('{"file_path":"/a/b.ts"}').kind).toBe('ok');
    registerToolRenderer({
      tool: 'read',
      renderArguments: (): ToolRenderResult => ({ kind: 'fallback' }),
      renderResult: (): ToolRenderResult => ({ kind: 'fallback' }),
    });
    expect(resolveToolRenderer('read')?.renderArguments('{"file_path":"/a/b.ts"}')).toEqual({
      kind: 'fallback',
    });
  });

  it('a renderer registered before the first resolve wins over the built-in seed', async () => {
    vi.resetModules();
    const fresh = await import('./index.js');
    fresh.registerToolRenderer({
      tool: 'bash',
      renderArguments: (): ToolRenderResult => ({ kind: 'fallback' }),
      renderResult: (): ToolRenderResult => ({ kind: 'fallback' }),
    });
    expect(fresh.resolveToolRenderer('bash')?.renderArguments('{"command":"ls"}')).toEqual({
      kind: 'fallback',
    });
  });

  it('a custom tool registers and resolves under its lowercased name', () => {
    registerToolRenderer(fallbackRenderer);
    expect(resolveToolRenderer('Custom')?.tool).toBe('custom');
    expect(resolveToolRenderer('CUSTOM')).toBe(resolveToolRenderer('custom'));
  });
});
