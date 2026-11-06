import { formatCount, formatPercent } from '../../core/format.js';
import type { Locale } from '../../i18n.js';
import type { RsiMonitorCalibration } from '../../core/rsi-types.js';
import type { RsiSummary } from '../../core/rsi-api-client.js';
import { rsiApi } from '../../core/rsi-api-client.js';
import { Card, CardHeader, CardBody, StatCard, Callout, CopyField } from '../ui/Display.js';
import { Table } from '../ui/Table.js';
import { Select } from '../ui/Select.js';
import { Badge } from '../ui/Badge.js';
import { Tooltip } from '../ui/Overlay.js';
import { PageSkeleton } from '../ui/PageSkeleton.js';
import { EmptyState } from '../ui/States.js';
import { IconFlask } from '../icons/index.js';
import { useRsiRead } from './data.js';
import { Numeric, Reason, ReadError } from './Shared.js';
import { copy } from './copy.js';
const categories=['task_specific','hardcoded_answer','test_tampering','marker_deletion','rationalized_special_case','statement_keyed_heuristic','benign'];
export function calibrationSufficient(report:RsiMonitorCalibration):boolean {return report.status!=='insufficient'&&categories.every(c=>report.categories.some(m=>m.category===c&&m.valid>=Math.max(30,report.minimumSamples)));}
export function CalibrationReport({report,locale}:{report:RsiMonitorCalibration;locale:Locale}) {
  const sufficient=calibrationSufficient(report),cheating=report.categories.filter(c=>c.category!=='benign'),valid=cheating.reduce((n,c)=>n+c.valid,0),detected=cheating.reduce((n,c)=>n+c.detected,0),benign=report.categories.find(c=>c.category==='benign');
  return <div className="rsi-stack">{!sufficient&&<Callout tone="attention" title={copy(locale,'样本不足，不能说明监控达标','Insufficient samples; monitor quality is unproven')}/>}
    <div className="rsi-stat-grid"><StatCard label={copy(locale,'监控模式','Monitor mode')} value={copy(locale,sufficient?(report.status==='failed'?'只告警':'挂起'):'未校准',sufficient?(report.status==='failed'?'Alerts only':'Suspension'):'Not calibrated')}/><StatCard label={copy(locale,'有效样本数','Valid samples')} value={formatCount(report.categories.reduce((n,c)=>n+c.valid,0),locale)}/><StatCard label={copy(locale,sufficient?'检出率':'检出率（参考）',sufficient?'Detection rate':'Detection rate (reference)')} value={formatPercent(valid?detected/valid:null)} unknownReason={valid?`${detected}/${valid} · ${detected/valid*100}%`:copy(locale,'没有有效样本','No valid samples')}/><StatCard label={copy(locale,sufficient?'误报率':'误报率（参考）',sufficient?'False positives':'False positives (reference)')} value={formatPercent(benign?.rate)} unknownReason={benign&&benign.rate!==null?`${benign.detected}/${benign.valid} · ${benign.rate*100}%`:copy(locale,'没有有效样本','No valid samples')}/></div>
    <div className="rsi-inline"><Badge>{report.model}</Badge><Badge>{report.promptVersion}</Badge></div>
    <Card><CardHeader title={copy(locale,'分层校准','Calibration by category')} description={copy(locale,'区间为 95% Wilson 区间；达标由点估计判断','95% Wilson intervals; thresholds use point estimates')}/><Table locale={locale} rows={report.categories} rowKey={m=>m.category} stickyFirst columns={[
      {key:'category',label:copy(locale,'类别','Category'),render:m=><Reason code={m.category} locale={locale}/>},
      {key:'samples',label:copy(locale,'样本','Samples'),align:'right',render:m=><span><Numeric value={m.valid} locale={locale}/> / <Numeric value={m.samples} locale={locale}/></span>},
      {key:'rate',label:copy(locale,'检出率／误报率','Detection / false positives'),render:m=><div className="rsi-calibration-rate"><Numeric value={m.rate} kind="percent"/>{m.interval&&<Tooltip label={`${(m.interval.lower*100).toFixed(1)}%–${(m.interval.upper*100).toFixed(1)}%`}><div className="rsi-interval" tabIndex={0}><span style={{left:`${m.interval.lower*100}%`,width:`${(m.interval.upper-m.interval.lower)*100}%`}}/><i style={{left:`${(m.category==='benign'?report.falsePositiveMax:report.detectionMin)*100}%`}}/></div></Tooltip>}</div>},
      {key:'deterministic',label:copy(locale,'确定性规则结果','Deterministic rules'),render:m=><span><Numeric value={report.deterministic.find(d=>d.category===m.category)?.rate} kind="percent"/>{report.deterministic.some(d=>d.category===m.category)&&<Tooltip label={copy(locale,'规则本来就查这些指纹，这个 100% 不代表能抓住现实中的作弊','These rules check these fingerprints by design; 100% does not demonstrate detection of real-world cheating')}><span tabIndex={0}> ⓘ</span></Tooltip>}</span>},
      {key:'explanation',label:copy(locale,'说明','Notes'),render:m=><Badge tone={!sufficient?'attention':m.rate===null?'neutral':(m.category==='benign'?m.rate<=report.falsePositiveMax:m.rate>=report.detectionMin)?'success':'danger'}>{copy(locale,!sufficient?'仅供参考':m.rate===null?'缺少结果':(m.category==='benign'?m.rate<=report.falsePositiveMax:m.rate>=report.detectionMin)?'达标':'未达标',!sufficient?'Reference only':m.rate===null?'Missing result':(m.category==='benign'?m.rate<=report.falsePositiveMax:m.rate>=report.detectionMin)?'Meets threshold':'Below threshold')}</Badge>},
    ]}/></Card>
  </div>;
}
export function Calibration({tasks,taskId,locale,onTask,revision}:{tasks:RsiSummary[];taskId:string|null;locale:Locale;onTask:(id:string)=>void;revision:number}) {
  const active=taskId??tasks[0]?.task.id??null,read=useRsiRead(active?active+':calibration':null,signal=>rsiApi.calibration(active!,signal),revision);
  return <div className="rsi-stack"><div className="rsi-toolbar"><Select locale={locale} aria-label={copy(locale,'调优任务','Tuning task')} value={active??''} options={tasks.map(s=>({value:s.task.id,label:`${s.agentName??'—'} · ${s.repositoryName}`}))} onChange={e=>onTask(e.target.value)}/></div>
    {read.loading&&!read.value&&<PageSkeleton/>}{Boolean(read.error)&&<ReadError error={read.error} locale={locale} retry={read.retry}/>}
    {read.value?.latestReport?<CalibrationReport report={read.value.latestReport} locale={locale}/>:!read.loading&&!read.error&&<Card><CardBody><EmptyState icon={<IconFlask/>} title={copy(locale,'没有校准记录','No calibration report')} description={copy(locale,'校准只能通过命令行启动','Calibration starts only from the command line')}/><CopyField locale={locale} label={copy(locale,'启动校准','Start calibration')} value={`node bin/rsi.js calibrate --task ${active??'<id>'} --sample all`}/></CardBody></Card>}
  </div>;
}
