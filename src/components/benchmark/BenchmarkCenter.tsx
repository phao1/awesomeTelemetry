import { PageHeader } from '../PageHeader.js';
import { Card, CardHeader, CardBody, MetricStrip, Meter, Callout } from '../ui/Display.js';
import { Skeleton } from '../ui/States.js';
import { Dropzone } from '../ui/Dropzone.js';
import { Table } from '../ui/Table.js';
import { BarList } from '../charts/BarList.js';
import { IconFlask } from '../icons/index.js';
import { formatTokens } from '../../core/format.js';
import { MarkupTable } from '../ui/MarkupTable.js';
import { Button } from '../ui/Button.js';
import { Disclosure } from '../ui/PageControls.js';
import { OptionSelect } from '../ui/PageControls.js';
import { FilePicker } from '../ui/PageControls.js';
import { transferArchitectureReport } from '../agent-folding/architecture-client.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Locale } from '../../i18n.js';
import { benchmarkGroups, benchmarkMetrics, diagnoseBenchmarkRun, DIAGNOSIS_COPY, METRIC_LABELS, runSuccess } from '../../core/benchmark-analysis.js';
import type { BenchmarkMetric, BenchmarkStats } from '../../core/benchmark-analysis.js';
import { BENCHMARK_TEMPLATE, demoBenchmarkReport } from '../../core/benchmark-demo.js';
import { BENCHMARK_MAX_BYTES, validateBenchmarkManifest, validateBenchmarkReport } from '../../core/benchmark-validation.js';
import type { BenchmarkReport, BenchmarkSpan } from '../../core/benchmark-types.js';
import { serializeTaskRoute } from '../../task-route.js';
import '../../styles/components/benchmark.css';
import { BenchmarkSetup } from './BenchmarkSetup.js';

