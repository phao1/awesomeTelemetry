import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client.js';
import type { CodexCallDetail, CodexCallPage } from '../core/trace-types.js';
import type { Locale } from '../i18n.js';
import { Skeleton } from './ui/States.js';
import { ProxyInsights } from './ProxyInsights.js';

const COPY = {
  zh: { title: 'Codex 逐调用链路', refresh: '刷新已落盘调用', notice: '只分析本地证据，不重放请求。预热不是生成调用；续接不是重试；增量 input 不是完整继承上下文。',
    active: '连接进行中：当前是已写入磁盘的快照；变更通知触发更新，最多每 5 秒一次。', auto: '自动更新选中连接', settling: '实时前缀正在切换为已保存归档，稍后自动补读一次。', budget: '大详情已触发 30 秒自动读取流量预算；稍后补读，仍可手动刷新。', partial: '证据不完整', empty: '尚未发现 response.create；可能尚未写入、不是 Responses 协议或未捕获模型流量。',
    unknown: '未知', warmup: '预热', call: '调用', previous: '上一页', next: '下一页', input: '本次请求（有界预览）', truncated: '预览已截断，完整内容在连接原文归档。',
    items: '输入/输出与工具', tools: '工具声明', usage: '原生 Usage', native: '原生会话', open: '打开原生轨迹', references: '工具结果引用（不是执行/成功证明）',
    reason: '完整性/关联限制', timing: '代理观测：首内容 / 调用结束', parent: '续接来源调用', more: '下一组内容', back: '上一组内容', noTiming: '不是推理或工具执行耗时', source: '响应 ID / 原生 Turn', system: '系统指令', error: '读取失败，可手动刷新重试。' },
  en: { title: 'Codex per-call chain', refresh: 'Refresh written calls', notice: 'Local evidence only, no replay. Warmup is not generation; lineage is not retry; incremental input is not full inherited context.',
    active: 'Active connection: written disk snapshot only. Change hints update at most once every 5 seconds.', auto: 'Auto-update selected connection', settling: 'The live prefix is switching to the saved archive. One automatic reread is pending.', budget: 'Large details reached the 30-second auto-read byte budget. Updates will resume; manual refresh remains available.', partial: 'Incomplete evidence', empty: 'No response.create observed: writes may be pending, or this is not captured Responses traffic.',
    unknown: 'Unknown', warmup: 'Warmup', call: 'Call', previous: 'Previous page', next: 'Next page', input: 'Sent request (bounded preview)', truncated: 'Preview truncated; full bytes remain in the connection archive.',
    items: 'Input/output and tools', tools: 'Tool declarations', usage: 'Native usage', native: 'Native session', open: 'Open native trajectory', references: 'Tool-result references (not execution/success proof)',
    reason: 'Completeness/link limits', timing: 'Proxy: first content / call end', parent: 'Previous-response call', more: 'Next content page', back: 'Previous content page', noTiming: 'Not inference or tool execution time', source: 'Response ID / native turn', system: 'System instructions', error: 'Read failed; refresh manually to retry.' },
} as const;
const PRE_STYLE = { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 480, overflow: 'auto' } as const;
interface Props {
  source: { id: number } | { requestId: string }; locale: Locale; onOpenSession?: (key: string) => void; invalidateKey?: number; changeKey?: number;
}
export function CodexCallsPanel(props: Props) {
  const key = 'id' in props.source ? 'id:' + props.source.id : 'live:' + props.source.requestId;
  return <CodexCallsContent key={key} {...props} />;
}
function CodexCallsContent({ source, locale, onOpenSession, invalidateKey = 0, changeKey = 0 }: Props) {
  const copy = COPY[locale], key = 'id' in source ? 'id:' + source.id : 'live:' + source.requestId;
  const [attempt, setAttempt] = useState(0), [offset, setOffset] = useState(0), [selected, setSelected] = useState<number | null>(null);
  const [page, setPage] = useState<CodexCallPage | null>(null), [detail, setDetail] = useState<CodexCallDetail | null>(null);
  const [pending, setPending] = useState(false), [detailPending, setDetailPending] = useState(false), [error, setError] = useState<string | null>(null), [itemPage, setItemPage] = useState(0);
  const [detailAttempt, setDetailAttempt] = useState(0), [automatic, setAutomatic] = useState(true), [dirty, setDirty] = useState(false);
  const [visible, setVisible] = useState(document.visibilityState !== 'hidden');
  const [budgetVersion, setBudgetVersion] = useState(0), [budgetHeld, setBudgetHeld] = useState(false);
  const [settlementRetry, setSettlementRetry] = useState(false), settlementUsed = useRef(false);
  const failedRead = (cause: unknown): void => {
    if (cause instanceof ApiError && cause.code === 'CAPTURE_ORIGINALS_DELETED') {
      // Preserving a reading position must never preserve revoked body data.
      selection.current = { sequence: null, detail: null }; pageRef.current = null;
      setSelected(null); setDetail(null); setPage(null); setItemPage(0); setDirty(false); setSettlementRetry(false);
    }
    // An explicit409 is a source handoff, not a model/network replay. Allow
    // exactly one serial fresh-page convergence attempt until manual reset.
    if ('requestId' in source && cause instanceof ApiError && cause.code === 'CODEX_SOURCE_CHANGED' && !settlementUsed.current) {
      settlementUsed.current = true; setSettlementRetry(true); setDirty(true); setError(null);
    } else setError(cause instanceof Error ? cause.message : String(cause));
  };
  const recentReads = useRef<Array<{ at: number; bytes: number }>>([]);
  const observeRead = (value: CodexCallPage | CodexCallDetail): void => {
    const at = Date.now();
    recentReads.current = recentReads.current.filter(read => read.at > at - 30000);
    recentReads.current.push({ at, bytes: new TextEncoder().encode(JSON.stringify(value)).length });
    // Retain conservative debt even if explicit user refreshes exceed64 reads.
    if (recentReads.current.length > 64) {
      const first = recentReads.current.shift()!; recentReads.current[0]!.bytes += first.bytes;
    }
    setBudgetVersion(version => version + 1);
  };
  const lastRead = useRef(0), manual = useRef(false), pageRef = useRef<CodexCallPage | null>(null), pageGeneration = useRef<number | null>(null);
  const selection = useRef<{ sequence: number | null; detail: CodexCallDetail | null }>({ sequence: null, detail: null });
  useEffect(() => { setDirty(true); }, [changeKey]);
  useEffect(() => {
    const changed = (): void => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', changed);
    return () => document.removeEventListener('visibilitychange', changed);
  }, []);
  useEffect(() => {
    if (!dirty || !automatic || !visible || !page?.active && !settlementRetry || pending || detailPending || error !== null) { setBudgetHeld(false); return; }
    const now = Date.now(), reads = recentReads.current.filter(read => read.at > now - 30000);
    // Reserve room for the maximum64KiB page +1MiB selected detail. Using
    // uncompressed UTF-8 bytes is conservative relative to wire compression.
    const blocked = reads.reduce((sum, read) => sum + read.bytes, 0) >= 512 * 1024;
    setBudgetHeld(blocked);
    const due = Math.max(lastRead.current + 5000, blocked ? reads[0]!.at + 30000 : now);
    const timer = setTimeout(() => {
      const debt = recentReads.current.filter(read => read.at > Date.now() - 30000).reduce((sum, read) => sum + read.bytes, 0);
      if (debt >= 512 * 1024) setBudgetVersion(version => version + 1);
      else { setDirty(false); setAttempt(value => value + 1); }
    }, Math.max(0, due - now));
    return () => clearTimeout(timer);
  }, [dirty, automatic, visible, page?.active, pending, detailPending, error, budgetVersion, settlementRetry]);
  const root = useRef<HTMLElement>(null), [inspectKey, setInspectKey] = useState<{ value: string } | null>(null);
  useEffect(() => {
    // Revoke old conclusions/callbacks, but retain the reading position. Only
    // the fresh page may authorize reloading this one selected detail.
    pageGeneration.current = null; pageRef.current = null;
    selection.current = { sequence: selection.current.sequence, detail: null };
    setPage(null); setDetail(null); setInspectKey(null);
  }, [invalidateKey]);
  useEffect(() => {
    if (inspectKey === null) return;
    const target = root.current?.querySelector<HTMLElement>('[data-codex-evidence="' + inspectKey.value + '"]');
    if (target instanceof HTMLDetailsElement) target.open = true;
    target?.focus(); target?.scrollIntoView?.({ block: 'nearest' });
  }, [inspectKey, itemPage]);
  useEffect(() => {
    const controller = new AbortController(); let current = true;
    const refreshDetail = manual.current; manual.current = false;
    pageGeneration.current = null;
    lastRead.current = Date.now(); setDirty(false); setSettlementRetry(false); setPending(true); setError(null);
    const deadline = setTimeout(() => { current = false; controller.abort(); setPending(false); setError('CODEX_INSPECTION_TIMEOUT'); }, 31000);
    void api.codexCalls(source, offset, controller.signal).then(value => {
      if (!current) return;
      observeRead(value); pageRef.current = value; pageGeneration.current = invalidateKey; setPage(value);
      const chosen = selection.current;
      const row = value.items.find(item => item.sequence === chosen.sequence);
      if (chosen.sequence !== null && (refreshDetail || chosen.detail === null || row === undefined ||
        chosen.detail.call.state === 'pending' || JSON.stringify(row ?? chosen.detail.call) !== JSON.stringify(chosen.detail.call) ||
        !value.active && chosen.detail.active)) setDetailAttempt(number => number + 1);
    })
      .catch((cause: unknown) => { if (current) failedRead(cause); })
      .finally(() => { clearTimeout(deadline); if (current) setPending(false); });
    return () => { current = false; clearTimeout(deadline); controller.abort(); };
    // The scalar key owns this read, not the parent's object identity.
  }, [key, offset, attempt, invalidateKey]);
  useEffect(() => {
    if (selected === null || pageGeneration.current !== invalidateKey) { setDetailPending(false); return; }
    const controller = new AbortController(); let current = true; setDetailPending(true); setError(null);
    const deadline = setTimeout(() => { current = false; controller.abort(); setDetailPending(false); setError('CODEX_INSPECTION_TIMEOUT'); }, 31000);
    void api.codexCall(source, selected, controller.signal).then(value => {
      if (current) {
        const currentPage = pageRef.current;
        if (value.call.sequence !== selected || !currentPage?.active && value.fingerprint !== currentPage?.fingerprint) throw new Error('CODEX_SOURCE_CHANGED');
        observeRead(value); selection.current = { sequence: selected, detail: value }; setDetail(value);
      }
    }).catch((cause: unknown) => { if (current) failedRead(cause); })
      .finally(() => { clearTimeout(deadline); if (current) setDetailPending(false); });
    return () => { current = false; clearTimeout(deadline); controller.abort(); };
  }, [key, selected, detailAttempt, invalidateKey]);
  const choose = (sequence: number): void => {
    if (sequence === selected) setDetailAttempt(value => value + 1);
    selection.current = { sequence, detail: null }; setSelected(sequence); setDetail(null); setItemPage(0);
  };
  const move = (next: number): void => { selection.current = { sequence: null, detail: null }; setSelected(null); setDetail(null); setOffset(next); };
  return <section ref={root} aria-label={copy.title}>
    <h3>{copy.title}</h3><p className="hint">{copy.notice}</p>
    <button className="btn" type="button" disabled={pending || detailPending} onClick={() => { manual.current = true; settlementUsed.current = false; setAttempt(value => value + 1); }}>{copy.refresh}</button>
    {'requestId' in source && <label><input type="checkbox" checked={automatic} onChange={event => setAutomatic(event.target.checked)} /> {copy.auto}</label>}
    {budgetHeld && <p role="status">{copy.budget}</p>}
    {settlementRetry && <p role="status">{copy.settling}</p>}
    {error !== null && <p role="alert">{copy.error} <code>{error}</code></p>}
    {pending && <Skeleton count={2} />}
    {page !== null && <>
      {page.active && <p role="status">{copy.active}</p>}
      {!page.complete && <p className="hint">{copy.partial}: {page.reasons.join(', ') || copy.unknown} · unassigned: {page.unassignedEvents}</p>}
      {page.items.length === 0 && <p>{copy.empty}</p>}
      <div style={{ overflowX: 'auto' }}><table className="ui-table ui-table-compact" style={{ minWidth: 720 }}><thead><tr><th>#</th><th>Model / lane</th><th>State</th><th>Input / output</th><th>Cache / reasoning</th><th>ms</th></tr></thead>
        <tbody>{page.items.map(call => <tr key={call.sequence}><td><button type="button" className="btn" disabled={pending || detailPending} style={{ whiteSpace: 'nowrap' }} aria-pressed={selected === call.sequence} onClick={() => choose(call.sequence)}>{call.warmup ? copy.warmup : copy.call} {call.sequence + 1}</button></td>
          <td>{call.model ?? '—'} / {call.streamId ?? 'default'}</td><td>{call.state}{call.reasons.length > 0 ? ' ⚠' : ''}</td>
          <td>{call.usage.inputTokens ?? '—'} / {call.usage.outputTokens ?? '—'}</td><td>{call.usage.cacheReadTokens ?? '—'} / {call.usage.reasoningTokens ?? '—'}</td>
          <td>{call.firstContentMs ?? '—'} / {call.durationMs ?? '—'}</td></tr>)}</tbody></table></div>
      <p>{offset + (page.items.length ? 1 : 0)}–{offset + page.items.length} / {page.total}</p>
      <button className="btn" type="button" disabled={offset === 0 || pending || detailPending} onClick={() => move(Math.max(0, offset - 20))}>{copy.previous}</button>
      <button className="btn" type="button" disabled={!page.hasMore || pending || detailPending} onClick={() => move(offset + 20)}>{copy.next}</button>
    </>}
    {detailPending && <Skeleton count={3} />}
    {detail !== null && <div>
      <h4>{detail.call.warmup ? copy.warmup : copy.call} {detail.call.sequence + 1}</h4>
      <p>{copy.source}: <code>{detail.call.responseId ?? '—'}</code> / <code>{detail.call.nativeTurnId ?? '—'}</code></p>
      <p>{copy.timing}: {detail.call.firstContentMs ?? '—'} / {detail.call.durationMs ?? '—'} ms · {copy.noTiming}</p>
      <p>{copy.parent}: {detail.call.predecessorSequence !== null ? <button className="btn" type="button" disabled={pending || detailPending} onClick={() => choose(detail.call.predecessorSequence!)}>{detail.call.predecessorSequence + 1}</button> : detail.call.previousResponseId ?? '—'}</p>
      <details><summary>{locale === 'zh' ? '上下文差异（仅本次发送载荷）' : 'Context diff (transmitted payload only)'}</summary>
        <p className="hint">{copy.notice}</p>
        {detail.contextDiff === null ? <p>{copy.unknown}: {detail.contextDiffUnavailableReason}</p> : <>
          <p>Chars: {detail.contextDiff.growth.baseChars} → {detail.contextDiff.growth.targetChars} ({detail.contextDiff.growth.deltaChars > 0 ? '+' : ''}{detail.contextDiff.growth.deltaChars}); input tokens Δ: {detail.contextDiff.growth.inputTokenDelta ?? '—'}</p>
          {detail.contextDiff.categories.map(category => <details key={category.category}><summary>{category.category}: +{category.added} / −{category.removed} / ~{category.modified}</summary>
            {category.entries.slice(0, 50).map((entry, i) => <details key={i}><summary>{entry.kind} · {entry.label}</summary><p>{entry.beforePath ?? '—'} → {entry.afterPath ?? '—'}</p><pre style={PRE_STYLE}>{JSON.stringify({ before: entry.before, after: entry.after, changedPaths: entry.changedPaths }, null, 2)}</pre></details>)}
            {category.entries.length > 50 && <p>{copy.truncated}</p>}
          </details>)}
          {!detail.contextDiff.completeness.complete && <p>{copy.partial}: {detail.contextDiff.completeness.reasons.join(', ')}</p>}
        </>}
      </details>
      <p>{copy.native}: <code>{detail.call.nativeSessionId ?? '—'}</code> · {detail.native.state}
        {detail.native.sessionKey !== null && onOpenSession !== undefined && <button className="btn" type="button" onClick={() => onOpenSession(detail.native.sessionKey!)}>{copy.open}</button>}</p>
      {detail.native.matches.map((match, i) => <p className="mono" key={i}>{match.kind}: {match.value} → {match.eventId} · {match.sourcePath}</p>)}
      {detail.call.reasons.length > 0 && <p role="status">{copy.reason}: {detail.call.reasons.join(', ')}</p>}
      <ProxyInsights analysis={detail.analysis} locale={locale} onInspect={value => { if (value.startsWith('item-')) setItemPage(Math.floor(Number(value.slice(5)) / 50)); setInspectKey({ value }); }} />
      {!detail.analysis.completeness.complete && <p role="status">{copy.partial}: {detail.analysis.completeness.reasons.join(', ')}</p>}
      <details><summary>{copy.input}</summary>{detail.requestPreviewTruncated && <p>{copy.truncated}</p>}<pre className="mono" style={PRE_STYLE}>{detail.requestPreview}</pre></details>
      {detail.analysis.system !== null && <details data-codex-evidence="system" tabIndex={-1}><summary>{copy.system}</summary><pre style={PRE_STYLE}>{detail.analysis.system}</pre></details>}
      <details><summary>{copy.tools} ({detail.analysis.declarations.length})</summary>{detail.analysis.declarations.map((tool, i) => <pre data-codex-evidence={'declaration-' + i} tabIndex={-1} style={PRE_STYLE} key={i}>{tool.definition}</pre>)}</details>
      <details data-codex-evidence="usage" tabIndex={-1}><summary>{copy.usage}</summary><pre style={PRE_STYLE}>{JSON.stringify(detail.analysis.usage, null, 2)}</pre></details>
      {detail.analysis.errors.map((value, i) => <p data-codex-evidence={'error-' + i} tabIndex={-1} role="alert" key={i}>{value.code}: {value.message}</p>)}
      {detail.toolReferences.length > 0 && <div><h4>{copy.references}</h4>{detail.toolReferences.map(ref => <p key={ref.callId}><code>{ref.callId}</code> → {ref.proposalSequence === null ? copy.unknown : <button className="btn" type="button" disabled={pending || detailPending} onClick={() => choose(ref.proposalSequence!)}>{copy.call} {ref.proposalSequence + 1}</button>}</p>)}</div>}
      <h4>{copy.items}</h4>
      {detail.analysis.items.slice(itemPage * 50, (itemPage + 1) * 50).map((item, i) => <details data-codex-evidence={'item-' + (itemPage * 50 + i)} tabIndex={-1} key={itemPage * 50 + i}><summary>{item.phase} · {item.kind} · {item.name ?? item.callId ?? item.id ?? '—'}{!item.complete && ' …'}</summary><p className="hint">{item.sourcePath}</p><pre style={PRE_STYLE}>{item.content}</pre></details>)}
      <button className="btn" type="button" disabled={itemPage === 0} onClick={() => setItemPage(value => value - 1)}>{copy.back}</button>
      <button className="btn" type="button" disabled={(itemPage + 1) * 50 >= detail.analysis.items.length} onClick={() => setItemPage(value => value + 1)}>{copy.more}</button>
    </div>}
  </section>;
}
