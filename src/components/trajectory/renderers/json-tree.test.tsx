import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';

import { RENDER_MAX_CHARS, type ToolRenderResult } from './index.js';
import { JsonTree, renderJsonTree } from './json-tree.js';

const containers: HTMLDivElement[] = [];

function mount(node: React.ReactNode): { unmount: () => void; buttons: () => HTMLButtonElement[]; html: () => string } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  containers.push(container);
  const root = createRoot(container);
  act(() => {
    root.render(node);
  });
  return {
    unmount: () => {
      root.unmount();
    },
    buttons: () => [...container.querySelectorAll('button')] as HTMLButtonElement[],
    html: () => container.innerHTML,
  };
}

afterEach(() => {
  while (containers.length > 0) {
    const container = containers.pop();
    if (container !== undefined) {
      container.remove();
    }
  }
});

function markup(result: ToolRenderResult): string {
  if (result.kind === 'fallback') {
    return '';
  }
  return renderToStaticMarkup(result.node as React.ReactElement);
}

describe('renderJsonTree (task 7.2)', () => {
  it('renders a collapsible JSON tree with keys and values', () => {
    const html = markup(renderJsonTree('{"name":"demo","count":2,"ok":true,"nothing":null}'));
    expect(html).toContain('&quot;name&quot;');
    expect(html).toContain('&quot;demo&quot;');
    expect(html).toContain('2');
    expect(html).toContain('true');
    expect(html).toContain('null');
  });

  it('renders the object summary with its entry count', () => {
    const html = markup(renderJsonTree('{"a":1,"b":2}'));
    expect(html).toContain('{2}');
  });

  it('collapses nodes at or below JSON_TREE_DEFAULT_DEPTH by default', () => {
    const html = markup(renderJsonTree('{"a":{"b":{"c":{"d":1}}}}'));
    // depth 0 root, 1 (a), 2 (b) expand by default; depth 3 (c) collapses, so
    // the grandchild "d" must not appear in the initial markup.
    expect(html).toContain('&quot;c&quot;');
    expect(html).not.toContain('&quot;d&quot;');
  });

  it('expands a collapsed node on activation', () => {
    const { buttons, html, unmount } = mount(<JsonTree value={{ a: { b: { c: { d: 1 } } } }} />);
    expect(html()).not.toContain('"d"');
    const toggle = buttons().find((button) => button.getAttribute('aria-label')?.startsWith('c '));
    expect(toggle).toBeDefined();
    act(() => {
      toggle!.click();
    });
    expect(html()).toContain('"d"');
    unmount();
  });

  it('previews a root array at JSON_TREE_ARRAY_PREVIEW entries with an overflow note', () => {
    const html = markup(renderJsonTree('[1,2,3,4,5,6,7,8]'));
    expect(html).toContain('1');
    expect(html).toContain('8');
    expect(html).toContain('+3 more');
  });

  it('keeps a short root array fully visible without an overflow note', () => {
    const html = markup(renderJsonTree('[1,2]'));
    expect(html).toContain('1');
    expect(html).toContain('2');
    expect(html).not.toContain('more');
  });

  it('falls back to preformatted text for non-JSON input without failing', () => {
    const html = markup(renderJsonTree('plain text\nsecond line'));
    expect(html).toContain('plain text');
    expect(html).toContain('second line');
    expect(html).toContain('<pre');
  });

  it('falls back to preformatted text for malformed JSON without failing', () => {
    const html = markup(renderJsonTree('{"a":'));
    expect(html).toContain('{&quot;a&quot;:');
    expect(html).toContain('<pre');
  });

  it('returns fallback for a body over RENDER_MAX_CHARS before parsing', () => {
    const oversized = JSON.stringify({ a: 'x'.repeat(RENDER_MAX_CHARS) });
    expect(oversized.length).toBeGreaterThan(RENDER_MAX_CHARS);
    expect(renderJsonTree(oversized)).toEqual({ kind: 'fallback' });
  });
});
