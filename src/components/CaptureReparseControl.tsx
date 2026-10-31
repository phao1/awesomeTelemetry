import { useCallback, useId, useLayoutEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client.js';
import type { CaptureReparseResponse, CaptureReparseStatus } from '../core/trace-types.js';
import type { Locale } from '../i18n.js';

export interface CaptureReparseControlProps {
  id: number;
  requestId: string;
  locale: Locale;
  blocked: boolean;
  invalidateKey: number;
  onBegin: () => void;
  onParsed: (response: CaptureReparseResponse) => void;
}

const COPY = {
  en: { title: 'Offline reparse', refresh: 'Refresh reparse status', action: 'Reparse retained originals', cancel: 'Stop waiting',
    scope: 'Explicit local reparse only: verifies both retained originals and updates a small versioned summary. No model/tool request, new capture or charge; no preview fallback.',
    blocked: 'Body availability is blocked or unknown. Old status/results are hidden; no reparse is allowed.',
    metadataHint: 'Current means matching versions and source-reference metadata, not a fresh file integrity check or Agent/protocol success. Only an explicit reparse revalidates files.',
    waiting: 'Waiting for local evidence…', uncertain: 'Stopped waiting; this is not guaranteed rollback. The server may still finish an accepted reparse. Refresh status explicitly before another action; old body results are not restored.',
    cancelled: 'Waiting cancelled. Refresh status explicitly; no late result will be applied.', stale: 'Evidence changed. Old status/results are hidden; refresh explicitly. No automatic reparse occurred.',
    failed: 'Local evidence read failed. Refresh status explicitly; reparse is never retried automatically.', timeout: 'Local request exceeded 10 seconds. Refresh status explicitly.',
    received: 'Reparse result received. Protocol state is shown independently; this is not proof of Agent success.',
    states: { not_parsed: 'Not reparsed', current: 'Current metadata', stale: 'Stale metadata', unavailable: 'Unavailable' },
    currentVersions: 'Current parser / capture-metric versions', storedVersions: 'Stored parser / capture-metric versions', parsedAt: 'Last parsed at', fingerprint: 'Source fingerprint',
    format: 'Recorded request format', protocol: 'Recorded protocol state', completeness: 'Projection completeness', complete: 'Complete', partial: 'Incomplete', usage: 'Native usage (unknown is not zero)',
  },
  zh: { title: '离线重解析', refresh: '刷新重解析状态', action: '重新解析已保留原文', cancel: '停止等待',
    scope: '仅显式本地重解析：校验两份已保留原文并更新小型版本摘要；不调用模型或工具，不新增抓包或费用，不回退到预览。',
    blocked: '正文可用性被阻断或未知。旧状态及结果已隐藏，不能重解析。',
    metadataHint: '当前仅表示版本与原文引用元数据匹配，不代表重新校验文件完整性，也不代表 Agent 或协议成功；只有显式重解析才重新验证文件。',
    waiting: '正在等待本地证据…', uncertain: '已停止等待，但不保证服务端回滚。已接受的重解析可能继续完成；请显式刷新状态后再操作，旧正文结果不会恢复。',
    cancelled: '已取消等待，请显式刷新状态；迟到结果不会被应用。', stale: '证据已更新。旧状态及结果已隐藏，请显式刷新；没有自动重解析。',
    failed: '本地证据读取失败，请显式刷新状态；不会自动重试重解析。', timeout: '本地读取超过 10 秒，请显式刷新状态。',
    received: '已收到重解析结果。协议状态独立展示，不证明 Agent 成功。',
    states: { not_parsed: '尚未重解析', current: '元数据当前有效', stale: '元数据已过时', unavailable: '不可用' },
    currentVersions: '当前解析器 / 抓包指标版本', storedVersions: '已保存解析器 / 抓包指标版本', parsedAt: '最近解析时间', fingerprint: '来源指纹',
    format: '已记录请求格式', protocol: '已记录协议状态', completeness: '投影完整性', complete: '完整', partial: '不完整', usage: '原生 usage（未知不等于零）',
  },
};
type Value = Record<string, unknown>;
const record = (value: unknown): Value | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Value : null;
const integer = (value: unknown, minimum = 0): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
const nullableString = (value: unknown): boolean => value === null || typeof value === 'string';
const nullableIndex = (value: unknown): boolean => value === null || integer(value);
const keys = (value: Value, expected: readonly string[]): boolean => Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
const formats = ['openai_chat', 'openai_responses', 'anthropic_messages', 'unknown'];
const states = ['completed', 'incomplete', 'failed', 'unknown'];
const COUNTERS = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens', 'nativeTotalTokens', 'totalTokens'] as const;
const SOURCE_REASONS = new Set([
  'originals_deleted', 'originals_missing', 'originals_incomplete', 'originals_invalid', 'original_deleted',
  'source_too_large', 'decoded_too_large', 'capture_incomplete', 'source_unavailable', 'source_integrity_failed',
  'invalid_utf8', 'unsupported_content_encoding', 'decode_failed',
]);
function validUsage(value: unknown, snapshots: boolean): boolean {
  const item = record(value);
  if (item === null || !keys(item, [...COUNTERS, 'accounting', ...(snapshots ? ['snapshots'] : [])]) ||
    !COUNTERS.every(key => nullableIndex(item[key])) || !['openai_subsets', 'anthropic_additive_input', 'unknown'].includes(String(item.accounting))) return false;
  return !snapshots || Array.isArray(item.snapshots) && item.snapshots.length <= 32 && item.snapshots.every(value => {
    const entry = record(value); return entry !== null && nullableIndex(entry.eventIndex) && typeof entry.value === 'string';
  });
}
function validCompleteness(value: unknown): boolean {
  const item = record(value);
  return item !== null && keys(item, ['complete', 'omittedCount', 'reasons']) && typeof item.complete === 'boolean' && integer(item.omittedCount) &&
    Array.isArray(item.reasons) && item.reasons.length <= 32 && item.reasons.every(reason => typeof reason === 'string' && reason.length <= 128);
}
function bounded(value: unknown, maximum: number): boolean { return new TextEncoder().encode(JSON.stringify(value)).length <= maximum; }
function utcTimestamp(value: unknown): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 19) === value.slice(0, 19);
}
function validStatus(value: unknown, id: number, requestId: string): value is CaptureReparseStatus {
  const item = record(value);
  if (item === null || !keys(item, ['proxyId', 'requestId', 'currentParserVersion', 'currentMetricVersion', 'state', 'unavailableReason', 'snapshot']) ||
    item.proxyId !== id || !integer(item.proxyId, 1) || item.requestId !== requestId || typeof item.requestId !== 'string' || item.requestId.length < 1 || item.requestId.length > 1024 ||
    !integer(item.currentParserVersion, 1) || !integer(item.currentMetricVersion, 1) || !bounded(value, 16384)) return false;
  if (item.state === 'unavailable') return item.snapshot === null && ['originals_deleted', 'originals_missing', 'originals_incomplete', 'originals_invalid'].includes(String(item.unavailableReason));
  if (item.unavailableReason !== null) return false;
  if (item.state === 'not_parsed') return item.snapshot === null;
  if (item.state !== 'current' && item.state !== 'stale') return false;
  const snapshot = record(item.snapshot);
  if (snapshot === null || !keys(snapshot, ['parserVersion', 'metricVersion', 'sourceFingerprint', 'parsedAt', 'requestFormat', 'state', 'usage', 'completeness']) ||
    !integer(snapshot.parserVersion, 1) || !integer(snapshot.metricVersion, 1) || typeof snapshot.sourceFingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(snapshot.sourceFingerprint) ||
    !utcTimestamp(snapshot.parsedAt) ||
    !formats.includes(String(snapshot.requestFormat)) || !states.includes(String(snapshot.state)) || !validUsage(snapshot.usage, false) || !validCompleteness(snapshot.completeness) || !bounded(snapshot, 8192)) return false;
  return item.state !== 'current' || snapshot.parserVersion === item.currentParserVersion && snapshot.metricVersion === item.currentMetricVersion;
}
function validResponse(value: unknown, id: number, requestId: string): value is CaptureReparseResponse {
  const item = record(value);
  if (item === null || !validStatus(item.status, id, requestId) || item.status.state !== 'current' || item.status.snapshot === null || !bounded(value, 1024 * 1024)) return false;
  const analysis = record(item.analysis), snapshot = item.status.snapshot;
  if (analysis === null || analysis.parserVersion !== snapshot.parserVersion || analysis.requestFormat !== snapshot.requestFormat || analysis.state !== snapshot.state ||
    !nullableString(analysis.model) || !nullableString(analysis.responseId) || !nullableString(analysis.stopReason) || !nullableString(analysis.system) ||
    !integer(analysis.unknownEvents) || !validUsage(analysis.usage, true) || !validCompleteness(analysis.completeness) ||
    !Array.isArray(analysis.items) || !Array.isArray(analysis.declarations) || !Array.isArray(analysis.errors) || analysis.items.length + analysis.declarations.length + analysis.errors.length > 1024) return false;
  if (!analysis.items.every(value => { const entry = record(value); return entry !== null && ['request', 'response'].includes(String(entry.phase)) &&
    ['text', 'reasoning', 'tool_call', 'tool_result'].includes(String(entry.kind)) && nullableString(entry.id) && nullableString(entry.callId) && nullableString(entry.name) &&
    nullableIndex(entry.index) && nullableIndex(entry.choiceIndex) && typeof entry.content === 'string' && (entry.toolResultIsError === null || typeof entry.toolResultIsError === 'boolean') &&
    typeof entry.complete === 'boolean' && typeof entry.sourcePath === 'string'; }) ||
    !analysis.declarations.every(value => { const entry = record(value); return entry !== null && nullableString(entry.name) && typeof entry.type === 'string' && typeof entry.definition === 'string' && typeof entry.sourcePath === 'string'; }) ||
    !analysis.errors.every(value => { const entry = record(value); return entry !== null && nullableString(entry.code) && typeof entry.message === 'string' && typeof entry.sourcePath === 'string'; })) return false;
  const usage = record(analysis.usage)!;
  const completeness = record(analysis.completeness)!;
  return [...COUNTERS, 'accounting'].every(key => usage[key] === snapshot.usage[key as keyof typeof snapshot.usage]) &&
    completeness.complete === snapshot.completeness.complete && completeness.omittedCount === snapshot.completeness.omittedCount && JSON.stringify(completeness.reasons) === JSON.stringify(snapshot.completeness.reasons);
}

