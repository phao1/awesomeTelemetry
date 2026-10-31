import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, fetchJson } from '../../api/client.js';
import type { Locale } from '../../i18n.js';
import type { ArchitectureCategory, ArchitectureDiagnosisReport, ArchitectureEvidence, ArchitectureThresholds } from '../../core/architecture-diagnosis-types.js';
import { DEFAULT_ARCHITECTURE_THRESHOLDS, validateArchitectureThresholds } from '../../core/architecture-diagnosis-analysis.js';
import { serializeTaskRoute } from '../../task-route.js';
import { taskApi } from '../task/task-data.js';
import '../../styles/components/architecture-diagnosis.css';

const CATEGORIES: ArchitectureCategory[] = ['context_bloat', 'tool_conflict', 'handoff_loss'];
const CATEGORY_LABELS = { context_bloat: ['上下文膨胀', 'Context bloat'], tool_conflict: ['工具选择冲突', 'Tool selection conflicts'], handoff_loss: ['交接信息缺口', 'Handoff information gaps'] } as const;
const STATE_LABELS = { findings: ['发现可检查的证据', 'Evidence to inspect'], not_observed: ['完整范围内未观察到', 'Not observed in the complete scope'], insufficient: ['证据不足，无法判断', 'Insufficient evidence'] } as const;
const COVERAGE_LABELS = { complete: ['完整', 'Complete'], partial: ['部分', 'Partial'], unavailable: ['不可用', 'Unavailable'] } as const;
const ACTION_LABELS = { progressive_disclosure: ['先渐进披露', 'Try progressive disclosure first'], split_candidate: ['尝试拆出独立子任务', 'Try splitting an independent branch'], merge_candidate: ['尝试合回主循环', 'Try merging into the main loop'], repair_tool_contract: ['先修复工具契约', 'Repair the tool contract first'], verify_first: ['先补齐证据再决定', 'Verify evidence before deciding'] } as const;
const THRESHOLD_LABELS: Record<keyof ArchitectureThresholds, readonly [string, string]> = { minSamples: ['最少同源样本', 'Minimum same-stream samples'], minContextTokens: ['上下文 Token 下限', 'Minimum context tokens'], minContextChars: ['完整上下文字符下限', 'Minimum full-context characters'], growthRatio: ['增长倍数', 'Growth ratio'], duplicateRatio: ['重复内容比例', 'Duplicate content ratio'], toolCatalogLimit: ['工具目录数量', 'Tool catalog size'], repeatedToolErrors: ['明确工具错误次数', 'Explicit tool errors'], minHandoffAnchors: ['交接引用锚点数量', 'Handoff reference anchors'] };
const PAGE_SIZE = 20;
interface ReadState<T> { key: string; value: T | null; loading: boolean; error: string | null; cancelled: boolean }
function readErrorCode(error: unknown): string {
  if (error instanceof ApiError) {
    const reason = error.details?.reason;
    if (reason === 'BUSY') return 'DIAGNOSIS_BUSY';
    if (reason === 'SOURCE_CHANGED') return 'DIAGNOSIS_SOURCE_CHANGED';
    if (reason === 'CANCELLED') return 'DIAGNOSIS_CANCELLED';
    return error.code;
  }
  return error instanceof Error ? error.message : 'DIAGNOSIS_READ_FAILED';
}

