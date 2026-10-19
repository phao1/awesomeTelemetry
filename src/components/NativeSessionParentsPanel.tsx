import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import type { NativeSessionParentPage } from '../core/trace-types.js';
import { useVirtualList } from '../hooks/useVirtualList.js';
import type { Locale } from '../i18n.js';

const copy = {
  en: { title: 'Native parent references', hint: 'A declared parent/fork reference is not proof of spawning, communication, retry or billing identity. Team topology remains independent.', refresh: 'Refresh parent references', next: 'Next references', retry: 'Retry', loading: 'Loading parent references', timeout: 'The local read exceeded 5 seconds. Retry only this metadata read.', stale: 'Parent evidence changed. Refresh explicitly before using old conclusions.', empty: 'No retained parent declaration. This does not classify the session as root.', incomplete: 'Incomplete evidence', resolved: 'Resolved reference', unresolved: 'Unresolved reference', ambiguous: 'Ambiguous owners', unknown: 'Incomplete reference', candidates: 'Candidate owners', truncated: 'More owners exist; this candidate list is truncated.', open: 'Open resolved parent', namespace: 'Namespace', value: 'Native parent ID', scope: 'Owner native session', source: 'Source locator' },
  zh: { title: '原生父级引用', hint: '声明的父级/分叉引用不证明运行时派生、通信、重试或计费身份；Team 拓扑保持独立。', refresh: '刷新父级引用', next: '下一页引用', retry: '重试', loading: '正在读取父级引用', timeout: '本地读取超过 5 秒，可仅重试这次元数据读取。', stale: '父级依据已变化，请显式刷新后再使用结论。', empty: '没有保留的父级声明，不代表此会话就是根节点。', incomplete: '依据不完整', resolved: '已解析引用', unresolved: '未解析引用', ambiguous: '多个候选会话', unknown: '引用依据不完整', candidates: '候选会话', truncated: '仍有更多会话，此候选列表已截断。', open: '打开已解析父级会话', namespace: '命名空间', value: '原生父级 ID', scope: '当前原生会话', source: '来源定位' },
} as const;
type Item = NativeSessionParentPage['items'][number];
type Labels = { [Key in keyof typeof copy.en]: string };
interface Props { sessionKey: string; locale: Locale; onOpenSession?: (key: string) => void; invalidateKey?: number }
function stateLabel(state: Item['state'], labels: Labels): string { return state === 'incomplete' ? labels.unknown : labels[state]; }

