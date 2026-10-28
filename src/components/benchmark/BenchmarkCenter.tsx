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
export function BenchmarkCenter({ locale }: { locale: Locale }): React.JSX.Element {
  const zh = locale === 'zh', text = (cn: string, en: string) => zh ? cn : en;
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
  const load = (value: BenchmarkReport) => { setReport(value); setRunId(value.runs[0]?.id ?? ''); setSelectedId(null); setPage(0); setError(''); };
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
    <header className="benchmark-heading"><div><h1>{text('评测中心', 'Benchmark center')}</h1><p>{text('同一任务 · 多工具 / 模型 · 重复验收 · 从问题定位到泳道', 'One task · tools / models · repeated acceptance · evidence-linked lanes')}</p></div>
      <label className="btn">{text('导入评测报告', 'Import report')}<input aria-label={text('导入评测报告', 'Import report')} type="file" accept=".json,application/json" onChange={e => { importReport(e.target.files?.[0]); e.target.value = ''; }} /></label>
      <button className="btn" onClick={() => { const old = reader.current; reader.current = null; old?.abort(); setReading(false); load(demoBenchmarkReport()); }}>{text('查看合成示例', 'View synthetic example')}</button>
      {report && <button className="btn" onClick={() => download('benchmark-report.json', report)}>{text('导出报告', 'Export report')}</button>}
    </header>
    {reading && <p role="status">{text('正在读取本地报告…', 'Reading local report…')} <button className="btn" onClick={() => { const old = reader.current; reader.current = null; old?.abort(); setReading(false); }}>{text('取消', 'Cancel')}</button></p>}
    {error && <p role="alert">{error}</p>}
    <BenchmarkSetup locale={locale} onReport={load}/>
    <details className="benchmark-plan"><summary>{text('配置自动化实验', 'Configure automated experiment')}</summary>
      <p>{text('设置任务仓库、起始提交、提示词、验收器、GUI 驱动及模型。默认每组 3 次；每次独立工作区，完成后运行相同验收器。驱动需负责模型选择、提交任务、等待完成并导出证据。', 'Set repository, revision, prompt, evaluator, GUI drivers and models. Default: 3 trials per variant in isolated workspaces, followed by the same evaluator. Each driver selects the model, submits the task, waits and exports evidence.')}</p>
      <textarea aria-label={text('实验配置 JSON', 'Experiment manifest JSON')} value={draft} onChange={e => setDraft(e.target.value)} spellCheck={false}/>
      <button className="btn" onClick={() => { try { const value = validateBenchmarkManifest(JSON.parse(draft)); download('benchmark.json', value); setError(''); } catch { setError(text('配置无效：请检查字段、命令数组、重复次数和用例数。', 'Invalid manifest: check fields, command arrays, repetitions and test count.')); } }}>{text('校验并下载配置', 'Validate and download manifest')}</button>
      <p>{text('构建项目后先检查计划，再显式执行。运行模型可能产生费用。报告仅在本机导入查看。', 'After building, inspect the plan, then execute explicitly. Model runs may incur charges. Reports are imported locally.')}</p>
      <pre>npm run benchmark -- benchmark.json{'\n'}npm run benchmark -- benchmark.json --execute --output ./benchmark-results/new-experiment</pre>
    </details>
    {!report && <section className="benchmark-empty"><h2>{text('从一份可重复实验开始', 'Start with a reproducible experiment')}</h2><p>{text('1. 配置同一任务与验收标准　2. 执行工具 × 模型 × 重复次数　3. 导入 report.json，比较指标并定位问题。', '1. Fix the task and evaluator. 2. Run tools × models × repetitions. 3. Import report.json to compare metrics and inspect findings.')}</p><p>{text('还没有真实驱动或任务？先查看合成示例了解结果结构。', 'No real driver or task yet? Explore the synthetic example.')}</p></section>}
    {report && <>
      {report.synthetic && <p className="benchmark-warning" role="status">{text('合成示例：仅演示流程，不代表 Qoder 或码道的真实表现。', 'SYNTHETIC: workflow demonstration only, not actual Qoder or CodeArts performance.')}</p>}
      <section className="benchmark-context" ref={reportRef}><h2>{report.manifest.name}</h2><p>{report.manifest.task.id} · {report.runs.length}/{report.manifest.variants.length * report.manifest.repetitions} {text('次运行', 'runs')} · {report.manifest.task.expectedTests} {text('个固定验收用例', 'fixed acceptance tests')}</p>
        <details><summary>{text('可比性与任务指纹', 'Comparability and task fingerprints')}</summary><p>Commit: <code>{report.commit}</code></p><p>Prompt SHA256: <code>{report.promptSha256}</code></p><p>{text('固定源代码、提示词和验收器；模型、工具集、参数与环境按配置展示。不同模型的结果是组合表现，不能单独归因于产品。报告声明尚未经本界面独立核验。', 'Source, prompt and evaluator are fixed by the runner; models, tools, parameters and environment are declared per variant. Different models compare configurations, not product causality. Report declarations are not independently certified by this viewer.')}</p>
          {groups.map(g => <p key={g.variant.id}>{g.variant.product}: {g.variant.model} · {g.variant.environment} · {g.variant.parameters} · {g.variant.toolSet} · {g.modelVerified ? text('实际模型匹配', 'Actual model matches') : text('实际模型未确认 / 不一致', 'Actual model unknown / mismatched')}</p>)}
        </details>
      </section>
      <div className="benchmark-scorecards">{groups.map(g => <section key={g.variant.id}><h3>{g.variant.product} · {g.variant.model}</h3>
        <p><strong>{text('稳', 'Stability')}</strong> {g.successes}/{g.known} {text('已知验收成功', 'known acceptance successes')} · {text('未知', 'unknown')} {g.runs.length - g.known} · CV {fmt(g.metrics.e2e.cv)}%</p>
        <p><strong>{text('准', 'Accuracy')}</strong> {fmt(g.metrics.passRate.mean)}% {text('平均用例通过率', 'mean test pass rate')}</p>
        <p><strong>{text('快', 'Speed')}</strong> {fmt(g.metrics.e2e.median)} min {text('中位数', 'median')} · P95 {fmt(g.metrics.e2e.p95)}</p>
        <p><strong>{text('省', 'Efficiency')}</strong> {fmt(g.metrics.tokens.mean)} Token · n={g.metrics.tokens.n}</p>
        {(g.runs.length < 3 || g.runs.length < report.manifest.repetitions) && <p className="benchmark-warning">{text('重复样本不足或实验未完成，暂不判断稳定性。', 'Too few repetitions or incomplete experiment; stability is not established.')}</p>}
      </section>)}</div>
      <details className="benchmark-matrix" open><summary>{text('完整指标对照', 'Full metric comparison')}</summary>
        <label>{text('统计方式', 'Statistic')} <select value={stat} onChange={e => setStat(e.target.value as typeof stat)}><option value="mean">{text('均值', 'Mean')}</option><option value="median">{text('中位数', 'Median')}</option><option value="p95">P95</option></select></label>
        <p>{text('— 为未知；n 为有效样本数。成功率请读上方成功 / 已知次数。累计时长可能重叠；E2E 不包含准备和验收。TTFT / TPOT 仅使用驱动声明为实测且完整的模型调用。Token 不等于费用。', '— means unknown; n is valid sample count. Read success / known trials above for success rate. Duration sums may overlap. E2E excludes setup and evaluation. TTFT / TPOT require complete, driver-declared measured calls. Tokens are not money.')}</p>
        <div className="benchmark-table-scroll"><table><thead><tr><th>{text('指标', 'Metric')}</th>{groups.map(g => <th key={g.variant.id}>{g.variant.product}<br/>{g.variant.model}</th>)}</tr></thead><tbody>
          {(Object.keys(METRIC_LABELS) as BenchmarkMetric[]).filter(k => k !== 'success').map(k => <tr key={k}><th>{METRIC_LABELS[k][zh ? 0 : 1]}</th>{groups.map(g => <td key={g.variant.id}>{summary(g.metrics[k])}</td>)}</tr>)}
        </tbody></table></div>
      </details>
      <section><h2>{text('运行记录与诊断', 'Runs and diagnostics')}</h2><div className="benchmark-table-scroll"><table><thead><tr>{['Run', text('产品 / 实际模型', 'Product / actual model'), text('执行状态', 'Execution'), text('验收', 'Acceptance'), 'E2E (min)', text('执行机', 'Host')].map(k => <th key={k}>{k}</th>)}</tr></thead><tbody>
        {report.runs.map(r => { const ok = runSuccess(r, report.manifest.task.expectedTests); return <tr key={r.id} aria-selected={runId === r.id}><td><button className="btn" onClick={() => selectRun(r.id)}>{r.id}</button></td><td>{report.manifest.variants.find(v => v.id === r.variantId)?.product} / {r.telemetry?.actualModel ?? '—'}</td><td>{r.status}</td><td>{ok === null ? text('未知', 'Unknown') : ok ? text('通过', 'Pass') : text('未通过', 'Fail')} · {r.verdict ? `${r.verdict.passed}/${r.verdict.total}` : '—'}</td><td>{fmt(benchmarkMetrics(r, report.manifest.task.expectedTests).e2e)}</td><td>{r.host}</td></tr>; })}
      </tbody></table></div></section>
      {run && <section className="benchmark-investigation"><h2>{run.id} · {text('问题 → 优化建议 → 泳道证据', 'Findings → recommendations → lane evidence')}</h2>
        <details><summary>{text('本轮完整指标', 'Metrics for this run')}</summary><div className="benchmark-table-scroll"><table><tbody>{(Object.entries(benchmarkMetrics(run, report.manifest.task.expectedTests)) as Array<[BenchmarkMetric, number | null]>).map(([key, value]) => <tr key={key}><th>{METRIC_LABELS[key][zh ? 0 : 1]}</th><td>{fmt(value)}</td></tr>)}</tbody></table></div></details>
        <p>{text('以下是基于明确规则的诊断线索，不是已经证明的根因。', 'These rule-based findings are investigation leads, not proven root causes.')}</p>
        {run.error && <p role="alert">{run.error}</p>}
        {findings.length === 0 && <p>{text('当前规则未发现问题，不代表任务或代码不存在其他缺陷。', 'No findings under current rules; this does not establish absence of other defects.')}</p>}
        <ul className="benchmark-findings">{findings.map(f => <li key={f.rule}><strong>{DIAGNOSIS_COPY[f.rule][zh ? 0 : 1]}</strong><p>{DIAGNOSIS_COPY[f.rule][zh ? 2 : 3]}</p>{f.spanIds.length > 0 && <button className="btn" onClick={() => locate(f.spanIds[0]!)}>{text('定位证据', 'Locate evidence')} ({f.spanIds.length})</button>}</li>)}</ul>
        <div className="benchmark-lane-layout" ref={laneRef}><div>
          <p>{text('共享相对时间轴（从本次准备开始）；灰色为运行器，蓝色为模型，绿色为工具；点击查看证据。', 'Shared relative clock from run preparation: runner / model / tool lanes. Select a span to inspect evidence.')} 0–{fmt(extent / 1000)}s</p>
          {(['runner', 'model', 'tool'] as const).map(kind => <div className="benchmark-lane" key={kind}><strong>{kind === 'runner' ? text('运行器', 'Runner') : kind === 'model' ? text('模型', 'Model') : text('工具', 'Tool')}</strong><div className="benchmark-track">{current.filter(s => s.kind === kind).map(s => <button key={s.id} className={`benchmark-span benchmark-${kind}`} data-error={s.status === 'error'} aria-pressed={selectedId === s.id} aria-label={`${s.name} · ${s.status} · ${fmt(s.durationMs)}ms`} title={`${s.name} · ${fmt(s.startMs)}ms · ${fmt(s.durationMs)}ms · ${s.timing}`} style={{ left: `${s.startMs / extent * 100}%`, width: `${Math.max(.4, (s.durationMs ?? 0) / extent * 100)}%` }} onClick={() => setSelectedId(s.id)}/> )}</div></div>)}
          <p>{page * 200 + (current.length ? 1 : 0)}–{page * 200 + current.length} / {spans.length} {text('条证据；缺失时长是起点标记。', 'spans; unknown durations are start markers.')}</p>
          <button className="btn" disabled={!page} onClick={() => setPage(p => p - 1)}>{text('上一页', 'Previous')}</button> <button className="btn" disabled={(page + 1) * 200 >= spans.length} onClick={() => setPage(p => p + 1)}>{text('下一页', 'Next')}</button>
          <div className="benchmark-span-list">{current.map(s => <button key={s.id} className="benchmark-span-row" aria-pressed={selectedId === s.id} onClick={() => setSelectedId(s.id)}><span>{s.kind} · {s.name}</span><span>{fmt(s.startMs / 1000)}s · {s.status} · {fmt(s.durationMs)}ms · {s.timing}</span></button>)}</div>
        </div><aside aria-label={text('选中证据', 'Selected evidence')}><h3>{text('证据详情', 'Evidence details')}</h3>{selected ? <><p>{selected.name}</p><dl>{Object.entries(selected).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v === null ? '—' : String(v)}</dd></div>)}</dl>{originalLink(selected) ? <a className="btn" href={originalLink(selected)!} target="_blank" rel="noreferrer">{text('打开原任务泳道', 'Open original task lane')}</a> : <p>{text('未提供原始会话定位；保留本报告证据，不推测关联。', 'No original session locator; inspect report evidence without inferred links.')}</p>}</> : <p>{text('选择泳道、记录或诊断中的证据。', 'Select a lane span, row or finding.')}</p>}</aside></div>
      </section>}
    </>}
  </main>;
}
