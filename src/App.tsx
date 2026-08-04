import {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import type {
  SessionDetailResponse,
  SessionIndexEntry,
  TraceEvent,
  TraceEventSlim,
  TracePhase,
} from './core/trace-types.js';
import { TRACE_PHASES } from './core/trace-types.js';
import { getStoredLocale, storeLocale, t, type Locale } from './i18n.js';
import { api } from './api/client.js';
import { invalidateSessionDetail, recordCache } from './cache/caches.js';
import { mergeSessionsPatch } from './core/list-utils.js';
import { localSamples } from './generated/local-samples.js';
import { LanguageToggle } from './components/LanguageToggle.js';
import { LiveIndicator } from './components/LiveIndicator.js';
import { SessionList } from './components/SessionList.js';
import { SessionHeaderCard } from './components/SessionHeaderCard.js';
import { PhaseTiles } from './components/PhaseTiles.js';
import { TraceGanttTree } from './components/TraceGanttTree.js';
import { EventInspector } from './components/EventInspector.js';
import { AgentOverview } from './components/AgentOverview.js';
import { CompareBoard } from './components/CompareBoard.js';
import { ProxyView } from './components/ProxyView.js';
import { FridaView } from './components/FridaView.js';
import { SettingsModal } from './components/SettingsModal.js';
import { TranscriptModal } from './components/TranscriptModal.js';
import { TokenTextModal } from './components/TokenTextModal.js';
import { ThemeToggle } from './components/ThemeToggle.js';
import { useTheme } from './theme.js';

type View = 'session' | 'agent' | 'compare' | 'proxy' | 'frida';

const VIEWS: View[] = ['session', 'agent', 'compare', 'proxy', 'frida'];
const PAGE_SIZE = 2000;

/** REQ-001：五视图 shell，App.tsx 是唯一 stateful shell。 */
export default function App() {
  const [view, setView] = useState<View>('session');
  const [locale, setLocaleState] = useState<Locale>(() => getStoredLocale());
  const theme = useTheme();
  const [live, setLive] = useState(false);
  const [sessions, setSessions] = useState<SessionIndexEntry[]>([]);
  const [sessionCursor, setSessionCursor] = useState<string | null>(null);
  const [hasMoreSessions, setHasMoreSessions] = useState(false);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [offlineSamples, setOfflineSamples] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [detail, setDetail] = useState<SessionDetailResponse | null>(null);
  const [pending, setPending] = useState(false);
  const [phaseFilter, setPhaseFilter] = useState<TracePhase[]>([...TRACE_PHASES]);
  const deferredPhaseFilter = useDeferredValue(phaseFilter); // REQ-002
  const [selectedEvent, setSelectedEvent] = useState<TraceEventSlim | null>(null);
  const [detailPage, setDetailPage] = useState(0);
  const [fontPx, setFontPx] = useState(14); // REQ-012：8–28px
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [transcriptEvent, setTranscriptEvent] = useState<TraceEventSlim | null>(null);
  const [transcriptEvents, setTranscriptEvents] = useState<TraceEvent[]>([]);
  const [tokenEvent, setTokenEvent] = useState<TraceEventSlim | null>(null);
  const selectedKeyRef = useRef<string | null>(null);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    storeLocale(next);
  }, []);

  const switchView = useCallback((next: View) => {
    startTransition(() => setView(next)); // REQ-002：视图切换用 startTransition
  }, []);

  // REQ-015（G7.6）：会话索引由 App 单一持有，SessionList/CompareBoard 全部读这一份
  const loadSessions = useCallback(
    async (nextCursor?: string) => {
      setSessionsLoading(true);
      try {
        const result = await api.listSessions({
          dataSource: 'scan',
          limit: 50,
          cursor: nextCursor,
        });
        startTransition(() => {
          setSessions((prev) => mergeSessionsPatch(prev, result.items));
        });
        setSessionCursor(result.nextCursor);
        setHasMoreSessions(result.hasMore);
        setSessionsError(null);
        setOfflineSamples(false);
      } catch (err) {
        console.error('[sessions] 列表加载失败:', err);
        setSessionsError(err instanceof Error ? err.message : String(err));
        // REQ-014：API 不可用时用本地样本兜底，状态栏显示「离线样本」
        startTransition(() => {
          setSessions((prev) => (prev.length === 0 ? [...localSamples] : prev));
        });
        setOfflineSamples(true);
      } finally {
        setSessionsLoading(false);
      }
    },
    [],
  );

  const loadMoreSessions = useCallback(() => {
    if (!hasMoreSessions || sessionsLoading) {
      return;
    }
    void loadSessions(sessionCursor ?? undefined);
  }, [hasMoreSessions, sessionsLoading, sessionCursor, loadSessions]);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  // REQ-004：SSE 局部 patch——失效缓存 + 一次 keys 批量补丁，不重拉全量
  useEffect(() => {
    const es = new EventSource('/api/events');
    es.onopen = () => setLive(true);
    es.onerror = () => setLive(false);
    es.addEventListener('sessions_changed', (event) => {
      const data = JSON.parse((event as MessageEvent).data) as { keys: string[] };
      for (const key of data.keys) {
        invalidateSessionDetail(key);
      }
      if (data.keys.length === 0) {
        return;
      }
      void api
        .listSessions({ keys: data.keys })
        .then((result) => {
          startTransition(() => {
            setSessions((prev) => mergeSessionsPatch(prev, result.items));
          });
          if (selectedKeyRef.current !== null && data.keys.includes(selectedKeyRef.current)) {
            setDetail(null);
            setPending(false);
          }
        })
        .catch((err) => {
          // 失败时保留现有列表，但必须记录错误（禁止空 catch）
          console.error('[sse] sessions_changed patch 失败:', err);
        });
    });
    return () => es.close();
  }, []);

  const selectSession = useCallback(
    (key: string) => {
      selectedKeyRef.current = key;
      setSelectedKey(key);
      setSelectedEvent(null);
      setDetailPage(0);
      const cached = recordCache.get(`${key}:slim`);
      if (cached !== undefined) {
        setDetail(cached);
        setPending(false);
        return;
      }
      setDetail(null);
      setPending(false);
      void api
        .sessionDetail(key, 'slim')
        .then((result) => {
          if (result.pending) {
            setPending(true); // REQ-009：解密中占位，等待 SSE 通知
            setDetail({ ...result, events: [], eventTotal: 0, hasMore: false });
            return;
          }
          recordCache.set(`${key}:slim`, result);
          setDetail(result);
        })
        .catch(() => {
          // 详情加载失败保留空态
        });
    },
    [],
  );

  const loadMoreEvents = useCallback(() => {
    if (selectedKey === null || detail === null || !detail.hasMore) {
      return;
    }
    const nextPage = detailPage + 1;
    void api.sessionDetail(selectedKey, 'slim', nextPage * PAGE_SIZE, PAGE_SIZE).then((result) => {
      setDetail((prev) => {
        if (prev === null) {
          return prev;
        }
        const seen = new Set(prev.events.map((e) => e.id));
        return {
          ...prev,
          events: [...prev.events, ...result.events.filter((e) => !seen.has(e.id))],
          eventTotal: result.eventTotal,
          hasMore: result.hasMore,
          eventOffset: result.eventOffset,
          eventLimit: result.eventLimit,
        };
      });
      setDetailPage(nextPage);
    });
  }, [selectedKey, detail, detailPage]);

  const visibleEvents = useMemo(
    () =>
      detail === null
        ? []
        : detail.events.filter((e) => deferredPhaseFilter.includes(e.phase)),
    [detail, deferredPhaseFilter],
  );

  const togglePhase = useCallback((phase: TracePhase) => {
    setPhaseFilter((prev) =>
      prev.includes(phase) ? prev.filter((p) => p !== phase) : [...prev, phase],
    );
  }, []);

  const adjustFont = useCallback((delta: number) => {
    setFontPx((prev) => Math.min(28, Math.max(8, prev + delta)));
  }, []);

  const openTranscript = useCallback(
    (event: TraceEventSlim) => {
      setTranscriptEvent(event);
      if (selectedKey !== null) {
        void api.sessionDetail(selectedKey, 'full').then((result) => {
          setTranscriptEvents(result.events as TraceEvent[]);
        });
      }
    },
    [selectedKey],
  );

  return (
    <div className="app">
      <nav className="toolbar">
        {VIEWS.map((v) => (
          <button
            key={v}
            type="button"
            className={`btn ${view === v ? 'phase-tile-on' : ''}`}
            onClick={() => switchView(v)}
          >
            {t(`view.${v}`, locale)}
          </button>
        ))}
        <span className="spacer" />
        <button type="button" className="btn" onClick={() => adjustFont(-2)}>
          {t('common.fontSmall', locale)}
        </button>
        <button type="button" className="btn" onClick={() => adjustFont(2)}>
          {t('common.fontLarge', locale)}
        </button>
        <button type="button" className="btn" onClick={() => setFontPx(14)}>
          {t('common.fontReset', locale)}
        </button>
        <button type="button" className="btn" onClick={() => setSettingsOpen(true)}>
          {t('settings.title', locale)}
        </button>
        <LiveIndicator connected={live} locale={locale} />
        <LanguageToggle locale={locale} onChange={setLocale} />
        <ThemeToggle
          theme={theme.theme}
          effective={theme.effective}
          onCycle={theme.cycle}
        />
      </nav>

      {view === 'session' && (
        <div className="view-body">
          <SessionList
            items={sessions}
            selectedId={selectedKey}
            onSelect={selectSession}
            locale={locale}
            hasMore={hasMoreSessions}
            loading={sessionsLoading}
            error={sessionsError}
            onLoadMore={loadMoreSessions}
            onRetry={() => void loadSessions()}
            offlineSamples={offlineSamples}
          />
          <main className="main">
            {pending && <p className="hint">{t('pending.decrypting', locale)}</p>}
            {detail !== null && !pending && (
              <SessionHeaderCard session={detail.session} locale={locale} />
            )}
            <PhaseTiles active={phaseFilter} onToggle={togglePhase} locale={locale} />
            <TraceGanttTree
              events={visibleEvents as TraceEventSlim[]}
              total={detail?.eventTotal ?? 0}
              hasMore={detail?.hasMore ?? false}
              onLoadMore={loadMoreEvents}
              onSelectEvent={setSelectedEvent}
              selectedEventId={selectedEvent?.id ?? null}
            />
          </main>
          <EventInspector
            sessionKey={selectedKey ?? ''}
            event={selectedEvent}
            locale={locale}
            fontPx={fontPx}
            onOpenTranscript={openTranscript}
            onOpenTokens={setTokenEvent}
            onClose={() => setSelectedEvent(null)}
          />
        </div>
      )}
      {view === 'agent' && (
        <div className="view-body">
          <main className="main">
            <AgentOverview locale={locale} />
          </main>
        </div>
      )}
      {view === 'compare' && (
        <div className="view-body">
          <main className="main">
            <CompareBoard sessions={sessions} locale={locale} />
          </main>
        </div>
      )}
      {view === 'proxy' && (
        <div className="view-body">
          <main className="main">
            <ProxyView locale={locale} />
          </main>
        </div>
      )}
      {view === 'frida' && (
        <div className="view-body">
          <main className="main">
            <FridaView locale={locale} />
          </main>
        </div>
      )}

      {settingsOpen && (
        <SettingsModal locale={locale} onClose={() => setSettingsOpen(false)} />
      )}
      {transcriptEvent !== null && (
        <TranscriptModal
          title={transcriptEvent.title}
          events={transcriptEvents}
          locale={locale}
          onClose={() => setTranscriptEvent(null)}
        />
      )}
      {tokenEvent !== null && (
        <TokenTextModal event={tokenEvent as TraceEvent} locale={locale} onClose={() => setTokenEvent(null)} />
      )}
    </div>
  );
}
