import { useEffect, useMemo, useRef, useState } from 'react';
import type { Locale } from '../../i18n.js';
import { fetchJson } from '../../api/client.js';
import { METRIC_LABELS } from '../../core/benchmark-analysis.js';
import type { BenchmarkMetric, BenchmarkStats } from '../../core/benchmark-analysis.js';
import { analyzeTeamExperiment } from '../../core/team-experiment-analysis.js';
import { createTeamExperimentDemo } from '../../core/team-experiment-demo.js';
import { validateTeamExperimentDemo, validateTeamExperimentPlan, validateTeamExperimentReport } from '../../core/team-experiment-validation.js';
import type { TeamExperimentMode, TeamExperimentPlan, TeamExperimentReport, TeamExperimentScenario } from '../../core/team-experiment-types.js';
import { TEAM_MODE_LABELS, TeamExperimentReplay } from './TeamExperimentReplay.js';
import type { TeamExperimentReplayHandle } from './TeamExperimentReplay.js';
import '../../styles/components/team-experiment.css';
import { RealTaskDiagnosisEntry } from '../diagnosis/ArchitectureDiagnosisPanel.js';
import { AgentFoldingWorkbench } from '../agent-folding/AgentFoldingWorkbench.js';

const MAX_BYTES = 16 * 1024 * 1024;
const MODES: TeamExperimentMode[] = ['single_loop', 'subagents', 'agent_team'];
const SCENARIOS = {
  single_wins: ['单 loop 更合适', 'Single loop fits better'], subagents_win: ['子 Agent 并行收益', 'Subagent parallel gains'],
  team_quality: ['Team 验收收益', 'Team acceptance gains'], incomplete: ['证据不足', 'Insufficient evidence'],
} as const satisfies Record<TeamExperimentScenario, readonly [string, string]>;
const DEFAULT_PLAN: TeamExperimentPlan = {
  version: 1, kind: 'team-experiment', name: '同任务 · 执行模式对比', repetitions: 3, schedule: 'parallel',
  task: { id: 'task-001', repository: '/absolute/path/to/repository', ref: 'HEAD', prompt: '实现需求，并通过固定的独立验收。', expectedTests: 3,
    evaluator: ['/absolute/path/to/evaluator'], timeoutMs: 600000, caseIds: ['normal', 'boundary', 'regression'] },
  variants: [
    { id: 'single', mode: 'single_loop', prompt: '在一个 Agent loop 中完成任务；需要时并行调用工具，保留共享上下文。', product: 'Codex', model: '填写实际模型', environment: 'local', parameters: 'same budget', toolSet: 'same tools', driver: ['/absolute/path/to/single-driver'] },
    { id: 'subagents', mode: 'subagents', prompt: '由主 Agent 协调，将独立工作交给子 Agent，汇总结果后验收。', product: 'Codex', model: '填写实际模型', environment: 'local', parameters: 'same budget', toolSet: 'same tools', driver: ['/absolute/path/to/subagent-driver'] },
  ],
};
function number(value: number | null): string { return value === null ? '—' : value > 0 && value < .01 ? value.toPrecision(2) : value.toLocaleString(undefined, { maximumFractionDigits: 2 }); }
function download(name: string, value: unknown): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Task-centred configuration and evidence. All execution is an explicit action. */
export function TeamExperimentCenter({ locale, diagnosisInvalidateKey = 0 }: { locale: Locale; diagnosisInvalidateKey?: number }): React.JSX.Element {
  return <AgentFoldingWorkbench locale={locale} diagnosisInvalidateKey={diagnosisInvalidateKey} advanced={<TeamModeExperimentAdvanced locale={locale} diagnosisInvalidateKey={diagnosisInvalidateKey}/>}/>;
}

