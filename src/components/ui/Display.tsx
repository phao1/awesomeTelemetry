import { useState, type ReactNode, type HTMLAttributes } from 'react';
import { Badge, type BadgeTone } from './Badge.js';
import { Tooltip } from './Overlay.js';
import { Sparkline } from '../charts/Sparkline.js';
import { IconInfo, IconChevronDown, IconCopy, IconCheck, IconEye, IconEyeOff } from '../icons/index.js';
import { IconButton } from './Button.js';
import { Toast } from './States.js';
import { formatPercent } from '../../core/format.js';
export function Pill({icon,children}:{icon?:ReactNode;children:ReactNode}):React.JSX.Element {return <span className="ui-pill">{icon}{children}</span>;}
export function Card({children,className='',...props}:HTMLAttributes<HTMLElement>):React.JSX.Element {return <section {...props} className={`ui-card ${className}`}>{children}</section>;}
export function CardHeader({title,description,actions,children}:{title?:ReactNode;description?:ReactNode;actions?:ReactNode;children?:ReactNode}):React.JSX.Element {return <header className="ui-card-header"><div><h2>{title}</h2>{description&&<p>{description}</p>}{children}</div>{actions}</header>;}
export function CardBody({children}: {children:ReactNode}):React.JSX.Element {return <div className="ui-card-body">{children}</div>;}
export function CardFooter({children}:{children:ReactNode}):React.JSX.Element {return <footer className="ui-card-footer">{children}</footer>;}
export function StatCard({label,icon,value,unit,change,higherIsBetter=true,comparison,points,unknownReason}:{label:string;icon?:ReactNode;value:string|number|null;unit?:string;change?:number;higherIsBetter?:boolean;comparison?:string;points?:number[];unknownReason?:string}):React.JSX.Element {
 const tone=change===undefined||change===0?'neutral':(change>0)===higherIsBetter?'success':'danger';
 return <Card><CardBody><div className="ui-stat-label">{icon}{label}{unknownReason&&<Tooltip label={unknownReason}><button className="ui-inline-icon" aria-label={unknownReason}><IconInfo/></button></Tooltip>}</div><div className="ui-stat-value num">{value??'—'} <small>{unit}</small></div><div className="ui-stat-footer">{change!==undefined&&<Badge tone={tone}>{change>0?'↑':change<0?'↓':'—'} {formatPercent(Math.abs(change))}</Badge>}{comparison}</div>{points&&<div className="ui-stat-sparkline"><Sparkline fluid series={[{label,points:points.map(value=>({value})),color:"var(--chart-1)"}]} height={40}/></div>}</CardBody></Card>;
}
export function MetricStrip({items}:{items:{label:string;value:ReactNode}[]}):React.JSX.Element {return <Card><dl className="ui-metric-strip">{items.map(i=><div key={i.label}><dt>{i.label}</dt><dd className="num">{i.value}</dd></div>)}</dl></Card>;}
export function Callout({title,children,tone='accent'}:{title:string;children?:ReactNode;tone?:BadgeTone}):React.JSX.Element {return <div className="ui-callout" role={tone==='danger'?'alert':'note'} style={{background:`var(--${tone}-subtle)`,color:`var(--${tone}-fg)`}}><IconInfo/><div><strong>{title}</strong><div className="ui-muted">{children}</div></div></div>;}
export function Steps({items,current}:{items:string[];current:number}):React.JSX.Element {return <ol className="ui-steps">{items.map((item,i)=><li key={item} aria-current={current===i?'step':undefined} data-complete={i<current}><span>{i<current?<IconCheck/>:i+1}</span>{item}</li>)}</ol>;}
export function Accordion({title,children,open,defaultOpen=false,onOpenChange,disabled}:{title:string;children:ReactNode;open?:boolean;defaultOpen?:boolean;onOpenChange?:(open:boolean)=>void;disabled?:boolean}):React.JSX.Element {const [internal,setInternal]=useState(defaultOpen);const expanded=open??internal;return <section className="ui-accordion"><button type="button" disabled={disabled} aria-expanded={expanded} onClick={()=>{setInternal(!expanded);onOpenChange?.(!expanded);}}>{title}<IconChevronDown className={expanded?'is-rotated':''}/></button>{expanded&&<div>{children}</div>}</section>;}
export function KeyValue({items}:{items:{label:string;value:ReactNode}[]}):React.JSX.Element {return <dl className="ui-key-value">{items.map((i,index)=><div key={index}><dt>{i.label}</dt><dd>{i.value}</dd></div>)}</dl>;}
export const DescriptionList=KeyValue;
export function Meter({value,max=100,label,tone='accent',threshold}:{value:number;max?:number;label:string;tone?:BadgeTone;threshold?:number}):React.JSX.Element {const pct=Math.max(0,Math.min(100,max>0?value/max*100:0));return <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.max(0,Math.min(max,value))} className="ui-meter"><span style={{width:`${pct}%`,background:`var(--${threshold!==undefined&&value<threshold?'attention':tone}-emphasis)`}}/></div>;}
export const ProgressBar=Meter;
export function CopyField({value,label,secret=false}:{value:string;label:string;secret?:boolean}):React.JSX.Element {
 const [shown,setShown]=useState(!secret),[copied,setCopied]=useState(false),[error,setError]=useState(false);
 return <div className="ui-copy-field"><input aria-label={label} readOnly type={shown?'text':'password'} value={value}/>{secret&&<IconButton label={shown?'Hide / 隐藏':'Show / 显示'} icon={shown?<IconEyeOff/>:<IconEye/>} onClick={()=>setShown(!shown)}/>}<IconButton label="Copy / 复制" icon={copied?<IconCheck/>:<IconCopy/>} onClick={()=>{void navigator.clipboard.writeText(value).then(()=>{setCopied(true);setError(false);}).catch((err:unknown)=>{console.error('[copy]',err);setError(true);});}}/>{copied&&<Toast title="Copied / 已复制" onDismiss={()=>setCopied(false)}/ >}{error&&<Toast tone="error" title="Copy failed / 复制失败" onDismiss={()=>setError(false)}/>}</div>;
}
