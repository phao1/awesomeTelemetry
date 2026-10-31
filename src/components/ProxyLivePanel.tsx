import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
const CodexCallsPanel = lazy(() => import('./CodexCallsPanel.js').then(module => ({ default: module.CodexCallsPanel })));

import type { Locale } from '../i18n.js';
import { api } from '../api/client.js';

export interface LiveStreamEntry {
  requestId: string;
  hostname: string;
  startedAt: string;
  ended: boolean;
}

const COPY = {
  en: {
    title: 'Selected live preview', empty: 'No recent live streams. Identity-encoded SSE and native WS connections announce a live preview.',
    choose: 'Select an active stream to subscribe; no bodies are loaded until selection.', close: 'Close preview',
    scope: 'Ephemeral text only: earlier fragments from before selection or reconnect may be missing. This is not a complete response, durable history or Agent success. Inspect retained originals/final analysis for evidence.',
    connecting: 'Connecting…', waiting: 'Waiting for fragments…', live: 'Receiving live fragments', draining: 'Metadata reports an end; waiting up to 5 seconds for this connection’s final fragments.', ended: 'Ended — preview retained; completion does not prove protocol or Agent success.',
    disconnected: 'Disconnected. EventSource is reconnecting automatically; a gap may remain and missed fragments are not replayed.',
    gap: 'A connection gap occurred. The displayed fragments may omit an unknown interval, even after reconnection.',
    invalid: 'Invalid preview frame ignored; completeness is unknown.', unavailable: 'Live preview is unavailable. Check browser support or the local connection, then retry.',
    evicted: 'The selected stream is no longer in the recent list; subscription closed and partial preview retained.',
    limit: 'Truncated: the 64 KiB UTF-8 display prefix is full; later fragments are not retained here. Originals are independent.',
    retry: 'Retry preview connection', active: 'active', done: 'ended',
  },
  zh: {
    title: '选中流实时预览', empty: '暂无近期实时流；identity 编码的 SSE 流和原生 WS 连接会通知实时预览入口。',
    choose: '选择进行中的流后才订阅；选择前不加载正文。', close: '关闭预览',
    scope: '仅临时文本：选择之前或重连期间的片段可能缺失。这不是完整响应、持久历史或 Agent 成功证明；证据请查看保留原文和最终分析。',
    connecting: '正在连接…', waiting: '等待片段…', live: '正在接收实时片段', draining: '元数据已报告结束，最多等待 5 秒以接收本连接的最后片段。', ended: '已结束 — 保留当前预览；结束不证明协议或 Agent 成功。',
    disconnected: '连接已断开，EventSource 正自动重连；可能留下未知缺口，丢失片段不会重放。',
    gap: '发生过连接缺口；即使重连成功，显示的片段仍可能遗漏未知区间。',
    invalid: '已忽略无效预览帧；完整性未知。', unavailable: '实时预览不可用，请检查浏览器支持或本地连接，然后重试。',
    evicted: '选中流已不在近期列表，订阅已关闭，保留部分预览。',
    limit: '已截断：64 KiB UTF-8 显示前缀已满，后续片段不会保留在此处；原文采集独立。',
    retry: '重试预览连接', active: '进行中', done: '已结束',
  },
} as const;

interface Preview { text: string; bytes: number; limited: boolean }
const PREVIEW_BYTES = 65_536;
function appendPreview(previous: Preview, chunk: string): Preview {
  if (previous.limited || chunk.length === 0) return previous;
  let bytes = previous.bytes;
  let chars = 0;
  for (const character of chunk) {
    const point = character.codePointAt(0)!;
    const width = point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    if (bytes + width > PREVIEW_BYTES) break;
    bytes += width;
    chars += character.length;
  }
  return { text: previous.text + chunk.slice(0, chars), bytes, limited: chars < chunk.length };
}

