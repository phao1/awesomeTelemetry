import { useState } from 'react';
import { EmptyState } from '../ui/States.js';
import { IconList } from '../icons/index.js';
import { formatCount } from '../../core/format.js';
export function BarList({items,format=formatCount,label='Ranking'}:{items:{label:string;value:number;color?:string}[];format?:(n:number)=>string;label?:string}):React.JSX.Element {
 const [all,setAll]=useState(false);const max=Math.max(1,...items.map(i=>i.value));
 if(!items.length)return <EmptyState icon={<IconList/>} title="暂无数据 / No data"/>;
 return <div className="chart-bar-list" aria-label={label}>{items.slice(0,all?undefined:8).map(item=><div key={item.label} title={`${item.label}: ${format(item.value)}`}><span className="chart-bar-list-fill" style={{width:`${Math.max(0,item.value)/max*100}%`,background:item.color??'var(--chart-1)'}}/><span>{item.label}</span><strong className="num">{format(item.value)}</strong></div>)}{items.length>8&&<button type="button" className="ui-btn ui-btn-ghost" onClick={()=>setAll(!all)}>{all?'收起 / Show less':'查看全部 / Show all'}</button>}</div>;
}
