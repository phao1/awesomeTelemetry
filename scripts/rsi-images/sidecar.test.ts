import { describe,it,expect } from 'vitest';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const {createSidecar,connectHost,publicAddress} = await import(pathToFileURL(resolve('scripts/rsi-images/sidecar.mjs')).href);
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
const factory = createSidecar;
describe('optimizer sidecar network boundary',()=>{
  it('matches exact DNS names/443, never IP literals, suffixes, credentials or wildcard tricks',()=>{
    expect(connectHost('API.OPENAI.COM:443',['api.openai.com'])).toBe('api.openai.com');
    for(const value of ['127.0.0.1:443','[::1]:443','192.168.5.2:443','api.openai.com:80','api.openai.com.evil:443','api.openai.com@127.0.0.1:443','api.openai.com.:443'])expect(connectHost(value,['api.openai.com'])).toBeNull();
    expect(connectHost('api.openai.com:443',[])).toBeNull();
  });
  it('rejects private/rebinding DNS answers, including IPv6 mapped host addresses',()=>{
    for(const address of ['127.0.0.1','192.168.5.2','172.17.0.1','10.1.2.3','169.254.1.2','100.64.0.1','::1','::ffff:192.168.5.2','fe80::1','fc00::1'])expect(publicAddress(address),address).toBe(false);
    expect(publicAddress('8.8.8.8')).toBe(true);
  });
  it('returns404 for page routes and encoded traversal without contacting a host service',async()=>{
    let forwarded=0;
    const server=factory({modelHandler:()=>{},agentBase:'http://host.lima.internal:4173',request:()=>{forwarded++;throw Error('must not forward');}});
    const listener=server.listeners('request')[0]!;
    for(const url of ['/api/rsi/tasks','/api/health','/api/rsi/agent/../tasks','/api/rsi/agent/%2e%2e/tasks','/api/rsi/agent/%2Ftasks']){
      const req={url,method:'GET',headers:{}};let status=0;
      await listener(req,{writeHead:(code:number)=>{status=code;},end:()=>{}});expect(status,url).toBe(404);
    }
    expect(forwarded).toBe(0);server.close();
  });
  it('forwards only agent path and limited headers to a fixed platform origin',async()=>{
    let options:Record<string,unknown>|undefined,origin='';
    const upstream=new PassThrough();Object.assign(upstream,{setTimeout:()=>{},end:()=>{},destroy:()=>{}});
    const server=factory({modelHandler:()=>{},agentBase:'http://host.lima.internal:4173',request:(url:URL,o:Record<string,unknown>)=>{origin=url.origin;options=o;return upstream;}});
    const req=new EventEmitter();Object.assign(req,{url:'/api/rsi/agent/brief',method:'GET',headers:{authorization:'Bearer temporary',origin:'http://evil',cookie:'private'}});
    const res=new EventEmitter();Object.assign(res,{writeHead:()=>{},end:()=>{}});
    await server.listeners('request')[0]!(req,res);expect(origin).toBe('http://host.lima.internal:4173');expect(options).toEqual({method:'GET',headers:{host:'127.0.0.1:4173',authorization:'Bearer temporary'}});upstream.emit('close');server.close();
  });
});
it('redacts session/task bearers and proxy credentials before model forwarding and trace retention',async()=>{
 const {redactModelValue}=await import(pathToFileURL(resolve('scripts/rsi-images/model-proxy.mjs')).href);const {createHash}=await import('node:crypto');
 const session='a'.repeat(64),hash=createHash('sha256').update(session).digest('hex');
 const result=redactModelValue({messages:[{role:'tool',content:`RSI_AGENT_TOKEN=${session} model-temporary real-upstream-secret`}]},['model-temporary','real-upstream-secret'],[hash]);
 const text=JSON.stringify(result);expect(text).not.toContain(session);expect(text).not.toContain('model-temporary');expect(text).not.toContain('real-upstream-secret');expect(text).toContain('[REDACTED]');
});
