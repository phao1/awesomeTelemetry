import {expect,it,vi} from 'vitest';
import {TaskHomeHydrator,HomeHydrationBusy} from './task-home-hydrator.js';
import type {TaskHydrationFrame} from '../../src/core/task-types.js';
const turn=()=>new Promise<void>(resolve=>setImmediate(resolve));
const members=(n:number,taskId='collected:t')=>Array.from({length:n},(_,i)=>({taskId,key:'s'+i,loaded:false}));

it('defers work beyond subscription, shares reads and globally caps concurrency at two',async()=>{
 const releases=new Map<string,()=>void>(),signals=new Map<string,AbortSignal>();let active=0,max=0;
 const load=vi.fn(async(key:string,signal:AbortSignal)=>{signals.set(key,signal);active++;max=Math.max(max,active);await new Promise<void>(r=>releases.set(key,r));active--;return 'loaded' as const;});
 const notify=vi.fn(),errors=vi.fn(),a:TaskHydrationFrame[]=[],b:TaskHydrationFrame[]=[];
 const queue=new TaskHomeHydrator({load,notify,onError:errors});
 queue.subscribe(['collected:t'],members(4),f=>a.push(f));queue.subscribe(['collected:t'],members(4),f=>b.push(f));
 expect(load).not.toHaveBeenCalled();expect(a[0]!.items[0]!.pending).toBe(4);
 await turn();expect(load).toHaveBeenCalledTimes(2);expect(max).toBe(2);
 releases.get('s0')!();await turn();await turn();expect(load).toHaveBeenCalledTimes(3);
 releases.get('s1')!();releases.get('s2')!();await turn();await turn();releases.get('s3')!();await turn();
 expect(max).toBe(2);expect(load.mock.calls.map(([key])=>key)).toEqual(['s0','s1','s2','s3']);
 expect(a.at(-1)).toEqual({items:[{taskId:'collected:t',pending:0,loaded:4,reasons:[]}],done:true});expect(b.at(-1)).toEqual(a.at(-1));expect(a).toHaveLength(2);expect(notify).toHaveBeenCalledTimes(4);expect(errors).not.toHaveBeenCalled();expect(signals.size).toBe(4);await queue.close();
});
it('cancels abandoned queued members and suppresses late page callbacks while awaiting admitted work on close',async()=>{
 const releases:Array<()=>void>=[],load=vi.fn(async(_key:string,signal:AbortSignal)=>{await new Promise<void>(r=>releases.push(r));return signal.aborted?'cancelled' as const:'loaded' as const;}),updates=vi.fn();
 const queue=new TaskHomeHydrator({load,notify:vi.fn(),onError:vi.fn()}),cancel=queue.subscribe(['collected:t'],members(5),updates);
 await turn();expect(load).toHaveBeenCalledTimes(2);cancel();expect(load.mock.calls.every(([,signal])=>signal.aborted)).toBe(true);
 let closed=false;const stopping=queue.close().then(()=>{closed=true;});await turn();expect(closed).toBe(false);
 releases.forEach(r=>r());await stopping;expect(load).toHaveBeenCalledTimes(2);expect(updates).toHaveBeenCalledOnce();
});
it('retains another page demand when one owner leaves and reports missing/failed sources without retry loops',async()=>{
 let release!:()=>void;
 const load=vi.fn(async(key:string)=>{if(key==='s0'){await new Promise<void>(r=>{release=r;});return 'source_missing' as const;}throw new Error('scanner failed');});
 const errors=vi.fn(),notify=vi.fn(),a=vi.fn(),b:TaskHydrationFrame[]=[];
 const queue=new TaskHomeHydrator({load,notify,onError:errors});const cancel=queue.subscribe(['collected:t'],members(2),a);queue.subscribe(['collected:t'],members(2),f=>b.push(f));await turn();cancel();release();await turn();
 expect(b.at(-1)).toEqual({items:[{taskId:'collected:t',pending:0,loaded:0,reasons:['parse_failed','source_missing']}],done:true});expect(load).toHaveBeenCalledTimes(2);expect(errors).toHaveBeenCalledOnce();expect(notify).toHaveBeenCalledTimes(2);await queue.close();
});
it('does not admit known members, limits page owners and expires abandoned leases',async()=>{
 vi.useFakeTimers();const releases:Array<()=>void>=[],load=vi.fn(async()=>{await new Promise<void>(r=>releases.push(r));return 'loaded' as const;});
 const queue=new TaskHomeHydrator({load,notify:vi.fn(),onError:vi.fn()}),known=vi.fn(),updates=vi.fn();
 try{
 queue.subscribe(['collected:known'],[{taskId:'collected:known',key:'loaded',loaded:true}],known);expect(known).toHaveBeenLastCalledWith({items:[{taskId:'collected:known',pending:0,loaded:1,reasons:[]}],done:true});expect(load).not.toHaveBeenCalled();
 for(let i=0;i<4;i++)queue.subscribe(['collected:t'],members(3),updates);
 expect(()=>queue.subscribe(['collected:t'],members(3),updates)).toThrow(HomeHydrationBusy);
 await vi.advanceTimersByTimeAsync(120000);expect(updates.mock.calls.at(-1)?.[0]).toMatchObject({done:true,items:[{pending:0,reasons:['cancelled']}]});
 releases.forEach(r=>r());await queue.close();expect(load.mock.calls.length).toBeLessThanOrEqual(2);
 }finally{vi.useRealTimers();}
});
