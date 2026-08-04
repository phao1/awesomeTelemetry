import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';

import type { Locale } from '../i18n.js';
import { t } from '../i18n.js';
import type {
  TraceEvent,
  TraceEventRaw,
  TraceEventSlim,
} from '../core/trace-types.js';
import { api } from '../api/client.js';
import { eventDetailCache } from '../cache/caches.js';
import { ErrorState, Skeleton } from './ui/States.js';
import { Tabs } from './ui/Tabs.js';
import { Drawer } from './ui/Modal.js';

export interface EventInspectorProps {
  sessionKey: string;
  event: TraceEventSlim | null;
  locale: Locale;
  fontPx: number;
  width: number;
  collapsed: boolean;
  onResize: (width: number) => void;
  onToggleCollapse: () => void;
  loadDetail?: (key: string, eventId: string) => Promise<TraceEvent | TraceEventRaw>;
  loadRaw?: (key: string, eventId: string) => Promise<TraceEventRaw>;
  onOpenTranscript: (event: TraceEventSlim) => void;
  onOpenTokens: (event: TraceEventSlim) => void;
  onClose: () => void;
  /** ui-design-v2 §3.5：上一步 / 下一步顺序浏览。 */
  onNavigate?: (direction: -1 | 1) => void;
  canNavigate?: { prev: boolean; next: boolean };
}

type InspectorTab = 'summary' | 'input' | 'output' | 'raw' | 'tokens';
const TEXT_TABS: InspectorTab[] = ['input', 'output', 'raw'];

