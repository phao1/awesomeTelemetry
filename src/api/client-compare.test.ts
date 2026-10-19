import {afterEach,describe,expect,it,vi} from 'vitest';
import {api} from './client.js';

afterEach(()=>vi.unstubAllGlobals());
describe('comparison request ownership',()=>{
  it('forwards the owner signal without changing the frozen compare route/body',async()=>{
    const fetcher=vi.fn(async()=>new Response(JSON.stringify({left:null,right:null,speed:null}),{status:200}));
    vi.stubGlobal('fetch',fetcher);
    const controller=new AbortController();
    await api.compare('left-key','right-key',controller.signal);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('/api/compare',expect.objectContaining({method:'POST',signal:controller.signal,body:JSON.stringify({leftKey:'left-key',rightKey:'right-key'})}));
  });
});
