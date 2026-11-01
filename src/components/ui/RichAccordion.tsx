import { useState, type ReactNode } from 'react';
import { IconChevronDown } from '../icons/index.js';
/** Accordion for rich finding titles; the existing string-title API stays unchanged. */
export function RichAccordion({title,children,className='',defaultOpen=false}:{title:ReactNode;children:ReactNode;className?:string;defaultOpen?:boolean}):React.JSX.Element {
 const [open,setOpen]=useState(defaultOpen);
 return <section className={`ui-accordion ${className}`}><button type="button" aria-expanded={open} onClick={()=>setOpen(!open)}>{title}<IconChevronDown className={open?'is-rotated':''}/></button>{open&&<div>{children}</div>}</section>;
}
