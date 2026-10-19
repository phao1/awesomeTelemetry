import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {TeamActivitySlim,TeamRunSnapshot} from '../../core/trace-types.js';
const {detail}=vi.hoisted(()=>({detail:vi.fn()}));
vi.mock('../team/team-client.js',()=>({teamApi:{activityDetail:detail}}));
import {StageReplay} from './StageReplay.js';
const event=(id:string,over:Partial<TeamActivitySlim>={}):TeamActivitySlim=>({id,runId:'r',agentId:'a',taskId:'t',roundId:null,kind:'task_created',status:'success',startedAt:'2026-08-17T00:00:00Z',endedAt:null,nativeSequence:1,sessionKey:'s',eventId:id,turnKey:null,messageId:null,artifactId:null,tokenUsage:null,costUsd:null,costSource:null,costCurrency:null,hasInput:true,hasOutput:true,hasRaw:false,evidenceIds:[id],orderConfidence:'ambiguous',...over});
const snapshot={summary:{id:'r',stamp:'v1'},agents:[{id:'a',displayName:'历史成员',state:'completed'},{id:'future',displayName:'未来成员',state:'completed'}],tasks:[{id:'t',nativeId:'1',title:'契约研究',status:'completed'}],assignments:[{agentId:'future',taskId:'t'}]} as unknown as TeamRunSnapshot;
let host:HTMLDivElement;let root:Root;
beforeEach(()=>{vi.useFakeTimers();host=document.createElement('div');document.body.append(host);root=createRoot(host);detail.mockReset();detail.mockResolvedValue({activity:event('one'),body:{input:'{"id":1}',output:'completion reported',result:null,message:null},raw:null});});
afterEach(()=>{act(()=>root.unmount());host.remove();vi.useRealTimers();});
const click=(name:string)=>{const button=[...host.querySelectorAll('button')].find(item=>item.textContent===name||item.getAttribute('aria-label')===name);expect(button).toBeTruthy();act(()=>button!.click());};
const render=(items:TeamActivitySlim[],stamp='v1')=>act(()=>root.render(<StageReplay snapshot={{...snapshot,summary:{...snapshot.summary,stamp}}} activities={items} coverage="complete" onSelect={()=>{}} locale="zh"/>));
describe('stage playback and historical boundaries',()=>{
 it('plays, pauses, seeks and highlights only the selected historical actor/task',()=>{
  render([event('one'),event('two',{kind:'task_status',startedAt:'2026-08-17T00:01:00Z'}),event('three',{kind:'verification',agentId:'future',startedAt:'2026-08-17T00:02:00Z'})]);
  expect(host.querySelector('[data-active-agent="a"]')).toBeTruthy();expect(host.textContent).not.toContain('未来成员');expect(host.textContent).not.toContain('已完成');expect(detail).not.toHaveBeenCalled();
  click('播放');act(()=>vi.advanceTimersByTime(1800));expect(host.querySelector('.sr-current h4')!.textContent).toBe('任务状态上报');click('暂停');act(()=>vi.advanceTimersByTime(5000));expect(host.querySelector('.sr-current h4')!.textContent).toBe('任务状态上报');
  const range=host.querySelector('input')!;act(()=>{const setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value')!.set!;setter.call(range,'2');range.dispatchEvent(new Event('input',{bubbles:true}));range.dispatchEvent(new Event('change',{bubbles:true}));});
  expect(host.querySelector('[data-active-agent="future"]')).toBeTruthy();click('上一步');expect(host.querySelector('[data-active-task="t"]')).toBeTruthy();
 });
 it('excludes unknown-clock records from autoplay and reviews them separately',()=>{
  render([event('one'),event('unknown',{startedAt:null,taskId:null})]);
  expect(host.querySelector('.sr-count')!.textContent).toContain('1 有时间步骤 · 1 时间未知');
  const unknown=[...host.querySelectorAll('button')].find(item=>item.textContent?.includes('时间未知，单独查看'))!;act(()=>unknown.click());expect(host.querySelector('.sr-current time')!.textContent).toContain('时间未知');expect(host.querySelector('[data-active-task]')).toBeNull();
  expect([...host.querySelectorAll('button')].find(item=>item.textContent==='播放')!.disabled).toBe(true);
 });
 it('reads a single source body only after explicit expansion and stops timers on unmount',async()=>{
  render([event('one'),event('two',{startedAt:'2026-08-17T00:01:00Z'})]);expect(detail).not.toHaveBeenCalled();
  await act(async()=>{const evidence=host.querySelector<HTMLDetailsElement>('.sr-evidence')!;evidence.open=true;evidence.dispatchEvent(new Event('toggle'));await Promise.resolve();});
  expect(detail).toHaveBeenCalledWith('r','one','body');expect(host.textContent).toContain('completion reported');
  const pendingBeforePlayback=vi.getTimerCount();click('播放');act(()=>root.render(<div/>));expect(vi.getTimerCount()).toBe(pendingBeforePlayback);
 });
 it('resets historical cursor and private evidence when run stamp changes',()=>{
  const items=[event('one'),event('two',{kind:'task_status',startedAt:'2026-08-17T00:01:00Z'})];render(items);click('下一步');expect(host.querySelector('.sr-current h4')!.textContent).toBe('任务状态上报');render(items,'v2');expect(host.querySelector('.sr-current h4')!.textContent).toBe('建立任务与成员');
 });
});