/** ui-design-v2 §3.5：详情面板 —— 复制落实、上/下步、全屏抽屉、面板内局部搜索。 */
export function EventInspector({
  sessionKey,
  event,
  locale,
  fontPx,
  width,
  collapsed,
  onResize,
  onToggleCollapse,
  loadDetail = (key, eventId) => api.eventDetail(key, eventId),
  loadRaw = (key, eventId) => api.eventDetail(key, eventId, true) as Promise<TraceEventRaw>,
  onOpenTranscript,
  onOpenTokens,
  onClose,
  onNavigate,
  canNavigate = { prev: false, next: false },
}: EventInspectorProps): React.JSX.Element {
  const [detail, setDetail] = useState<TraceEvent | TraceEventRaw | null>(null);
  const [raw, setRaw] = useState<string | null>(null);
  const [rawLoading, setRawLoading] = useState(false);
  const [tab, setTab] = useState<InspectorTab>('summary');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [diffOnly, setDiffOnly] = useState(false);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const currentTabText = (): string => {
    if (event === null || detail === null) {
      return '';
    }
    if (tab === 'input') {
      return detail.inputSummary ?? '';
    }
    if (tab === 'output') {
      return detail.outputSummary ?? '';
    }
    if (tab === 'raw') {
      return raw ?? '';
    }
    if (tab === 'tokens') {
      return event.tokens === null ? '' : JSON.stringify(event.tokens, null, 2);
    }
    return event.error ?? event.title;
  };

  const matchCount = useMemo(() => {
    const query = findQuery.trim().toLowerCase();
    if (query === '') {
      return 0;
    }
    const text = currentTabText().toLowerCase();
    let count = 0;
    let cursor = 0;
    while (true) {
      const at = text.indexOf(query, cursor);
      if (at < 0) {
        break;
      }
      count += 1;
      cursor = at + query.length;
      if (count > 500) {
        break;
      }
    }
    return count;
  }, [findQuery, tab, detail, raw, event]);

  useEffect(() => {
    if (event === null) {
      setDetail(null);
      setRaw(null);
      setTab('summary');
      setError(null);
      return;
    }
    const cached = eventDetailCache.get(`${sessionKey}:${event.id}`);
    if (cached !== undefined) {
      setDetail(cached);
      setError(null);
      return;
    }
    const timer = setTimeout(() => {
      void loadDetail(sessionKey, event.id)
        .then((loaded) => {
          eventDetailCache.set(`${sessionKey}:${event.id}`, loaded);
          setDetail(loaded);
          setError(null);
        })
        .catch((err: unknown) => {
          console.error('[inspector] 事件正文加载失败:', err);
          setError(err instanceof Error ? err.message : String(err));
        });
    }, 200);
    return () => clearTimeout(timer);
  }, [sessionKey, event, loadDetail]);

  // REQ-017 ⑤：Raw 页签切到才请求（include=raw）
  useEffect(() => {
    if (tab !== 'raw' || event === null || raw !== null || rawLoading) {
      return;
    }
    setRawLoading(true);
    void loadRaw(sessionKey, event.id)
      .then((loaded) => {
        setRaw(loaded.raw);
        setRawLoading(false);
      })
      .catch((err: unknown) => {
        console.error('[inspector] raw 拉取失败:', err);
        setRawLoading(false);
        setError(err instanceof Error ? err.message : String(err));
      });
  }, [tab, raw, rawLoading, sessionKey, event, loadRaw]);

  const onMouseDown = (e: ReactMouseEvent<HTMLElement>): void => {
    if (collapsed) {
      return;
    }
    dragRef.current = { startX: e.clientX, startWidth: width };
    const onMove = (ev: globalThis.MouseEvent): void => {
      if (dragRef.current !== null) {
        onResize(
          Math.max(280, Math.min(900, dragRef.current.startWidth + (dragRef.current.startX - ev.clientX))),
        );
      }
    };
    const onUp = (): void => {
      dragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  if (event === null) {
    return (
      <aside className="inspector" style={{ width: collapsed ? 0 : width }}>
        <div className="drag-handle" onMouseDown={onMouseDown} />
        <p className="hint">{t('common.empty', locale)}</p>
      </aside>
    );
  }

  const tabs: Array<{ id: InspectorTab; label: string }> = [
    { id: 'summary', label: 'Summary' },
    { id: 'input', label: t('event.input', locale) },
    { id: 'output', label: t('event.output', locale) },
    { id: 'raw', label: t('event.raw', locale) },
    { id: 'tokens', label: t('event.tokens', locale) },
  ];

  const retry = (): void => {
    setError(null);
    setDetail(null);
    void loadDetail(sessionKey, event.id)
      .then((loaded) => {
        eventDetailCache.set(`${sessionKey}:${event.id}`, loaded);
        setDetail(loaded);
      })
      .catch((err: unknown) => {
        console.error('[inspector] 重试失败:', err);
        setError(err instanceof Error ? err.message : String(err));
      });
  };

  const copyTab = (): void => {
    void navigator.clipboard
      .writeText(currentTabText())
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      })
      .catch((err: unknown) => {
        console.error('[inspector] 复制失败:', err);
      });
  };

  const highlight = (text: string): React.JSX.Element => {
    const query = findQuery.trim().toLowerCase();
    if (query === '') {
      return <>{text}</>;
    }
    const lower = text.toLowerCase();
    const parts: Array<React.JSX.Element> = [];
    let cursor = 0;
    let count = 0;
    while (true) {
      const at = lower.indexOf(query, cursor);
      if (at < 0) {
        break;
      }
      if (at > cursor) {
        parts.push(<span key={`t${cursor}`}>{text.slice(cursor, at)}</span>);
      }
      parts.push(<mark key={`m${at}`}>{text.slice(at, at + query.length)}</mark>);
      cursor = at + query.length;
      count += 1;
      if (count > 500) {
        break;
      }
    }
    if (cursor < text.length) {
      parts.push(<span key={`t${cursor}`}>{text.slice(cursor)}</span>);
    }
    return <>{parts}</>;
  };

  /** §3.5：diff 视图「仅看变更行」—— 只保留 +/- 变更行，去掉 +++/--- 头。 */
  const diffOnlyLines = (text: string): string =>
    text
      .split('\n')
      .filter((line) => /^[+-][^+-]/.test(line))
      .join('\n');

  const renderBody = (): React.JSX.Element => (
    <div className="inspector-body" style={{ fontSize: fontPx }}>
      <h4 className="inspector-title">{event.title}</h4>
      <p className="meta">
        {event.kind} · {event.phase} · {event.status} · {event.durationMs}ms
      </p>
      {error !== null && <ErrorState code="EVENT_DETAIL_FAILED" message={error} onRetry={retry} />}
      {error === null && detail === null && <Skeleton variant="block" count={2} />}
      {error === null && detail !== null && (
        <>
          {tab === 'summary' && (
            <div>
              <p>{event.actor} · {event.tool ?? '—'}</p>
              {event.error !== null && (
                <section>
                  <h5>{t('event.error', locale)}</h5>
                  <pre className="mono">{highlight(event.error)}</pre>
                </section>
              )}
              <div className="inspector-actions">
                <button type="button" className="btn" onClick={() => onOpenTranscript(event)}>
                  {t('transcript.title', locale)}
                </button>
                <button type="button" className="btn" onClick={() => onOpenTokens(event)}>
                  {t('token.title', locale)}
                </button>
              </div>
            </div>
          )}
          {tab === 'input' &&
            (detail.inputSummary === null ? (
              <p className="hint">{t('common.empty', locale)}</p>
            ) : diffOnly && !diffOnlyLines(detail.inputSummary).trim() ? (
              <p className="hint">{t('inspector.noDiffLines', locale)}</p>
            ) : (
              <pre>{highlight(diffOnly ? diffOnlyLines(detail.inputSummary) : detail.inputSummary)}</pre>
            ))}
          {tab === 'output' &&
            (detail.outputSummary === null ? (
              <p className="hint">{t('common.empty', locale)}</p>
            ) : diffOnly && !diffOnlyLines(detail.outputSummary).trim() ? (
              <p className="hint">{t('inspector.noDiffLines', locale)}</p>
            ) : (
              <pre>{highlight(diffOnly ? diffOnlyLines(detail.outputSummary) : detail.outputSummary)}</pre>
            ))}
          {tab === 'raw' &&
            (rawLoading ? (
              <Skeleton variant="block" count={1} />
            ) : raw === null ? (
              <p className="hint">{t('common.empty', locale)}</p>
            ) : (
              <pre className="mono">{highlight(raw)}</pre>
            ))}
          {tab === 'tokens' &&
            (event.tokens === null ? (
              <p className="hint">{t('common.empty', locale)}</p>
            ) : (
              <table className="ui-table ui-table-compact">
                <tbody>
                  {(['input', 'output', 'reasoning', 'cacheRead', 'cacheWrite', 'total'] as const).map((key) => (
                    <tr key={key}>
                      <td>{key}</td>
                      <td className="mono">{event.tokens![key]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ))}
        </>
      )}
    </div>
  );

  const showFind = TEXT_TABS.includes(tab);
  const showDiffToggle = tab === 'input' || tab === 'output';
  const inspectorContent = (
    <>
      <div className="inspector-tabs">
        <Tabs
          variant="underline"
          activeId={tab}
          onChange={(id) => setTab(id as InspectorTab)}
          items={tabs}
        />
      </div>
      {(showFind || showDiffToggle) && (
        <div className="inspector-find">
          {showDiffToggle && (
            <button
              type="button"
              className={`timeline-chip ${diffOnly ? 'timeline-chip-on' : ''}`}
              aria-pressed={diffOnly}
              onClick={() => setDiffOnly((prev) => !prev)}
            >
              {t('inspector.diffOnly', locale)}
            </button>
          )}
          {showFind && (
            <>
              <input
                type="search"
                className="inspector-find-input"
                placeholder={t('inspector.find', locale)}
                value={findQuery}
                onChange={(e) => setFindQuery(e.target.value)}
                aria-label={t('inspector.find', locale)}
              />
              <span className="mono inspector-find-count">
                {findQuery.trim() === ''
                  ? ''
                  : matchCount > 0
                    ? t('inspector.matches', locale).replace('{n}', String(matchCount))
                    : t('inspector.noMatches', locale)}
              </span>
            </>
          )}
        </div>
      )}
      {renderBody()}
    </>
  );

  return (
    <>
      <aside className="inspector" style={{ width: collapsed ? 0 : width }}>
        <div className="drag-handle" onMouseDown={onMouseDown} />
        <header className="inspector-header">
          <span className="mono">#{event.sequence}</span>
          <span style={{ display: 'inline-flex', gap: 'var(--space-1)' }}>
            {onNavigate !== undefined && (
              <>
                <button
                  type="button"
                  className="ui-icon-btn ui-btn-sm"
                  aria-label="previous event"
                  disabled={!canNavigate.prev}
                  onClick={() => onNavigate(-1)}
                >
                  ←
                </button>
                <button
                  type="button"
                  className="ui-icon-btn ui-btn-sm"
                  aria-label="next event"
                  disabled={!canNavigate.next}
                  onClick={() => onNavigate(1)}
                >
                  →
                </button>
              </>
            )}
            <button
              type="button"
              className="ui-btn-sm btn"
              disabled={detail === null && raw === null}
              onClick={copyTab}
            >
              {copied ? t('event.copied', locale) : t('event.copy', locale)}
            </button>
            <button
              type="button"
              className="ui-icon-btn ui-btn-sm"
              aria-label={t('inspector.expand', locale)}
              title={t('inspector.expand', locale)}
              onClick={() => setDrawerOpen(true)}
            >
              ⤢
            </button>
            <button type="button" className="ui-icon-btn ui-btn-sm" aria-label="collapse panel" onClick={onToggleCollapse}>
              ⇥
            </button>
            <button type="button" className="ui-icon-btn ui-btn-sm" aria-label="close" onClick={onClose}>
              ×
            </button>
          </span>
        </header>
        {inspectorContent}
      </aside>
      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={`#${event.sequence} · ${event.title}`}
        className="inspector-full"
      >
        <div className="inspector-drawer">{inspectorContent}</div>
      </Drawer>
    </>
  );
}
