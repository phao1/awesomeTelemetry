import { readFileSync } from 'node:fs';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import type { TaskSummary } from '../../core/task-types.js';
import { TaskHealthList } from './TaskHealthList.js';
const css=readFileSync(process.cwd()+'/src/styles/task-f3.css','utf8');
const task:TaskSummary={id:'collected:long',origin:'collected',provenanceKnown:true,rootSessionKey:'long',runId:null,title:'Very long task title '.repeat(50),provider:'codex',startedAt:'2026-10-25T00:00:00.000Z',updatedAt:'2026-11-01T00:00:00.000Z',recordedStatus:'success',memberCount:21,eventCount:100,loadedMemberCount:16,metrics:{durationMs:424800000,toolCalls:100,errors:1,input:null,output:null,cacheRead:null,correctedTotal:1234567,promptInput:null,cacheHitRate:null,models:[],coverage:{correctedTotal:{known:16,total:21,missing:[{memberId:'missing',name:'Missing member',reason:'detail_not_loaded'}]}} as NonNullable<TaskSummary['metrics']>['coverage']}};
it.each([1280,1024])('keeps long titles and partial coverage on single lines at %s width',width=>{
 const host=document.createElement('div'),style=document.createElement('style'),root=createRoot(host);style.textContent=css;document.head.append(style);document.body.append(host);vi.stubGlobal('innerWidth',width);host.style.width=`${width}px`;
 try{act(()=>root.render(<TaskHealthList items={[task]} locale="zh" checked={[]} onCheck={()=>{}} onSelect={()=>{}} onHealth={()=>{}} onIntake={()=>{}}/>));
  const table=host.querySelector<HTMLTableElement>('.task-f3-table')!;expect(getComputedStyle(table).tableLayout).toBe('fixed');expect(getComputedStyle(table).minWidth).toContain('230');
  const title=host.querySelector<HTMLElement>('.task-health-title.task-f3-single-line')!;expect(title.textContent).toBe(task.title);expect(getComputedStyle(title).whiteSpace).toBe('nowrap');expect(getComputedStyle(title).textOverflow).toBe('ellipsis');
  const meta=host.querySelector<HTMLElement>('.task-f3-title-meta.task-f3-single-line')!;expect(getComputedStyle(meta).whiteSpace).toBe('nowrap');expect(getComputedStyle(meta).overflow).toBe('hidden');
  for(const cell of table.querySelectorAll('tbody>tr[data-table-row]>td'))expect(getComputedStyle(cell).whiteSpace).toBe('nowrap');
  const widths={status:21,duration:20,tools:18,errors:14,tokens:21,cache:24,health:28};for(const [key,multiple] of Object.entries(widths)){const label=table.querySelector(`.task-f3-col-${key}`)!;expect(label.closest('th')!.style.width).toBe(`calc(var(--space-1) * ${multiple})`);}
  expect(table.querySelector('thead th:first-child')!.classList.contains('ui-sticky-cell')).toBe(true);expect(table.querySelector('thead th:nth-child(2)')!.classList.contains('ui-sticky-cell')).toBe(true);
  const badge=[...table.querySelectorAll('.ui-badge')].find(el=>el.textContent==='部分 16/21')!;expect(badge).toBeTruthy();expect(getComputedStyle(badge).whiteSpace).toBe('nowrap');expect(badge.closest('.task-f3-token-cell')).not.toBeNull();expect(css).toContain('table-layout:fixed');expect(table.querySelector('.task-f3-col-members')).toBeNull();expect(meta.textContent).toContain('Codex');expect(meta.textContent).toContain('21 成员');expect(230*4).toBeLessThanOrEqual(1280-232-48);const fixedWidths=Object.values(widths).reduce((n,v)=>n+v*4,0)+80+96;expect(fixedWidths).toBeLessThanOrEqual(230*4);
 }finally{act(()=>root.unmount());host.remove();style.remove();vi.unstubAllGlobals();}
});
it('uses day-relative activity while keeping its absolute timestamp in the tooltip',()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-03T00:00:00.000Z'));const host=document.createElement('div'),root=createRoot(host);document.body.append(host);
 try{act(()=>root.render(<TaskHealthList items={[task]} locale="zh" checked={[]} onCheck={()=>{}} onSelect={()=>{}} onHealth={()=>{}} onIntake={()=>{}}/>));const time=host.querySelector<HTMLTimeElement>('[data-column=activity] time')!;expect(time.textContent).toBe('2 天前');expect(time.title).toBe(task.updatedAt);act(()=>time.dispatchEvent(new FocusEvent('focusin',{bubbles:true})));act(()=>vi.advanceTimersByTime(300));expect(document.querySelector('[role=tooltip]')!.textContent).toContain('11月1日');}finally{act(()=>root.unmount());host.remove();vi.useRealTimers();}
});