/** Explicit reads own their deadline and result, even when a loader ignores abort. */
function useExplicitRead<T>(key: string, deadline: number) {
  const owner = useRef<{ controller: AbortController; timer: ReturnType<typeof setTimeout> } | null>(null);
  const currentKey = useRef(key); currentKey.current = key;
  const [state, setState] = useState<ReadState<T>>({ key, value: null, loading: false, error: null, cancelled: false });
  const dispose = useCallback(() => { const old = owner.current; owner.current = null; if (old) { clearTimeout(old.timer); old.controller.abort(); } }, []);
  useEffect(() => dispose, [key, dispose]);
  const start = (read: (signal: AbortSignal) => Promise<T>) => {
    if (owner.current) return;
    const controller = new AbortController();
    const owned = { controller, timer: setTimeout(() => { if (owner.current !== owned) return; dispose(); setState({ key, value: null, loading: false, error: 'DIAGNOSIS_TIMEOUT', cancelled: false }); }, deadline) };
    owner.current = owned; setState({ key, value: null, loading: true, error: null, cancelled: false });
    void read(controller.signal).then(value => { if (owner.current === owned && currentKey.current === key) setState({ key, value, loading: false, error: null, cancelled: false }); })
      .catch((error: unknown) => { if (owner.current === owned && currentKey.current === key) setState({ key, value: null, loading: false, error: readErrorCode(error), cancelled: false }); })
      .finally(() => { if (owner.current === owned) { clearTimeout(owned.timer); owner.current = null; } });
  };
  return { ...(state.key === key ? state : { value: null, loading: false, error: null, cancelled: false }), invalidated: state.key !== key && (state.value !== null || state.loading || state.error !== null), start, cancel: () => { dispose(); setState({ key, value: null, loading: false, error: null, cancelled: true }); } };
}

function readError(code: string, locale: Locale): string {
  const words: Record<string, readonly [string, string]> = {
    DIAGNOSIS_TIMEOUT: ['读取超时，请重试。', 'Read timed out. Retry explicitly.'],
    DIAGNOSIS_SOURCE_CHANGED: ['来源已变更，请重新分析。', 'Source changed. Analyze again.'],
    SOURCE_CHANGED: ['来源已变更，请重新分析。', 'Source changed. Analyze again.'],
    DIAGNOSIS_BUSY: ['另一个分析正在运行，请稍后重试。', 'Another analysis is running. Retry shortly.'],
    DIAGNOSIS_CANCELLED: ['分析已停止，请显式重试。', 'Analysis stopped. Retry explicitly.'],
    BAD_REQUEST: ['任务、成员或阈值无效，请检查输入。', 'Check the task, member and threshold values.'],
    TASK_NOT_FOUND: ['任务已不存在，请重新选择。', 'Task no longer exists. Select it again.'],
  };
  return (words[code] ?? ['读取失败，请重试。', 'Read failed. Retry explicitly.'])[locale === 'zh' ? 0 : 1] + ' (' + code + ')';
}

function sourceLink(ref: ArchitectureEvidence): string | null {
  if (ref.source === 'native_event' && ref.sessionKey && ref.eventId) return serializeTaskRoute({ task: ref.taskId, origin: 'collected', member: 'all', mode: 'trajectory', event: `${ref.sessionKey}:event:${ref.eventId}` });
  if (Number.isSafeInteger(ref.captureId) && ref.captureId !== null && ref.captureId > 0) {
    const base = `/api/proxy/requests/${ref.captureId}`;
    if (ref.source === 'codex_call' && ref.callSequence !== null && Number.isSafeInteger(ref.callSequence) && ref.callSequence >= 0) return `${base}/codex-calls/${ref.callSequence}`;
    if (ref.source === 'http_capture') return base;
  }
  return null;
}

export interface ArchitectureDiagnosisPanelProps {
  taskId: string; member: string; locale: Locale; invalidateKey?: string | number;
  onLocate?: (ref: ArchitectureEvidence) => void;
}

