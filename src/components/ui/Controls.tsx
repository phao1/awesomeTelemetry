import { useEffect, useRef, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { Tabs, type TabsProps } from './Tabs.js';
export function SegmentedControl(props:Omit<TabsProps,'variant'>):React.JSX.Element {return <Tabs {...props} variant="pill"/>;}
export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>,'type'> {ref?:React.Ref<HTMLInputElement>;indeterminate?:boolean;label?:ReactNode;}
export function Checkbox({indeterminate,label,ref:externalRef,...props}:CheckboxProps):React.JSX.Element {const ref=useRef<HTMLInputElement>(null);useEffect(()=>{if(ref.current)ref.current.indeterminate=!!indeterminate;},[indeterminate]);return <label className="ui-check-label"><input {...props} ref={node=>{ref.current=node;if(typeof externalRef==='function')externalRef(node);else if(externalRef)externalRef.current=node;}} type="checkbox" aria-checked={indeterminate?'mixed':props.checked}/>{label}</label>;}
export function Radio({label,...props}:CheckboxProps):React.JSX.Element {return <label className="ui-check-label"><input {...props} type="radio"/>{label}</label>;}
export function Switch({label,checked,defaultChecked=false,onChange,disabled,...props}:CheckboxProps):React.JSX.Element {
 const [internal,setInternal]=useState(defaultChecked);
 return <label className="ui-check-label"><input {...props} className="ui-switch" role="switch" type="checkbox" checked={checked??internal} disabled={disabled} onChange={e=>{setInternal(e.target.checked);onChange?.(e);}}/>{label}</label>;
}
