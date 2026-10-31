import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {PageSkeleton} from './PageSkeleton.js';
describe('PageSkeleton',()=>{
 it.each(['zh','en'] as const)('has a localized status, title, cards and table rows without bare loading text (%s)',locale=>{
  const host=document.createElement('div'),root=createRoot(host);
  try{act(()=>root.render(<PageSkeleton locale={locale}/>));expect(host.querySelector('[role=status]')!.getAttribute('aria-label')).toBe(locale==='zh'?'正在加载页面':'Loading page');expect(host.querySelectorAll('.ui-page-skeleton-cards .ui-card')).toHaveLength(3);expect(host.querySelectorAll('.ui-table-skeleton-row')).toHaveLength(6);expect(host.textContent).toBe('');}finally{act(()=>root.unmount());}
 });
 it('supports compact table-only panels',()=>{const html=renderToStaticMarkup(<PageSkeleton compact variant="table" rows={3}/>);expect(html).toContain('ui-page-skeleton-compact');expect(html).not.toContain('ui-page-skeleton-cards');expect(html.match(/ui-table-skeleton-row/g)).toHaveLength(3);});
 it('all App Suspense fallbacks use the page skeleton, including settings dialog',()=>{const source=readFileSync('src/App.tsx','utf8');expect(source).not.toMatch(/fallback=\{<p\b/);expect(source.match(/fallback=\{<PageSkeleton/g)?.length).toBeGreaterThan(10);expect(source).toContain('<PageSkeleton locale={locale} compact /></Modal>');});
});
