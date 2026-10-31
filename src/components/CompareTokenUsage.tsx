import type {TokenUsage} from '../core/trace-types.js';
import {t,type I18nKey,type Locale} from '../i18n.js';
import type {TokenClass} from './TokenTextModal.js';
import {DonutRing} from './charts/DonutChart.js';
import type {ChartTone} from './charts/types.js';

const PARTS=['input','reasoning','output','cacheRead','cacheWrite'] as const;
type Part=typeof PARTS[number];
type Side='left'|'right';
const TONES:Record<Part,ChartTone>={input:'accent',reasoning:'done',output:'success',cacheRead:'attention',cacheWrite:'neutral'};
const TEXT_PARTS:readonly string[]=['input','reasoning','output'];
const finite=(value:unknown):number|null=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;

/** Snapshot-only display: no aggregation across sessions, guessed accounting or IO. */
export function CompareTokenUsage({usage,estimates,locale,visual='rings',pending,onInspectText}: {
  usage:Record<Side,TokenUsage>;
  estimates:Record<Side,number|null>;
  locale:Locale;
  visual?:'rings'|'bars';
  pending?:Partial<Record<Side,boolean>>;
  onInspectText?:(side:Side,tokenClass:TokenClass)=>void;
}):React.JSX.Element {
  const view=(side:Side)=>{
    const values=Object.fromEntries(PARTS.map(part=>[part,finite(usage[side][part])])) as Record<Part,number|null>;
    const total=finite(usage[side].total);
    const sum=PARTS.reduce((count,part)=>count+(values[part]??0),0);
    const reconciled=total!==null&&Number.isFinite(sum)&&PARTS.every(part=>values[part]!==null)&&sum===total;
    const reason:I18nKey|null=pending?.[side]===true?'compare.evidence.partial':!reconciled?'compare.token.notAdditive':total===0?'compare.token.noRecorded':null;
    return {values,total,drawable:pending?.[side]!==true&&reconciled&&total!>0,reason};
  };
  const sides={left:view('left'),right:view('right')};
  const fmt=(value:number|null):string=>value===null?'—':value.toLocaleString(locale);
  const mark=(side:Side):'L'|'R'=>side==='left'?'L':'R';
  const ring=(side:Side,radius:number):React.JSX.Element|null=>sides[side].drawable?<DonutRing
    slices={PARTS.map(part=>({label:part,value:sides[side].values[part]!,tone:TONES[part]}))}
    cx={120} cy={110} r={radius} thickness={12} total={sides[side].total!}
    ariaLabelPrefix={mark(side)} segmentClassName="compare-chart-donut-seg"
    interactiveLabels={TEXT_PARTS}
    onSliceClick={onInspectText===undefined?undefined:label=>onInspectText(side,label as TokenClass)}/>:null;
  const amount=(side:Side,part:Part):React.JSX.Element=>{
    const value=sides[side].values[part];
    return onInspectText&&value!==null&&value>0&&TEXT_PARTS.includes(part)?<button type="button" className="cmp-token-text"
      aria-label={`${mark(side)} ${part} · ${t('token.modal.title',locale)}`} onClick={()=>onInspectText(side,part as TokenClass)}>{fmt(value)}</button>:<>{fmt(value)}</>;
  };
  return <div className={`compare-token-usage ${visual==='rings'?'compare-chart-donut':''}`}>
    <p className="hint">{t('compare.token.scope',locale)}</p>
    {visual==='rings'&&<p className="hint">{t('compare.token.rings',locale)}</p>}
    {visual==='rings'?<svg viewBox="0 0 240 220" width="100%" height={220} role={onInspectText?'group':'img'} aria-label={t('compare.charts.tokenDonut',locale)}>
      <circle cx={120} cy={110} r={50} fill="none" stroke="var(--canvas-subtle)" strokeWidth={12}/>{ring('left',50)}
      <circle cx={120} cy={110} r={68} fill="none" stroke="var(--canvas-subtle)" strokeWidth={12}/>{ring('right',68)}
      <text x={120} y={88} textAnchor="middle" fill="var(--fg-muted)" fontSize={9}>L</text>
      <text x={120} y={104} textAnchor="middle" fill="var(--fg-default)" fontSize={11}>{fmt(sides.left.total)}</text>
      <text x={120} y={121} textAnchor="middle" fill="var(--fg-muted)" fontSize={9}>R</text>
      <text x={120} y={137} textAnchor="middle" fill="var(--fg-default)" fontSize={11}>{fmt(sides.right.total)}</text>
    </svg>:<div>{(['left','right'] as const).map(side=><div key={side} className="token-stack" role="group" aria-label={`${mark(side)} ${t('compare.charts.tokenDonut',locale)}`}>
      <span className="compare-side-mark">{mark(side)}</span>
      {sides[side].drawable&&<div className="token-stack-bar">{PARTS.map(part=>{
        const value=sides[side].values[part]!;
        if(value===0)return null;
        const style={width:`${value/sides[side].total!*100}%`,background:`var(--${TONES[part]}-emphasis)`};
        const content=<><span className="token-stack-seg-label">{t(`compare.charts.tokenClass.${part}`,locale)}</span><span className="mono token-stack-seg-count">{fmt(value)}</span></>;
        const title=`${mark(side)} ${t(`compare.charts.tokenClass.${part}`,locale)} · ${fmt(value)}`;
        return onInspectText&&TEXT_PARTS.includes(part)?<button type="button" key={part} className="token-stack-seg" style={style} title={title} aria-label={`${mark(side)} ${part}`} onClick={()=>onInspectText(side,part as TokenClass)}>{content}</button>:<span key={part} className="token-stack-seg" style={style} title={title}>{content}</span>;
      })}</div>}
      <span className="mono">{fmt(sides[side].total)}</span>
    </div>)}</div>}
    {(['left','right'] as const).map(side=>sides[side].reason===null?null:<p role="status" key={side}>{mark(side)} · {t(sides[side].reason!,locale)}</p>)}
    <table className="ui-table ui-table-compact compare-token-values"><thead><tr><th scope="col">{t('compare.charts.tokenDonut',locale)}</th><th scope="col">L</th><th scope="col">R</th></tr></thead>
      <tbody>{PARTS.map(part=><tr key={part} data-token-part={part}><th scope="row"><span className="compare-chart-swatch" style={{background:`var(--${TONES[part]}-emphasis)`}}/>{t(`compare.charts.tokenClass.${part}`,locale)}</th><td className="mono">{amount('left',part)}</td><td className="mono">{amount('right',part)}</td></tr>)}</tbody>
      <tfoot><tr><th scope="row">{t('compare.token.total',locale)}</th><td className="mono">{fmt(sides.left.total)}</td><td className="mono">{fmt(sides.right.total)}</td></tr></tfoot>
    </table>
    <div className="compare-token-estimate"><p>{t('compare.token.estimate',locale)}</p>{(['left','right'] as const).map(side=>{
      const value=finite(estimates[side]);
      return <span key={side}>{mark(side)} · {onInspectText&&value!==null&&value>0?<button type="button" className="cmp-token-text" aria-label={`${mark(side)} system estimate`} onClick={()=>onInspectText(side,'system')}>{fmt(value)}</button>:fmt(value)}</span>;
    })}</div>
  </div>;
}