/** Local retained evidence only. Opening the panel never starts acquisition. */
export function ArchitectureDiagnosisPanel({ taskId, member, locale, invalidateKey = 0, onLocate }: ArchitectureDiagnosisPanelProps): React.JSX.Element {
  const zh = locale === 'zh', index = zh ? 0 : 1, text = (cn: string, en: string) => zh ? cn : en;
  const key = JSON.stringify([taskId, member, invalidateKey]);
  // Allow the server's 45s scope deadline to settle its 30s archive worker first.
  const read = useExplicitRead<ArchitectureDiagnosisReport>(key, 50000);
  const [thresholds, setThresholds] = useState<ArchitectureThresholds>({ ...DEFAULT_ARCHITECTURE_THRESHOLDS });
  const [validationError, setValidationError] = useState(false), [page, setPage] = useState(0), [font, setFont] = useState(13), [showReport, setShowReport] = useState(true);
  const report = read.value, pageIndex = Math.min(page, Math.max(0, Math.ceil((report?.findings.length ?? 0) / PAGE_SIZE) - 1));
  const analyze = () => {
    let checked: ArchitectureThresholds;
    try { checked = validateArchitectureThresholds(thresholds); setValidationError(false); } catch { setValidationError(true); return; }
    setPage(0); setShowReport(true);
    read.start(async signal => {
      const query = new URLSearchParams({ member });
      for (const [name, value] of Object.entries(checked)) query.set(name, String(value));
      const value = await fetchJson<ArchitectureDiagnosisReport>(`/tasks/${encodeURIComponent(taskId)}/architecture-diagnosis?${query}`, { signal, cache: 'no-store' });
      if (value?.version !== 1 || value.taskId !== taskId || value.member !== member || !value.coverage || !Array.isArray(value.findings) || value.findings.length > 64 || !Array.isArray(value.evidence) || value.evidence.length > 512 || !Array.isArray(value.limitations) || CATEGORIES.some(category => !['findings', 'not_observed', 'insufficient'].includes(value.categories?.[category]))) throw new Error('INVALID_DIAGNOSIS_RESPONSE');
      return value;
    });
  };
  return <section className="architecture-diagnosis" aria-label={text('任务拆分与合并分析', 'Task split and merge analysis')}>
    <div className="architecture-diagnosis-toolbar"><button type="button" className="btn" disabled={read.loading} onClick={analyze}>{report ? text('重新分析拆分与合并', 'Analyze split and merge again') : text('分析拆分与合并', 'Analyze split and merge')}</button>{report && <button type="button" className="btn" aria-expanded={showReport} onClick={() => setShowReport(old => !old)}>{showReport ? text('收起分析结果', 'Collapse analysis results') : text('展开分析结果', 'Expand analysis results')}</button>}<span>{text('仅分析当前任务保留的 telemetry；覆盖不足会明确说明。', 'Analyze retained telemetry for this task; missing coverage stays explicit.')}</span>{read.loading && <button type="button" className="btn" onClick={read.cancel}>{text('取消分析', 'Cancel analysis')}</button>}</div>
    <details className="architecture-thresholds"><summary>{text('分析阈值（产品启发式）', 'Analysis thresholds (product heuristics)')}</summary><p>{text('这些默认值用于筛选待检查证据，不是架构优劣或因果关系的公式。修改后需显式重新分析。', 'These defaults select evidence to inspect, not architectural quality or causality. Changes require explicit analysis.')}</p><fieldset disabled={read.loading}><legend>{text('可调整阈值', 'Adjustable thresholds')}</legend><div className="architecture-threshold-grid">{(Object.keys(THRESHOLD_LABELS) as Array<keyof ArchitectureThresholds>).map(name => <label key={name}>{THRESHOLD_LABELS[name][index]}<input type="number" step={name === 'growthRatio' || name === 'duplicateRatio' ? 'any' : '1'} value={Number.isFinite(thresholds[name]) ? thresholds[name] : ''} onChange={event => setThresholds(old => ({ ...old, [name]: event.target.value === '' ? NaN : Number(event.target.value) }))}/><small>{text('默认', 'Default')} {DEFAULT_ARCHITECTURE_THRESHOLDS[name]}</small></label>)}</div><button type="button" className="btn" onClick={() => { setThresholds({ ...DEFAULT_ARCHITECTURE_THRESHOLDS }); setValidationError(false); }}>{text('恢复默认阈值', 'Reset thresholds')}</button></fieldset></details>
    {validationError && <p role="alert">{text('阈值超出允许范围，请检查数值或恢复默认。', 'Thresholds are outside the allowed range. Check values or reset defaults.')}</p>}
    {read.loading && <p role="status">{text('正在读取当前任务的有界证据…', 'Reading bounded evidence for this task…')}</p>}
    {read.error && <div role="alert"><p>{readError(read.error, locale)}</p><button type="button" className="btn" onClick={analyze}>{text('重试分析', 'Retry analysis')}</button></div>}
    {read.cancelled && <p role="status">{text('分析已取消；可再次显式分析。', 'Analysis cancelled. You can analyze again explicitly.')}</p>}
    {read.invalidated && <p role="status">{text('任务来源或阅读范围已变化，旧分析已清除，请重新分析。', 'Task source or reading scope changed. Old analysis was cleared; analyze again explicitly.')}</p>}
    {report && showReport && <div className="architecture-report" style={{ '--user-font-size': `${font}px` } as React.CSSProperties}>
      <div className="architecture-report-heading"><h3>{text('过程证据与调整建议', 'Process evidence and adjustment options')}</h3><span>{report.title}</span><div className="architecture-font-controls"><button type="button" aria-label={text('缩小分析文字', 'Smaller analysis text')} disabled={font <= 8} onClick={() => setFont(old => Math.max(8, old - 1))}>A−</button><button type="button" aria-label={text('放大分析文字', 'Larger analysis text')} disabled={font >= 28} onClick={() => setFont(old => Math.min(28, old + 1))}>A+</button><button type="button" onClick={() => setFont(13)}>{text('重置字号', 'Reset text')}</button></div></div>
      <p className="architecture-scope">{text('任务范围', 'Task scope')}: <code>{report.taskId}</code> · {text('成员', 'Member')}: <code>{report.member}</code> · <time>{report.analyzedAt}</time></p>
      <dl className="architecture-categories">{CATEGORIES.map(category => <div key={category} data-state={report.categories[category]}><dt>{CATEGORY_LABELS[category][index]}</dt><dd>{STATE_LABELS[report.categories[category]][index]} · {COVERAGE_LABELS[report.coverage[category === 'context_bloat' ? 'context' : category === 'tool_conflict' ? 'tools' : 'handoffs']][index]}</dd></div>)}</dl>
      <p className="architecture-scope">{text('已检查原生记录', 'Native records inspected')} {report.coverage.nativeEvents} / {report.coverage.nativeEventTotal ?? '—'} · {text('HTTP/WS 捕获', 'HTTP/WS captures')} {report.coverage.captures} · {text('逻辑调用', 'Logical calls')} {report.coverage.logicalCalls} · {text('省略', 'Omitted')} {report.coverage.omitted}</p>
      <details className="architecture-limits"><summary>{text('覆盖、限制与本次阈值', 'Coverage, limitations and thresholds used')}</summary>{report.coverage.reasons.length > 0 && <ul>{report.coverage.reasons.map((reason, i) => <li key={i}><code>{reason}</code></li>)}</ul>}{report.limitations.length > 0 && <ul>{report.limitations.map((item, i) => <li key={i}>{item[locale]}</li>)}</ul>}<dl className="architecture-metrics">{(Object.keys(THRESHOLD_LABELS) as Array<keyof ArchitectureThresholds>).map(name => <div key={name}><dt>{THRESHOLD_LABELS[name][index]}</dt><dd>{report.thresholds[name]}</dd></div>)}</dl><p>{text('一次观察只能提出有条件的调整建议；用相同任务和固定验收复测。', 'One observation supports conditional changes only; rerun the same task and fixed acceptance checks.')}</p></details>
      {report.findings.length === 0 && <p>{text('当前范围没有可支持的结论。证据不足不代表问题不存在。', 'No supported findings in this scope. Insufficient evidence does not establish absence.')}</p>}
      <ol className="architecture-findings" start={pageIndex * PAGE_SIZE + 1}>{report.findings.slice(pageIndex * PAGE_SIZE, (pageIndex + 1) * PAGE_SIZE).map(finding => <li className="architecture-finding" key={finding.id} data-finding={finding.id}>
        <details className="architecture-finding-disclosure"><summary><span>{finding.title[locale]}</span> <span className="architecture-confidence">{finding.confidence === 'observed' ? text('观察事实', 'Observed') : text('启发式判断', 'Heuristic')}</span></summary><p>{finding.explanation[locale]}</p>
        <dl className="architecture-metrics">{finding.metrics.map(metric => <div key={metric.key}><dt>{metric.label[locale]}</dt><dd>{metric.value === null ? '—' : metric.value.toLocaleString(undefined, { maximumFractionDigits: 3 })} {metric.unit}</dd></div>)}</dl>
        <details className="architecture-evidence"><summary>{text('查看原始证据', 'Inspect original evidence')} · {Math.min(8, finding.evidenceIds.length)}</summary><ul>{finding.evidenceIds.slice(0, 8).map(id => { const ref = report.evidence.find(item => item.id === id); if (!ref) return <li key={id}>{text('证据引用不可用', 'Evidence reference unavailable')}: <code>{id}</code></li>; const href = sourceLink(ref); return <li key={id}><div className="architecture-evidence-heading"><strong>{ref.source === 'native_event' ? text('原生事件', 'Native event') : ref.source === 'http_capture' ? text('HTTP 捕获', 'HTTP capture') : text('Codex 逻辑调用', 'Codex logical call')}{ref.captureId !== null && ` #${ref.captureId}`}{ref.callSequence !== null && ` · ${text('调用', 'call')} ${ref.callSequence}`}</strong>{onLocate && (ref.source === 'native_event' || ref.captureId !== null) && <button type="button" className="btn" onClick={() => onLocate(ref)}>{ref.source === 'native_event' ? text('定位此记录', 'Locate this record') : text('打开此捕获', 'Open this capture')}</button>}{href && <a href={href} target={ref.source === 'native_event' ? undefined : '_blank'} rel={ref.source === 'native_event' ? undefined : 'noreferrer'}>{ref.source === 'codex_call' ? text('打开此调用的原始证据', 'Open this call’s original evidence') : text('打开原始证据', 'Open original evidence')}</a>}</div><code>{ref.path}</code>{ref.excerpt !== null && <pre>{ref.excerpt}</pre>}</li>; })}</ul></details>
        <div className="architecture-recommendation"><strong>{ACTION_LABELS[finding.recommendation.action][index]}</strong><p>{finding.recommendation.reason[locale]}</p><dl><dt>{text('适用条件', 'Conditions')}</dt><dd>{finding.recommendation.conditions[locale]}</dd><dt>{text('如何复测', 'Verification')}</dt><dd>{finding.recommendation.verification[locale]}</dd></dl></div></details>
      </li>)}</ol>
      {report.findings.length > PAGE_SIZE && <nav className="architecture-pager" aria-label={text('分析结果分页', 'Diagnosis pages')}><button type="button" className="btn" disabled={pageIndex === 0} onClick={() => setPage(pageIndex - 1)}>{text('上一页发现', 'Previous findings')}</button><span>{pageIndex * PAGE_SIZE + 1}–{Math.min((pageIndex + 1) * PAGE_SIZE, report.findings.length)} / {report.findings.length}</span><button type="button" className="btn" disabled={(pageIndex + 1) * PAGE_SIZE >= report.findings.length} onClick={() => setPage(pageIndex + 1)}>{text('下一页发现', 'Next findings')}</button></nav>}
    </div>}
  </section>;
}