/** Compatible v1 mode reports remain available as an advanced workflow. */
export function TeamModeExperimentAdvanced({ locale, diagnosisInvalidateKey = 0 }: { locale: Locale; diagnosisInvalidateKey?: number }): React.JSX.Element {
  const zh = locale === 'zh', text = (cn: string, en: string) => zh ? cn : en;
  const [plan, setPlan] = useState<TeamExperimentPlan>(() => structuredClone(DEFAULT_PLAN));
  const [driverText, setDriverText] = useState(() => DEFAULT_PLAN.variants.map(v => JSON.stringify(v.driver)));
  const [evaluatorText, setEvaluatorText] = useState(JSON.stringify(DEFAULT_PLAN.task.evaluator));
  const [report, setReport] = useState<TeamExperimentReport | null>(null), [reportVersion, setReportVersion] = useState(0);
  const [error, setError] = useState(''), [message, setMessage] = useState('');
  const [setupOpen, setSetupOpen] = useState(true), [running, setRunning] = useState(false), [reading, setReading] = useState(false);
  const [stat, setStat] = useState<'mean' | 'median' | 'p95'>('median'), [casePage, setCasePage] = useState(0);
  const [trialRecordsOpen, setTrialRecordsOpen] = useState(false), [inspectedTrialId, setInspectedTrialId] = useState(''), [trialCasePage, setTrialCasePage] = useState(0);
  const reader = useRef<{ file: FileReader; timer: ReturnType<typeof setTimeout> } | null>(null);
  const request = useRef<{ controller: AbortController; timer: ReturnType<typeof setTimeout> } | null>(null);
  const reportRef = useRef<HTMLElement>(null);
  const replayRef = useRef<TeamExperimentReplayHandle>(null);
  const analysis = useMemo(() => report ? analyzeTeamExperiment(report) : null, [report]);
  const disposeReader = (): void => { const old = reader.current; reader.current = null; if (old) { clearTimeout(old.timer); old.file.abort(); } };
  const disposeRequest = (): void => { const old = request.current; request.current = null; if (old) { clearTimeout(old.timer); old.controller.abort(); } };
  useEffect(() => () => { disposeReader(); disposeRequest(); }, []);
  const load = (next: TeamExperimentReport): void => {
    setReport(next); setReportVersion(v => v + 1); setCasePage(0); setSetupOpen(false); setError('');
    setTrialRecordsOpen(false); setInspectedTrialId(''); setTrialCasePage(0);
    requestAnimationFrame(() => reportRef.current?.scrollIntoView?.({ block: 'start' }));
  };
  const importReport = (file: File | undefined): void => {
    if (!file) return;
    disposeReader(); disposeRequest(); setRunning(false); setReading(false); setError(''); setMessage('');
    if (file.size > MAX_BYTES) { setError(text('报告超过 16 MiB。', 'Report exceeds 16 MiB.')); return; }
    const fileReader = new FileReader();
    const owned = { file: fileReader, timer: setTimeout(() => {
      if (reader.current !== owned) return; disposeReader(); setReading(false); setError(text('文件读取超时，请重新选择。', 'File read timed out. Select it again.'));
    }, 5000) };
    reader.current = owned; setReading(true);
    fileReader.onload = () => {
      if (reader.current !== owned) return;
      try { load(validateTeamExperimentReport(JSON.parse(String(fileReader.result)))); }
      catch { setError(text('报告无效：请使用任务模式实验报告，检查版本、身份、证据与用例。', 'Invalid report: use a task-mode experiment report with valid version, identities, evidence and cases.')); }
    };
    fileReader.onerror = () => { if (reader.current === owned) setError(text('读取失败，请重试。', 'Read failed. Retry.')); };
    fileReader.onloadend = () => { clearTimeout(owned.timer); if (reader.current === owned) { reader.current = null; setReading(false); } };
    fileReader.readAsText(file);
  };
  const preview = (scenario: TeamExperimentScenario): void => { disposeReader(); disposeRequest(); setReading(false); setRunning(false); setMessage(''); load(createTeamExperimentDemo(scenario)); };
  const cancel = (): void => { disposeRequest(); setRunning(false); setMessage(text('已停止等待并请求取消，已完成的本地实验可能保留。', 'Stopped waiting and requested cancellation; finished local trials may remain.')); };
  const runFixture = (): void => {
    if (request.current) return;
    let input;
    try { input = validateTeamExperimentDemo({ name: plan.name, repetitions: plan.repetitions, schedule: plan.schedule, variants: plan.variants.map(v => ({ mode: v.mode, prompt: v.prompt })) }); }
    catch { setError(text('请填写实验名与各组提示词，并设置 1–10 次重复。', 'Fill the name and per-variant prompts; choose 1–10 repetitions.')); return; }
    disposeReader(); setReading(false); setError(''); setMessage(''); setRunning(true);
    const owned = { controller: new AbortController(), timer: setTimeout(() => { if (request.current === owned) cancel(); }, 65000) };
    request.current = owned;
    void fetchJson<unknown>('/team-experiments/demo', { method: 'POST', headers: { 'content-type': 'application/json' }, signal: owned.controller.signal, body: JSON.stringify(input) })
      .then(raw => { if (request.current !== owned) return; const next = validateTeamExperimentReport(raw); load(next); setMessage(text(`内置实验完成，保留 ${next.trials.length} 次运行；未调用真实模型。`, `Built-in experiment finished with ${next.trials.length} retained trials; no real model was called.`)); })
      .catch(() => { if (request.current === owned) setError(text('内置实验未完成。请检查本地服务和 Git，或稍后显式重试；已完成记录可能保留。', 'Built-in experiment did not finish. Check the local service and Git, then retry explicitly; finished records may remain.')); })
      .finally(() => { if (request.current === owned) { clearTimeout(owned.timer); request.current = null; setRunning(false); } });
  };
  const exportPlan = (): void => {
    try {
      const candidate = { ...plan, task: { ...plan.task, evaluator: JSON.parse(evaluatorText) as unknown }, variants: plan.variants.map((v, i) => ({ ...v, driver: JSON.parse(driverText[i]!) as unknown })) };
      download('team-experiment-plan.json', validateTeamExperimentPlan(candidate)); setError(''); setMessage(text('计划已校验并导出。真实驱动只在你显式执行 CLI 后运行。', 'Plan validated and exported. Real drivers run only after explicit CLI execution.'));
    } catch { setError(text('计划无效：检查绝对路径、JSON 参数数组、提示词和固定用例。', 'Invalid plan: check paths, JSON argv arrays, prompts and fixed cases.')); }
  };
  const copyCommand = (): void => {
    if (!navigator.clipboard) { setError(text('复制不可用，请从上方手动复制命令。', 'Clipboard unavailable. Copy the command above manually.')); return; }
    void navigator.clipboard.writeText('npm run team:experiment -- team-experiment-plan.json --execute --output ./team-experiment-results/run-001')
      .then(() => setMessage(text('运行命令已复制。', 'Run command copied.')))
      .catch(() => setError(text('复制失败，请从上方手动复制命令。', 'Copy failed. Copy the command above manually.')));
  };
  const field = (index: number, key: 'prompt' | 'model' | 'product' | 'environment' | 'parameters' | 'toolSet', value: string): void => setPlan(old => ({ ...old, variants: old.variants.map((v, i) => i === index ? { ...v, [key]: value } : v) }));
  const summary = (s: BenchmarkStats): string => `${number(s[stat])} (n=${s.n})`;
  const metricLabel = (key: BenchmarkMetric): string => `${(['passed', 'total', 'passRate'] as string[]).includes(key) ? text('汇总验收 · ', 'Aggregate acceptance · ') : ''}${METRIC_LABELS[key][zh ? 0 : 1]}`;
  const flips = analysis?.caseFlips ?? [], displayedCasePage = Math.min(casePage, Math.max(0, Math.ceil(flips.length / 100) - 1));
  const inspectedTrial = report?.trials.find(t => t.id === inspectedTrialId) ?? report?.trials[0] ?? null;
  const inspectedCaseIndex = Math.min(trialCasePage, Math.max(0, Math.ceil((inspectedTrial?.cases?.length ?? 0) / 100) - 1));
  const caseWords = { both_passed: ['双方通过', 'Both pass'], left_only: ['仅左侧通过', 'Left only'], right_only: ['仅右侧通过', 'Right only'], both_failed: ['双方失败', 'Both fail'], unknown: ['未知', 'Unknown'] } as const;
  return <section className="team-exp-center">
    <header className="team-exp-heading"><div><h1>{text('任务模式实验', 'Task mode experiments')}</h1><p>{text('同一任务，比较单 loop、主子 Agent 与团队协作；从验收结果追溯过程。', 'Compare single loop, subagents and teams on one task; trace acceptance back to evidence.')}</p></div>
      <label className="btn team-exp-file-label">{text('导入报告', 'Import report')}<input aria-label={text('导入任务模式报告', 'Import task-mode report')} type="file" accept=".json,application/json" onChange={e => { importReport(e.target.files?.[0]); e.target.value = ''; }}/></label>
      {report && <button className="btn" onClick={() => download('team-experiment-report.json', report)}>{text('导出报告', 'Export report')}</button>}
    </header>
    <RealTaskDiagnosisEntry locale={locale} invalidateKey={diagnosisInvalidateKey}/>
    <div className="team-exp-scenarios"><span>{text('离线模拟：', 'Offline scenarios:')}</span>{Object.entries(SCENARIOS).map(([id, title]) => <button className="btn" key={id} onClick={() => preview(id as TeamExperimentScenario)}>{title[zh ? 0 : 1]}</button>)}</div>
    {error && <p role="alert" className="team-exp-alert">{error}</p>}{message && <p role="status">{message}</p>}
    {reading && <p role="status">{text('正在读取本地报告…', 'Reading local report…')} <button className="btn" onClick={() => { disposeReader(); setReading(false); }}>{text('取消读取', 'Cancel read')}</button></p>}
    <details className="team-exp-setup" open={setupOpen} onToggle={e => setSetupOpen(e.currentTarget.open)}><summary>{text('设置任务与对照组合', 'Configure task and variants')}</summary>
      <p>{text('独立任务适合委派；紧密共享上下文的步骤可以留在主循环。Team 需要实际讨论或协作价值，多个 Agent 不等于团队。用固定验收比较，而不是以 Agent 数量判断好坏。', 'Delegate independent work; keep tightly shared context in the main loop. Teams need actual collaborative value. Compare fixed acceptance, not agent counts.')}</p>
      <fieldset disabled={running}><legend>{text('共同任务', 'Shared task')}</legend><div className="team-exp-form-grid">
        <label>{text('实验名称', 'Experiment name')}<input value={plan.name} maxLength={120} onChange={e => setPlan({ ...plan, name: e.target.value })}/></label>
        <label>{text('任务标识', 'Task ID')}<input value={plan.task.id} onChange={e => setPlan({ ...plan, task: { ...plan.task, id: e.target.value } })}/></label>
        <label>{text('每组重复', 'Repetitions')}<select value={plan.repetitions} onChange={e => setPlan({ ...plan, repetitions: Number(e.target.value) })}>{[1, 2, 3, 5, 10].map(n => <option key={n} value={n}>{n}</option>)}</select></label>
        <label>{text('调度', 'Schedule')}<select value={plan.schedule} onChange={e => setPlan({ ...plan, schedule: e.target.value as TeamExperimentPlan['schedule'] })}><option value="parallel">{text('每轮同时启动', 'Paired parallel')}</option><option value="sequential">{text('顺序执行，排查资源争用', 'Sequential, check contention')}</option></select></label>
      </div><label>{text('共同任务目标', 'Shared task goal')}<textarea rows={2} value={plan.task.prompt} maxLength={32000} onChange={e => setPlan({ ...plan, task: { ...plan.task, prompt: e.target.value } })}/></label>
      <div className="team-exp-variant-forms">{plan.variants.map((v, i) => <section key={v.id}><div className="team-exp-form-grid"><label>{text('模式', 'Mode')} {i + 1}<select value={v.mode} onChange={e => setPlan({ ...plan, variants: plan.variants.map((row, n) => n === i ? { ...row, mode: e.target.value as TeamExperimentMode } : row) })}>{MODES.map(m => <option key={m} value={m}>{TEAM_MODE_LABELS[m][zh ? 0 : 1]}</option>)}</select></label><label>{text('模型', 'Model')} {i + 1}<input value={v.model} onChange={e => field(i, 'model', e.target.value)}/></label></div><label>{text('该组提示词', 'Variant prompt')} {i + 1}<textarea rows={3} maxLength={32000} value={v.prompt} onChange={e => field(i, 'prompt', e.target.value)}/></label>
        <details><summary>{text('模型、工具和驱动条件', 'Model, tool and driver conditions')}</summary>{(['product', 'environment', 'parameters', 'toolSet'] as const).map(key => <label key={key}>{({ product: ['产品', 'Product'], environment: ['环境', 'Environment'], parameters: ['参数与预算', 'Parameters and budget'], toolSet: ['工具权限', 'Tool permissions'] })[key][zh ? 0 : 1]}<input value={v[key]} onChange={e => field(i, key, e.target.value)}/></label>)}<label>{text('驱动 argv（JSON 数组）', 'Driver argv (JSON array)')}<input value={driverText[i]} onChange={e => setDriverText(old => old.map((s, n) => n === i ? e.target.value : s))}/></label></details>
      </section>)}</div>
      <div className="team-exp-actions"><button className="btn" disabled={plan.variants.length >= 3} onClick={() => { setPlan({ ...plan, variants: [...plan.variants, { ...plan.variants[0]!, id: 'team', mode: 'agent_team', prompt: '组建团队，明确分工，讨论发现和依赖，联合完成固定验收。' }] }); setDriverText([...driverText, '["/absolute/path/to/team-driver"]']); }}>{text('加入 Team 对照组', 'Add team variant')}</button>{plan.variants.length === 3 && <button className="btn" onClick={() => { setPlan({ ...plan, variants: plan.variants.slice(0, 2) }); setDriverText(driverText.slice(0, 2)); }}>{text('移除第三组', 'Remove third variant')}</button>}</div>
      <details><summary>{text('真实任务仓库与固定验收', 'Real repository and fixed acceptance')}</summary><div className="team-exp-form-grid"><label>{text('本地仓库绝对路径', 'Absolute local repository path')}<input value={plan.task.repository} onChange={e => setPlan({ ...plan, task: { ...plan.task, repository: e.target.value } })}/></label><label>{text('起始版本', 'Starting ref')}<input value={plan.task.ref} onChange={e => setPlan({ ...plan, task: { ...plan.task, ref: e.target.value } })}/></label></div><label>{text('固定用例标识（一行一个）', 'Fixed case IDs (one per line)')}<textarea rows={3} value={plan.task.caseIds.join('\n')} onChange={e => { const ids = e.target.value.split('\n'); setPlan({ ...plan, task: { ...plan.task, caseIds: ids, expectedTests: ids.length } }); }}/></label><label>{text('独立验收 argv（JSON 数组）', 'Independent evaluator argv (JSON array)')}<input value={evaluatorText} onChange={e => setEvaluatorText(e.target.value)}/></label><label>{text('每阶段超时（毫秒）', 'Stage timeout (ms)')}<input type="number" value={plan.task.timeoutMs} min={100} max={86400000} onChange={e => setPlan({ ...plan, task: { ...plan.task, timeoutMs: Number(e.target.value) } })}/></label></details>
      </fieldset>
      <p className="team-exp-scope">{text('不同提示词是配置组合对比，不能只归因于架构；同时运行会争用机器和网络。真实模型需要你的驱动，导出计划后使用 CLI 显式执行。', 'Different prompts compare configurations, not architecture alone. Parallel runs can contend for resources. Real models require your driver and explicit CLI execution of the exported plan.')}</p>
      <div className="team-exp-actions"><button className="btn" onClick={exportPlan}>{text('校验并导出真实实验计划', 'Validate and export real plan')}</button></div>
      <details><summary>{text('如何运行真实对照实验', 'How to run a real comparison')}</summary><p>{text('填写上面的真实仓库、驱动和独立验收器，导出计划。在终端先校验，再显式执行；完成后导入输出目录中的 report.json。驱动负责启动所选模型、等待真正完成并导出证据。', 'Fill the real repository, drivers and independent evaluator, then export the plan. Validate in a terminal before explicit execution. Import report.json from the output directory. Drivers launch the configured model, wait for completion and export evidence.')}</p><pre>{'npm run team:experiment -- team-experiment-plan.json\nnpm run team:experiment -- team-experiment-plan.json --execute --output ./team-experiment-results/run-001'}</pre><button className="btn" onClick={copyCommand}>{text('复制执行命令', 'Copy run command')}</button></details>
      <section className="team-exp-fixture"><h3>{text('运行内置演示任务', 'Run the built-in fixture')}</h3><p>{text('这里只运行固定的本地实现与验收，验证多进程同时启动、工作区隔离和报告闭环。不会执行上方自填任务或调用模型；产品能力与 Token 仍属模拟。', 'This runs fixed local implementation and acceptance processes to verify paired starts, isolated workspaces and reporting. It does not execute the custom task above or call models; product capability and token evidence remain synthetic.')}</p><button className="btn" disabled={running} onClick={runFixture}>{running ? text('演示正在运行…', 'Fixture running…') : text(`运行内置配对实验（${plan.variants.length * plan.repetitions} 次）`, `Run built-in paired fixture (${plan.variants.length * plan.repetitions} trials)`)}</button>{running && <button className="btn" onClick={cancel}>{text('取消运行', 'Cancel run')}</button>}</section>
    </details>
    {!report && <p className="team-exp-empty">{text('先查看一个模拟场景，或导入真实报告。验收 → 指标 → 关键事件 → 原始记录，帮助判断这个任务适合哪种方式。', 'Start with a synthetic scenario or import a real report. Acceptance → metrics → key events → original records show which configuration fits this task.')}</p>}
    {report && analysis && <section className="team-exp-report" ref={reportRef}>
      <div className="team-exp-report-heading"><h2>{report.plan.name}</h2><strong className="team-exp-badge">{report.synthetic ? 'SYNTHETIC · ' + text('模拟结果', 'Synthetic result') : text('已记录实验', 'Recorded experiment')}</strong><span>{report.trials.length} / {report.plan.variants.length * report.plan.repetitions} {text('次运行', 'trials')}</span></div>
      <p>{text('固定版本', 'Pinned commit')} <code>{report.commit.slice(0, 12)}</code> · {report.plan.task.expectedTests} {text('个固定用例', 'fixed cases')} · {report.plan.schedule} · {report.createdAt}</p>
      <section className="team-exp-guidance" aria-label={text('模式选择建议', 'Mode recommendation')}><h3>{analysis.recommendation[zh ? 'zh' : 'en']}</h3><ul>{analysis.recommendation.reasons.map(r => <li key={r.code}>{r[zh ? 'zh' : 'en']}{r.trialIds?.[0] && r.eventIds?.[0] && <button className="btn" onClick={() => replayRef.current?.locate(r.trialIds![0]!, r.eventIds![0]!)}>{text('定位建议证据', 'Locate recommendation evidence')}</button>}</li>)}</ul></section>
      {analysis.warnings.length > 0 && <details className="team-exp-warnings"><summary>{text('可比性与证据限制', 'Comparability and evidence limits')} · {analysis.warnings.length}</summary><ul>{analysis.warnings.map(w => <li key={w.code}>{w[zh ? 'zh' : 'en']}</li>)}</ul></details>}
      <div className="team-exp-metric-toolbar"><h3>{text('先看验收，再看速度与用量', 'Acceptance before speed and usage')}</h3><label>{text('统计', 'Statistic')} <select value={stat} onChange={e => setStat(e.target.value as typeof stat)}><option value="median">{text('中位数', 'Median')}</option><option value="mean">{text('均值', 'Mean')}</option><option value="p95">P95</option></select></label></div>
      <div className="team-exp-table-scroll"><table><thead><tr><th>{text('指标', 'Metric')}</th>{analysis.groups.map(g => <th key={g.variant.id}>{TEAM_MODE_LABELS[g.variant.mode][zh ? 0 : 1]}<small>{g.variant.id} · {g.variant.model}</small></th>)}</tr></thead><tbody><tr><th>{text('独立验收通过 / 已知 / 保留', 'Pass / known / retained')}</th>{analysis.groups.map(g => <td key={g.variant.id}>{g.successes} / {g.known} / {g.trials.length}</td>)}</tr>{(['e2e', 'tokens', 'modelCalls', 'toolCalls'] as const).map(k => <tr key={k}><th>{METRIC_LABELS[k][zh ? 0 : 1]}</th>{analysis.groups.map(g => <td key={g.variant.id}>{summary(g.metrics[k])}</td>)}</tr>)}<tr><th>{text('E2E 波动 CV (%)', 'E2E variation CV (%)')}</th>{analysis.groups.map(g => <td key={g.variant.id}>{number(g.metrics.e2e.cv)}</td>)}</tr><tr><th>{text('实际模型一致', 'Actual model confirmed')}</th>{analysis.groups.map(g => <td key={g.variant.id}>{g.modelVerified ? text('已确认', 'Confirmed') : text('未知或不符', 'Unknown / mismatch')}</td>)}</tr></tbody></table></div>
      {analysis.comparisons.map(c => <p key={c.variantId}>{c.baselineId} / {c.variantId} · {text('配对实测 E2E 比', 'Paired measured E2E ratio')} {summary(c.e2eRatio)} · {text('Token 比', 'Token ratio')} {summary(c.tokenRatio)} · {c.pairs} {text('对；比值 >1 表示右侧较低，不能替代验收。', 'pairs; a ratio >1 means a lower right-side value, not acceptance.')}</p>)}
      <details><summary>{text('全部指标、口径与每组提示词', 'All metrics, definitions and prompts')}</summary><p>{text('n 为该指标的有效样本；空缺是未知。Token 包含关系沿用原始声明，调用累计耗时可重叠，不等于任务 E2E。少于三次不能判断稳定性。', 'n is the valid sample count; missing is unknown. Token inclusion follows source declarations. Summed call durations may overlap and are not task E2E. Fewer than three trials cannot establish stability.')}</p><div className="team-exp-table-scroll"><table><tbody>{(Object.keys(METRIC_LABELS) as BenchmarkMetric[]).map(k => <tr key={k}><th>{metricLabel(k)}</th>{analysis.groups.map(g => <td key={g.variant.id}>{summary(g.metrics[k])}</td>)}</tr>)}</tbody></table></div>{report.plan.variants.map(v => <details key={v.id}><summary>{v.id} · {TEAM_MODE_LABELS[v.mode][zh ? 0 : 1]}</summary><p>{v.product} · {v.model} · {v.environment} · {v.parameters} · {v.toolSet}</p><pre>{v.prompt}</pre><p>SHA256: {report.trials.find(t => t.variantId === v.id)?.promptSha256 ?? '—'}</p></details>)}</details>
      <details className="team-exp-trial-records" open={trialRecordsOpen} onToggle={e => setTrialRecordsOpen(e.currentTarget.open)}><summary>{text('运行记录、验收详情与采集错误', 'Trial records, acceptance details and capture errors')}</summary>{trialRecordsOpen && inspectedTrial && <>
        <label>{text('选择运行详情', 'Select trial details')}<select value={inspectedTrial.id} onChange={e => { setInspectedTrialId(e.target.value); setTrialCasePage(0); }}>{report.trials.map(trial => <option key={trial.id} value={trial.id}>{trial.id} · {trial.run.status} · {trial.run.verdict ? `${trial.run.verdict.passed}/${trial.run.verdict.total}` : text('验收未知', 'Acceptance unknown')}</option>)}</select></label>
        <section className="team-exp-selected-trial" aria-label={text('选中运行详情', 'Selected trial details')}><h3>{inspectedTrial.id}</h3><p>{inspectedTrial.run.host} · {inspectedTrial.run.startedAt} · {text('实际模型', 'Actual model')} {inspectedTrial.run.telemetry?.actualModel ?? '—'}</p>{inspectedTrial.run.error && <pre>{inspectedTrial.run.error}</pre>}{inspectedTrial.evidenceError && <p className="team-exp-alert">{text('采集证据错误（独立验收另列）：', 'Capture evidence error (acceptance is separate): ')}{inspectedTrial.evidenceError}</p>}
          {inspectedTrial.cases ? <><p>{inspectedTrial.cases.length ? inspectedCaseIndex * 100 + 1 : 0}–{Math.min((inspectedCaseIndex + 1) * 100, inspectedTrial.cases.length)} / {inspectedTrial.cases.length}</p><ul>{inspectedTrial.cases.slice(inspectedCaseIndex * 100, (inspectedCaseIndex + 1) * 100).map(c => <li className="team-exp-case-detail" key={c.id}><strong>{c.id} · {c.status}</strong>{c.detail && <p>{c.detail}</p>}</li>)}</ul><button className="btn" disabled={!inspectedCaseIndex} onClick={() => setTrialCasePage(inspectedCaseIndex - 1)}>{text('上一页验收详情', 'Previous acceptance details')}</button><button className="btn" disabled={(inspectedCaseIndex + 1) * 100 >= inspectedTrial.cases.length} onClick={() => setTrialCasePage(inspectedCaseIndex + 1)}>{text('下一页验收详情', 'Next acceptance details')}</button></> : <p>{text('没有独立具名用例证据。', 'Named independent case evidence is unavailable.')}</p>}
        </section>
      </>}</details>
      <details className="team-exp-cases"><summary>{text('逐用例比较：哪些从通过变失败？', 'Per-case comparison: which cases flipped?')} · {flips.length}</summary><div className="team-exp-table-scroll"><table><thead><tr>{[text('轮次', 'Trial'), text('用例', 'Case'), text('左侧', 'Left'), text('右侧', 'Right'), text('结果', 'Outcome')].map(s => <th key={s}>{s}</th>)}</tr></thead><tbody>{flips.slice(displayedCasePage * 100, (displayedCasePage + 1) * 100).map(f => <tr key={`${f.repetition}/${f.caseId}/${f.leftVariantId}/${f.rightVariantId}`}><td>{f.repetition}</td><th>{f.caseId}</th><td>{f.leftVariantId} · {f.leftStatus}</td><td>{f.rightVariantId} · {f.rightStatus}</td><td>{caseWords[f.outcome][zh ? 0 : 1]}</td></tr>)}</tbody></table></div><button className="btn" disabled={!displayedCasePage} onClick={() => setCasePage(p => p - 1)}>{text('上一页用例', 'Previous cases')}</button><button className="btn" disabled={(displayedCasePage + 1) * 100 >= flips.length} onClick={() => setCasePage(p => p + 1)}>{text('下一页用例', 'Next cases')}</button></details>
      <TeamExperimentReplay key={reportVersion} ref={replayRef} report={report} locale={locale}/>
      <details className="team-exp-research"><summary>{text('设计依据与下一次实验', 'Research basis and the next experiment')}</summary><p>{text('每次只折叠一个分工边界，固定任务与验收，记录失败翻转再决定保留。不同配置得到的建议只适用于本次任务范围。', 'Fold one delegation boundary at a time, keep task and acceptance fixed, and inspect regressions before deciding. Configuration findings apply to this task scope.')}</p><a href="https://claude.com/resources/articles/building-agents-when-to-fold-subagents-into-your-main-agent-loop" target="_blank" rel="noreferrer">When to fold subagents into your main agent loop</a> · <a href="https://code.claude.com/docs/en/agent-teams" target="_blank" rel="noreferrer">Agent teams</a></details>
    </section>}
  </section>;
}
