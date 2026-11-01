import { DataTable } from '../ui/DataTable.js';
import { Badge } from '../ui/Badge.js';
import { formatPercent } from '../../core/format.js';
import { Select } from '../ui/Select.js';
import { Input } from '../ui/Input.js';
import { RichAccordion as Accordion } from '../ui/RichAccordion.js';
import { Card } from '../ui/Display.js';
import { Button } from '../ui/Button.js';
import { ArchitectureReview } from './ArchitectureReview.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Locale } from '../../i18n.js';
import type { FoldingProject } from '../../core/agent-folding-types.js';
import { DEFAULT_FOLDING_THRESHOLDS, decideFoldingInventory } from '../../core/agent-folding-rules.js';
import { analyzeFoldingProject } from '../../core/agent-folding-analysis.js';
import { applyKitInventory, buildKitArtifacts, kitLines, parseKitInventory, parseKitPlan, parseKitResults, projectKitTraces } from '../../core/agent-folding-interchange.js';
import { kitCoverage } from '../../core/agent-folding-kit.js';
import type { FoldingKitResult } from '../../core/agent-folding-kit.js';
import { downloadArchitecture, readArchitectureFile } from './architecture-client.js';
import '../../styles/components/agent-architecture.css';
export function TaskArchitecture({ project, locale, onLocate }: { project: FoldingProject; locale: Locale; onLocate: (taskId: string, sessionKey: string | null, eventId: string | null) => void }) {
  const [edited, setEdited] = useState<FoldingProject | null>(null), p = edited ?? project;
  const [selected, setSelected] = useState<string | null>(null), [error, setError] = useState(''), [progress, setProgress] = useState<Array<{ text: string; done: boolean }>>([]);
  const [baseline, setBaseline] = useState<FoldingKitResult[] | null>(null), [evals, setEvals] = useState<Record<string, string | null>>({});
  const readVersion = useRef(0), zh = locale === 'zh';
  useEffect(() => () => { readVersion.current++; }, []);
  const [thresholds, setThresholds] = useState({ ...DEFAULT_FOLDING_THRESHOLDS });
  const decisions = useMemo(() => decideFoldingInventory(p, thresholds), [p, thresholds]), analysis = useMemo(() => analyzeFoldingProject(p), [p]);
  const coverage = useMemo(() => { if (!baseline) return null; try { return kitCoverage(projectKitTraces(p), baseline, { exclude: p.agents.filter(a => a.isMain).map(a => a.id) }); } catch { return null; } }, [p, baseline]);
  const agentName = (id: string) => { const name = p.agents.find(a => a.id === id)?.name ?? id; if (name === 'unknown') return `${zh ? '未知 Agent' : 'Unknown Agent'} #${p.agents.findIndex(a => a.id === id) + 1}`; return name.includes(' / ') && (name.includes('角色未知') || name.startsWith('未知 Agent #')) ? name.split(' / ')[zh ? 0 : 1] ?? name : name; };
  const chosen = decisions.find(d => d.agentId === selected);
  const ruleLabel = (key: string) => zh ? ({ samples: '样本数', large_input: '每次读入量', input_return_ratio: '读入与返回的比值', parallel_or_independent_verification: '并行工作或独立验证', skill_unresolvable_conflict: '技能无法解决的指令或工具冲突', direct_user_dialogue: '必须直接与用户对话', external_control: '由外部机构控制', merge_coupling: '合并候选耦合率', merge_share: '合并候选流量占比', minSamples: '最少样本', largeInputTokens: '大输入 Token', inputReturnRatio: '读入 / 返回', minCoupling: '最小耦合率', minShare: '最小流量占比' }[key] ?? key) : key;
  const actionLabel = (action: string) => ({ main: '主循环', fold: '折回', merge: '合并', as_tool: '工具调用', keep: '保留', insufficient: '证据不足' }[action] ?? action);
  const importFile = async (file: File | undefined, kind: 'inventory' | 'plan' | 'results') => {
    if (!file) return; const token = ++readVersion.current; setError('');
    try { const text = await readArchitectureFile(file); if (token !== readVersion.current) return;
      if (kind === 'inventory') { const value = applyKitInventory(p, parseKitInventory(text)); setEdited(value.project); setEvals(value.evalsByAgent); }
      if (kind === 'plan') setProgress(parseKitPlan(text));
      if (kind === 'results') { const rows = parseKitResults(kitLines(text)); if (!rows.some(r => r.by_agent)) throw new Error('Results have no by_agent'); setBaseline(rows); }
    } catch { if (token === readVersion.current) setError(zh ? '导入文件无效，请检查格式与大小后重试。' : 'Invalid import. Check the file format and size, then retry.'); }
  };
  return <Card className="architecture-panel" aria-label={zh ? 'Agent 架构审计' : 'Agent architecture audit'}>
    <header className="architecture-heading"><div><span className="task-eyebrow">AGENT ARCHITECTURE</span><h2>{zh ? '架构审计' : 'Architecture audit'}</h2><p>{zh ? '基于本地记录 · 默认折回，独立上下文需要证据' : 'Local evidence · default to folding; independent context needs evidence'}</p></div><Badge>{p.agents.length} Agents · {p.traffic.length} {zh ? '次委派' : 'delegations'}</Badge></header>
    <div className="architecture-toolbar">{(['inventory', 'plan', 'results'] as const).map(kind => <label className="ui-btn ui-btn-secondary" key={kind}>{zh ? { inventory: '导入清单', plan: '导入进度', results: '导入基线覆盖' }[kind] : `Import ${kind}`}<input type="file" hidden aria-label={`Import ${kind}`} accept={kind === 'inventory' ? '.tsv' : kind === 'plan' ? '.md' : '.jsonl'} onChange={e => { void importFile(e.target.files?.[0], kind); e.target.value = ''; }} /></label>)}
      <Accordion title={zh?'导出 kit 文件':'Export kit files'}>{buildKitArtifacts(p).map(f => <Button variant="secondary" key={f.path} onClick={() => downloadArchitecture(f.path.replaceAll('/', '-'), f.content)}>{f.path}</Button>)}</Accordion></div>
    <Accordion title={<>{zh ? '判定阈值（启发式，可调整）' : 'Heuristic thresholds'}</>}><p>{thresholds.version}</p><div className="architecture-toolbar">{(['minSamples', 'largeInputTokens', 'inputReturnRatio', 'minCoupling', 'minShare'] as const).map(key => <label key={key}>{ruleLabel(key)}<Input type="number" min={key === 'minCoupling' || key === 'minShare' ? 0 : 1} max={key === 'minCoupling' || key === 'minShare' ? 1 : 1000000} step={key === 'minCoupling' || key === 'minShare' ? .01 : 1} value={thresholds[key]} onChange={e => { const value = Number(e.target.value); if (Number.isFinite(value) && value >= (key === 'minCoupling' || key === 'minShare' ? 0 : 1) && (key !== 'minSamples' || Number.isInteger(value)) && value <= (key === 'minCoupling' || key === 'minShare' ? 1 : 1000000)) setThresholds(t => ({ ...t, [key]: value, version: 'architecture-r4-1-user' })); }} /></label>)}</div></Accordion>
    <Accordion title={<>{zh ? 'Agent 清单与负责人' : 'Agent inventory and owners'}</>}><DataTable locale={locale} rows={p.agents} rowKey={agent=>agent.id} columns={[
      {key:'name',label:'Agent',render:agent=>agentName(agent.id)},
      {key:'owner',label:zh?'负责人':'Owner',render:agent=><Input aria-label={`Owner ${agent.id}`} maxLength={200} value={agent.owner??''} onChange={e=>setEdited({...p,agents:p.agents.map(a=>a.id===agent.id?{...a,owner:e.target.value||null}:a)})}/>},
      ...(['talksToUser','externalOwner'] as const).map(field=>({key:field,label:field==='talksToUser'?(zh?'直接对话':'Direct dialogue'):(zh?'外部控制':'External control'),render:(agent:FoldingProject['agents'][number])=><Select aria-label={`${field} ${agent.id}`} value={agent[field]===null?'unknown':String(agent[field])} onChange={e=>setEdited({...p,agents:p.agents.map(a=>a.id===agent.id?{...a,[field]:e.target.value==='unknown'?null:e.target.value==='true'}:a)})} options={[{value:'unknown',label:zh?'未知':'Unknown'},{value:'true',label:zh?'是':'Yes'},{value:'false',label:zh?'否':'No'}]}/>})),
      {key:'proposed',label:zh?'声明的方案':'Declared action',render:agent=>agent.proposed}
    ]}/><p>{zh ? '负责人和独立上下文理由分开记录；声明不是经验证的收益。' : 'Ownership and independent context reasons are separate; declarations are not verified benefits.'}</p></Accordion>
    {error && <p role="alert">{error}</p>}
    <div className="architecture-cards">{p.agents.slice(0, 20).map(agent => { const d = decisions.find(x => x.agentId === agent.id)!; return <Button className={`architecture-card ${selected === agent.id ? 'is-selected' : ''}`} key={agent.id} onClick={() => setSelected(selected === agent.id ? null : agent.id)} aria-expanded={selected === agent.id}><strong>{agentName(agent.id)}</strong><Badge>{zh ? actionLabel(d.action) : d.action}{d.mergeWith ? ` → ${agentName(d.mergeWith)}` : ''}</Badge><small>{zh ? '样本' : 'Samples'} {d.sampleCount} · {d.confidence}</small></Button>; })}</div>
    {p.agents.length > 20 && <p>{zh ? '仅展示前 20 项，请缩小审计范围。完整清单可导出。' : 'Showing first 20; narrow scope or export the full inventory.'}</p>}
    {chosen && <section className="architecture-decision" aria-label={zh ? '判定卡' : 'Decision card'}><h3>{agentName(chosen.agentId)} · {zh ? actionLabel(chosen.action) : chosen.action}</h3><p>{chosen.thresholds.version} · {zh ? '启发式阈值，不是已证明的收益' : 'Heuristic thresholds, not proven benefits'}</p>
      <DataTable locale={locale} rows={chosen.reasons} rowKey={r=>r.rule} columns={[
       {key:'rule',label:zh?'理由':'Rule',render:r=>ruleLabel(r.rule)},
       {key:'met',label:zh?'满足':'Met',render:r=>r.met===null?'—':r.met?'✓':'—'},
       {key:'value',label:zh?'数值 / 阈值':'Value / threshold',render:r=>`${r.value??'—'} / ${r.threshold??'—'}`}
      ]}/>
      <p>{zh ? '反证' : 'Counter-evidence'}：{chosen.counterEvidence.join('；') || (zh ? '尚未提供' : 'Not supplied')}</p><p>{chosen.ownerQuestions.join('；')}</p><p>{evals[chosen.agentId] ?? ''}</p>
      <div className="architecture-toolbar">{chosen.evidenceIds.slice(0, 20).map(id => { const e = p.evidence.find(e => e.id === id); return e?.native ? <Button variant="secondary" key={id} onClick={() => onLocate(e.native!.taskId, e.native!.sessionKey, e.native!.eventId)}>{zh ? '原始事件' : 'Source event'} · {e.native.eventId?.slice(0, 16)}</Button> : <code key={id}>{id}</code>; })}</div>
      <ArchitectureReview key={chosen.agentId + JSON.stringify(chosen)} project={p} decision={chosen} />
    </section>}
    <Accordion defaultOpen title={<>{zh ? '耦合与合并候选' : 'Coupling and merge candidates'}</>}><DataTable locale={locale} rows={analysis.coupling.slice(0,20)} rowKey={c=>c.left+':'+c.right} columns={[
       {key:'agents',label:'Agent → Agent',render:c=>`${agentName(c.left)} → ${agentName(c.right)}`},
       {key:'traces',label:zh?'任务数':'Traces',align:'right',render:c=>c.traces},
       {key:'coupling',label:zh?'耦合率':'Coupling',align:'right',render:c=><Button variant="link" onClick={()=>setSelected(c.left)}>{formatPercent(c.coupling)}</Button>},
       {key:'share',label:zh?'流量占比':'Share',align:'right',render:c=>formatPercent(c.share)}
      ]}/></Accordion>
    <Accordion defaultOpen title={<>{zh ? '生产调用链覆盖' : 'Production chain coverage'}</>}>{coverage ? <><p>{coverage.status} · {coverage.traces} traces / {coverage.tasks} eval tasks</p>{coverage.chains.slice(0, 20).map(c => <p key={c.chain.join(',')}>{c.chain.map(id => agentName(id)).join(' → ')} · {c.traces} · {c.covering.length ? c.covering.map(t => `${t.caseId} ${t.passes}/${t.reps}`).join(', ') : (zh ? '缺少覆盖题目' : 'Missing coverage cases')}</p>)}</> : <p>{zh ? '未知：导入带 by_agent 的基线 results.jsonl。集合覆盖与顺序/逐次诊断独立。' : 'Unknown: import baseline results.jsonl with by_agent. Set coverage is distinct from ordered per-run diagnostics.'}</p>}</Accordion>
    {progress.length > 0 && <Accordion defaultOpen title={<>PLAN.md</>}>{progress.map((r, i) => <p key={i}>{r.done ? '☑' : '☐'} {r.text}</p>)}</Accordion>}
    <Accordion title={<>{zh ? '来源与限制' : 'Sources and limitations'}</>}>{p.limitations.map((s, i) => <p key={i}>{s}</p>)}</Accordion>
  </Card>;
}
