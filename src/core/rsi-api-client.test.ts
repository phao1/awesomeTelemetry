import { describe, expect, it, vi } from 'vitest';
import { createRsiClient, RsiApiError } from './rsi-api-client.js';
const response=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
describe('RSI page client authentication and errors',()=>{
  it('bootstraps once, shares concurrent issuance and sends bearer only in headers',async()=>{
    const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(response({token:'page-secret'})).mockImplementation(async()=>response({tasks:[],reviews:[],pendingCount:0}));
    const client=createRsiClient(fetcher);await Promise.all([client.overview(),client.overview()]);expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls[0]![0]).toBe('/api/rsi/session');expect(fetcher.mock.calls[0]![1]?.headers).toBeUndefined();
    for(const [url,init] of fetcher.mock.calls.slice(1)){expect(String(url)).not.toContain('page-secret');expect(init?.headers).toMatchObject({Authorization:'Bearer page-secret'});expect(init?.cache).toBe('no-store');expect(init?.body).toBeUndefined();}
    expect(Object.values(localStorage)).not.toContain('page-secret');
  });
  it.each([401,403,409,413,503])('preserves status, code and safe field reason (%s)',async status=>{
    const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(response({token:'page'})).mockImplementation(async()=>response({error:{code:status===409?'RSI_CONFLICT':'RSI_INVALID_REQUEST',message:'redacted',details:{field:'bank',reason:'invalid_bank'}}},status));
    const client=createRsiClient(fetcher);await expect(client.options()).rejects.toMatchObject({status,details:{field:'bank',reason:'invalid_bank'}});
    await expect(client.overview()).rejects.toBeInstanceOf(RsiApiError);
  });
  it('retries failed bootstrap without persisting a token and passes abort signals',async()=>{
    const fetcher=vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(response({token:'page'})).mockImplementation(async()=>response({tasks:[],reviews:[],pendingCount:0})),client=createRsiClient(fetcher);
    await expect(client.overview()).rejects.toThrow('offline');const controller=new AbortController();await client.overview(controller.signal);expect(fetcher.mock.calls.at(-1)![1]?.signal).toBe(controller.signal);
  });
  it('encodes entity selectors and sends stable idempotency keys in the command body',async()=>{
    const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(response({token:'page'})).mockResolvedValue(response({taskId:'task',queueId:'request',status:'queued'}));
    const client=createRsiClient(fetcher);await client.command('task',null,{action:'pause',reason:'inspect'},'request');
    expect(fetcher.mock.calls[1]![1]).toMatchObject({method:'POST',headers:{Authorization:'Bearer page','content-type':'application/json'}});expect(JSON.parse(String(fetcher.mock.calls[1]![1]?.body))).toEqual({requestId:'request',iterationId:null,command:{action:'pause',reason:'inspect'}});
  });
});

it('adopts every RSI-016 page DTO verbatim from the authoritative contract',async()=>{
 const {readFileSync}=await import('node:fs');
 const source=readFileSync('src/core/rsi-api-client.ts','utf8'),contract=readFileSync('openspec/contracts/rsi.md','utf8').split('## RSI-016 ')[1]!;
 const block=contract.match(/```ts\n([\s\S]+?)```/)![1]!;
 const adopted=source.slice(source.indexOf('export type RsiTaskView'),source.indexOf('export class RsiApiError'));
 expect(adopted.trim().replace(/\s+/g,' ')).toBe(block.trim().replace(/\s+/g,' '));
});

it('sends the human question phase filter and cursor in one owned request',async()=>{
 const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(response({token:'page'})).mockImplementation(async()=>response({items:[],nextCursor:null}));
 const client=createRsiClient(fetcher),controller=new AbortController();
 await client.runs('task',3,'last-run',controller.signal,'sealed');
 expect(fetcher.mock.calls[1]![0]).toBe('/api/rsi/tasks/task/iterations/3/runs?limit=200&cursor=last-run&phase=sealed');
 expect(fetcher.mock.calls[1]![1]?.signal).toBe(controller.signal);
 await client.runs('task',3,null,controller.signal,'all');expect(String(fetcher.mock.calls[2]![0])).not.toContain('phase=');
});
