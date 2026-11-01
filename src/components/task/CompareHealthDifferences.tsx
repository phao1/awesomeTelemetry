import { comparisonFindingName } from './comparison-copy.js';
import { useState } from 'react';
import type { Locale } from '../../i18n.js';
import type { HealthDifference } from '../../core/task-comparison.js';
import type { HealthReport } from '../../core/task-health/types.js';
import { healthProse } from './health/health-copy.js';
import { Card, CardBody, CardHeader, Accordion, Meter } from '../ui/Display.js';
import { Tabs } from '../ui/Tabs.js';
import { Badge } from '../ui/Badge.js';
import { Button } from '../ui/Button.js';
import { EmptyState } from '../ui/States.js';
import { IconInfo } from '../icons/index.js';
import { PageSkeleton } from '../ui/PageSkeleton.js';
import { ArchitectureReadError } from '../agent-folding/ArchitectureReadError.js';
const statuses=['new','resolved','persisting','uncertain'] as const;
export function CompareHealthDifferences({locale,differences,reports,loading,error,onGenerate,onCancel,onLocate,progress}:{locale:Locale;progress?:{done:number;total:number};differences:HealthDifference[]|null;reports:{a:HealthReport[];b:HealthReport[]}|null;loading:boolean;error:unknown;onGenerate:()=>void;onCancel:()=>void;onLocate:(task:string,event?:string,request?:string)=>void}) {
 const zh=locale==='zh',[status,setStatus]=useState<typeof statuses[number]>('new');
 const names=zh?{new:'新出现',resolved:'已消失',persisting:'仍存在',uncertain:'证据不足'}:{new:'New',resolved:'Resolved',persisting:'Persisting',uncertain:'Insufficient evidence'};
 return <Card><CardHeader title={zh?'健康差异':'Health differences'} description={zh?'同修订、范围与阈值的标准报告直接复用。':'Standard reports with matching revisions, scopes and thresholds are reused.'} actions={<Button loading={loading} onClick={onGenerate} aria-label={zh?'为两侧生成/读取标准健康报告':'Generate / read standard health reports for both sides'} title={zh?'为两侧生成/读取标准健康报告':'Generate / read standard health reports for both sides'}>{zh?'读取报告':'Read reports'}</Button>}/><CardBody>
 {loading&&<>{progress&&<><span role="status" className="num">{progress.done}/{progress.total}</span><Meter label={zh?'读取报告进度':'Report reading progress'} value={progress.done} max={progress.total}/></>}<PageSkeleton compact variant="table"/><Button onClick={onCancel}>{zh?'取消':'Cancel'}</Button></>}
 {error!=null&&<ArchitectureReadError error={error} locale={locale} retry={onGenerate}/>}
 {!reports&&!loading&&<EmptyState icon={<IconInfo/>} title={zh?'尚未读取标准报告':'Standard reports not read'} description={zh?'读取完整报告后才能判断健康变化。':'Read complete standard health reports to assess changes.'}/>}
 {reports&&<><Tabs variant="pill" activeId={status} onChange={id=>setStatus(id as typeof status)} items={statuses.map(id=>({id,label:`${names[id]} (${differences?.filter(d=>d.status===id).length??0})`}))}/>
 <div className="task-compare-table"><table className="ui-table"><thead><tr><th>{zh?'严重度 / 规则':'Severity / rule'}</th><th>A / B</th><th>{zh?'建议':'Recommendation'}</th><th>{zh?'证据':'Evidence'}</th></tr></thead><tbody>{differences?.filter(d=>d.status===status).map(d=>{const first=[...d.b,...d.a][0]!;return <tr key={d.key}><th><Badge tone={first.finding.severity==='warning'?'danger':'attention'}>{zh?{warning:'警告',notice:'注意',info:'信息'}[first.finding.severity]:first.finding.severity}</Badge> <span title={d.rule}>{comparisonFindingName(d.rule,locale)}</span></th><td className="num">{d.a.length} / {d.b.length}</td><td>{healthProse(first.finding.recommendation.action,locale)}</td><td>{[...d.a,...d.b].map(o=>o.finding.evidenceIds.map(id=>{const evidence=o.report.evidence.find(e=>e.id===id);return evidence?.recordIds.map(record=><Button key={o.report.id+id+record} size="sm" variant="ghost" onClick={()=>onLocate(o.report.taskId,record,o.report.scope.request)}>{zh?'查看证据':'View evidence'}</Button>);}))}</td></tr>;})}</tbody></table></div>
 {!differences?.some(d=>d.status===status)&&<EmptyState icon={<IconInfo/>} title={zh?'此分类没有问题':'No findings in this category'}/>}
 <Accordion title={zh?'报告口径与修订':'Report conventions and revisions'}>{[...reports.a,...reports.b].map(r=><p key={r.id}>{r.taskId} · {r.generatedAt} · {r.thresholds.profile} · calc {r.calcVersion} / rules {r.ruleVersion} · revision {r.revision} · {r.coverage.members.loaded}/{r.coverage.members.total}</p>)}</Accordion></>}
 </CardBody></Card>;
}
