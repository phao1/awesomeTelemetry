import { useEffect, useId, useRef, useState, type ReactNode, type ChangeEvent, type SelectHTMLAttributes } from 'react';
import { Floating } from './portal.js';
import { IconCheck, IconChevronDown, IconClose, IconSearch } from '../icons/index.js';
export interface SelectOption {value:string;label:string;description?:string;icon?:ReactNode;color?:string;disabled?:boolean;}
export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>,'size'|'multiple'> {size?:'sm'|'md'|'lg';options:SelectOption[];prefix?:string;}
export function Select({value,defaultValue,options,onChange,disabled,size='md',prefix,className,'aria-label':label,id,name,required,onBlur}:SelectProps):React.JSX.Element {
 const [internal,setInternal]=useState(String(defaultValue??options[0]?.value??''));
 const current=value===undefined?internal:String(value);
 return <Choice options={options} values={[current]} size={size} disabled={disabled} prefix={prefix} className={className} label={label??prefix??name??'Select'} id={id} onBlur={onBlur as unknown as React.FocusEventHandler<HTMLElement>} onValues={values=>{setInternal(values[0]??'');onChange?.({target:{value:values[0]??'',name},currentTarget:{value:values[0]??'',name}} as ChangeEvent<HTMLSelectElement>);}}><input type="hidden" name={name} value={current} required={required}/></Choice>;
}
export interface ComboboxProps {options:SelectOption[];value?:string;defaultValue?:string;onChange?:(value:string)=>void;disabled?:boolean;label:string;placeholder?:string;onLoadMore?:()=>void;loading?:boolean;loadMoreLabel?:string;}
export function Combobox({value,defaultValue='',onChange,...props}:ComboboxProps):React.JSX.Element {
 const [internal,setInternal]=useState(defaultValue);
 return <Choice {...props} search values={[value??internal]} onValues={next=>{setInternal(next[0]??'');onChange?.(next[0]??'');}}/>;
}
export interface MultiComboboxProps extends Omit<ComboboxProps,'value'|'defaultValue'|'onChange'> {value?:string[];defaultValue?:string[];onChange?:(value:string[])=>void;}
export function MultiCombobox({value,defaultValue=[],onChange,...props}:MultiComboboxProps):React.JSX.Element {
 const [internal,setInternal]=useState(defaultValue);
 return <Choice {...props} search multiple values={value??internal} onValues={next=>{setInternal(next);onChange?.(next);}}/>;
}
function Choice({options,values,onValues,label,disabled,size='md',prefix,className,search=false,multiple=false,placeholder='Select…',onLoadMore,loading,loadMoreLabel='Load more / 加载更多',children,id,onBlur}:{options:SelectOption[];values:string[];onValues:(values:string[])=>void;label:string;disabled?:boolean;size?:string;prefix?:string;className?:string;search?:boolean;multiple?:boolean;placeholder?:string;onLoadMore?:()=>void;loading?:boolean;loadMoreLabel?:string;children?:ReactNode;id?:string;onBlur?:React.FocusEventHandler<HTMLElement>}):React.JSX.Element {
 const generated=useId(),listId=generated+'-options',ref=useRef<HTMLDivElement>(null);
 const [open,setOpen]=useState(false),[query,setQuery]=useState(''),[active,setActive]=useState(0);
 const filtered=options.filter(o=>!query||`${o.label} ${o.description??''}`.toLowerCase().includes(query.toLowerCase()));
 const enabled=filtered.filter(o=>!o.disabled);
 const selected=options.filter(o=>values.includes(o.value));
 const choose=(option:SelectOption)=>{if(option.disabled)return;onValues(multiple?values.includes(option.value)?values.filter(v=>v!==option.value):[...values,option.value]:[option.value]);if(!multiple)setOpen(false);};
 const keyboard=(e:React.KeyboardEvent)=>{
  if(disabled||e.nativeEvent.isComposing||(e.target as HTMLElement).closest('.ui-chip-remove'))return;
  if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();if(!open){setOpen(true);setActive(e.key==='ArrowUp'?Math.max(0,enabled.length-1):0);}else setActive(i=>e.key==='Home'?0:e.key==='End'?Math.max(0,enabled.length-1):(i+(e.key==='ArrowDown'?1:-1)+enabled.length)%Math.max(1,enabled.length));}
  else if(e.key==='Enter'||(!open&&e.key===' ')){e.preventDefault();if(!open)setOpen(true);else if(enabled[active])choose(enabled[active]);}
  else if(e.key==='Escape'){e.preventDefault();setOpen(false);}
  else if(!search&&e.key.length===1&&!e.ctrlKey&&!e.metaKey){const match=enabled.findIndex(o=>o.label.toLowerCase().startsWith(e.key.toLowerCase()));if(match>=0){e.preventDefault();setActive(match);setOpen(true);}}
 };
 useEffect(()=>{if(open&&enabled[active])document.getElementById(`${generated}-${enabled[active]!.value}`)?.scrollIntoView?.({block:'nearest'});},[open,active,generated,enabled]);
 const toggle=()=>{if(disabled)return;setOpen(!open);setQuery('');setActive(0);};
 const triggerContent=<>{prefix&&<span className="ui-muted">{prefix}: </span>}{selected.length?selected.slice(0,multiple?2:1).map(o=><span key={o.value} className={multiple?'ui-chip':'ui-choice-value'}>{o.icon&&<span className="ui-choice-icon">{o.icon}</span>}{o.color&&<span className="ui-color-dot" style={{background:o.color}}/>}<span className="ui-chip-label">{o.label}</span>{multiple&&<button className="ui-chip-remove" type="button" disabled={disabled} aria-label={`Remove ${o.label}`} onClick={event=>{event.stopPropagation();onValues(values.filter(v=>v!==o.value));}}><IconClose size={12}/></button>}</span>):placeholder}{multiple&&selected.length>2&&<span className="ui-chip-overflow">+{selected.length-2}</span>}<IconChevronDown/></>;
 const attributes={id,role:'combobox','aria-label':label,'aria-expanded':open,'aria-controls':listId,'aria-haspopup':'listbox' as const,'aria-activedescendant':open&&enabled[active]?`${generated}-${enabled[active]!.value}`:undefined};
 return <div className={`ui-choice ${className??''}`} ref={ref} onKeyDown={keyboard}>{children}{multiple?<div {...attributes} className={`ui-select ui-multi-trigger ui-btn-${size}`} tabIndex={disabled?-1:0} aria-disabled={disabled||undefined} onBlur={onBlur} onClick={toggle}>{triggerContent}</div>:<button {...attributes} type="button" className={`ui-select ui-btn-${size}`} disabled={disabled} onBlur={onBlur} onClick={toggle}>{triggerContent}</button>}{open&&!disabled&&<Floating anchor={ref} onClose={()=>setOpen(false)} label={label} className="ui-choice-popup">{search&&<label className="ui-combo-search"><IconSearch/><input autoFocus aria-label={`${label} search`} value={query} onChange={e=>{setQuery(e.target.value);setActive(0);}}/></label>}<div role="listbox" id={listId} aria-label={label} aria-multiselectable={multiple||undefined} className="ui-choice-list">{filtered.map(o=><button type="button" role="option" key={o.value} id={`${generated}-${o.value}`} aria-selected={values.includes(o.value)} disabled={o.disabled} className={`ui-option ${enabled[active]===o?'is-active':''}`} onMouseEnter={()=>{if(!o.disabled)setActive(enabled.indexOf(o));}} onClick={()=>choose(o)}>{o.icon&&<span className="ui-choice-icon">{o.icon}</span>}{o.color&&<span className="ui-color-dot" style={{background:o.color}}/>}<span className="ui-option-label">{o.label}{o.description&&<small>{o.description}</small>}</span>{values.includes(o.value)&&<IconCheck/>}</button>)}{!filtered.length&&<div className="ui-empty-options">No results / 无匹配项</div>}</div>{onLoadMore&&<button type="button" disabled={loading} onClick={onLoadMore} className="ui-btn ui-btn-ghost">{loading?<span className="ui-spinner"/>:loadMoreLabel}</button>}</Floating>}</div>;
}
