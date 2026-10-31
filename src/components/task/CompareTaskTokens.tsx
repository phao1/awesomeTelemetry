import type {TaskComparisonSnapshot} from '../../core/task-types.js';
import type {Locale} from '../../i18n.js';
import type {FoldingMetricRun} from '../../core/agent-folding-metrics.js';
import {foldingSummary} from '../../core/agent-folding-metrics.js';
import {formatCount,formatPercent,formatTokens} from '../../core/format.js';
import {formatComparisonRatio} from '../../core/task-comparison.js';
import {Card,CardBody,CardHeader,Meter} from '../ui/Display.js';
import {StackedMeter} from '../ui/StackedMeter.js';
import {Tooltip} from '../ui/Overlay.js';
import {compareTokenRows} from './compare-token-model.js';
export function CompareTaskTokens({snapshot,locale,runs}:{snapshot:TaskComparisonSnapshot;locale:Locale;runs?:{a:FoldingMetricRun[];b:FoldingMetricRun[]}|null}){
 const zh=locale==='zh',rows=compareTokenRows(snapshot,runs,locale);
 const cell=(value:number|null,signed=false)=><Tooltip label={formatCount(value,locale)}><span tabIndex={0}>{value===null?'—':(signed&&value>0?'+':'')+formatTokens(value)}</span></Tooltip>;
 return <Card><CardHeader title={zh?'Token 构成':'Token composition'} description={zh?'每侧按已知分量归一化至 100%；表格保留缺失分量与可比性限制。':'Each side normalizes known components to 100%; missing counters and comparability limits remain in the table.'}/><CardBody>
 <div className="compare-token-stacks">{(['a','b'] as const).map(side=>{const total=rows.reduce((n,r)=>n+(r[side]??0),0);return <div key={side}><strong>{side.toUpperCase()}</strong><StackedMeter className="compare-token-stack" label={`${side.toUpperCase()} · ${zh?'已知 Token 构成':'Known token composition'}`} parts={rows.map(r=>({value:r[side]??0,color:r.color,label:`${r.label}: ${formatCount(r[side],locale)} · ${formatPercent(total&&r[side]!=null?r[side]/total:null)}`}))}/>{!total&&<span className="ui-muted">—</span>}</div>;})}</div>
 <div className="task-compare-table compare-token-table"><table className="ui-table"><thead><tr><th>{zh?'分量':'Component'}</th><th>A</th><th>B</th><th>{zh?'差值':'Difference'}</th><th>B/A</th></tr></thead><tbody>{rows.map(r=><tr key={r.key}><th><span className="compare-token-dot" style={{background:r.color}}/>{r.label}</th><td>{cell(r.a)}</td><td>{cell(r.b)}</td><td>{cell(r.delta,true)}</td><td>{formatComparisonRatio(r.ratio)}</td></tr>)}</tbody></table></div>
 <div className="task-compare-selectors">{(['a','b'] as const).map(side=>{const rate=foldingSummary(snapshot[side].map(t=>t.metrics?.cacheHitRate??null)),complete=rate.n===snapshot[side].length&&snapshot[side].every(t=>{const c=t.metrics?.coverage?.cacheHitRate;return c&&c.known===c.total&&c.total>0;});return <div key={side}><span className="num">{side.toUpperCase()} · {zh?'缓存命中率':'Cache hit rate'} {formatPercent(complete?rate.median:null)}</span>{complete&&rate.median!==null&&<Meter value={rate.median*100} label={side.toUpperCase()+' '+(zh?'缓存命中率':'Cache hit rate')}/>}</div>;})}</div>
 </CardBody></Card>;
}
