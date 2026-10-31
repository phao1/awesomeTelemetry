import { useEffect, useId, useRef, useState } from 'react';
import { EmptyState } from '../ui/States.js';
import { IconDashboard } from '../icons/index.js';
import { niceAxis } from './axis.js';
import { formatPercent, formatTokens } from '../../core/format.js';
export interface ChartSeries {label:string;points:number[];color?:string;}
export interface CartesianProps {series:ChartSeries[];labels?:string[];xLabels?:string[];height?:number;width?:number;stacked?:boolean;label?:string;format?:(value:number)=>string;yAxis?:'number'|'percent';percentScale?:'ratio'|'percent';}
export function useChartWidth(fallback=520):[React.RefObject<HTMLDivElement|null>,number] {
 const ref=useRef<HTMLDivElement>(null),[width,setWidth]=useState(fallback);
 useEffect(()=>{if(!ref.current||typeof ResizeObserver==='undefined')return;const observer=new ResizeObserver(entries=>{const next=entries[0]?.contentRect.width;if(next&&next>0)setWidth(next);});observer.observe(ref.current);return ()=>observer.disconnect();},[]);
 return [ref,width];
}
export function CartesianChart({series,labels,xLabels,height=220,width=520,stacked=false,label='Chart',format,yAxis='number',percentScale='ratio',kind='line'}:CartesianProps&{kind?:'line'|'area'|'bar'}):React.JSX.Element {
 const [ref,responsive]=useChartWidth(width),[hover,setHover]=useState<number|null>(null),id=useId();
 const count=Math.max(0,...series.map(s=>s.points.length)),w=Math.max(180,responsive),pad=40,bottom=height-28,plot=bottom-12,plotWidth=w-pad-12;
 if(!count||!series.some(s=>s.points.some(v=>Number.isFinite(v))))return <EmptyState icon={<IconDashboard/>} title="暂无数据 / No data"/>;
 const safe=(v:number|undefined)=>Number.isFinite(v)?Math.max(0,v!):0;
 const totals=Array.from({length:count},(_,i)=>series.reduce((sum,s)=>sum+safe(s.points[i]),0));
 const axis=yAxis==='percent'?{max:percentScale==='ratio'?1:100,ticks:Array.from({length:6},(_,i)=>i*(percentScale==='ratio'?.2:20))}:niceAxis(Math.max(0,...(stacked?totals:series.flatMap(s=>s.points.map(safe)))));
 const max=axis.max;
 const formatValue=format??(yAxis==='percent'?(n:number)=>formatPercent(percentScale==='ratio'?n:n/100):formatTokens);
 const formatTick=yAxis==='percent'?(n:number)=>`${Math.round(n/max*100)}%`:formatValue;
 const x=(i:number)=>kind==='bar'?pad+(i+.5)*plotWidth/count:pad+(count===1?.5:i/(count-1))*plotWidth;
 const y=(v:number)=>bottom-v/max*plot;
 const before=(si:number,i:number)=>stacked?series.slice(0,si).reduce((n,s)=>n+safe(s.points[i]),0):0;
 const color=(si:number)=>series[si]?.color??`var(--chart-${si%8+1})`;
 const names=labels??xLabels??[];
 return <div ref={ref} className="instrument-chart"><div className="chart-legend">{series.map((s,i)=><span key={s.label}><i style={{background:color(i)}}/>{s.label}</span>)}</div><svg role="img" aria-label={label} width="100%" height={height} viewBox={`0 0 ${w} ${height}`} onMouseLeave={()=>setHover(null)} onMouseMove={event=>{const box=event.currentTarget.getBoundingClientRect();const local=(event.clientX-box.left)/(box.width||w)*w;setHover(Math.max(0,Math.min(count-1,Math.round((local-pad)/plotWidth*(kind==='bar'?count:count-1)-(kind==='bar'?.5:0)))));}} tabIndex={0} onKeyDown={event=>{if(event.key==='ArrowRight'||event.key==='ArrowLeft'){event.preventDefault();setHover(i=>Math.max(0,Math.min(count-1,(i??0)+(event.key==='ArrowRight'?1:-1))));}if(event.key==='Escape')setHover(null);}}>
 {axis.ticks.map(tick=><g key={tick}><line x1={pad} x2={w-12} y1={y(tick)} y2={y(tick)} stroke="var(--chart-grid)" strokeDasharray="3 4"/><text x={pad-8} y={y(tick)+4} textAnchor="end" className="chart-axis chart-axis-y">{formatTick(tick)}</text></g>)}
 {series.map((s,si)=>{const top=s.points.map((v,i)=>[x(i),y(Math.min(max,before(si,i)+safe(v)))] as const),base=s.points.map((_,i)=>[x(i),y(before(si,i))] as const).reverse();const line=top.map(([a,b],i)=>`${i?'L':'M'}${a},${b}`).join(' ');return <g key={s.label}>{kind==='bar'?s.points.map((v,i)=>{const slot=plotWidth/count*.7,barWidth=stacked?slot:slot/series.length,b=before(si,i);return <rect key={i} x={x(i)-slot/2+(stacked?0:si*barWidth)} y={y(Math.min(max,b+safe(v)))} width={barWidth} height={Math.max(0,Math.min(max,safe(v))/max*plot)} rx={3} fill={color(si)}><title>{`${names[i]??i+1} · ${s.label}: ${formatValue(v)}`}</title></rect>;}):<>{kind==='area'&&<><defs><linearGradient id={`${id}-${si}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={color(si)} stopOpacity={.18}/><stop offset="1" stopColor={color(si)} stopOpacity={.02}/></linearGradient></defs><path d={`${line} ${base.map(([a,b])=>`L${a},${b}`).join(' ')}Z`} fill={`url(#${id}-${si})`}/></>}<path d={line} fill="none" stroke={color(si)} strokeWidth={2} strokeLinejoin="round"/>{hover!==null&&top[hover]&&<circle cx={top[hover]![0]} cy={top[hover]![1]} r={3} fill={color(si)} stroke="var(--canvas-default)" strokeWidth={2}/>}</>}</g>;})}
 {names.map((name,i)=>i%Math.max(1,Math.ceil(count/6))===0?<text key={i} x={x(i)} y={height-6} textAnchor="middle" className="chart-axis">{name}</text>:null)}
 {hover!==null&&<line x1={x(hover)} x2={x(hover)} y1={12} y2={bottom} stroke="var(--border-strong)" strokeDasharray="3 3"/>}</svg>{hover!==null&&<div className="chart-tooltip" role="status"><strong>{names[hover]??hover+1}</strong>{series.map((s,i)=><div key={s.label}><i style={{background:color(i)}}/>{s.label}<b className="num">{formatValue(s.points[hover]??0)}</b></div>)}</div>}</div>;
}