it('provides phone card metrics, two-line titles and a separate scrolling filter strip',()=>{
 const host=document.createElement('div'),root=createRoot(host);
 try{act(()=>root.render(<TaskHealthList items={[task]} locale="en" checked={[]} onCheck={()=>{}} onSelect={()=>{}} onHealth={()=>{}} onIntake={()=>{}}/>));
 const metrics=host.querySelector('.task-f3-mobile-metrics')!;expect(metrics.textContent).toContain('Token 1.2M');expect(metrics.textContent).toContain('Cache hit —');expect(metrics.textContent).toContain('Errors 1');expect(metrics.querySelector('.ui-badge')).not.toBeNull();expect(metrics.querySelector('time')).not.toBeNull();expect(host.querySelector('[data-column=title]')).not.toBeNull();expect(host.querySelector('tbody input[type=checkbox]')).not.toBeNull();
 const phone=css.slice(css.indexOf('@media(max-width:47.999rem)'));expect(phone).toContain('grid-template-columns:var(--table-control-width) minmax(0,1fr) var(--table-control-width)');expect(phone).toContain('-webkit-line-clamp:2');expect(phone).toContain('.task-f3-filter-strip{flex-wrap:nowrap;overflow-x:auto');expect(phone).toContain('.task-f3-toolbar{display:grid;grid-template-columns:minmax(0,1fr)}');
 }finally{act(()=>root.unmount());}
});

it('lets phone card rows and cells grow to their full content without clipping',()=>{
 const host=document.createElement('div'),root=createRoot(host),style=document.createElement('style');
 const phone=css.slice(css.indexOf('@media(max-width:47.999rem)'));const rules=phone.slice(phone.indexOf('{')+1,phone.lastIndexOf('}'));
 // jsdom does not evaluate viewport media queries; apply the actual phone rules directly.
 style.textContent='.ui-table td,.ui-table tr{height:64px;overflow:hidden}'+css+rules;document.head.append(style);document.body.append(host);
 try{act(()=>root.render(<TaskHealthList items={[task]} locale="en" checked={[]} onCheck={()=>{}} onSelect={()=>{}} onHealth={()=>{}} onIntake={()=>{}}/>));
 const row=host.querySelector<HTMLElement>('tr[data-table-row]')!,cell=row.querySelector<HTMLElement>('[data-column=title]')!;
 expect(getComputedStyle(row).display).toBe('grid');expect(getComputedStyle(row).height).toBe('auto');expect(getComputedStyle(row).overflow).toBe('visible');expect(getComputedStyle(cell).height).toBe('auto');expect(getComputedStyle(cell).overflow).toBe('visible');
 expect(cell.querySelector('.task-health-title')!.textContent).toBe(task.title);expect(cell.querySelector('.task-f3-title-meta')!.textContent).toContain('21 members');expect(getComputedStyle(cell.querySelector('.task-f3-mobile-metrics')!).display).toBe('flex');
 }finally{act(()=>root.unmount());host.remove();style.remove();}
});