function PreviewConnection({ requestId, ended, available, locale, onSourceChange }: {
  requestId: string; ended: boolean; available: boolean; locale: Locale; onSourceChange: () => void;
}) {
  const copy = COPY[locale];
  const [preview, setPreview] = useState<Preview>({ text: '', bytes: 0, limited: false });
  const [phase, setPhase] = useState<'connecting' | 'waiting' | 'live' | 'draining' | 'disconnected' | 'ended'>('connecting');
  const [issue, setIssue] = useState<'invalid' | 'unavailable' | null>(null);
  const [gap, setGap] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const terminal = useRef(false);
  const [initiallyEnded] = useState(ended);
  const owned = useRef<{ close: () => void; drain: () => void } | null>(null);

  useEffect(() => {
    if (initiallyEnded || !available) { terminal.current = true; setPhase('ended'); return; }
    if (terminal.current) return;
    let source: EventSource;
    setPhase('connecting'); setIssue(null);
    try { source = new EventSource('/api/events?requestId=' + encodeURIComponent(requestId)); }
    catch { setIssue('unavailable'); return; }
    let current = true;
    let closed = false;
    let drainTimer: ReturnType<typeof setTimeout> | null = null;
    const close = (): void => {
      current = false;
      if (drainTimer !== null) { clearTimeout(drainTimer); drainTimer = null; }
      if (!closed) { closed = true; source.close(); }
    };
    const connection = { close, drain: (): void => {
      if (!current || drainTimer !== null) return;
      setPhase('draining');
      drainTimer = setTimeout(() => {
        if (!current) return;
        terminal.current = true; setGap(true); setPhase('ended'); onSourceChange(); close();
      }, 5000);
    } };
    owned.current = connection;
    source.onopen = () => { if (current) { setPhase(drainTimer === null ? 'waiting' : 'draining'); onSourceChange(); } };
    source.onerror = () => { if (current) { setPhase('disconnected'); setGap(true); } };
    const read = (event: MessageEvent): Record<string, unknown> | null => {
      let value: unknown;
      try { value = JSON.parse(event.data as string) as unknown; }
      catch { setIssue('invalid'); return null; }
      if (value === null || typeof value !== 'object' || Array.isArray(value)) { setIssue('invalid'); return null; }
      return value as Record<string, unknown>;
    };
    source.addEventListener('proxy_stream_chunk', event => {
      if (!current) return;
      const value = read(event as MessageEvent);
      if (value === null) return;
      if (typeof value.requestId !== 'string') { setIssue('invalid'); return; }
      if (value.requestId !== requestId) return;
      if (typeof value.chunk !== 'string') { setIssue('invalid'); return; }
      const chunk = value.chunk;
      setPreview(previous => appendPreview(previous, chunk));
      setPhase(drainTimer === null ? 'live' : 'draining');
    });
    source.addEventListener('proxy_sources_changed', event => {
      if (!current) return;
      const value = read(event as MessageEvent);
      if (value === null) return;
      if (!Array.isArray(value.requestIds) || value.requestIds.length > 64 || value.requestIds.some(id => typeof id !== 'string')) { setIssue('invalid'); return; }
      if (value.requestIds.includes(requestId)) onSourceChange();
    });
    source.addEventListener('proxy_stream_ended', event => {
      if (!current) return;
      const value = read(event as MessageEvent);
      if (value === null) return;
      if (typeof value.requestId !== 'string') { setIssue('invalid'); return; }
      if (value.requestId !== requestId) return;
      terminal.current = true;
      setPhase('ended'); onSourceChange(); close();
    });
    // Closing this connection never clears its already-observed preview.
    return () => { close(); if (owned.current === connection) owned.current = null; };
  }, [requestId, initiallyEnded, available, attempt, onSourceChange]);
  useEffect(() => {
    // Metadata and selected text arrive over separate HTTP connections. Only
    // the selected connection's ordered end proves its final chunk was drained.
    if (!ended || terminal.current) return;
    if (owned.current !== null) owned.current.drain();
    else { terminal.current = true; setPhase('ended'); }
  }, [ended]);

  return (
    <div>
      <p className="hint">{copy.scope}</p>
      <p role="status">{!available ? copy.evicted : copy[phase]}</p>
      {phase === 'disconnected' && <p role="alert">{copy.disconnected}</p>}
      {issue !== null && <p role="alert">{copy[issue]}</p>}
      {gap && <p className="hint">{copy.gap}</p>}
      {preview.limited && <p role="status">{copy.limit}</p>}
      {issue === 'unavailable' && !ended && available && <button type="button" className="btn" onClick={() => { setGap(true); setAttempt(value => value + 1); }}>{copy.retry}</button>}
      <pre className="mono" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 320, overflow: 'auto' }}>{preview.text}</pre>
    </div>
  );
}

