import { useState } from 'react';
import type { Locale } from '../../i18n.js';
import type { RsiIteration } from '../../core/rsi-types.js';
import type { RsiMetrics, RsiTaskView } from '../../core/rsi-api-client.js';
import { formatCount, formatTokens, formatDuration } from '../../core/format.js';
import { Card, CardBody, CardHeader } from '../ui/Display.js';
import { Button } from '../ui/Button.js';
import { EmptyState } from '../ui/States.js';
import { LineChart, BarChart } from '../charts/index.js';
import { useChartWidth } from '../charts/CartesianChart.js';
import { IconTrendingUp } from '../icons/index.js';
import { copy, reasonLabel } from './copy.js';
import { Status } from './Shared.js';
export function ScoreChart({task,iterations,locale,onOpen}:{task:RsiTaskView;iterations:RsiIteration[];locale:Locale;onOpen:(i:RsiIteration)=>void}) {
  const [ref,width]=useChartWidth(),[hover,setHover]=useState<number|null>(null),points=iterations.filter(i=>i.trainScore!==null).sort((a,b)=>a.seq-b.seq);
  const baseline=task.baselineTrainScore;
  if(!points.length)return <EmptyState icon={<IconTrendingUp/>} title={copy(locale,baseline===null?'等待基线标定':'当前只有基线',baseline===null?'Waiting for baseline calibration':'Only the baseline is available')} description={copy(locale,'完成首轮迭代后将显示分数趋势','Score trends appear after the first iteration')}/>;
  const w=Math.max(180,width),height=280,left=40,right=w-16,bottom=248,top=16,max=Math.max(1,...points.map(i=>i.trainScore!+(task.delta??0)),(baseline??0)+(task.delta??0))*1.1;
  const parent=iterations.find(i=>i.id===task.currentParentId)?.trainScore??baseline;
  const x=(seq:number)=>left+seq/Math.max(1,...points.map(i=>i.seq))*(right-left), y=(score:number)=>bottom-score/max*(bottom-top);
  const point=hover===null?null:points[hover];
  return <div className="rsi-score-chart" ref={ref}><svg role="img" aria-label={copy(locale,'训练集通过数与噪声带','Training passes and noise band')} width="100%" height={height} viewBox={`0 0 ${w} ${height}`}>
    {[0,.25,.5,.75,1].map(f=><g key={f}><line x1={left} x2={right} y1={y(max*f)} y2={y(max*f)} stroke="var(--chart-grid)" strokeDasharray="3 4"/><text x={left-8} y={y(max*f)+4} textAnchor="end" className="chart-axis">{formatTokens(Math.round(max*f))}</text></g>)}
    {parent!==null&&task.delta!==null&&<rect x={left} y={y(Math.min(max,parent+task.delta))} width={right-left} height={y(Math.max(0,parent-task.delta))-y(Math.min(max,parent+task.delta))} fill="var(--accent-subtle)"><title>δ {formatCount(task.delta,locale)}</title></rect>}
    {baseline!==null&&<g><line x1={left} x2={right} y1={y(baseline)} y2={y(baseline)} stroke="var(--fg-subtle)" strokeDasharray="5 4"/><text x={right} y={Math.max(14,y(baseline)-8)} textAnchor="end" className="chart-axis">{copy(locale,'基线','Baseline')} {formatCount(baseline,locale)}</text></g>}
    <path d={points.map((p,index)=>`${index?'L':'M'}${x(p.seq)},${y(p.trainScore!)}`).join(' ')} fill="none" stroke="var(--chart-1)" strokeWidth={2}/>
    {points.map((p,index)=>{const tone=p.state==='promoted'?'success':p.state==='rejected'?'danger':'attention';return <g key={p.id}><circle role="button" tabIndex={0} aria-label={`#${p.seq} ${p.prd.hypothesis}`} cx={x(p.seq)} cy={y(p.trainScore!)} r={5} fill={p.state==='rejected'?'var(--canvas-default)':`var(--${tone}-fg)`} stroke={`var(--${tone}-fg)`} strokeWidth={2} onFocus={()=>setHover(index)} onBlur={()=>setHover(null)} onMouseEnter={()=>setHover(index)} onMouseLeave={()=>setHover(null)} onClick={()=>onOpen(p)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' ')onOpen(p);}}/><text x={x(p.seq)} y={height-8} textAnchor="middle" className="chart-axis">#{p.seq}</text></g>;})}
  </svg>{point&&<div className="rsi-chart-tooltip" role="status"><strong>#{point.seq} · {point.prd.hypothesis}</strong><span className="num">{formatCount(point.trainScore,locale)}</span><Status value={point.state} locale={locale}/>{point.holdReasons.map(r=><span key={r}>{reasonLabel(r,locale)}</span>)}</div>}</div>;
}
export function Trends({task,iterations,metrics,locale,onOpen}:{task:RsiTaskView;iterations:RsiIteration[];metrics:RsiMetrics|null;locale:Locale;onOpen:(i:RsiIteration)=>void}) {
  const ordered=[...iterations].sort((a,b)=>a.seq-b.seq),values=ordered.map(i=>metrics?.iterations.find(m=>m.iterationId===i.id));
  return <div className="rsi-stack"><Card><CardHeader title={copy(locale,'训练集通过数','Training passes')} description={copy(locale,'浅色区间为当前父代的噪声带 δ','Shaded area is the current parent’s noise band δ')}/><CardBody><ScoreChart task={task} iterations={ordered} locale={locale} onOpen={onOpen}/><div className="rsi-sealed-markers" aria-label={copy(locale,'封存集判定','Sealed-set decisions')}>{ordered.filter(i=>i.sealedScore!==null).map(i=>{const d=metrics?.iterations.find(m=>m.iterationId===i.id)?.defenses.find(d=>d.level==='L2'),label=`#${i.seq} · ${reasonLabel(d?.state==='pass'?'accept':d?.state==='reject'?'reject':'evidence_missing',locale)}`;return <Button variant="ghost" key={i.id} className={`rsi-sealed-marker ${d?.state==='pass'?'is-success':d?.state==='reject'?'is-danger':''}`} onClick={()=>onOpen(i)} title={label} aria-label={label}>#{i.seq}</Button>;})}</div></CardBody></Card><div className="rsi-chart-grid">
    <Card><CardHeader title={copy(locale,'每轮 Token','Tokens per iteration')}/><CardBody><BarChart locale={locale} label={copy(locale,'每轮 Token 构成','Tokens by role')} stacked labels={ordered.map(i=>'#'+i.seq)} series={[{label:copy(locale,'被优化 Agent','Target Agent'),points:values.map(v=>v?.targetTokens??null)},{label:copy(locale,'优化者','Optimizer'),points:values.map(v=>v?.optimizerTokens??null)},{label:copy(locale,'审查','Review'),points:values.map(v=>v?.reviewTokens??null)}]}/></CardBody></Card>
    <Card><CardHeader title={copy(locale,'每轮执行耗时','Recorded run duration')} description={copy(locale,'各次执行时长之和；缺失记录不估算','Sum of recorded run durations; missing data is not estimated')}/><CardBody><LineChart locale={locale} label={copy(locale,'耗时趋势','Duration trend')} labels={ordered.map(i=>'#'+i.seq)} format={n=>formatDuration(n,locale)} series={[{label:copy(locale,'耗时','Duration'),points:values.map(v=>v?.durationMs??null)}]}/></CardBody></Card>
  </div></div>;
}
