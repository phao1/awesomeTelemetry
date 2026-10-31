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
 it.each([AreaChart,LineChart,BarChart])('renders responsive multi-series axes, legend, keyboard tooltip and empty state',Component=>{const disconnect=vi.fn();vi.stubGlobal('ResizeObserver',class{observe(){ }disconnect=disconnect;});const host=mount(<Component series={series} labels={['Mon','Tue','Wed']}/>);expect(host.textContent).toContain('Input');expect(host.querySelectorAll('line[stroke="var(--chart-grid)"]')).toHaveLength(5);const svg=host.querySelector('svg')!;act(()=>svg.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true})));expect(host.querySelector('[role=status]')!.textContent).toContain('Tue');expect(host.querySelector('[role=status]')!.textContent).toContain('20');act(()=>svg.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));expect(host.querySelector('[role=status]')).toBeNull();const empty=mount(<Component series={[]}/>);expect(empty.textContent).toContain('No data');expect(empty.querySelector('.instrument-chart')).toBeNull();});
 it('uses a common stacked scale and nonoverlapping area baselines',()=>{const host=mount(<AreaChart stacked series={series}/>);const lines=[...host.querySelectorAll('path[fill=none]')];expect(lines).toHaveLength(2);expect(lines[0]!.getAttribute('d')).not.toBe(lines[1]!.getAttribute('d'));expect(host.querySelectorAll('linearGradient')).toHaveLength(2);});
 it('renders grouped and stacked bars with all data',()=>{const grouped=mount(<BarChart series={series}/>),stacked=mount(<BarChart stacked series={series}/>);expect(grouped.querySelectorAll('rect')).toHaveLength(6);expect(stacked.querySelectorAll('rect')).toHaveLength(6);expect(Number(stacked.querySelector('rect')!.getAttribute('width'))).toBeGreaterThan(Number(grouped.querySelector('rect')!.getAttribute('width')));});
 it('BarList limits to eight rows and expands',()=>{const host=mount(<BarList items={Array.from({length:10},(_,i)=>({label:`Task ${i}`,value:10-i}))}/>);expect(host.querySelectorAll('.chart-bar-list-fill')).toHaveLength(8);act(()=>host.querySelector('button')!.click());expect(host.querySelectorAll('.chart-bar-list-fill')).toHaveLength(10);});
 it('Histogram has shared chart behavior',()=>{const host=mount(<Histogram buckets={[{label:'Mon',value:2}]}/>);expect(host.querySelector('svg')!.getAttribute('aria-label')).toBe('histogram');expect(host.querySelector('rect')).not.toBeNull();});
 it('donut has true total, percentage legend, separated ring and empty state',()=>{const host=mount(<DonutChart slices={[{label:'A',value:75},{label:'B',value:25}]}/>);expect(host.textContent).toContain('100');expect(host.textContent).toContain('75.0%');expect(host.querySelectorAll('circle[fill=none]')).toHaveLength(3);expect(mount(<DonutChart slices={[]}/>).textContent).toContain('No data');});
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
