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
  const table=host.querySelector<HTMLTableElement>('.task-f3-table')!;expect(getComputedStyle(table).tableLayout).toBe('fixed');expect(getComputedStyle(table).minWidth).toContain('326');
  const title=host.querySelector<HTMLElement>('.task-health-title.task-f3-single-line')!;expect(title.textContent).toBe(task.title);expect(getComputedStyle(title).whiteSpace).toBe('nowrap');expect(getComputedStyle(title).textOverflow).toBe('ellipsis');
  const meta=host.querySelector<HTMLElement>('.task-f3-title-meta.task-f3-single-line')!;expect(getComputedStyle(meta).whiteSpace).toBe('nowrap');expect(getComputedStyle(meta).overflow).toBe('hidden');
  for(const cell of table.querySelectorAll('tbody>tr[data-table-row]>td'))expect(getComputedStyle(cell).whiteSpace).toBe('nowrap');
  const widths={status:26,duration:24,members:14,tools:20,errors:16,tokens:26,cache:30,health:28};for(const [key,multiple] of Object.entries(widths)){const label=table.querySelector(`.task-f3-col-${key}`)!;expect(label.closest('th')!.style.width).toBe(`calc(var(--space-1) * ${multiple})`);}
  expect(table.querySelector('thead th:first-child')!.classList.contains('ui-sticky-cell')).toBe(true);expect(table.querySelector('thead th:nth-child(2)')!.classList.contains('ui-sticky-cell')).toBe(true);
  const badge=[...table.querySelectorAll('.ui-badge')].find(el=>el.textContent==='部分 16/21')!;expect(badge).toBeTruthy();expect(getComputedStyle(badge).whiteSpace).toBe('nowrap');expect(badge.closest('.task-f3-token-cell')).not.toBeNull();expect(css).toContain('table-layout:fixed');
 }finally{act(()=>root.unmount());host.remove();style.remove();vi.unstubAllGlobals();}
});
it('uses day-relative activity while keeping its absolute timestamp in the tooltip',()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-03T00:00:00.000Z'));const host=document.createElement('div'),root=createRoot(host);document.body.append(host);
 try{act(()=>root.render(<TaskHealthList items={[task]} locale="zh" checked={[]} onCheck={()=>{}} onSelect={()=>{}} onHealth={()=>{}} onIntake={()=>{}}/>));const time=host.querySelector('time')!;expect(time.textContent).toBe('2 天前');expect(time.title).toBe(task.updatedAt);act(()=>time.dispatchEvent(new FocusEvent('focusin',{bubbles:true})));act(()=>vi.advanceTimersByTime(300));expect(document.querySelector('[role=tooltip]')!.textContent).toContain('11月1日');}finally{act(()=>root.unmount());host.remove();vi.useRealTimers();}
});
