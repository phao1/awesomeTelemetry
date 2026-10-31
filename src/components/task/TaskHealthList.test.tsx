import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {expect,it,vi} from 'vitest';
import type {TaskSummary} from '../../core/task-types.js';
import {TaskHealthList} from './TaskHealthList.js';
const task={id:'collected:s',origin:'collected',title:'Fix failed build',provider:'codex',startedAt:'2026-10-31T00:00:00Z',memberCount:2,metrics:{durationMs:1000,toolCalls:3,errors:1,correctedTotal:100,costUsd:null,models:[],costs:{amounts:[{currency:'CNY',amount:1,source:'estimated'}],known:1,total:2},coverage:{correctedTotal:{known:1,total:2,missing:[{name:'Ada',reason:'not_reported'}]}}},latestHealth:{id:'report',generatedAt:'2026-10-31T00:00:00Z',revision:'saved',conclusion:'findings',issues:2},alerts:[{rule:'errors',threshold:0,actual:1}]} as unknown as TaskSummary;
it('shows partial metrics, saved report, structured alert reasons and shares selection and evidence entry',()=>{
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host),select=vi.fn(),health=vi.fn(),check=vi.fn();
 vi.spyOn(HTMLElement.prototype,'offsetHeight','get').mockReturnValue(600);vi.spyOn(HTMLElement.prototype,'offsetWidth','get').mockReturnValue(1200);
 try{act(()=>root.render(<TaskHealthList items={[task]} locale="zh" checked={[task.id]} onCheck={check} onSelect={select} onHealth={health} onIntake={()=>{}}/>));
 expect(host.textContent).toContain('部分（1/2 成员）');expect(host.textContent).toContain('CNY 1.0000（估算）');expect(host.textContent).toContain('发现问题 · 2');expect(host.querySelector('.task-alert-badge')?.getAttribute('title')).toBe('任务错误数: 1 > 0');
 expect(host.querySelector<HTMLInputElement>('input')!.checked).toBe(true);act(()=>host.querySelector<HTMLInputElement>('input')!.click());expect(check).toHaveBeenCalledWith(task.id,false);
 act(()=>host.querySelector<HTMLButtonElement>('.task-health-title')!.click());expect(select).toHaveBeenCalledWith(task);
 act(()=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='健康监测')!.click());expect(health).toHaveBeenCalledWith(task);
 }finally{act(()=>root.unmount());host.remove();vi.restoreAllMocks();}
});
it('keeps the data intake guidance when a bounded page has no tasks',()=>{
 const host=document.createElement('div'),root=createRoot(host),intake=vi.fn();try{act(()=>root.render(<TaskHealthList items={[]} locale="en" checked={[]} onCheck={()=>{}} onSelect={()=>{}} onHealth={()=>{}} onIntake={intake}/>));expect(host.textContent).toContain('No tasks in this range');act(()=>host.querySelector<HTMLButtonElement>('button')!.click());expect(intake).toHaveBeenCalledOnce();}finally{act(()=>root.unmount());}
});

it('shows Loading only for pending unknown cells, preserves missing-file reasons and offers an exact-model price shortcut',()=>{
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host),settings=vi.fn(),select=vi.fn();
 vi.spyOn(HTMLElement.prototype,'offsetHeight','get').mockReturnValue(600);vi.spyOn(HTMLElement.prototype,'offsetWidth','get').mockReturnValue(1200);
 const unknown={...task,loadedMemberCount:0,metrics:{...task.metrics!,durationMs:null,toolCalls:null,errors:null,correctedTotal:null,costUsd:null,costs:{amounts:[],known:0,total:2,missingReasons:['detail_not_loaded' as const]}}};
 const props={items:[unknown],locale:'zh' as const,checked:[],onCheck:()=>{},onSelect:select,onHealth:()=>{},onIntake:()=>{},onSettings:settings};
 try{
 act(()=>root.render(<TaskHealthList {...props} progress={{[task.id]:{taskId:task.id,pending:1,loaded:0,reasons:[]}}}/>));expect(host.querySelector('.task-health-row')?.textContent).toContain('加载中');expect(host.querySelector('.task-price-link')).toBeNull();
 act(()=>root.render(<TaskHealthList {...props} progress={{[task.id]:{taskId:task.id,pending:0,loaded:0,reasons:['source_missing']}}}/>));expect(host.querySelector('.task-health-row')?.textContent).not.toContain('加载中');expect(host.querySelector('.task-cost-cell')?.getAttribute('title')).toContain('原生文件已不存在');
 expect(host.querySelector('.task-price-link')).toBeNull();
 const pricedModel={...unknown,loadedMemberCount:2,metrics:{...unknown.metrics,costs:{amounts:[],known:0,total:2,missingPrices:['custom-model'],missingReasons:['model_unpriced' as const]}}};
 act(()=>root.render(<TaskHealthList {...props} items={[pricedModel]}/>));
 act(()=>host.querySelector<HTMLButtonElement>('.task-price-link')!.click());expect(settings).toHaveBeenCalledWith({section:'model-pricing',model:'custom-model'});expect(select).not.toHaveBeenCalled();expect(host.querySelector('.task-row-label')).toBeNull();
 }finally{act(()=>root.unmount());host.remove();vi.restoreAllMocks();}
});
it('renders row labels in narrow cards only, without hiding the loading or health actions',()=>{
 vi.stubGlobal('matchMedia',()=>({matches:true,addEventListener:()=>{},removeEventListener:()=>{}}));
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 vi.spyOn(HTMLElement.prototype,'offsetHeight','get').mockReturnValue(600);vi.spyOn(HTMLElement.prototype,'offsetWidth','get').mockReturnValue(375);
 try{act(()=>root.render(<TaskHealthList items={[task]} locale="zh" checked={[]} onCheck={()=>{}} onSelect={()=>{}} onHealth={()=>{}} onIntake={()=>{}}/>));expect(host.querySelector('.task-row-label')?.textContent).toContain('开始');expect(host.querySelector('.task-health-row')?.getAttribute('style')).toContain('280px');expect(host.querySelector('.task-health-row')?.textContent).toContain('健康监测');}
 finally{act(()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();}
});
