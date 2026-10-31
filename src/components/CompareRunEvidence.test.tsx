import{act}from'react';
import{createRoot}from'react-dom/client';
import{afterEach,describe,expect,it,vi}from'vitest';
import{CompareRunEvidence}from'./CompareRunEvidence.js';
import{makeEvent,makeResult}from'./compare-test-fixtures.js';

afterEach(()=>vi.restoreAllMocks());
describe('comparison source evidence (WB-003)',()=>{
  it.each(['zh','en']as const)('names source/coverage, bounds error locators and opens exact retained evidence without IO (%s)',locale=>{
    const result=makeResult();
    result.left.events=Array.from({length:6},(_,i)=>makeEvent({id:`error-${i}`,sequence:i+1,title:`SYNTHETIC_${i}`,tool:null,status:'error',error:'SYNTHETIC',durationMs:i*1000}));
    result.left.eventTotal=20;result.left.hasMore=true;
    result.left.session.primaryModel='synthetic-model';result.right.session.durationSource=undefined;
    const open=vi.fn();const calls=vi.fn();const fetcher=vi.spyOn(globalThis,'fetch');
    const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
    act(()=>root.render(<CompareRunEvidence result={result} locale={locale} onOpenRun={open} onOpenCalls={calls}/>));
    try {
      expect(host.textContent).toContain('6 / 20');expect(host.textContent).toContain('synthetic-model');expect(host.textContent).toContain('unknown');
      expect(host.textContent).toContain(locale==='zh'?'等价未验证':'equivalence is unverified');
      expect(host.querySelectorAll('.cmp-evidence-side:first-child .cmp-evidence-errors button')).toHaveLength(3);
      const error=host.querySelector<HTMLButtonElement>('.cmp-evidence-side:first-child .cmp-evidence-errors button')!;
      act(()=>error.click());expect(open).toHaveBeenLastCalledWith('left','error-0');
      const longest=host.querySelector<HTMLButtonElement>('.cmp-evidence-side:first-child .cmp-evidence-longest button')!;
      act(()=>longest.click());expect(open).toHaveBeenLastCalledWith('left','error-5');
      act(()=>host.querySelector<HTMLButtonElement>('.cmp-run-evidence > header button')!.click());expect(calls).toHaveBeenCalledTimes(1);
      expect(fetcher).not.toHaveBeenCalled();
    } finally {act(()=>root.unmount());host.remove();fetcher.mockRestore();}
  });
});
