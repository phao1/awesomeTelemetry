import './stacked-meter.css';
/** Compact part-to-whole display; values and accessible labels are caller-owned. */
export function StackedMeter({parts,label,className='',segmentClassName=''}:{parts:Array<{label:string;value:number;color:string}>;label:string;className?:string;segmentClassName?:string}) {
 const valid=parts.filter(p=>Number.isFinite(p.value)&&p.value>0),total=valid.reduce((n,p)=>n+p.value,0);
 return <div className={`ui-stacked-meter ${className}`} role="img" aria-label={label}>{valid.map(p=><span key={p.label} tabIndex={0} className={segmentClassName} title={p.label} style={{width:`${p.value/total*100}%`,background:p.color}}/>)}</div>;
}
