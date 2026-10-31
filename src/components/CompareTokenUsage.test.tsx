import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {CompareTokenUsage} from './CompareTokenUsage.js';
import {makeTokenUsage} from './compare-test-fixtures.js';
import type {TokenUsage} from '../core/trace-types.js';
import {t} from '../i18n.js';

const views:Array<()=>void>=[];
function mount(node:React.ReactNode):HTMLDivElement {
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
  act(()=>root.render(node));views.push(()=>{act(()=>root.unmount());host.remove();});return host;
}
afterEach(()=>{while(views.length)views.pop()!();vi.restoreAllMocks();});
const usage={left:makeTokenUsage(),right:makeTokenUsage()};
const estimates={left:500,right:null};

describe('CompareTokenUsage snapshot accounting',()=>{
  it.each(['rings','bars'] as const)('%s includes both cache components and preserves the native total without the system estimate',visual=>{
    const host=mount(<CompareTokenUsage usage={usage} estimates={estimates} locale="en" visual={visual}/>);
    expect(host.querySelectorAll('[data-token-part]')).toHaveLength(5);
    expect(host.querySelector('[data-token-part="cacheRead"] td')?.textContent).toBe('30');
    expect(host.querySelector('[data-token-part="cacheWrite"] td')?.textContent).toBe('10');
    expect([...host.querySelectorAll('tfoot td')].map(td=>td.textContent)).toEqual(['210','210']);
    expect(host.querySelector('.compare-token-estimate')?.textContent).toContain('L · 500');
    expect(host.querySelector('.compare-token-estimate')?.textContent).toContain('R · —');
  });

  it.each(['rings','bars'] as const)('%s retains non-additive observations without guessing reasoning overlap',visual=>{
    const host=mount(<CompareTokenUsage usage={{...usage,left:makeTokenUsage({total:190})}} estimates={estimates} locale="en" visual={visual}/>);
    expect(host.textContent).toContain('do not reconcile');
    expect(host.querySelector('[data-token-part="reasoning"] td')?.textContent).toBe('20');
    expect(host.querySelector('tfoot td')?.textContent).toBe('190');
    if(visual==='rings')expect(host.querySelectorAll('circle[stroke-dasharray]')).toHaveLength(5);
    else expect(host.querySelectorAll('.token-stack-bar')).toHaveLength(1);
  });

  it('unknown, invalid and zero observations never become made-up shares or missing-as-zero estimates',()=>{
    const none=makeTokenUsage({input:0,output:0,reasoning:0,cacheRead:0,cacheWrite:0,total:0});
    const bad=makeTokenUsage({input:NaN,output:-2,total:Infinity});
    const host=mount(<CompareTokenUsage usage={{left:none,right:bad}} estimates={{left:0,right:null}} locale="en"/>);
    expect(host.querySelectorAll('circle[stroke-dasharray]')).toHaveLength(0);
    expect(host.textContent).toContain('No positive token record');
    expect(host.textContent).not.toMatch(/NaN|Infinity/);
    expect(host.querySelector('.compare-token-estimate')?.textContent).toContain('L · 0');
    expect(host.querySelector('.compare-token-estimate')?.textContent).toContain('R · —');
  });

  it('pending native metadata withholds composition, even when its retained numbers happen to add up',()=>{
    const host=mount(<CompareTokenUsage usage={usage} estimates={estimates} locale="en" pending={{left:true,right:true}}/>);
    expect(host.querySelectorAll('circle[stroke-dasharray]')).toHaveLength(0);
    expect(host.querySelector('tfoot td')?.textContent).toBe('210');
    expect([...host.querySelectorAll('[role="status"]')].map(node=>node.textContent))
      .toEqual([`L · ${t('compare.evidence.partial','en')}`,`R · ${t('compare.evidence.partial','en')}`]);
  });

  it('only supported text classes are actionable and rendering/legend inspection performs no IO',()=>{
    const fetch=vi.spyOn(globalThis,'fetch');const inspect=vi.fn();
    const host=mount(<CompareTokenUsage usage={usage} estimates={estimates} locale="en" onInspectText={inspect}/>);
    expect(fetch).not.toHaveBeenCalled();
    expect(host.querySelector('[aria-label="L cacheRead"]')).toBeNull();
    expect(host.querySelector('[data-token-part="cacheRead"] button')).toBeNull();
    const output=host.querySelector('circle[aria-label="R output"]')!;
    act(()=>output.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true})));
    expect(inspect).toHaveBeenLastCalledWith('right','output');
    act(()=>host.querySelector<HTMLButtonElement>('[aria-label="L system estimate"]')!.click());
    expect(inspect).toHaveBeenLastCalledWith('left','system');expect(fetch).not.toHaveBeenCalled();
  });

  it('every full ring sums to its real circumference, independent of the other side total',()=>{
    const scaled=Object.fromEntries(Object.entries(usage.right).map(([key,value])=>[key,value*3])) as unknown as TokenUsage;
    const host=mount(<CompareTokenUsage usage={{...usage,right:scaled}} estimates={estimates} locale="en"/>);
    for(const radius of [50,68]){
      const rings=[...host.querySelectorAll(`circle[r="${radius}"][stroke-dasharray]`)];
      const used=rings.reduce((sum,circle)=>sum+Number(circle.getAttribute('stroke-dasharray')!.split(' ')[0]),0);
      expect(used).toBeCloseTo(2*Math.PI*radius,6);
    }
  });
});
