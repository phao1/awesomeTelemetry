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
import {
  HighlightedJson,
  countMatches,
  highlightMatches,
  looksLikeJson,
  redactSecrets,
  useDesensitizationEnabled,
} from './inspector-text.js';

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
  /** REQ-114：默认页签（compare Timeline 面板用 summary）。 */
  initialTab?: InspectorTab;
  /** REQ-114：可见页签白名单（compare Timeline 面板只保留 Summary + Raw）。 */
  visibleTabs?: InspectorTab[];
  /** REQ-114：填充父容器（宽度交给 CSS 的 --inspector-width，不用内联 px）。 */
  fillParent?: boolean;
}

export type InspectorTab = 'summary' | 'input' | 'output' | 'raw' | 'tokens';
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
  initialTab = 'summary',
  visibleTabs,
  fillParent = false,
}: EventInspectorProps): React.JSX.Element {
  const [detail, setDetail] = useState<TraceEvent | TraceEventRaw | null>(null);
  const [raw, setRaw] = useState<string | null>(null);
  const [rawLoading, setRawLoading] = useState(false);
  const [tab, setTab] = useState<InspectorTab>(initialTab);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [diffOnly, setDiffOnly] = useState(false);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const desensitize = useDesensitizationEnabled();

  const currentTabText = (): string => {
    if (event === null || detail === null) {
      return '';
    }
    const rawText = ((): string => {
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
    })();
    return desensitize ? redactSecrets(rawText) : rawText;
  };

  const matchCount = useMemo(
    () => countMatches(currentTabText(), findQuery),
    [findQuery, tab, detail, raw, event, desensitize],
  );

  useEffect(() => {
    if (event === null) {
      setDetail(null);
      setRaw(null);
      setTab(initialTab);
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

  const asideClass = fillParent ? 'inspector inspector-fill' : 'inspector';
  const asideStyle = fillParent ? undefined : { width: collapsed ? 0 : width };

  if (event === null) {
    // 未选中事件时不占版面：此前它恒定占住约 26% 的横向空间只为显示「暂无数据」，
    // 而那部分宽度正是时间线最需要的。选中事件后面板自然出现。
    if (!fillParent) {
      return <aside className="inspector inspector-empty" aria-hidden="true" />;
    }
    return (
      <aside className={asideClass}>
        <p className="hint">{t('inspector.selectPrompt', locale)}</p>
      </aside>
    );
  }

  const tabs: Array<{ id: InspectorTab; label: string }> = (
    [
      { id: 'summary', label: 'Summary' },
      { id: 'input', label: t('event.input', locale) },
      { id: 'output', label: t('event.output', locale) },
      { id: 'raw', label: t('event.raw', locale) },
      { id: 'tokens', label: t('event.tokens', locale) },
    ] as Array<{ id: InspectorTab; label: string }>
  ).filter((entry) => visibleTabs === undefined || visibleTabs.includes(entry.id));

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

  const highlight = (text: string): React.JSX.Element => highlightMatches(text, findQuery);

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
          {tab === 'input' && (() => {
            const source = detail.inputSummary;
            if (source === null) {
              return <p className="hint">{t('common.empty', locale)}</p>;
            }
            const body = desensitize ? redactSecrets(source) : source;
            const text = diffOnly ? diffOnlyLines(body) : body;
            if (diffOnly && !diffOnlyLines(body).trim()) {
              return <p className="hint">{t('inspector.noDiffLines', locale)}</p>;
            }
            return (
              <pre>
                {findQuery.trim() === '' && looksLikeJson(text)
                  ? <HighlightedJson text={text} truncatedLabel={t('inspector.jsonTruncated', locale).replace('{n}', '64,000')} />
                  : highlight(text)}
              </pre>
            );
          })()}
          {tab === 'output' && (() => {
            const source = detail.outputSummary;
            if (source === null) {
              return <p className="hint">{t('common.empty', locale)}</p>;
            }
            const body = desensitize ? redactSecrets(source) : source;
            const text = diffOnly ? diffOnlyLines(body) : body;
            if (diffOnly && !diffOnlyLines(body).trim()) {
              return <p className="hint">{t('inspector.noDiffLines', locale)}</p>;
            }
            return (
              <pre>
                {findQuery.trim() === '' && looksLikeJson(text)
                  ? <HighlightedJson text={text} truncatedLabel={t('inspector.jsonTruncated', locale).replace('{n}', '64,000')} />
                  : highlight(text)}
              </pre>
            );
          })()}
          {tab === 'raw' &&
            (rawLoading ? (
              <Skeleton variant="block" count={1} />
            ) : raw === null ? (
              <p className="hint">{t('common.empty', locale)}</p>
            ) : (
              <pre className="mono">
                {findQuery.trim() === '' && looksLikeJson(raw)
                  ? <HighlightedJson text={desensitize ? redactSecrets(raw) : raw} truncatedLabel={t('inspector.jsonTruncated', locale).replace('{n}', '64,000')} />
                  : highlight(desensitize ? redactSecrets(raw) : raw)}
              </pre>
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
      <aside className={asideClass} style={asideStyle}>
        {!fillParent && <div className="drag-handle" onMouseDown={onMouseDown} />}
        <header className="inspector-header">
          <span className="mono">#{event.sequence}</span>
          <span style={{ display: 'inline-flex', gap: 'var(--space-1)' }}>
            {onNavigate !== undefined && (
              <>
                <button
                  type="button"
                  className="ui-icon-btn ui-btn-sm"
                  aria-label={t('a11y.prevEvent', locale)}
                  disabled={!canNavigate.prev}
                  onClick={() => onNavigate(-1)}
                >
                  ←
                </button>
                <button
                  type="button"
                  className="ui-icon-btn ui-btn-sm"
                  aria-label={t('a11y.nextEvent', locale)}
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
            <button type="button" className="ui-icon-btn ui-btn-sm" aria-label={t('a11y.collapsePanel', locale)} onClick={onToggleCollapse}>
              ⇥
            </button>
            <button type="button" className="ui-icon-btn ui-btn-sm" aria-label={t('a11y.close', locale)} onClick={onClose}>
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
