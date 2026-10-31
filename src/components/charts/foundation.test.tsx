import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,describe,it,expect,vi} from 'vitest';
import {AreaChart} from './AreaChart.js';
import {LineChart} from './LineChart.js';
import {BarChart} from './BarChart.js';
import {BarList} from './BarList.js';
import {Histogram} from './Histogram.js';
import {DonutChart} from './DonutChart.js';
const roots:Root[]=[];
function mount(node:React.ReactNode){const host=document.createElement('div');document.body.append(host);const root=createRoot(host);roots.push(root);act(()=>root.render(node));return host;}
afterEach(()=>{act(()=>roots.splice(0).forEach(r=>r.unmount()));document.body.replaceChildren();vi.unstubAllGlobals();});
const series=[{label:'Input',points:[10,20,30]},{label:'Output',points:[5,10,15]}];
describe('F2 chart foundation',()=>{
 it.each([AreaChart,LineChart,BarChart])('renders responsive multi-series axes, legend, keyboard tooltip and empty state',Component=>{const disconnect=vi.fn();vi.stubGlobal('ResizeObserver',class{observe(){ }disconnect=disconnect;});const host=mount(<Component series={series} labels={['Mon','Tue','Wed']}/>);expect(host.textContent).toContain('Input');expect(host.querySelectorAll('line[stroke="var(--chart-grid)"]')).toHaveLength(5);const svg=host.querySelector('svg')!;act(()=>svg.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true})));expect(host.querySelector('[role=status]')!.textContent).toContain('Tue');expect(host.querySelector('[role=status]')!.textContent).toContain('20');act(()=>svg.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));expect(host.querySelector('[role=status]')).toBeNull();const empty=mount(<Component locale="en" series={[]}/>);expect(empty.textContent).toContain('No data');expect(empty.querySelector('.instrument-chart')).toBeNull();});
 it('uses a common stacked scale and nonoverlapping area baselines',()=>{const host=mount(<AreaChart stacked series={series}/>);const lines=[...host.querySelectorAll('path[fill=none]')];expect(lines).toHaveLength(2);expect(lines[0]!.getAttribute('d')).not.toBe(lines[1]!.getAttribute('d'));expect(host.querySelectorAll('linearGradient')).toHaveLength(2);});
 it('renders grouped and stacked bars with all data',()=>{const grouped=mount(<BarChart series={series}/>),stacked=mount(<BarChart stacked series={series}/>);expect(grouped.querySelectorAll('rect')).toHaveLength(6);expect(stacked.querySelectorAll('rect')).toHaveLength(6);expect([...stacked.querySelectorAll('rect'),...grouped.querySelectorAll('rect')].every(r=>Number(r.getAttribute('width'))<=40)).toBe(true);expect(grouped.querySelectorAll('rect')[0]!.getAttribute('x')).not.toBe(grouped.querySelectorAll('rect')[3]!.getAttribute('x'));expect(stacked.querySelectorAll('rect')[0]!.getAttribute('x')).toBe(stacked.querySelectorAll('rect')[3]!.getAttribute('x'));});
 it('BarList limits to eight rows and expands',()=>{const host=mount(<BarList items={Array.from({length:10},(_,i)=>({label:`Task ${i}`,value:10-i}))}/>);expect(host.querySelectorAll('.chart-bar-list-fill')).toHaveLength(8);act(()=>host.querySelector('button')!.click());expect(host.querySelectorAll('.chart-bar-list-fill')).toHaveLength(10);});
 it('Histogram has shared chart behavior',()=>{const host=mount(<Histogram buckets={[{label:'Mon',value:2}]}/>);expect(host.querySelector('svg')!.getAttribute('aria-label')).toBe('histogram');expect(host.querySelector('rect')).not.toBeNull();});
 it('donut has true total, percentage legend, separated ring and empty state',()=>{const host=mount(<DonutChart slices={[{label:'A',value:75},{label:'B',value:25}]}/>);expect(host.textContent).toContain('100');expect(host.textContent).toContain('75.0%');expect(host.querySelectorAll('circle[fill=none]')).toHaveLength(3);expect(mount(<DonutChart locale="en" slices={[]}/>).textContent).toContain('No data');});
});

