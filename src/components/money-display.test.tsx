import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {describe,expect,it} from 'vitest';
import {SessionToolbar} from './SessionToolbar.js';
import {SessionHeaderCard} from './SessionHeaderCard.js';
import {CompareKPI} from './CompareKPI.js';
import {CompareDimensions} from './CompareDimensions.js';
import {makeResult} from './compare-test-fixtures.js';

describe('user-directed Token-only presentation',()=>{
  it.each(['zh','en'] as const)('omits known monetary values from both session headers and comparison while keeping Token evidence (%s)',locale=>{
    const result=makeResult();result.left.session.costUsd=456789.1234;result.right.session.costUsd=987654.5678;
    result.left.session.costSource='estimated';result.right.session.costSource='estimated';
    const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
    try {
      act(()=>root.render(<><SessionToolbar session={result.left.session} events={result.left.events} locale={locale}/><SessionHeaderCard session={result.left.session} events={result.left.events} locale={locale}/><CompareKPI result={result} locale={locale}/><CompareDimensions result={result} locale={locale}/></>));
      const text=host.textContent??'';expect(text).not.toMatch(/[$¥￥€£]\s*[\d—]/);expect(text).not.toContain('456789.1234');expect(text).not.toContain('987654.5678');
      expect(text).toContain(result.left.session.tokenUsage.total.toLocaleString());
      expect(host.querySelector('[data-kpi="cost"]')).toBeNull();
      expect([...host.querySelectorAll('.compare-kpi-label')].map(el=>el.textContent)).not.toContain(locale==='zh'?'成本':'Cost');
    } finally {act(()=>root.unmount());host.remove();}
  });
});
