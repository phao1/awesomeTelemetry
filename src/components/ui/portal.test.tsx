import {act,useRef,useState} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {Floating,isAnchorVisible} from './portal.js';
import {Select,Combobox,MultiCombobox} from './Select.js';
import {Popover,DropdownMenu,Tooltip} from './Overlay.js';
const roots:Root[]=[];
let anchorBox:DOMRect,clipBox:DOMRect;
function mount(node:React.ReactNode){const host=document.createElement('div');document.body.append(host);const root=createRoot(host);roots.push(root);act(()=>root.render(node));return host;}
beforeEach(()=>{
 anchorBox=new DOMRect(100,100,80,32);clipBox=new DOMRect(0,0,400,300);
 vi.stubGlobal('innerWidth',400);vi.stubGlobal('innerHeight',300);
 vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(function(this:HTMLElement){return this.matches('[data-anchor],.ui-choice,.ui-overlay-anchor')?anchorBox:this.matches('[data-scroll]')?clipBox:this.matches('.ui-floating')?new DOMRect(0,0,160,80):new DOMRect();});
});
afterEach(()=>{act(()=>roots.splice(0).forEach(r=>r.unmount()));document.body.replaceChildren();vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();});
function Demo({close}:{close:()=>void}){const anchor=useRef<HTMLButtonElement>(null),[open,setOpen]=useState(true);return <div data-scroll style={{overflow:'auto'}}><button data-anchor ref={anchor}>Anchor</button>{open&&<Floating anchor={anchor} onClose={()=>{setOpen(false);close();}}><button>Option</button></Floating>}</div>;}
describe('shared floating lifecycle',()=>{
 it('repositions on captured ancestor scroll and resize, flips, and closes when clipped',()=>{
  const close=vi.fn(),host=mount(<Demo close={close}/>),floating=document.querySelector<HTMLElement>('.ui-floating')!;
  expect(floating.style.top).toBe('140px');
  anchorBox=new DOMRect(140,60,80,32);act(()=>host.querySelector('[data-scroll]')!.dispatchEvent(new Event('scroll')));expect(floating.style.top).toBe('100px');expect(floating.style.left).toBe('140px');
  anchorBox=new DOMRect(330,250,50,32);act(()=>window.dispatchEvent(new Event('resize')));expect(floating.style.top).toBe('162px');expect(floating.style.left).toBe('220px');
  clipBox=new DOMRect(0,0,100,100);act(()=>host.querySelector('[data-scroll]')!.dispatchEvent(new Event('scroll')));expect(close).toHaveBeenCalledOnce();expect(document.querySelector('.ui-floating')).toBeNull();
 });
 it('closes completely offscreen anchors and removes observers/listeners after unmount',()=>{
  const close=vi.fn(),disconnect=vi.fn(),observe=vi.fn();vi.stubGlobal('ResizeObserver',class{observe=observe;disconnect=disconnect;});
  const remove=vi.spyOn(window,'removeEventListener');mount(<Demo close={close}/>);expect(observe).toHaveBeenCalledTimes(2);
  anchorBox=new DOMRect(0,-100,80,32);act(()=>window.dispatchEvent(new Event('scroll')));expect(close).toHaveBeenCalledOnce();expect(disconnect).toHaveBeenCalledOnce();expect(remove).toHaveBeenCalledWith('scroll',expect.any(Function),true);
 });
 it('repositions when anchor or content dimensions change',()=>{
  let resize:ResizeObserverCallback=()=>undefined;vi.stubGlobal('ResizeObserver',class{constructor(callback:ResizeObserverCallback){resize=callback;}observe(){}disconnect(){}});
  mount(<Demo close={()=>undefined}/>);anchorBox=new DOMRect(120,50,80,32);act(()=>resize([],{} as ResizeObserver));expect((document.querySelector('.ui-floating') as HTMLElement).style.top).toBe('90px');
 });
 it('keeps partially visible anchors open',()=>{expect(isAnchorVisible(new DOMRect(0,-10,80,32),{width:400,height:300})).toBe(true);expect(isAnchorVisible(new DOMRect(401,100,80,32),{width:400,height:300})).toBe(false);});
 it.each(['Select','Combobox','MultiCombobox','Popover','DropdownMenu','Tooltip'])('%s uses the common portal surface',name=>{
  vi.useFakeTimers();const options=[{value:'a',label:'Alpha',color:'var(--provider-codex)'},{value:'b',label:'Beta',color:'var(--provider-claude)'}];
  const node=name==='Select'?<Select options={options}/>:name==='Combobox'?<Combobox label="Choice" options={options}/>:name==='MultiCombobox'?<MultiCombobox label="Choices" options={options}/>:name==='Popover'?<Popover open onOpenChange={()=>undefined} trigger={p=><button {...p}>Open</button>}>Details</Popover>:name==='DropdownMenu'?<DropdownMenu open onOpenChange={()=>undefined} trigger={p=><button {...p}>Menu</button>} items={[{id:'a',label:'Alpha'}]}/>:<Tooltip label="Details"><button>Tip</button></Tooltip>;
  const host=mount(node);
  if(['Select','Combobox','MultiCombobox'].includes(name))act(()=>host.querySelector<HTMLElement>('[role=combobox]')!.click());
  if(name==='Tooltip'){act(()=>host.querySelector('button')!.focus());act(()=>vi.advanceTimersByTime(300));}
  expect(document.querySelector('#ui-portal .ui-floating')).not.toBeNull();expect(host.querySelector('.ui-floating')).toBeNull();
 });
 it('styles floating cards as opaque, bordered elevated surfaces above sticky chrome',()=>{
  const css=readFileSync('src/styles/components/foundation.css','utf8'),rule=css.match(/\.ui-floating\s*\{([^}]+)\}/)![1]!;
  expect(rule).toContain('background: var(--canvas-overlay)');expect(rule).toContain('1px solid var(--border-default)');expect(rule).toContain('var(--shadow-md)');expect(rule).toContain('z-index: var(--z-palette)');
  expect(css).not.toContain('.ui-option span { flex: 1; }');expect(css).toContain('.ui-option > .ui-option-label');expect(css).toContain('flex: 0 0 var(--dot-size)');
 });
});
