import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect,it,vi } from 'vitest';
import { useSidebarPreference } from './sidebar-preference.js';
it.each([1024,1279,1280,1440])('uses the breakpoint default at %s without writing a user preference',width=>{
 localStorage.clear();let change!:(event:MediaQueryListEvent)=>void;const remove=vi.fn();vi.stubGlobal('innerWidth',width);vi.stubGlobal('matchMedia',vi.fn(()=>({matches:width<1280,addEventListener:(_type:string,fn:typeof change)=>{change=fn;},removeEventListener:remove})));
 const host=document.createElement('div'),root=createRoot(host);function Test(){const [collapsed,toggle]=useSidebarPreference();return <button onClick={toggle} aria-expanded={!collapsed}/>;}
 try{act(()=>root.render(<Test/>));const button=host.querySelector('button')!;expect(button.getAttribute('aria-expanded')).toBe(String(width>=1280));expect(localStorage.getItem('awesome-telemetry.sidebarCollapsed')).toBeNull();act(()=>change({matches:true} as MediaQueryListEvent));expect(button.getAttribute('aria-expanded')).toBe('false');act(()=>button.click());expect(button.getAttribute('aria-expanded')).toBe('true');expect(localStorage.getItem('awesome-telemetry.sidebarCollapsed')).toBe('false');act(()=>change({matches:false} as MediaQueryListEvent));act(()=>change({matches:true} as MediaQueryListEvent));expect(button.getAttribute('aria-expanded')).toBe('true');}finally{act(()=>root.unmount());expect(remove).toHaveBeenCalledOnce();vi.unstubAllGlobals();localStorage.clear();}
});
it.each(['true','false'])('respects saved manual preference %s on mount and resize',saved=>{
 localStorage.setItem('awesome-telemetry.sidebarCollapsed',saved);let change!:(event:MediaQueryListEvent)=>void;vi.stubGlobal('innerWidth',1024);vi.stubGlobal('matchMedia',()=>({matches:true,addEventListener:(_type:string,fn:typeof change)=>{change=fn;},removeEventListener:()=>{}}));const host=document.createElement('div'),root=createRoot(host);function Test(){const [collapsed]=useSidebarPreference();return <span>{String(collapsed)}</span>;}
 try{act(()=>root.render(<Test/>));expect(host.textContent).toBe(saved);act(()=>change({matches:false} as MediaQueryListEvent));expect(host.textContent).toBe(saved);}finally{act(()=>root.unmount());vi.unstubAllGlobals();localStorage.clear();}
});
