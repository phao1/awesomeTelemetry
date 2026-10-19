import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import type { ProxyProtocolAnalysis } from '../core/trace-types.js';
import { ProxyInsights } from './ProxyInsights.js';

function fixture(): ProxyProtocolAnalysis {
  return { parserVersion: 1, requestFormat: 'openai_chat', model: null, responseId: null,
    state: 'completed', stopReason: null, system: null, declarations: [], items: [], errors: [], unknownEvents: 0,
    usage: { inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null, reasoningTokens: null,
      nativeTotalTokens: null, totalTokens: null, accounting: 'unknown', snapshots: [] },
    completeness: { complete: true, omittedCount: 0, reasons: [] } };
}

describe('ProxyInsights', () => {
  it.each(['en', 'zh'] as const)('renders a projected Messages error flag with its exact source and item callback (%s)', locale => {
    // Typed HTTP projection boundary; the real parser is exercised server-side.
    const analysis = fixture(); analysis.parserVersion = 3; analysis.requestFormat = 'anthropic_messages';
    analysis.items = [{ phase: 'request', kind: 'tool_result', id: null, callId: 'native-result', name: null,
      index: 0, choiceIndex: null, content: '<script>ENOENT</script>', toolResultIsError: true, complete: true, sourcePath: 'messages[0].content[0]' }];
    const container = document.createElement('div'); document.body.appendChild(container); const root = createRoot(container); const onInspect = vi.fn();
    const fetcher = vi.spyOn(globalThis, 'fetch');
    try {
      act(() => root.render(<ProxyInsights analysis={analysis} locale={locale} onInspect={onInspect} />));
      const source = [...container.querySelectorAll('button')].find(button => button.textContent === 'messages[0].content[0].is_error')!;
      expect(source).toBeDefined(); expect(source.type).toBe('button'); expect(container.textContent).toContain('is_error=true');
      expect(container.querySelector('script')).toBeNull(); act(() => source.click()); expect(onInspect).toHaveBeenCalledWith('item-0');
      expect(fetcher).not.toHaveBeenCalled(); expect(analysis.state).toBe('completed'); expect(analysis.items[0]?.content).toBe('<script>ENOENT</script>');
    } finally { act(() => root.unmount()); container.remove(); fetcher.mockRestore(); }
  });
  it.each(['zh', 'en'] as const)('provides bilingual unknown/empty/limitation states without new fetches (%s)', locale => {
    const container = document.createElement('div'); document.body.appendChild(container); const root = createRoot(container);
    const fetcher = vi.spyOn(globalThis, 'fetch');
    try {
      act(() => root.render(<ProxyInsights analysis={fixture()} locale={locale} onInspect={() => {}} />));
      expect(container.textContent).toContain('—');
      expect(container.textContent).not.toContain('0.0%');
      expect(container.textContent).toContain(locale === 'zh' ? '口径未知' : 'Unknown usage accounting');
      expect(container.textContent).toContain(locale === 'zh' ? '不等于执行成功' : 'not proof of success');
      expect(fetcher).not.toHaveBeenCalled();
    } finally { act(() => root.unmount()); container.remove(); fetcher.mockRestore(); }
  });
  it('labels incomplete evidence, renders hostile text inertly, and exposes source-specific keyboard buttons', () => {
    const analysis = fixture(); analysis.completeness = { complete: false, omittedCount: 2, reasons: ['value_limit'] };
    analysis.errors = [{ code: 'EXAMPLE', message: '<img src=x onerror=alert(1)>', sourcePath: 'events[7].error' }];
    analysis.declarations = Array.from({ length: 8 }, (_, i) => ({ type: 'function', name: 'tool-' + i, definition: 'x'.repeat(i + 1), sourcePath: 'tools[' + i + ']' }));
    const onInspect = vi.fn(); const container = document.createElement('div'); document.body.appendChild(container); const root = createRoot(container);
    try {
      act(() => root.render(<ProxyInsights analysis={analysis} locale="en" onInspect={onInspect} />));
      expect(container.querySelector('[role="status"]')?.textContent).toContain('value_limit');
      expect(container.querySelector('img')).toBeNull();
      expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
      expect(container.querySelectorAll('ol li')).toHaveLength(5);
      const button = container.querySelector('[aria-label="Inspect evidence: events[7].error"]') as HTMLButtonElement;
      expect(button.type).toBe('button');
      act(() => button.click());
      expect(onInspect).toHaveBeenCalledWith('error-0');
      expect(container.textContent).toContain('lower bounds');
    } finally { act(() => root.unmount()); container.remove(); }
  });
});
