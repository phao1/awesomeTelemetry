import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CompareHeroHeader } from './CompareHeroHeader.js';
import { makeResult } from './compare-test-fixtures.js';

describe('scan wall-clock hero claims', () => {
  it.each(['en', 'zh'] as const)('labels an admissible ratio as observed wall-clock, not Agent or model improvement (%s)', locale => {
    const result = makeResult(); const before = structuredClone(result);
    const html = renderToStaticMarkup(<CompareHeroHeader result={result} locale={locale} />);
    expect(html).toContain(locale === 'en' ? 'Observed session wall-clock ratio 1.7×' : '会话墙钟观测比 1.7×');
    expect(html).not.toContain(locale === 'en' ? '× faster' : '快 1.7×'); expect(result).toEqual(before);
  });
  it('does not announce a fast ratio when either scan is pending, non-scan, or has zero/nonfinite duration', () => {
    for (const cause of ['pending', 'source', 'zero', 'nan']) {
      const result = makeResult();
      if (cause === 'pending') result.left.pending = true;
      if (cause === 'source') result.left.session.dataSource = 'proxy';
      if (cause === 'zero') result.speed.left.e2eMs = 0;
      if (cause === 'nan') result.speed.left.e2eMs = NaN;
      const html = renderToStaticMarkup(<CompareHeroHeader result={result} locale="en" />);
      expect(html).toContain('Not comparable'); expect(html).not.toContain('wall-clock ratio'); expect(html).not.toContain('× faster');
    }
  });
});