it.each(['ratio','percent'] as const)('pins percentage axes to 0–100%% for %s input',percentScale=>{
 const host=mount(<LineChart yAxis="percent" percentScale={percentScale} series={[{label:'Cache hit',points:percentScale==='ratio'?[.585,.874]:[58.5,87.4]}]}/>);
 expect([...host.querySelectorAll('.chart-axis-y')].map(n=>n.textContent)).toEqual(['0%','20%','40%','60%','80%','100%']);
 act(()=>host.querySelector('svg')!.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true})));
 expect(host.querySelector('[role=status]')!.textContent).toContain('87.4%');
});
it('uses rounded ticks and geometry together for irregular numeric maxima',()=>{
 const host=mount(<BarChart series={[{label:'Requests',points:[58.5]}]}/>);
 expect([...host.querySelectorAll('.chart-axis-y')].map(n=>n.textContent)).toEqual(['0','20','40','60','80']);
 expect(host.innerHTML).not.toContain('NaN');
});
it('renders isolated line points with values and breaks paths at missing dates without a fabricated zero',()=>{
 const host=mount(<LineChart locale="en" yAxis="percent" labels={['Mon','Tue','Wed','Thu']} series={[{label:'Cache',points:[null,.75,null,null]}]}/>);
 expect(host.querySelectorAll('circle')).toHaveLength(1);expect(host.textContent).toContain('75.0%');expect(host.querySelector('path[fill=none]')!.getAttribute('d')).toMatch(/^M[^L]+$/);
 const gaps=mount(<LineChart series={[{label:'Gaps',points:[1,2,null,4,5]}]}/>);const d=gaps.querySelector('path[fill=none]')!.getAttribute('d')!;expect(d.match(/M/g)).toHaveLength(2);expect(d.match(/L/g)).toHaveLength(2);
 act(()=>host.querySelector('svg')!.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true,cancelable:true})));expect(host.querySelector('[role=status]')!.textContent).toContain('—');
});
it('caps a single-day bar at40SVG units and thins long continuous date labels to fit',()=>{
 const one=mount(<BarChart series={[{label:'Tasks',points:[1]}]}/>);expect(Number(one.querySelector('rect')!.getAttribute('width'))).toBeLessThanOrEqual(40);
 const dates=Array.from({length:30},(_,i)=>'10/'+String(i+1).padStart(2,'0'));const month=mount(<BarChart width={300} labels={dates} series={[{label:'Tasks',points:dates.map(()=>0)}]}/>);expect(month.querySelectorAll('rect')).toHaveLength(30);const labels=[...month.querySelectorAll('text')].filter(t=>t.textContent?.includes('/'));expect(labels.length).toBeLessThanOrEqual(4);expect(labels.length).toBeGreaterThan(1);
});
it.each(['zh','en'] as const)('renders one language in shared empty/select/ranking/donut copy for %s',locale=>{
 const donut=mount(<DonutChart locale={locale} slices={[{label:'A',value:1}]}/>);expect(donut.textContent).toContain(locale==='zh'?'总计':'Total');expect(donut.textContent).not.toContain(locale==='zh'?'Total':'总计');
 const bar=mount(<BarList locale={locale} items={Array.from({length:9},(_,i)=>({label:String(i),value:i}))}/>);expect(bar.querySelector('button')!.textContent).toBe(locale==='zh'?'查看全部':'Show all');
});
it('updates default shared chart copy when the application language changes without remounting',async()=>{
 const original=document.documentElement.lang;document.documentElement.lang='zh';
 try{const host=mount(<DonutChart slices={[{label:'A',value:1}]}/>);expect(host.textContent).toContain('总计');await act(async()=>{document.documentElement.lang='en';await Promise.resolve();});expect(host.textContent).toContain('Total');expect(host.textContent).not.toContain('总计');}finally{await act(async()=>{document.documentElement.lang=original;await Promise.resolve();});}
});
