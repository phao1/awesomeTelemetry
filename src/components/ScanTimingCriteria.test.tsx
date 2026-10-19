import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import { ScanTimingCriteria } from './ScanTimingCriteria.js';
import { makeSession } from './compare-test-fixtures.js';

describe('ScanTimingCriteria', () => {
  it('keeps timing scope and partial warnings visible while folding the full explanation', () => {
    const host = document.createElement('div'); const root = createRoot(host);
    try {
      act(() => root.render(<ScanTimingCriteria left={makeSession('s',{durationSource:'derived'})} partial locale="zh" compact />));
      const summary=host.querySelector('.scan-timing-summary')!;
      expect(summary.textContent).toContain('derived'); expect(summary.textContent).toContain('非网络/模型实测延迟');
      const details=host.querySelector('.scan-timing-compact > details') as HTMLDetailsElement;
      expect(details.open).toBe(false); expect(details.textContent).toContain('pureInferenceMs');
      expect(host.querySelector('.scan-timing-compact > [role="status"]')).not.toBeNull();
    } finally {act(()=>root.unmount());}
  });
  it.each(['zh', 'en'] as const)('shows declarations and legacy formulas without IO (%s)', (locale) => {
    const fetcher = vi.spyOn(globalThis, 'fetch');
    const div = document.createElement('div');
    const root = createRoot(div);
    try {
      act(() => root.render(<ScanTimingCriteria left={makeSession('l', { durationSource: 'derived' })}
        right={makeSession('r', { durationSource: 'measured' })} partial locale={locale} />));
      expect(div.textContent).toContain('durationSource');
      expect(div.textContent).toContain('derived');
      expect(div.textContent).toContain('measured');
      expect(div.textContent).toContain('TTFT');
      expect(div.textContent).toContain('pureInferenceMs');
      expect(div.querySelector('.scan-timing-criteria > p:nth-of-type(2)')?.textContent)
        .toContain(locale === 'zh' ? '不保证纯推理' : 'not guaranteed pure inference');
      expect(div.textContent).toContain('TPS');
      expect(div.textContent).toContain('TPOT');
      expect(div.querySelector('[role="status"]')).not.toBeNull();
      expect(div.textContent).toContain(locale === 'zh' ? '不证明逐事件实测' : 'not per-event measurement proof');
      expect(div.textContent).toContain(locale === 'zh' ? '含调度间隔' : 'including scheduling gaps');
      expect(div.textContent).toContain(locale === 'zh' ? '等价未证实' : 'are unproven');
      act(() => root.render(<ScanTimingCriteria left={makeSession('l')} locale={locale} />));
      expect(div.textContent).toContain('unknown');
      expect(div.querySelector('[role="status"]')).toBeNull();
      expect(fetcher).not.toHaveBeenCalled();
    } finally { act(() => root.unmount()); fetcher.mockRestore(); }
  });

  it('renders source labels as text, not markup', () => {
    const div = document.createElement('div'); const root = createRoot(div);
    try {
      act(() => root.render(<ScanTimingCriteria left={makeSession('l', { sourceAgent: '<img src=x onerror=alert(1)>' })} locale="en" />));
      expect(div.textContent).toContain('<img src=x onerror=alert(1)>');
      expect(div.querySelector('img')).toBeNull();
    } finally { act(() => root.unmount()); }
  });
});
