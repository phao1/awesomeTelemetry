import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client.js';
import { buildCaptureComparison } from '../core/capture-comparison.js';
import type { CaptureComparisonMetricRow, CaptureComparisonReason, CaptureComparisonWarningCode } from '../core/capture-comparison.js';
import type { CaptureComparisonResponse, CaptureComparisonSide, ProxyRequestListItem } from '../core/trace-types.js';
import type { Locale } from '../i18n.js';
import { Skeleton } from './ui/States.js';
import { CaptureDiagnosticsPanel } from './CaptureDiagnosticsPanel.js';

const RequestContextDiffPanel = lazy(() => import('./RequestContextDiffPanel.js').then(module => ({ default: module.RequestContextDiffPanel })));

export interface CaptureComparisonPanelProps {
  targetId: number;
  locale: Locale;
  loadedItems: ProxyRequestListItem[];
  onOpenRequest: (id: number) => void;
  invalidateKey?: number;
  metadataOnly?: boolean;
}

const COPY = {
  en: {
    title: 'Selected capture comparison', base: 'Base capture', target: 'Target capture', loaded: 'Choose a loaded capture', choose: 'Choose a base', manual: 'Or enter a capture ID',
    hint: 'Choose two captures explicitly. This is natural traffic, not a controlled experiment; task, tools, parameters and quality equivalence remain unproven.',
    compare: 'Compare selected captures', refresh: 'Refresh comparison', cancel: 'Cancel comparison', retry: 'Retry comparison',
    cancelled: 'Comparison cancelled. No model request was replayed.', loading: 'Reading selected local evidence…',
    stale: 'Evidence changed. Previous results are hidden; refresh explicitly to compare this pair again.',
    failure: 'Local comparison failed. Retry only this evidence read.', timeout: 'Comparison exceeded 10 seconds. Retry explicitly.',
    baseOpen: 'Open base capture', targetOpen: 'Open target capture', metric: 'Observed metric', delta: 'Target − base', basis: 'Basis / source',
    timing: 'Proxy timing offsets', usage: 'Native usage counters', unknown: 'Unknown / unavailable',
    cost: 'Cost is unknown; no price or billing aggregate is estimated.', metadata: 'Metadata-only comparison: body-derived analysis is excluded.',
    diff: 'Open context diff for this pair', hideDiff: 'Close context diff', diffBlocked: 'Context diff is unavailable while either original is deleted/uncertain or this is metadata-only.',
    warnings: 'Comparison boundaries and evidence warnings', generated: 'Snapshot generated', protocol: 'Protocol state', requestFormat: 'Observed request format', analysisFormat: 'Analysis format',
    model: 'Observed model', network: 'Network state', processing: 'Processing state', requestOriginal: 'Request original', responseOriginal: 'Response original',
    deletion: 'Original deletion intent', completeness: 'Analysis completeness', complete: 'Complete', incomplete: 'Incomplete', absent: 'No intent in this snapshot',
    errors: 'Projected protocol error count / codes', errorTruncated: 'Error-code list is truncated.', stopReason: 'Observed stop reason',
    notComparable: 'Difference unavailable', accounting: 'Native usage accounting', contentBasis: 'First-content basis', contentKind: 'First-content kind', timingState: 'Content timing status', clock: 'Timing clock',
    upstreamStatus: 'Observed upstream status', networkError: 'Network error', directionEnds: 'Request / response ended', processingError: 'Processing error',
  },
  zh: {
    title: '选定抓包对比', base: '基线抓包', target: '目标抓包', loaded: '选择已加载的抓包', choose: '选择基线', manual: '或输入抓包 ID',
    hint: '请明确选择两条抓包。这是自然流量对比，不是受控实验；任务、工具、参数与质量是否等价尚未验证。',
    compare: '比较选定抓包', refresh: '刷新对比', cancel: '取消对比', retry: '重试对比',
    cancelled: '已取消对比；没有重放模型请求。', loading: '正在读取选定的本地证据…',
    stale: '证据已更新。旧结果已隐藏；请显式刷新以重新比较此组合。', failure: '本地对比读取失败；重试只读取这些证据。', timeout: '对比读取超过 10 秒，请显式重试。',
    baseOpen: '打开基线抓包', targetOpen: '打开目标抓包', metric: '观测指标', delta: '目标 − 基线', basis: '口径 / 来源',
    timing: '代理时序偏移', usage: '原生 usage 计数', unknown: '未知 / 不可用', cost: '成本未知；不估算价格或合并计费。', metadata: '仅元数据对比：不包含由正文派生的分析。',
    diff: '打开此组合的上下文差异', hideDiff: '关闭上下文差异', diffBlocked: '任一正文已删除、不可确认或处于仅元数据模式时，不能读取上下文差异。',
    warnings: '对比边界与证据警告', generated: '快照生成时间', protocol: '协议状态', requestFormat: '观测请求格式', analysisFormat: '分析格式', model: '观测模型',
    network: '网络状态', processing: '解析任务状态', requestOriginal: '请求原文', responseOriginal: '响应原文', deletion: '原文删除意图', completeness: '分析完整性',
    complete: '完整', incomplete: '不完整', absent: '本快照没有删除意图', errors: '投影协议错误数量 / 代码', errorTruncated: '错误代码列表已截断。', stopReason: '观测结束原因', notComparable: '差值不可用',
    accounting: '原生 usage 计数口径', contentBasis: '首内容口径', contentKind: '首内容类别', timingState: '内容时序状态', clock: '时序时钟', upstreamStatus: '实际上游状态码', networkError: '网络错误', directionEnds: '请求 / 响应已结束', processingError: '解析任务错误',
  },
};
const METRICS = {
  en: { responseHeadersMs: 'Response headers', firstBodyByteMs: 'First response byte', firstContentMs: 'First meaningful content', completedMs: 'Network end',
    inputTokens: 'Input tokens', outputTokens: 'Output tokens', cacheReadTokens: 'Cache-read tokens', cacheWriteTokens: 'Cache-write tokens', reasoningTokens: 'Reasoning tokens', nativeTotalTokens: 'Native total tokens', totalTokens: 'Protocol total tokens' },
  zh: { responseHeadersMs: '响应头', firstBodyByteMs: '首响应字节', firstContentMs: '首有效内容', completedMs: '网络结束', inputTokens: '输入 token', outputTokens: '输出 token', cacheReadTokens: '缓存读取 token', cacheWriteTokens: '缓存写入 token', reasoningTokens: '推理 token', nativeTotalTokens: '原生总 token', totalTokens: '协议总 token' },
};
const REASONS: Record<Locale, Record<CaptureComparisonReason, string>> = {
  en: { missing_value: 'Value missing', invalid_value: 'Value invalid', clock_unavailable: 'Clock unavailable', clock_mismatch: 'Clock domains differ', incomplete_evidence: 'Evidence incomplete',
    content_not_observed: 'Meaningful content not observed', content_basis_mismatch: 'First-content bases differ', content_kind_mismatch: 'First-content kinds differ', analysis_unavailable: 'Analysis unavailable',
    accounting_unknown: 'Accounting unknown', accounting_mismatch: 'Accounting bases differ', original_deleted: 'Original deletion intent exists', protocol_not_completed: 'Protocol did not complete normally' },
  zh: { missing_value: '缺少观测值', invalid_value: '观测值无效', clock_unavailable: '缺少时钟证据', clock_mismatch: '时钟域不同', incomplete_evidence: '证据不完整',
    content_not_observed: '未观测到有效内容', content_basis_mismatch: '首内容口径不同', content_kind_mismatch: '首内容类别不同', analysis_unavailable: '分析不可用',
    accounting_unknown: '计数口径未知', accounting_mismatch: '计数口径不同', original_deleted: '存在原文删除意图', protocol_not_completed: '协议未正常完成' },
};
const WARNINGS: Record<Locale, Record<CaptureComparisonWarningCode, string>> = {
  en: { model_mismatch: 'Models differ', model_unknown: 'Model identity unknown', protocol_mismatch: 'Protocols differ', protocol_unknown: 'Protocol unknown', accounting_mismatch: 'Usage accounting differs', accounting_unknown: 'Usage accounting unknown',
    processing_mismatch: 'Processing outcomes differ', processing_unknown: 'Processing outcome unknown', processing_incomplete: 'Processing incomplete', retention_mismatch: 'Original retention differs', retention_unknown: 'Original retention unknown', retention_incomplete: 'Original retention incomplete',
    analysis_mismatch: 'Protocol outcomes differ', analysis_incomplete: 'Analysis incomplete', analysis_unavailable: 'Analysis unavailable', completeness_mismatch: 'Evidence completeness differs', measurement_mismatch: 'Measurement bases differ', timing_unavailable: 'Timing unavailable', timing_incomplete: 'Timing evidence incomplete', original_deleted: 'Original deletion intent exists',
    task_tool_parameters_quality_unproven: 'Task, tools, parameters and quality equivalence are unproven', natural_comparison_not_causal: 'Natural comparison is not causal evidence', cost_unknown: 'Cost unknown' },
  zh: { model_mismatch: '模型不同', model_unknown: '模型身份未知', protocol_mismatch: '协议不同', protocol_unknown: '协议未知', accounting_mismatch: 'usage 计数口径不同', accounting_unknown: 'usage 计数口径未知',
    processing_mismatch: '解析任务结果不同', processing_unknown: '解析任务结果未知', processing_incomplete: '解析任务不完整', retention_mismatch: '原文保留状态不同', retention_unknown: '原文保留状态未知', retention_incomplete: '原文保留不完整',
    analysis_mismatch: '协议结果不同', analysis_incomplete: '分析不完整', analysis_unavailable: '分析不可用', completeness_mismatch: '证据完整性不同', measurement_mismatch: '测量口径不同', timing_unavailable: '时序不可用', timing_incomplete: '时序证据不完整', original_deleted: '存在原文删除意图',
    task_tool_parameters_quality_unproven: '任务、工具、参数与质量是否等价尚未验证', natural_comparison_not_causal: '自然流量对比不能证明因果', cost_unknown: '成本未知' },
};
const validBase = (value: string, targetId: number): number | null => {
  if (!/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id !== targetId ? id : null;
};

/** Target or body-access mode changes unmount all old pair/body evidence immediately. */
export function CaptureComparisonPanel(props: CaptureComparisonPanelProps): React.JSX.Element {
  return <Comparison key={`${props.targetId}:${props.metadataOnly === true}`} {...props} />;
}

function Comparison({ targetId, locale, loadedItems, onOpenRequest, invalidateKey = 0, metadataOnly = false }: CaptureComparisonPanelProps): React.JSX.Element {
  const copy = COPY[locale];
  const [baseInput, setBaseInput] = useState('');
  const baseId = validBase(baseInput, targetId);
  const pair = `${targetId}:${baseId}`;
  const stamp = `${pair}:${invalidateKey}`;
  const [result, setResult] = useState<{ stamp: string; data: CaptureComparisonResponse } | null>(null);
  const [requested, setRequested] = useState<{ pair: string; version: number } | null>(null);
  const [error, setError] = useState<{ stamp: string; code: string } | null>(null);
  const [busy, setBusy] = useState(false), [cancelled, setCancelled] = useState(false), [showDiff, setShowDiff] = useState(false);
  const generation = useRef(0), controller = useRef<AbortController | null>(null), timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stop = useCallback((): void => {
    generation.current += 1; controller.current?.abort(); controller.current = null;
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  useEffect(() => { stop(); setBusy(false); setShowDiff(false); return stop; }, [stamp, stop]);
  const changeBase = (value: string): void => {
    stop(); setBusy(false); setBaseInput(value); setResult(null); setRequested(null); setError(null); setShowDiff(false); setCancelled(false);
  };
  const load = async (): Promise<void> => {
    if (baseId === null || controller.current !== null) return;
    stop(); const token = generation.current; const operation = new AbortController(); controller.current = operation;
    setRequested({ pair, version: invalidateKey }); setResult(null); setError(null); setBusy(true); setShowDiff(false); setCancelled(false);
    timer.current = setTimeout(() => {
      if (generation.current !== token) return;
      stop(); setBusy(false); setError({ stamp, code: 'COMPARISON_TIMEOUT' });
    }, 10000);
    try {
      const data = await api.captureComparison(targetId, baseId, metadataOnly, operation.signal);
      if (generation.current !== token || operation.signal.aborted) return;
      if (data.base.request.id !== baseId || data.target.request.id !== targetId ||
        [data.base, data.target].some(side => (metadataOnly || side.originalDeletion !== null) && side.analysis !== null)) {
        throw new ApiError('INVALID_COMPARISON', 'Unexpected selected comparison evidence');
      }
      setResult({ stamp, data });
    } catch (cause: unknown) {
      if (generation.current === token && !operation.signal.aborted) setError({ stamp, code: cause instanceof ApiError ? cause.code : 'COMPARISON_FAILED' });
    } finally { if (generation.current === token) { stop(); setBusy(false); } }
  };
  const stale = requested !== null && requested.pair === pair && requested.version !== invalidateKey;
  const shown = result?.stamp === stamp ? result.data : null;
  const shownError = error?.stamp === stamp ? error.code : null;
  const diffBlocked = metadataOnly || shown === null || shown.base.originalDeletion !== null || shown.target.originalDeletion !== null;
  return <section aria-label={copy.title}>
    <h3>{copy.title}</h3><p className="hint">{copy.hint}</p>
    {metadataOnly && <p role="status">{copy.metadata}</p>}
    <form onSubmit={event => { event.preventDefault(); void load(); }}>
      <label>{copy.loaded} <select value={loadedItems.some(item => item.id === baseId) ? baseInput : ''} onChange={event => changeBase(event.target.value)}>
        <option value="">{copy.choose}</option>
        {loadedItems.filter(item => item.id !== targetId).map(item => <option key={item.id} value={item.id}>#{item.id} · {item.hostname} · {item.model ?? '—'}</option>)}
      </select></label>
      <label>{copy.manual} <input type="text" inputMode="numeric" value={baseInput} onChange={event => changeBase(event.target.value)} /></label>
      <button className="btn" type="submit" disabled={baseId === null || busy}>{requested?.pair === pair ? copy.refresh : copy.compare}</button>
      {busy && <button className="btn" type="button" onClick={() => { stop(); setBusy(false); setCancelled(true); }}>{copy.cancel}</button>}
    </form>
    {busy && <div role="status" aria-live="polite">{copy.loading}<Skeleton count={2} /></div>}
    {cancelled && <p role="status">{copy.cancelled}</p>}
    {stale && <p role="status">{copy.stale}</p>}
    {shownError !== null && <div role="alert"><p>{shownError === 'COMPARISON_TIMEOUT' ? copy.timeout : copy.failure} <code>{shownError}</code></p>
      <button className="btn" type="button" disabled={baseId === null || busy} onClick={() => void load()}>{copy.retry}</button></div>}
    {shown !== null && <div data-comparison-result>
      <p className="hint">{copy.generated}: <time>{shown.generatedAt}</time></p>
      <Side side={shown.base} locale={locale} label={copy.base} openLabel={copy.baseOpen} onOpen={onOpenRequest} />
      <Side side={shown.target} locale={locale} label={copy.target} openLabel={copy.targetOpen} onOpen={onOpenRequest} />
      <ComparisonMetrics data={shown} locale={locale} />
      <CaptureDiagnosticsPanel data={shown} locale={locale} onOpenRequest={onOpenRequest} />
      <button className="btn" type="button" disabled={diffBlocked} onClick={() => setShowDiff(value => !value)}>{showDiff && !diffBlocked ? copy.hideDiff : copy.diff}</button>
      {diffBlocked && <p className="hint">{copy.diffBlocked}</p>}
      {showDiff && !diffBlocked && <Suspense fallback={<Skeleton count={2} />}><RequestContextDiffPanel key={pair}
        targetId={targetId} initialBaseId={shown.base.request.id} targetFormat={shown.target.request.requestFormat} locale={locale} loadedItems={loadedItems}
        onOpenRequest={onOpenRequest} invalidateKey={invalidateKey} /></Suspense>}
    </div>}
  </section>;
}

function Side({ side, locale, label, openLabel, onOpen }: { side: CaptureComparisonSide; locale: Locale; label: string; openLabel: string; onOpen: (id: number) => void }): React.JSX.Element {
  const copy = COPY[locale];
  const rows = [
    [copy.model, side.request.model], [copy.requestFormat, side.request.requestFormat], [copy.analysisFormat, side.analysis?.requestFormat],
    [copy.network, side.evidence.transport?.state], [copy.processing, side.evidence.processing?.status], [copy.protocol, side.analysis?.state ?? side.analysisUnavailableReason],
    [copy.upstreamStatus, side.evidence.transport?.statusCode == null ? null : String(side.evidence.transport.statusCode)],
    [copy.networkError, side.evidence.transport?.error], [copy.processingError, side.evidence.processing?.error],
    [copy.directionEnds, side.evidence.transport === undefined ? null : `${side.evidence.transport.requestEnded} / ${side.evidence.transport.responseEnded}`],
    [copy.requestOriginal, side.evidence.request?.status], [copy.responseOriginal, side.evidence.response?.status], [copy.stopReason, side.analysis?.stopReason],
    [copy.accounting, side.analysis?.usage.accounting], [copy.clock, side.evidence.transport?.timing?.clock],
    [copy.contentBasis, side.evidence.transport?.timing?.firstContentBasis], [copy.contentKind, side.evidence.transport?.timing?.firstContentKind], [copy.timingState, side.evidence.transport?.timing?.contentTimingStatus],
    [copy.deletion, side.originalDeletion?.state ?? copy.absent], [copy.completeness, side.analysis === null ? null : side.analysis.completeness.complete ? copy.complete : copy.incomplete],
    [copy.errors, side.analysis === null ? null : `${side.analysis.errorCount} · ${side.analysis.errorCodes.map(code => code ?? '—').join(', ')}`],
  ];
  return <section aria-label={label}><h4>{label} #{side.request.id}</h4>
    <button className="btn" type="button" onClick={() => onOpen(side.request.id)}>{openLabel} #{side.request.id}</button>
    <p className="mono" style={{ overflowWrap: 'anywhere' }}>{side.request.requestId} · {side.request.startedAt} · {side.request.url}</p>
    <dl className="meta">{rows.map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value ?? '—'}</dd></div>)}</dl>
    {side.analysis?.errorCodesTruncated && <p role="status">{copy.errorTruncated}</p>}
  </section>;
}

function ComparisonMetrics({ data, locale }: { data: CaptureComparisonResponse; locale: Locale }): React.JSX.Element {
  const copy = COPY[locale], view = buildCaptureComparison(data);
  const labels: Record<string, string> = METRICS[locale];
  const value = (number: number | null, unit: string, signed = false): string => number === null ? '—' : `${signed && number > 0 ? '+' : ''}${number} ${unit}`;
  const table = (title: string, rows: CaptureComparisonMetricRow[]) => <section aria-label={title}><h4>{title}</h4><div style={{ overflowX: 'auto' }}><table className="ui-table ui-table-compact" style={{ minWidth: 460, width: '100%', tableLayout: 'fixed' }}>
    <colgroup><col style={{ width: '24%' }} /><col style={{ width: '16%' }} /><col style={{ width: '16%' }} /><col style={{ width: '16%' }} /><col style={{ width: '28%' }} /></colgroup>
    <thead><tr><th scope="col">{copy.metric}</th><th scope="col">{copy.base}</th><th scope="col">{copy.target}</th><th scope="col">{copy.delta}</th><th scope="col">{copy.basis}</th></tr></thead>
    <tbody>{rows.map(row => <tr key={row.id} data-comparison-metric={row.id}><th scope="row">{labels[row.id] ?? row.id}</th><td>{value(row.base, row.unit)}</td><td>{value(row.target, row.unit)}</td><td>{value(row.delta, row.unit, true)}</td>
      <td style={{ overflowWrap: 'anywhere' }}>{!row.comparable && <p>{copy.notComparable}: {row.reasons.map(reason => REASONS[locale][reason]).join(' · ')}</p>}<details><summary>{copy.basis}</summary><code>{row.baseSource}</code><br /><code>{row.targetSource}</code></details></td></tr>)}</tbody>
  </table></div></section>;
  return <>{table(copy.timing, view.timings)}{table(copy.usage, view.usage)}<p>{copy.cost}</p>
    <h4>{copy.warnings}</h4><ul>{view.warnings.map((warning, index) => <li key={`${warning.code}:${index}`}>{WARNINGS[locale][warning.code]}
      {warning.sides.length > 0 && <> · {warning.sides.map(side => side === 'base' ? copy.base : copy.target).join(' / ')}</>}
      {warning.details.length > 0 && <span className="mono" style={{ overflowWrap: 'anywhere' }}> · {warning.details.join(' · ')}</span>}</li>)}</ul>
  </>;
}
