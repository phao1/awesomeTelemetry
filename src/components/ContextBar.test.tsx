import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {ContextBar} from './ContextBar.js';

afterEach(()=>vi.unstubAllGlobals());
describe('ContextBar explicit section navigation',()=>{
  it.each([true,false])('respects reduced motion=%s without losing the anchor action',reduced=>{
    vi.stubGlobal('matchMedia',vi.fn(()=>({matches:reduced})));
    const host=document.createElement('div');document.body.append(host);
    const section=document.createElement('section');section.id='observed-section';host.append(section);
    const scroll=vi.fn();section.scrollIntoView=scroll;
    const mount=document.createElement('div');host.append(mount);const root=createRoot(mount);
    try {
      act(()=>root.render(<ContextBar visible anchors={[{id:section.id,label:'Recorded evidence'}]} activeId="" locale="en" onCollapseAll={()=>undefined} onExpandAll={()=>undefined}/>));
      act(()=>mount.querySelector<HTMLButtonElement>('.contextbar-anchor')!.click());
      expect(scroll).toHaveBeenCalledExactlyOnceWith({behavior:reduced?'auto':'smooth',block:'start'});
    } finally {act(()=>root.unmount());host.remove();}
  });
});
