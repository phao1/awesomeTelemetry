import {afterEach,describe,expect,it,vi} from 'vitest';
import {api} from './client.js';

afterEach(()=>vi.unstubAllGlobals());
describe('administration request ownership',()=>{
  it('forwards config read/save signals without changing routes or the full submitted payload',async()=>{
    const fetcher=vi.fn(async()=>new Response('{}',{status:200}));vi.stubGlobal('fetch',fetcher);const controller=new AbortController();
    const body={providers:{codex:{enabled:false,path:'/synthetic/codex'}},traeKeyPath:null,prewarmRecent:0};
    await api.configProviders(controller.signal);await api.saveConfigProviders(body,controller.signal);
    expect(fetcher.mock.calls).toEqual([
      ['/api/config/providers',expect.objectContaining({signal:controller.signal})],
      ['/api/config/providers',expect.objectContaining({method:'PUT',signal:controller.signal,body:JSON.stringify(body)})],
    ]);
  });
  it('forwards the four Frida operation signals and preserves omitted/explicit PID request bodies',async()=>{
    const fetcher=vi.fn(async()=>new Response('{}',{status:200}));vi.stubGlobal('fetch',fetcher);const controller=new AbortController();
    await api.fridaStatus(controller.signal);await api.fridaCaptures(controller.signal);await api.fridaStart(undefined,controller.signal);await api.fridaStart(123,controller.signal);await api.fridaStop(controller.signal);
    expect(fetcher.mock.calls).toEqual([
      ['/api/frida/status',expect.objectContaining({signal:controller.signal})],
      ['/api/frida/captures',expect.objectContaining({signal:controller.signal})],
      ['/api/frida/start',expect.objectContaining({method:'POST',signal:controller.signal,body:'{}'})],
      ['/api/frida/start',expect.objectContaining({method:'POST',signal:controller.signal,body:'{"pid":123}'})],
      ['/api/frida/stop',expect.objectContaining({method:'POST',signal:controller.signal})],
    ]);
  });
});