/** The experiment report never promotes driver declarations into verified facts. */
export function RealTaskDiagnosisEntry({ locale, invalidateKey = 0 }: { locale: Locale; invalidateKey?: string | number }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return <section className="architecture-real-entry"><button type="button" className="btn" aria-expanded={open} onClick={() => setOpen(old => !old)}>{locale === 'zh' ? '分析真实任务 telemetry' : 'Analyze real task telemetry'}</button>{open && <RealTaskDiagnosisSelector locale={locale} invalidateKey={invalidateKey}/>}</section>;
}
function RealTaskDiagnosisSelector({ locale, invalidateKey }: { locale: Locale; invalidateKey: string | number }): React.JSX.Element {
  const zh = locale === 'zh', text = (cn: string, en: string) => zh ? cn : en;
  const [offset, setOffset] = useState(0), [taskId, setTaskId] = useState(''), [manualId, setManualId] = useState('');
  const list = useExplicitRead<Awaited<ReturnType<typeof taskApi.list>>>('real-task-list', 5000);
  const load = (next: number) => { setOffset(next); list.start(signal => taskApi.list({ origin: 'collected', limit: 100, offset: next, range: 'all' }, signal)); };
  useEffect(() => { load(0); }, []);
  return <div className="architecture-real-selector"><p>{text('选择实际监听到的任务。导入实验报告中的文本、Token 和原生定位不会自动成为已验证证据；以下分析单独读取真实来源。', 'Select an actually collected task. Imported experiment text, token counts and native locators do not automatically become verified evidence; this analysis reads real sources separately.')}</p>
    {list.loading && <p role="status">{text('正在读取任务元数据…', 'Reading task metadata…')} <button type="button" className="btn" onClick={list.cancel}>{text('取消任务读取', 'Cancel task read')}</button></p>}{list.error && <p role="alert">{readError(list.error, locale)}</p>}
    <div className="architecture-real-controls"><label>{text('真实任务', 'Collected task')}<select value={taskId} onChange={event => setTaskId(event.target.value)}><option value="">{text('选择任务…', 'Select a task…')}</option>{taskId && !list.value?.items.some(task => task.id === taskId) && <option value={taskId}>{taskId}</option>}{list.value?.items.map(task => <option value={task.id} key={task.id}>{task.title || task.provider} · {task.memberCount} {text('成员', 'members')}</option>)}</select></label><button type="button" className="btn" disabled={list.loading} onClick={() => load(offset)}>{text('刷新任务列表', 'Refresh task list')}</button><button type="button" className="btn" disabled={list.loading || offset === 0} onClick={() => load(Math.max(0, offset - 100))}>{text('上一页任务', 'Previous tasks')}</button><span>{list.value ? `${list.value.offset + (list.value.items.length ? 1 : 0)}–${list.value.offset + list.value.items.length} / ${list.value.total}` : '—'}</span><button type="button" className="btn" disabled={list.loading || !list.value?.hasMore} onClick={() => load(offset + 100)}>{text('下一页任务', 'Next tasks')}</button></div>
    {list.value?.items.length === 0 && <p>{text('当前没有可选的已采集任务；可以填写已知任务 ID。', 'No collected tasks on this page. You can enter a known task ID.')}</p>}
    <details><summary>{text('手动指定任务 ID', 'Enter a task ID')}</summary><form onSubmit={event => { event.preventDefault(); if (manualId.trim()) setTaskId(manualId.trim()); }}><label>{text('本地任务 ID', 'Local task ID')}<input maxLength={2048} value={manualId} onChange={event => setManualId(event.target.value)} placeholder="collected:…"/></label><button type="submit" className="btn" disabled={!manualId.trim()}>{text('使用此任务', 'Use this task')}</button></form></details>
    {taskId && <ArchitectureDiagnosisPanel taskId={taskId} member="all" locale={locale} invalidateKey={invalidateKey}/>}</div>;
}