export function ProxyLivePanel({ streams, locale, onOpenSession, invalidateKey = 0 }: { streams: LiveStreamEntry[]; locale: Locale; onOpenSession?: (key: string) => void; invalidateKey?: number }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [inspect, setInspect] = useState(false);
  const [sourceRevision, setSourceRevision] = useState(0);
  const sourceChanged = useCallback(() => setSourceRevision(value => value + 1), []);
  const [inventory, setInventory] = useState<LiveStreamEntry[]>([]), [refresh, setRefresh] = useState(0), [inventoryError, setInventoryError] = useState(false);
  useEffect(() => {
    const controller = new AbortController(); let current = true;
    const deadline = setTimeout(() => controller.abort(), 5000);
    void Promise.resolve().then(() => api.codexLiveSources(controller.signal)).then(value => {
      if (current) { setInventory(value.items.slice(0, 64)); setInventoryError(false); }
    }).catch(() => { if (current) setInventoryError(true); }).finally(() => clearTimeout(deadline));
    return () => { current = false; clearTimeout(deadline); controller.abort(); };
  }, [refresh]);
  const entries = [...new Map([...inventory, ...streams].map(entry => [entry.requestId, entry])).values()];
  const selected = entries.find(entry => entry.requestId === selectedId);
  const copy = COPY[locale];
  return (
    <section aria-label={copy.title}>
      <h3>{copy.title}</h3>
      <button className="btn" type="button" onClick={() => setRefresh(value => value + 1)}>{locale === 'zh' ? '刷新进行中连接' : 'Refresh active connections'}</button>
      {inventoryError && <p className="hint">{locale === 'zh' ? '进行中连接读取失败；实时通知仍保留，可显式重试。' : 'Active inventory unavailable; live notifications are retained. Refresh explicitly to retry.'}</p>}
      {entries.length === 0 && <p>{copy.empty}</p>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1)' }}>
        {entries.slice(0, 64).map(entry => <button type="button" className="btn" key={entry.requestId} data-stream-id={entry.requestId}
          aria-pressed={entry.requestId === selectedId} disabled={entry.ended} title={entry.startedAt}
          onClick={() => { setSelectedId(entry.requestId); setInspect(false); }}>{entry.hostname} · {entry.requestId} · {entry.ended ? copy.done : copy.active}</button>)}
      </div>
      {selectedId === null ? (entries.length > 0 && <p className="hint">{copy.choose}</p>) : <>
        <button type="button" className="btn" onClick={() => setSelectedId(null)}>{copy.close}</button>
        <PreviewConnection key={selectedId} requestId={selectedId} ended={selected?.ended ?? false} available={selected !== undefined} locale={locale} onSourceChange={sourceChanged} />
        {selectedId.startsWith('ws-') && <button className="btn" type="button" onClick={() => setInspect(value => !value)}>{locale === 'zh' ? 'Codex 调用链路' : 'Codex call chain'}</button>}
        {inspect && selectedId.startsWith('ws-') && <Suspense fallback={<p role="status">Loading…</p>}>
          <CodexCallsPanel key={selectedId} source={{ requestId: selectedId }} locale={locale} onOpenSession={onOpenSession} invalidateKey={invalidateKey} changeKey={sourceRevision} />
        </Suspense>}
      </>}
    </section>
  );
}
