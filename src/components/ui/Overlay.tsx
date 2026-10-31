import { useRef, useState, useEffect, useId, isValidElement, cloneElement, type ReactNode, type CSSProperties } from 'react';
import { ta } from '../../i18n.js';
import { Floating, type Placement } from './portal.js';
export type { Placement } from './portal.js';
export function Tooltip({label,placement='bottom',children}:{label:string;placement?:Placement;children:ReactNode}):React.JSX.Element {
  const id=useId();
  const ref=useRef<HTMLSpanElement>(null),timer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const [visible,setVisible]=useState(false);
  const hide=()=>{if(timer.current)clearTimeout(timer.current);setVisible(false);};
  const show=()=>{if(timer.current)clearTimeout(timer.current);timer.current=setTimeout(()=>setVisible(true),300);};
  useEffect(()=>()=>{if(timer.current)clearTimeout(timer.current);},[]);
  return <span ref={ref} className="ui-overlay-anchor" onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}>{isValidElement<{'aria-describedby'?:string}>(children)?cloneElement(children,{'aria-describedby':visible?id:children.props['aria-describedby']}):<span tabIndex={0} aria-describedby={visible?id:undefined}>{children}</span>}{visible&&<Floating id={id} anchor={ref} trap={false} role="tooltip" placement={placement} onClose={hide} className="ui-tooltip-card">{label}</Floating>}</span>;
}
export interface PopoverProps {trigger:(props:{onClick:()=>void;'aria-expanded':boolean})=>ReactNode;open:boolean;onOpenChange:(open:boolean)=>void;children:ReactNode;placement?:Placement;style?:CSSProperties;}
export function Popover({trigger,open,onOpenChange,children,placement,style}:PopoverProps):React.JSX.Element {
  const ref=useRef<HTMLDivElement>(null);
  return <div className="ui-overlay-anchor" ref={ref}>{trigger({onClick:()=>onOpenChange(!open),'aria-expanded':open})}{open&&<Floating anchor={ref} onClose={()=>onOpenChange(false)} placement={placement} label={ta('a11y.popover')} className="ui-popover-card"><div style={style}>{children}</div></Floating>}</div>;
}
export interface MenuItem {id:string;label:ReactNode;onSelect?:()=>void;disabled?:boolean;danger?:boolean;icon?:ReactNode;}
export interface DropdownMenuProps {trigger:PopoverProps['trigger'];items:MenuItem[];open:boolean;onOpenChange:(open:boolean)=>void;}
export function DropdownMenu({trigger,items,open,onOpenChange}:DropdownMenuProps):React.JSX.Element {
 const ref=useRef<HTMLDivElement>(null);
 return <div className="ui-overlay-anchor" ref={ref}>{trigger({onClick:()=>onOpenChange(!open),'aria-expanded':open})}{open&&<Floating anchor={ref} role="menu" label={ta('a11y.popover')} onClose={()=>onOpenChange(false)} className="ui-menu-card"><div onKeyDown={e=>{const nodes=[...e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];const i=nodes.indexOf(document.activeElement as HTMLButtonElement);if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();nodes[e.key==='Home'?0:e.key==='End'?nodes.length-1:(i+(e.key==='ArrowDown'?1:-1)+nodes.length)%nodes.length]?.focus();}}}>{items.map(item=><button key={item.id} type="button" role="menuitem" className={`ui-menu-item ${item.danger?'ui-text-danger':''}`} disabled={item.disabled} onClick={()=>{item.onSelect?.();onOpenChange(false);}}>{item.icon}{item.label}</button>)}</div></Floating>}</div>;
}
