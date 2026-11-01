import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { AreaChart } from './AreaChart.js';
import { BarChart } from './BarChart.js';
import { LineChart } from './LineChart.js';
it.each([AreaChart,BarChart,LineChart])('%s toggles series, rescales stacked axes and preserves color and restore controls',Chart=>{
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 try{act(()=>root.render(<Chart stacked labels={['Nov 1','Nov 2']} series={[{label:'Input',points:[10,20]},{label:'Output',points:[2,3]},{label:'Cache',points:[10000,20000]}]}/>));
 const svg=()=>host.querySelector('svg')!,max=()=>Number(svg().getAttribute('data-axis-max'));const before=max();const cache=host.querySelectorAll<HTMLButtonElement>('.chart-legend button')[2]!;const input=host.querySelectorAll<HTMLButtonElement>('.chart-legend button')[0]!;
 const color=host.querySelector('[data-series=Input] [stroke], [data-series=Input] rect')!.getAttribute('stroke')??host.querySelector('[data-series=Input] rect')!.getAttribute('fill');
 expect(cache.getAttribute('aria-pressed')).toBe('true');act(()=>cache.click());expect(cache.getAttribute('aria-pressed')).toBe('false');expect(host.querySelector('[data-series=Cache]')).toBeNull();expect(max()).toBeLessThan(before/100);expect(max()).toBeGreaterThanOrEqual(23);
 expect(host.querySelector('[data-series=Input] [stroke], [data-series=Input] rect')!.getAttribute('stroke')??host.querySelector('[data-series=Input] rect')!.getAttribute('fill')).toBe(color);
 act(()=>svg().dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true})));expect(host.querySelector('.chart-tooltip')!.textContent).toContain('Input');expect(host.querySelector('.chart-tooltip')!.textContent).not.toContain('Cache');
 act(()=>input.click());act(()=>host.querySelectorAll<HTMLButtonElement>('.chart-legend button')[1]!.click());expect(host.querySelectorAll('[data-series]')).toHaveLength(0);expect(host.querySelectorAll('.chart-legend button')).toHaveLength(3);expect(Number.isFinite(max())).toBe(true);expect(svg().outerHTML).not.toContain('NaN');
 cache.focus();expect(document.activeElement).toBe(cache);expect(cache.type).toBe('button');act(()=>cache.click());expect(host.querySelector('[data-series=Cache]')).not.toBeNull();expect(max()).toBeGreaterThanOrEqual(20000);act(()=>input.click());act(()=>host.querySelectorAll<HTMLButtonElement>('.chart-legend button')[1]!.click());expect(max()).toBe(before);
 }finally{act(()=>root.unmount());host.remove();}
});
