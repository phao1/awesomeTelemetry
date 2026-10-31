import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useFocusTrap } from './focus-trap.js';
import { pushOverlay } from '../../keyboard.js';
export function Portal({children,region}:{children:ReactNode;region?:'toasts'}): React.JSX.Element {
  let root = document.getElementById('ui-portal');
  if (!root) { root=document.createElement('div'); root.id='ui-portal'; document.body.appendChild(root); }
  if(region){let target=document.getElementById('ui-'+region);if(!target){target=document.createElement('div');target.id='ui-'+region;target.className='ui-toast-stack';root.appendChild(target);}return createPortal(children,target);}
  return createPortal(children,root);
}
export type Placement = 'top'|'bottom'|'left'|'right';
/** Shared viewport clamp and edge flip for all anchored layers. */
export function positionLayer(anchor: DOMRect, layer: Pick<DOMRect,'width'|'height'>, viewport:{width:number;height:number}, placement:Placement='bottom'): {left:number;top:number} {
  const gap=8, below=anchor.bottom+gap, above=anchor.top-layer.height-gap;
  let left=anchor.left,top=below;
  if(placement==='top')top=above>=gap?above:below;
  if(placement==='bottom'&&below+layer.height>viewport.height-gap&&above>=gap)top=above;
  if(placement==='left'||placement==='right'){
    const toLeft=anchor.left-layer.width-gap,toRight=anchor.right+gap;
    left=placement==='left'?toLeft:toRight;
    if(placement==='left'&&toLeft<gap&&toRight+layer.width<=viewport.width-gap)left=toRight;
    if(placement==='right'&&toRight+layer.width>viewport.width-gap&&toLeft>=gap)left=toLeft;
    top=anchor.top;
  }else if(left+layer.width>viewport.width-gap)left=anchor.right-layer.width;
  return {left:Math.max(gap,Math.min(left,viewport.width-layer.width-gap)),top:Math.max(gap,Math.min(top,viewport.height-layer.height-gap))};
}
/** Visible if any part of the anchor remains in the viewport. */
export function isAnchorVisible(rect:Pick<DOMRect,'top'|'bottom'|'left'|'right'>,viewport:{width:number;height:number}):boolean {
  return rect.bottom>0&&rect.right>0&&rect.top<viewport.height&&rect.left<viewport.width;
}
export function Floating({anchor,children,onClose,placement='bottom',className='',role='dialog',label,trap=true,id}:{anchor:RefObject<HTMLElement|null>;children:ReactNode;onClose:()=>void;placement?:Placement;className?:string;role?:'dialog'|'menu'|'listbox'|'tooltip';label?:string;trap?:boolean;id?:string}):React.JSX.Element {
  const ref=useRef<HTMLDivElement>(null), close=useRef(onClose);
  useLayoutEffect(()=>{close.current=onClose;},[onClose]);
  const [position,setPosition]=useState({left:0,top:0});
  const restore=useRef<HTMLElement|null>(null);
  useLayoutEffect(()=>{const el=anchor.current;restore.current=el?.matches('button,input,a[href]')?el:el?.querySelector<HTMLElement>('[role=combobox]')??el?.querySelector<HTMLElement>('button:not(:disabled),input:not([type=hidden]),a[href]')??null;},[anchor]);
  useFocusTrap(ref,trap,()=>close.current(),restore);
  useLayoutEffect(()=>{
    let closed=false;
    const update=(event?:Event)=>{
      const element=anchor.current, layer=ref.current;
      if(!element||!layer||closed)return;
      const rect=element.getBoundingClientRect(), viewport={width:window.innerWidth,height:window.innerHeight};
      // Zero-sized initial rectangles also occur in layout-free renderers. Scroll/
      // resize must still close detached or hidden anchors after opening.
      let visible=rect.width===0&&rect.height===0&&!event?true:isAnchorVisible(rect,viewport);
      for(let parent=element.parentElement;visible&&parent;parent=parent.parentElement){
        const bounds=parent.getBoundingClientRect();
        if(!bounds.width&&!bounds.height)continue;
        const style=getComputedStyle(parent);
        if(/auto|scroll|hidden|clip/.test(`${style.overflowY} ${style.overflow}`)&& (rect.bottom<=bounds.top||rect.top>=bounds.bottom))visible=false;
        if(/auto|scroll|hidden|clip/.test(`${style.overflowX} ${style.overflow}`)&& (rect.right<=bounds.left||rect.left>=bounds.right))visible=false;
      }
      if(!element.isConnected||!visible){closed=true;close.current();return;}
      setPosition(positionLayer(rect,layer.getBoundingClientRect(),viewport,placement));
    };
    const routeChanged=()=>close.current();window.addEventListener('hashchange',routeChanged);window.addEventListener('popstate',routeChanged);
    update(); window.addEventListener('resize',update);window.addEventListener('scroll',update,true);
    const down=(e:MouseEvent)=>{if(!ref.current?.contains(e.target as Node)&&!anchor.current?.contains(e.target as Node))close.current();};
    document.addEventListener('mousedown',down);
    const observer=typeof ResizeObserver==='undefined'?null:new ResizeObserver(()=>update(new Event('resize')));
    if(anchor.current)observer?.observe(anchor.current);
    if(ref.current)observer?.observe(ref.current);
    const remove=trap?pushOverlay(()=>close.current()):()=>undefined;
    return ()=>{observer?.disconnect();remove();window.removeEventListener('hashchange',routeChanged);window.removeEventListener('popstate',routeChanged);document.removeEventListener('mousedown',down);window.removeEventListener('resize',update);window.removeEventListener('scroll',update,true);};
  },[anchor,placement,trap]);
  return <Portal><div id={id} ref={ref} role={role} aria-label={label} className={`ui-floating ${className}`} style={position}>{children}</div></Portal>;
}