function References({ items, labels, onSelect, selectedId }: { items: Item[]; labels: Labels; onSelect: (id: string) => void; selectedId: string | null }): React.JSX.Element {
  const { containerRef, range, onScroll } = useVirtualList(items.length, 72, 4, 288);
  return <div ref={containerRef} onScroll={onScroll} tabIndex={0} aria-label={labels.title} style={{ height: Math.min(288, items.length * 72), overflow: 'auto' }}>
    <div style={{ height: range.totalHeight }}><div style={{ transform: `translateY(${range.offsetY}px)` }}>
      {items.slice(range.startIndex, range.endIndex).map(item => <button className="btn mono" type="button" key={item.identity.id}
        data-native-parent-reference={item.identity.id} aria-expanded={selectedId === item.identity.id} onClick={() => onSelect(item.identity.id)}
        style={{ display: 'block', height: 72, width: '100%', textAlign: 'left', overflow: 'hidden' }} title={`${item.identity.namespace} · ${item.identity.value}\n${item.identity.scope ?? '—'}\n${item.identity.sourcePath}`}>
        <div style={{ whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{stateLabel(item.state, labels)} · {item.identity.namespace} · {item.identity.value}</div>
        <div style={{ whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{labels.scope}: {item.identity.scope ?? '—'}</div>
        <div style={{ whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{item.identity.sourcePath}</div>
      </button>)}
    </div></div>
  </div>;
}
function Candidates({ item, labels, onOpenSession }: { item: Item; labels: Labels; onOpenSession?: (key: string) => void }): React.JSX.Element {
  const { containerRef, range, onScroll } = useVirtualList(item.matches.length, 56, 3, 224);
  return <>
    <h4>{labels.candidates} · {item.matches.length}</h4>
    {item.matchesTruncated && <p role="status">{labels.truncated}</p>}
    <div ref={containerRef} onScroll={onScroll} tabIndex={0} aria-label={labels.candidates} style={{ height: Math.min(224, item.matches.length * 56), overflow: 'auto' }}>
      <div style={{ height: range.totalHeight }}><div style={{ transform: `translateY(${range.offsetY}px)` }}>
        {item.matches.slice(range.startIndex, range.endIndex).map(match => <div className="mono" key={match.id} style={{ height: 56, overflow: 'hidden' }} title={`${match.title}\n${match.id}\n${match.provider} · ${match.startedAt ?? '—'}`}>
          <div style={{ whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{match.sourceAgent} · {match.title}</div>
          <div style={{ whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{match.id} · {match.startedAt ?? '—'}</div>
        </div>)}
      </div></div>
    </div>
    {item.state === 'resolved' && !item.matchesTruncated && item.matches.length === 1 && onOpenSession !== undefined && <button className="btn" type="button" onClick={() => onOpenSession(item.matches[0]!.id)}>{labels.open}</button>}
  </>;
}

/** This panel is mounted only after the parent view's explicit expansion. */
export function NativeSessionParentsPanel(props: Props): React.JSX.Element { return <ParentReferences key={props.sessionKey} {...props} />; }
function ParentReferences({ sessionKey, locale, onOpenSession, invalidateKey = 0 }: Props): React.JSX.Element {
  const labels = copy[locale];
  const [page, setPage] = useState<NativeSessionParentPage | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | undefined>();
  const [loadedVersion, setLoadedVersion] = useState(invalidateKey);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const version = useRef(invalidateKey); version.current = invalidateKey;
  const generation = useRef(0), controller = useRef<AbortController | null>(null), timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = useCallback(() => {
    generation.current += 1; controller.current?.abort(); controller.current = null;
    if (timer.current !== null) clearTimeout(timer.current); timer.current = null;
  }, []);
  const load = useCallback(async (nextCursor?: string): Promise<void> => {
    cancel(); const token = generation.current, atVersion = version.current;
    const owned = new AbortController(); controller.current = owned;
    setBusy(true); setError(null); setPage(null); setSelectedId(null); setCursor(nextCursor);
    timer.current = setTimeout(() => { if (generation.current === token) { cancel(); setBusy(false); setError('PARENT_TIMEOUT'); } }, 5000);
    try {
      const value = await api.nativeSessionParents(sessionKey, nextCursor === undefined ? {} : { cursor: nextCursor }, owned.signal);
      if (generation.current !== token || version.current !== atVersion || owned.signal.aborted) return;
      if (value.sessionKey !== sessionKey) throw new Error('Unexpected parent evidence owner');
      setPage(value); setLoadedVersion(atVersion);
    } catch (cause: unknown) {
      if (generation.current === token && !owned.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
    } finally { if (generation.current === token) { cancel(); setBusy(false); } }
  }, [sessionKey, cancel]);
  useEffect(() => { cancel(); setBusy(false); setSelectedId(null); setError(null); }, [invalidateKey, cancel]);
  useEffect(() => { void load(); return cancel; }, [load, cancel]);
  const stale = loadedVersion !== invalidateKey;
  const shown = stale ? null : page;
  const selected = shown?.items.find(item => item.identity.id === selectedId);
  return <section aria-label={labels.title}>
    <h3>{labels.title}</h3><p className="hint">{labels.hint}</p>
    <button className="btn" type="button" disabled={busy} onClick={() => void load()}>{labels.refresh}</button>
    {stale && <p role="status">{labels.stale}</p>}
    {busy && <p role="status" aria-live="polite">{labels.loading}</p>}
    {error !== null && <div role="alert"><span className="mono">PARENT_READ_FAILED</span><p>{error === 'PARENT_TIMEOUT' ? labels.timeout : error}</p>
      <button className="btn" type="button" onClick={() => void load(cursor)}>{labels.retry}</button></div>}
    {shown !== null && <>
      {!shown.completeness.complete && <p role="status">{labels.incomplete}: {shown.completeness.reasons.join(', ')}</p>}
      {shown.items.length === 0 ? <p>{labels.empty}</p> : <References key={cursor ?? ''} items={shown.items} labels={labels} selectedId={selectedId} onSelect={id => setSelectedId(previous => previous === id ? null : id)} />}
      {shown.hasMore && shown.nextCursor !== null && <button className="btn" type="button" onClick={() => void load(shown.nextCursor!)}>{labels.next}</button>}
      {selected !== undefined && <section aria-label={labels.source}>
        <h4>{stateLabel(selected.state, labels)}</h4>
        <dl style={{ overflowWrap: 'anywhere' }}><dt>{labels.namespace}</dt><dd className="mono">{selected.identity.namespace}</dd>
          <dt>{labels.value}</dt><dd className="mono">{selected.identity.value}</dd><dt>{labels.scope}</dt><dd className="mono">{selected.identity.scope ?? '—'}</dd>
          <dt>{labels.source}</dt><dd className="mono">{selected.identity.sourcePath}</dd></dl>
        <Candidates key={selected.identity.id} item={selected} labels={labels} onOpenSession={onOpenSession} />
      </section>}
    </>}
  </section>;
}
