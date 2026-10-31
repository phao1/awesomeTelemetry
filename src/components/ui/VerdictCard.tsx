import { Card, CardBody } from './Display.js';
import { Badge } from './Badge.js';
import { Tooltip } from './Overlay.js';
import './verdict-card.css';
export function VerdictCard({label,a,b,verdict,assessment,change,reason,aExact,bExact}:{label:string;a:string;b:string;aExact?:string;bExact?:string;verdict:'better'|'worse'|'equal'|'unavailable';assessment:string;change?:string;reason?:string}) {
 return <Card className="ui-verdict-card" data-verdict={verdict}><CardBody><div className="ui-muted">{label}</div><div className="ui-verdict-values num"><span title={aExact}>{a}</span><span className="ui-muted">→</span><span title={bExact}>{b}</span></div><Tooltip label={reason??assessment}><span className="ui-verdict-assessment" tabIndex={0}><Badge tone={verdict==='better'?'success':verdict==='worse'?'danger':'neutral'}>{change} {assessment}{reason?' ⓘ':''}</Badge></span></Tooltip></CardBody></Card>;
}
