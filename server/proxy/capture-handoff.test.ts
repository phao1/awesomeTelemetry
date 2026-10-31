import { createServer, request } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import Database from 'better-sqlite3';
import { expect, it, vi } from 'vitest';
import { initSchema } from '../storage/schema.js';
import { CaptureBodyStore } from './body-store.js';
import { CaptureProcessor } from './capture-processor.js';
import { CaptureResources } from './capture-resources.js';
import { readCaptureBodies } from './capture-storage.js';
import { createMitmProxy } from './mitm-proxy.js';

async function until(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!condition()) { if (Date.now() > deadline) throw new Error('Capture handoff deadline'); await new Promise(resolve => setTimeout(resolve, 2)); }
}

it('releases completed raw previews while original flush waits, but commits only after both settle', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'capture-handoff-'));
  const db = new Database(':memory:'); initSchema(db);
  const store = await CaptureBodyStore.create(join(directory, 'bodies'));
  const resources = new CaptureResources(), processor = new CaptureProcessor({ resources });
  const submit = vi.spyOn(processor, 'submitOwned');
  let release!: () => void, flushes = 0;
  const flushGate = new Promise<void>(resolve => { release = resolve; });
  const begin = store.begin.bind(store);
  // Gate only the real filesystem flush; original writes and worker parsing run.
  const gate = vi.spyOn(store, 'begin').mockImplementation((...args) => {
    const writer = begin(...args);
    return { ...writer, finish: async (...finishArgs) => { flushes += 1; await flushGate; return writer.finish(...finishArgs); } };
  });
  const requestBody = '{"model":"synthetic","messages":[]}', responseBody = '{"usage":{"input_tokens":12,"output_tokens":3},"content":[{"type":"text","text":"original"}]}';
  const origin = createServer((req, res) => { req.resume(); req.once('end', () => { res.writeHead(200, { 'content-type':'application/json' }); res.end(responseBody); }); });
  await new Promise<void>(resolve => origin.listen(0, '127.0.0.1', resolve));
  const originPort = (origin.address() as AddressInfo).port;
  const proxy = await createMitmProxy({db,port:0,bodyStore:store,resources,processor,caDirectory:join(directory,'ca')});
  const port = ((proxy as unknown as { httpServer: { address(): AddressInfo } }).httpServer.address()).port;
  try {
    const text = await new Promise<string>((resolve,reject) => {
      const outgoing = request({host:'127.0.0.1',port,path:`http://127.0.0.1:${originPort}/v1/messages`,method:'POST',headers:{'content-type':'application/json','content-length':Buffer.byteLength(requestBody)}}, res => {
        let body='';res.on('data',(chunk:Buffer)=>{body+=chunk.toString('utf8');});res.once('end',()=>resolve(body));res.on('error',reject);
      });outgoing.on('error',reject);outgoing.end(requestBody);
    });
    expect(text).toBe(responseBody);
    await until(()=>flushes===2 && submit.mock.calls.length===1 && processor.status().jobs===0);
    expect(resources.snapshot()).toMatchObject({previewBytes:320*1024,previewCollectors:1,queuedJobs:0,queuedBytes:0});
    expect(db.prepare('SELECT COUNT(1) AS n FROM proxy_requests').get()).toEqual({n:0});
    release();
    await until(()=>proxy.captureActivity().pendingWrites===0);
    const row=db.prepare('SELECT id,input_tokens,output_tokens FROM proxy_requests').get() as {id:number;input_tokens:number;output_tokens:number};
    expect(row).toMatchObject({input_tokens:12,output_tokens:3});
    const bodies=readCaptureBodies(db,row.id);
    expect(await readFile(join(store.directory,bodies.request!.id+'.body'),'utf8')).toBe(requestBody);
    expect(await readFile(join(store.directory,bodies.response!.id+'.body'),'utf8')).toBe(responseBody);
    expect(resources.snapshot()).toMatchObject({previewBytes:0,previewCollectors:0,queuedJobs:0,queuedBytes:0});
  } finally {
    release();await proxy.shutdown();await processor.close();gate.mockRestore();submit.mockRestore();
    await new Promise<void>(resolve=>origin.close(()=>resolve()));db.close();await rm(directory,{recursive:true,force:true});
  }
  expect(resources.snapshot()).toMatchObject({previewBytes:0,queuedJobs:0,workers:0});
});