/** A selected request owns all waiting; callbacks never participate in fetch effects. */
export function CaptureReparseControl(props: CaptureReparseControlProps): React.JSX.Element {
  return <Reparse key={`${props.id}:${props.requestId}`} {...props} />;
}
function Reparse({ id, requestId, locale, blocked, invalidateKey, onBegin, onParsed }: CaptureReparseControlProps): React.JSX.Element {
  const copy = COPY[locale], panelId = useId();
  const [expanded, setExpanded] = useState(false), [pending, setPending] = useState<'status' | 'post' | null>(null);
  const [loaded, setLoaded] = useState<{ version: number; status: CaptureReparseStatus } | null>(null);
  const [error, setError] = useState<string | null>(null), [received, setReceived] = useState(false), [stale, setStale] = useState(false);
  const [uncertain, setUncertain] = useState(false), [cancelled, setCancelled] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null), generation = useRef(0), version = useRef(invalidateKey);
  const callbacks = useRef({ onBegin, onParsed });
  const operation = useRef<{ kind: 'status' | 'post'; controller: AbortController; timer: ReturnType<typeof setTimeout> } | null>(null);
  useLayoutEffect(() => { callbacks.current = { onBegin, onParsed }; }, [onBegin, onParsed]);
  const stop = useCallback((): void => {
    generation.current += 1;
    if (operation.current !== null) { operation.current.controller.abort(); clearTimeout(operation.current.timer); operation.current = null; }
  }, []);
  useLayoutEffect(() => () => stop(), [stop]);
  useLayoutEffect(() => {
    const changed = version.current !== invalidateKey; version.current = invalidateKey;
    if (!blocked && !changed) return;
    if (operation.current?.kind === 'post') setUncertain(true);
    stop(); setPending(null); setLoaded(null); setReceived(false); setError(null);
    if (changed) setStale(true);
  }, [blocked, invalidateKey, stop]);
  const shown = !blocked && loaded?.version === invalidateKey ? loaded.status : null;
  const load = async (kind: 'status' | 'post'): Promise<void> => {
    if (blocked || operation.current !== null || kind === 'post' && (shown === null || shown.state === 'unavailable' || stale)) return;
    stop(); const token = generation.current, controller = new AbortController();
    const timer = setTimeout(() => {
      if (generation.current !== token) return;
      stop(); setPending(null); setLoaded(null); setReceived(false); setError('REPARSE_TIMEOUT');
      if (kind === 'post') setUncertain(true);
    }, 10000);
    operation.current = { kind, controller, timer };
    setPending(kind); setLoaded(null); setReceived(false); setError(null); setCancelled(false);
    const current = (): boolean => generation.current === token && !controller.signal.aborted;
    try {
      if (kind === 'status') {
        const value = await api.captureReparseStatus(id, controller.signal);
        if (!current()) return;
        if (!validStatus(value, id, requestId)) throw new ApiError('INVALID_REPARSE_RESPONSE', 'Invalid reparse metadata');
        setLoaded({ version: invalidateKey, status: value }); setStale(false); setUncertain(false);
      } else {
        callbacks.current.onBegin();
        const value = await api.reparseCapture(id, requestId, controller.signal);
        if (!current()) return;
        if (!validResponse(value, id, requestId)) throw new ApiError('INVALID_REPARSE_RESPONSE', 'Invalid reparse result');
        callbacks.current.onParsed(value);
        if (current()) { setLoaded({ version: invalidateKey, status: value.status }); setStale(false); setUncertain(false); setReceived(true); }
      }
    } catch (cause: unknown) {
      if (current()) {
        const knownError = cause instanceof ApiError && /^[A-Z][A-Z0-9_]{0,63}$/.test(cause.code);
        const reason = knownError ? cause.details?.reason : undefined;
        const code = knownError ? cause.code : 'REPARSE_UNAVAILABLE';
        setError(typeof reason === 'string' && SOURCE_REASONS.has(reason) ? `${code} · ${reason}` : code);
        if (kind === 'post') setUncertain(true);
      }
    } finally { if (current()) { stop(); setPending(null); } }
  };
  const cancel = (collapse: boolean): void => {
    if (operation.current?.kind === 'post') setUncertain(true);
    stop(); setPending(null); setLoaded(null); setReceived(false); setError(null); setCancelled(true);
    if (collapse) { setExpanded(false); trigger.current?.focus(); }
  };
  const snapshot = shown?.snapshot;
  return <section aria-label={copy.title} onKeyDown={event => { if (expanded && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(true); } }}>
    <button ref={trigger} className="btn" type="button" disabled={blocked} aria-expanded={expanded} aria-controls={panelId}
      onClick={() => { if (expanded) cancel(true); else { setExpanded(true); void load('status'); } }}>{copy.title}</button>
    <p className="hint">{copy.scope}</p>
    {blocked && <p role="status">{copy.blocked}</p>}
    {uncertain && <p role="status" data-reparse-uncertain>{copy.uncertain}</p>}
    {!uncertain && cancelled && <p role="status">{copy.cancelled}</p>}
    {expanded && !blocked && <div id={panelId} aria-busy={pending !== null}>
      <p className="hint">{copy.metadataHint}</p>
      <button className="btn" type="button" disabled={pending !== null} onClick={() => void load('status')}>{copy.refresh}</button>
      <button className="btn" type="button" disabled={pending !== null || shown === null || shown.state === 'unavailable' || stale} onClick={() => void load('post')}>{copy.action}</button>
      {pending !== null && <><p role="status" aria-live="polite">{copy.waiting}</p><button className="btn" type="button" onClick={() => cancel(false)}>{copy.cancel}</button></>}
      {stale && <p role="status">{copy.stale}</p>}
      {error !== null && <p role="alert">{error === 'REPARSE_TIMEOUT' ? copy.timeout : copy.failed} <code>{error}</code></p>}
      {received && <p role="status">{copy.received}</p>}
      {shown !== null && <>
        <p data-reparse-state role="status">{copy.states[shown.state]}{shown.unavailableReason !== null && <> · <code>{shown.unavailableReason}</code></>}</p>
        <dl className="meta"><div><dt>{copy.currentVersions}</dt><dd>{shown.currentParserVersion} / {shown.currentMetricVersion}</dd></div>
          {snapshot != null && <><div><dt>{copy.storedVersions}</dt><dd>{snapshot.parserVersion} / {snapshot.metricVersion}</dd></div><div><dt>{copy.parsedAt}</dt><dd><time>{snapshot.parsedAt}</time></dd></div>
            <div><dt>{copy.format}</dt><dd>{snapshot.requestFormat}</dd></div><div><dt>{copy.protocol}</dt><dd>{snapshot.state}</dd></div>
            <div><dt>{copy.completeness}</dt><dd>{snapshot.completeness.complete ? copy.complete : `${copy.partial} · ${snapshot.completeness.omittedCount}`} · {snapshot.completeness.reasons.join(', ')}</dd></div></>}
        </dl>
        {snapshot != null && <><details><summary>{copy.fingerprint}</summary><code style={{ overflowWrap: 'anywhere' }}>{snapshot.sourceFingerprint}</code></details><h4>{copy.usage}</h4>
          <dl className="meta">{COUNTERS.map(key => <div key={key} data-reparse-usage={key}><dt>{key}</dt><dd>{snapshot.usage[key] ?? '—'}</dd></div>)}<div><dt>accounting</dt><dd>{snapshot.usage.accounting}</dd></div></dl></>}
      </>}
    </div>}
  </section>;
}