function download(name: string, value: unknown): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function fmt(value: number | null): string { return value === null ? '—' : value > 0 && value < .01 ? value.toPrecision(2) : value.toLocaleString(undefined, { maximumFractionDigits: 2 }); }
function originalLink(span: BenchmarkSpan): string | null {
  return span.sessionKey ? serializeTaskRoute({ task: `collected:${span.sessionKey}`, origin: 'collected', member: 'all', mode: 'trajectory',
    event: span.eventId ? `${span.sessionKey}:event:${span.eventId}` : null }) : null;
}
export function BenchmarkCenter({ locale, onSearch, onMenu }: { locale: Locale; onSearch?:()=>void; onMenu?:()=>void }): React.JSX.Element {
  const zh = locale === 'zh', text = (cn: string, en: string) => zh ? cn : en;
  const [reports, setReports] = useState<BenchmarkReport[]>([]);
  const [report, setReport] = useState<BenchmarkReport | null>(null), [runId, setRunId] = useState('');
  const [draft, setDraft] = useState(JSON.stringify(BENCHMARK_TEMPLATE, null, 2));
  const [error, setError] = useState(''), [reading, setReading] = useState(false);
  const [stat, setStat] = useState<'mean' | 'median' | 'p95'>('mean');
  const [page, setPage] = useState(0), [selectedId, setSelectedId] = useState<string | null>(null);
  const reader = useRef<FileReader | null>(null);
  const laneRef = useRef<HTMLDivElement | null>(null);
  const reportRef = useRef<HTMLElement | null>(null);
  useEffect(() => { if (selectedId) laneRef.current?.scrollIntoView?.({ block: 'start' }); }, [selectedId]);
  useEffect(() => { if (report) reportRef.current?.scrollIntoView?.({ block: 'start' }); }, [report]);
  useEffect(() => () => { const old = reader.current; reader.current = null; old?.abort(); }, []);
  const load = (value: BenchmarkReport) => { setReports(previous => [value, ...previous.filter(item => item.createdAt !== value.createdAt || item.manifest.name !== value.manifest.name)].slice(0, 20)); setReport(value); setRunId(value.runs[0]?.id ?? ''); setSelectedId(null); setPage(0); setError(''); };
  const importReport = (file: File | undefined) => {
    if (!file) return;
    const old = reader.current; reader.current = null; old?.abort(); setReading(false); setError('');
    if (file.size > BENCHMARK_MAX_BYTES) { setError(text('文件超过 16 MiB。', 'File exceeds 16 MiB.')); return; }
    const owned = new FileReader(); reader.current = owned; setReading(true);
    const timer = setTimeout(() => { if (reader.current !== owned) return; reader.current = null; owned.abort(); setReading(false); setError(text('读取超时，请重新选择文件。', 'Read timed out. Select the file again.')); }, 5000);
    owned.onload = () => {
      if (reader.current !== owned) return;
      try { load(validateBenchmarkReport(JSON.parse(String(owned.result)))); }
      catch { setError(text('报告格式无效，请使用 version 1 评测报告，检查字段、用例数和指标范围。', 'Invalid report. Use a version 1 benchmark report with valid fields, counts and metric ranges.')); }
    };
    owned.onerror = () => { if (reader.current === owned) setError(text('文件读取失败，请重试。', 'File read failed. Retry.')); };
    owned.onloadend = () => { clearTimeout(timer); if (reader.current === owned) { reader.current = null; setReading(false); } };
    owned.readAsText(file);
  };
  const groups = useMemo(() => report ? benchmarkGroups(report) : [], [report]);
  const run = report?.runs.find(r => r.id === runId) ?? null;
  const spans = useMemo(() => run ? [...run.phases, ...run.telemetry?.spans ?? []].sort((a, b) => a.startMs - b.startMs) : [], [run]);
  const current = spans.slice(page * 200, (page + 1) * 200), selected = spans.find(s => s.id === selectedId) ?? null;
  const extent = Math.max(1, ...spans.map(s => s.startMs + (s.durationMs ?? 0)));
  const findings = report && run ? diagnoseBenchmarkRun(run, report) : [];
  const locate = (id: string) => { const index = spans.findIndex(s => s.id === id); if (index >= 0) { setPage(Math.floor(index / 200)); setSelectedId(id); } };
  const selectRun = (id: string) => { setRunId(id); setPage(0); setSelectedId(null); };
  const summary = (s: BenchmarkStats) => `${fmt(s[stat])} (n=${s.n})`;
  return <main className="benchmark-center">
    <PageHeader locale={locale} onSearch={onSearch} onMenu={onMenu} title={text('评测中心', 'Benchmark center')} description={text('固定任务与验收，比较重复实验的结果。', 'Compare repeated experiments with a fixed task and evaluator.')} actions={<>
      {report&&<FilePicker aria-label={text('导入评测报告', 'Import report')} accept=".json,application/json" onChange={e => { importReport(e.target.files?.[0]); e.target.value = ''; }} />}
      {report&&<Button variant="secondary" onClick={() => { const old = reader.current; reader.current = null; old?.abort(); setReading(false); load(demoBenchmarkReport()); }}>{text('加载示例', 'Load example')}</Button>}
      {report && <Button onClick={() => download('benchmark-report.json', report)}>{text('导出报告', 'Export report')}</Button>}
      {report && <Button onClick={() => { try { transferArchitectureReport(report); } catch { setError(text('无法保存临时报告', 'Unable to save temporary report')); } }}>{text('在任务中心对比', 'Compare in task center')}</Button>}
    </>} />
    {!report && <Dropzone label={text('导入评测报告','Import benchmark report')} description={text('拖入 report.json，查看验收结果、Token 和运行证据。','Drop report.json to inspect acceptance, tokens and run evidence.')} buttonLabel={text('选择文件','Choose file')} primary icon={<IconFlask/>} accept=".json,application/json" disabled={reading} onFile={importReport} actions={<Button variant="secondary" onClick={() => { const old = reader.current; reader.current = null; old?.abort(); setReading(false); load(demoBenchmarkReport()); }}>{text('加载示例', 'Load example')}</Button>}/>}

    {reports.length > 0 && <Card><CardHeader title={text('报告列表', 'Reports')} /><Table locale={locale} rows={reports} rowKey={row => row.createdAt + row.manifest.name} onRowClick={load} columns={[
      {key:'name',label:text('名称','Name'),render:row=><Button variant="link" onClick={()=>load(row)}>{row.manifest.name}</Button>},
      {key:'time',label:text('时间','Time'),render:row=>row.createdAt},
      {key:'samples',label:text('样本数','Samples'),align:'right',render:row=>row.runs.length},
      {key:'pass',label:text('通过率','Pass rate'),render:row=>{const known=row.runs.filter(r=>r.verdict);const passed=known.reduce((n,r)=>n+r.verdict!.passed,0),total=known.reduce((n,r)=>n+r.verdict!.total,0);return total?<div title={`${passed}/${total}`}><Meter label={text('通过率','Pass rate')} value={passed} max={total}/>{fmt(passed/total*100)}%</div>:'—';}},
      {key:'tokens',label:'Token',align:'right',render:row=>{const values=row.runs.map(r=>benchmarkMetrics(r,row.manifest.task.expectedTests).tokens);return values.every(v=>v!==null)?formatTokens(values.reduce<number>((n,v)=>n+(v??0),0)):'—';}},
    ]}/></Card>}
    {reading && <div><Skeleton variant="row" count={2} /> <Button  onClick={() => { const old = reader.current; reader.current = null; old?.abort(); setReading(false); }}>{text('取消', 'Cancel')}</Button></div>}
    {error && <Callout title={error} tone="danger"/>}
    <Disclosure title={text('新建实验', 'New experiment')}><BenchmarkSetup locale={locale} onReport={load}/></Disclosure>
    <Disclosure className="benchmark-plan" title={<>{text('配置自动化实验', 'Configure automated experiment')}</>}>
      <p>{text('设置任务仓库、起始提交、提示词、验收器、GUI 驱动及模型。默认每组 3 次；每次独立工作区，完成后运行相同验收器。驱动需负责模型选择、提交任务、等待完成并导出证据。', 'Set repository, revision, prompt, evaluator, GUI drivers and models. Default: 3 trials per variant in isolated workspaces, followed by the same evaluator. Each driver selects the model, submits the task, waits and exports evidence.')}</p>
      <textarea aria-label={text('实验配置 JSON', 'Experiment manifest JSON')} value={draft} onChange={e => setDraft(e.target.value)} spellCheck={false}/>
      <Button  onClick={() => { try { const value = validateBenchmarkManifest(JSON.parse(draft)); download('benchmark.json', value); setError(''); } catch { setError(text('配置无效：请检查字段、命令数组、重复次数和用例数。', 'Invalid manifest: check fields, command arrays, repetitions and test count.')); } }}>{text('校验并下载配置', 'Validate and download manifest')}</Button>
      <p>{text('构建项目后先检查计划，再显式执行。报告仅在本机导入查看。', 'After building, inspect the plan, then execute explicitly. Reports are imported locally.')}</p>
      <pre>npm run benchmark -- benchmark.json{'\n'}npm run benchmark -- benchmark.json --execute --output ./benchmark-results/new-experiment</pre>
    </Disclosure>
    {report && <>
      {report.synthetic && <p className="benchmark-warning" role="status">{text('合成示例：仅演示流程，不代表 Qoder 或码道的真实表现。', 'SYNTHETIC: workflow demonstration only, not actual Qoder or CodeArts performance.')}</p>}
      <section className="benchmark-context" ref={reportRef}><h2>{report.manifest.name}</h2><p>{report.manifest.task.id} · {report.runs.length}/{report.manifest.variants.length * report.manifest.repetitions} {text('次运行', 'runs')} · {report.manifest.task.expectedTests} {text('个固定验收用例', 'fixed acceptance tests')}</p>
        <Disclosure  title={<>{text('可比性与任务指纹', 'Comparability and task fingerprints')}</>}><p>Commit: <code>{report.commit}</code></p><p>Prompt SHA256: <code>{report.promptSha256}</code></p><p>{text('固定源代码、提示词和验收器；模型、工具集、参数与环境按配置展示。不同模型的结果是组合表现，不能单独归因于产品。报告声明尚未经本界面独立核验。', 'Source, prompt and evaluator are fixed by the runner; models, tools, parameters and environment are declared per variant. Different models compare configurations, not product causality. Report declarations are not independently certified by this viewer.')}</p>
          {groups.map(g => <p key={g.variant.id}>{g.variant.product}: {g.variant.model} · {g.variant.environment} · {g.variant.parameters} · {g.variant.toolSet} · {g.modelVerified ? text('实际模型匹配', 'Actual model matches') : text('实际模型未确认 / 不一致', 'Actual model unknown / mismatched')}</p>)}
        </Disclosure>
      </section>
      {report.runs.some(r => r.telemetry?.usage.cacheWriteReported === false) && <p className="benchmark-warning">{text('部分运行的工具不单独报告缓存写入；已按明确声明计为 0。', 'Some tools do not separately report cache writes; their explicit declaration counts these as zero.')}</p>}
      <div className="benchmark-scorecards">{groups.map(g => <Card key={g.variant.id}><CardHeader title={`${g.variant.product} · ${g.variant.model}`} /><CardBody><MetricStrip items={[{label:text('验收通过率','Acceptance pass rate'),value:g.metrics.passRate.mean===null?'—':`${fmt(g.metrics.passRate.mean)}%`},{label:text('中位 E2E','Median E2E'),value:`${fmt(g.metrics.e2e.median)} min`},{label:'Token',value:g.metrics.tokens.mean===null?'—':formatTokens(g.metrics.tokens.mean)}]}/><p>{g.successes}/{g.known} {text('已知验收成功','known acceptance successes')} · n={g.metrics.tokens.n} · CV {fmt(g.metrics.e2e.cv)}%</p>{g.runs.length < 3 && <Callout tone="attention" title={text('重复样本不足，暂不判断稳定性。','Too few repetitions to establish stability.')} />}</CardBody></Card>)}</div>
      <div className="f5-charts"><Card><CardHeader title={text('通过率按任务','Pass rate by task')} /><CardBody><BarList locale={locale} label={text('通过率','Pass rate')} items={groups.filter(g=>g.metrics.passRate.mean!==null).map(g=>({label:`${report.manifest.task.id} · ${g.variant.product}`,value:g.metrics.passRate.mean!}))} format={n=>`${fmt(n)}%`}/></CardBody></Card><Card><CardHeader title={text('Token 分布','Token distribution')} description={text('按运行展示；缺失值不计为零。','Per run; missing values are excluded.')} /><CardBody><BarList locale={locale} label="Token" items={report.runs.flatMap(r=>{const value=benchmarkMetrics(r,report.manifest.task.expectedTests).tokens;return value===null?[]:[{label:r.id,value}];})} format={formatTokens}/></CardBody></Card></div>
      <Disclosure className="benchmark-matrix" open title={<>{text('完整指标对照', 'Full metric comparison')}</>}>
        <label>{text('统计方式', 'Statistic')} <OptionSelect value={stat} onChange={e => setStat(e.target.value as typeof stat)}><option value="mean">{text('均值', 'Mean')}</option><option value="median">{text('中位数', 'Median')}</option><option value="p95">P95</option></OptionSelect></label>
        <p>{text('— 为未知；n 为有效样本数。成功率请读上方成功 / 已知次数。累计时长可能重叠；E2E 不包含准备和验收。TTFT / TPOT 仅使用驱动声明为实测且完整的模型调用。', '— means unknown; n is valid sample count. Read success / known trials above for success rate. Duration sums may overlap. E2E excludes setup and evaluation. TTFT / TPOT require complete, driver-declared measured calls. ')}</p>
        <div className="benchmark-table-scroll"><MarkupTable><thead><tr><th>{text('指标', 'Metric')}</th>{groups.map(g => <th key={g.variant.id}>{g.variant.product}<br/>{g.variant.model}</th>)}</tr></thead><tbody>
          {(Object.keys(METRIC_LABELS) as BenchmarkMetric[]).filter(k => k !== 'success').map(k => <tr key={k}><th>{METRIC_LABELS[k][zh ? 0 : 1]}</th>{groups.map(g => <td key={g.variant.id}>{summary(g.metrics[k])}</td>)}</tr>)}
        </tbody></MarkupTable></div>
      </Disclosure>
      <section><h2>{text('运行记录与诊断', 'Runs and diagnostics')}</h2><div className="benchmark-table-scroll"><MarkupTable><thead><tr>{['Run', text('产品 / 实际模型', 'Product / actual model'), text('执行状态', 'Execution'), text('验收', 'Acceptance'), 'E2E (min)', text('执行机', 'Host')].map(k => <th key={k}>{k}</th>)}</tr></thead><tbody>
        {report.runs.map(r => { const ok = runSuccess(r, report.manifest.task.expectedTests); return <tr key={r.id} aria-selected={runId === r.id}><td><Button  onClick={() => selectRun(r.id)}>{r.id}</Button></td><td>{report.manifest.variants.find(v => v.id === r.variantId)?.product} / {r.telemetry?.actualModel ?? '—'}</td><td>{r.status}</td><td>{ok === null ? text('未知', 'Unknown') : ok ? text('通过', 'Pass') : text('未通过', 'Fail')} · {r.verdict ? `${r.verdict.passed}/${r.verdict.total}` : '—'}</td><td>{fmt(benchmarkMetrics(r, report.manifest.task.expectedTests).e2e)}</td><td>{r.host}</td></tr>; })}
      </tbody></MarkupTable></div></section>
      {run && <section className="benchmark-investigation"><h2>{run.id} · {text('问题 → 优化建议 → 泳道证据', 'Findings → recommendations → lane evidence')}</h2>
        <Disclosure  title={<>{text('本轮完整指标', 'Metrics for this run')}</>}><div className="benchmark-table-scroll"><MarkupTable><tbody>{(Object.entries(benchmarkMetrics(run, report.manifest.task.expectedTests)) as Array<[BenchmarkMetric, number | null]>).map(([key, value]) => <tr key={key}><th>{METRIC_LABELS[key][zh ? 0 : 1]}</th><td>{fmt(value)}</td></tr>)}</tbody></MarkupTable></div></Disclosure>
        <p>{text('以下是基于明确规则的诊断线索，不是已经证明的根因。', 'These rule-based findings are investigation leads, not proven root causes.')}</p>
        {run.error && <p role="alert">{run.error}</p>}
        {findings.length === 0 && <p>{text('当前规则未发现问题，不代表任务或代码不存在其他缺陷。', 'No findings under current rules; this does not establish absence of other defects.')}</p>}
        <ul className="benchmark-findings">{findings.map(f => <li key={f.rule}><strong>{DIAGNOSIS_COPY[f.rule][zh ? 0 : 1]}</strong><p>{DIAGNOSIS_COPY[f.rule][zh ? 2 : 3]}</p>{f.spanIds.length > 0 && <Button  onClick={() => locate(f.spanIds[0]!)}>{text('定位证据', 'Locate evidence')} ({f.spanIds.length})</Button>}</li>)}</ul>
        <div className="benchmark-lane-layout" ref={laneRef}><div>
          <p>{text('共享相对时间轴（从本次准备开始）；灰色为运行器，蓝色为模型，绿色为工具；点击查看证据。', 'Shared relative clock from run preparation: runner / model / tool lanes. Select a span to inspect evidence.')} 0–{fmt(extent / 1000)}s</p>
          {(['runner', 'model', 'tool'] as const).map(kind => <div className="benchmark-lane" key={kind}><strong>{kind === 'runner' ? text('运行器', 'Runner') : kind === 'model' ? text('模型', 'Model') : text('工具', 'Tool')}</strong><div className="benchmark-track">{current.filter(s => s.kind === kind).map(s => <button key={s.id} className={`benchmark-span benchmark-${kind}`} data-error={s.status === 'error'} aria-pressed={selectedId === s.id} aria-label={`${s.name} · ${s.status} · ${fmt(s.durationMs)}ms`} title={`${s.name} · ${fmt(s.startMs)}ms · ${fmt(s.durationMs)}ms · ${s.timing}`} style={{ left: `${s.startMs / extent * 100}%`, width: `${Math.max(.4, (s.durationMs ?? 0) / extent * 100)}%` }} onClick={() => setSelectedId(s.id)}/> )}</div></div>)}
          <p>{page * 200 + (current.length ? 1 : 0)}–{page * 200 + current.length} / {spans.length} {text('条证据；缺失时长是起点标记。', 'spans; unknown durations are start markers.')}</p>
          <Button  disabled={!page} onClick={() => setPage(p => p - 1)}>{text('上一页', 'Previous')}</Button> <Button  disabled={(page + 1) * 200 >= spans.length} onClick={() => setPage(p => p + 1)}>{text('下一页', 'Next')}</Button>
          <div className="benchmark-span-list">{current.map(s => <Button key={s.id} className="benchmark-span-row" aria-pressed={selectedId === s.id} onClick={() => setSelectedId(s.id)}><span>{s.kind} · {s.name}</span><span>{fmt(s.startMs / 1000)}s · {s.status} · {fmt(s.durationMs)}ms · {s.timing}</span></Button>)}</div>
        </div><aside aria-label={text('选中证据', 'Selected evidence')}><h3>{text('证据详情', 'Evidence details')}</h3>{selected ? <><p>{selected.name}</p><dl>{Object.entries(selected).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v === null ? '—' : String(v)}</dd></div>)}</dl>{originalLink(selected) ? <a  href={originalLink(selected)!} target="_blank" rel="noreferrer">{text('打开原任务泳道', 'Open original task lane')}</a> : <p>{text('未提供原始会话定位；保留本报告证据，不推测关联。', 'No original session locator; inspect report evidence without inferred links.')}</p>}</> : <p>{text('选择泳道、记录或诊断中的证据。', 'Select a lane span, row or finding.')}</p>}</aside></div>
      </section>}
    </>}
  </main>;
}
