import { TaskWorkbench, type TaskChanges } from './components/task/TaskWorkbench.js';
import { DataIntake } from './components/task/DataIntake.js';
import { parseTaskRoute, serializeTaskRoute, type TaskRoute } from './task-route.js';
import { copy as taskCopy } from './components/task/copy.js';
import {
  lazy,
  Suspense,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import type {
  ProviderKey,
  SessionDetailResponse,
  SessionIndexEntry,
  SessionRange,
  TraceEventSlim,
  TraceStatus,
  BusEvents,
  SseConnected,
} from './core/trace-types.js';
import {
  errorMessage,
  getStoredLocale,
  setActiveLocale,
  storeLocale,
  t,
  type Locale,
} from './i18n.js';
import { api, ApiError } from './api/client.js';
import { eventDetailCache, invalidateSessionDetail, recordCache } from './cache/caches.js';
import { mergeSessionsPatch } from './core/list-utils.js';
import { localSamples } from './generated/local-samples.js';
import { LanguageToggle } from './components/LanguageToggle.js';
import { LiveIndicator } from './components/LiveIndicator.js';
import { SessionList } from './components/SessionList.js';
import { SessionStart } from './components/SessionStart.js';
import { SessionToolbar } from './components/SessionToolbar.js';
import { SessionFindings } from './components/SessionFindings.js';
import { SessionVisuals } from './components/SessionVisuals.js';
import { TrajectoryPane } from './components/trajectory/TrajectoryPane.js';
import { AgentCollabReplay } from './components/AgentCollabReplay.js';
const AgentOverview = lazy(() => import('./components/AgentOverview.js').then(module => ({ default: module.AgentOverview })));
const CompareBoard = lazy(() => import('./components/CompareBoard.js').then(module => ({ default: module.CompareBoard })));
const ProxyView = lazy(() => import('./components/ProxyView.js').then(module => ({ default: module.ProxyView })));
import type { LiveStreamEntry } from './components/ProxyLivePanel.js';
const ProxyLivePanel = lazy(() => import('./components/ProxyLivePanel.js').then(module => ({ default: module.ProxyLivePanel })));
import { SessionCaptureLinksPanel } from './components/TraceLinksPanel.js';
const FridaView = lazy(() => import('./components/FridaView.js').then(module => ({ default: module.FridaView })));
import { MissionControl, type MissionRange } from './components/MissionControl.js';
const SettingsModal = lazy(() => import('./components/SettingsModal.js').then(module => ({ default: module.SettingsModal })));
import { Modal } from './components/ui/Modal.js';

/** 错误展示本地化：已知错误码按当前语言翻译，未知码回退原始 message。 */
function formatError(err: unknown, locale: Locale): string {
  if (err instanceof ApiError) {
    const localized = errorMessage(err.code, locale);
    return localized === err.code ? err.message : localized;
  }
  return err instanceof Error ? err.message : String(err);
}
import { PromptContextModal } from './components/PromptContextModal.js';
import { ThemeToggle } from './components/ThemeToggle.js';
import { ErrorState, EmptyState } from './components/ui/States.js';
import { ErrorBoundary } from './components/ui/ErrorBoundary.js';
import { useTheme } from './theme.js';
import { AppHeader, StatusBar, ViewTabs, type AppView } from './components/AppShell.js';
import {
  LAYOUT_KEYS,
  LAYOUT_RANGES,
  loadBool,
  loadNumber,
  storeBool,
  storeNumber,
} from './layout.js';
import {
  installKeyboardShortcuts,
  registerShortcut,
  setEscapeFallback,
} from './keyboard.js';
import { HelpModal } from './components/HelpModal.js';
import { parseHash, serializeHash, type HashState } from './hash-router.js';
import type { CommandPaletteProps } from './components/CommandPalette.js';
import { computeFindings, type Finding } from './core/session-findings.js';
// add-agent-team-observability §7.3 — team 视图 shell（App.tsx 是唯一 stateful shell）
const TeamShell = lazy(() => import('./components/team/TeamShell.js').then(module => ({ default: module.TeamShell })));
import {
  DEFAULT_TEAM_HASH,
  parseTeamHash,
  serializeTeamViewHash,
  type TeamHashState,
} from './components/team/team-client.js';

/** --ui-scale 的基准字号：fontPx 等于它时缩放为 1（同 tokens.css §3.1 的 --text-base）。 */
const BASE_FONT_PX = 13;
/** 首帧 hash 在模块加载时解析一次：避免 state→hash 写入 effect 先把它覆盖掉。 */
const INITIAL_HASH = parseHash(window.location.hash);

interface PaletteModule {
  CommandPalette: (props: CommandPaletteProps) => React.JSX.Element;
}

/** REQ-001：五视图 shell，App.tsx 是唯一 stateful shell。 */
export default function App() {
  // §7.3：team 视图与既有五视图平行；AppView 不含 'team'，故本地扩展
  const isInitialTeam = window.location.hash.startsWith('#/team');
  const [view, setView] = useState<AppView | 'team'>(() =>
    window.location.hash === '' || window.location.hash === '#' || window.location.hash.startsWith('#/task') || (isInitialTeam && window.location.hash.includes('runId=')) || (window.location.hash.startsWith('#/session?') && parseTaskRoute(window.location.hash).task !== null) ? 'task' : isInitialTeam ? 'team' : (parseHash(window.location.hash)?.view ?? 'task') as AppView | 'team',
  );

  const [taskRoute, setTaskRoute] = useState<TaskRoute>(() => parseTaskRoute(window.location.hash));
  const [taskChanges, setTaskChanges] = useState<TaskChanges>({ version: 0, keys: [], runIds: [] });
  const [intakeChannel, setIntakeChannel] = useState<'native' | 'proxy' | 'frida' | 'import'>('native');

  const [teamHash, setTeamHash] = useState<TeamHashState>(() =>
    isInitialTeam ? parseTeamHash(window.location.hash.replace(/^#\/team\/?/, '')) : DEFAULT_TEAM_HASH,
  );
  /** §7.8 team_runs_changed SSE 失效计数（只标失效不轮询）。 */
  const [teamInvalidateKey, setTeamInvalidateKey] = useState(0);
  const [locale, setLocaleState] = useState<Locale>(() => getStoredLocale());
  const localeRef = useRef<Locale>(locale);
  const theme = useTheme();
  const [live, setLive] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [lastScanAt, setLastScanAt] = useState<string | null>(null);
  const [health, setHealth] = useState<{
    dbSizeBytes: number;
    walSizeBytes: number;
    sessionCount: number;
    eventCount: number;
  } | null>(null);
  const [sessions, setSessions] = useState<SessionIndexEntry[]>([]);
  const [hasMoreSessions, setHasMoreSessions] = useState(false);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [offlineSamples, setOfflineSamples] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(() => INITIAL_HASH?.key ?? null);
  const [detail, setDetail] = useState<SessionDetailResponse | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // fix-session-detail-display delta：会话列表服务端过滤 + 甘特布局模式
  const [sessionQ, setSessionQ] = useState(() => INITIAL_HASH?.q ?? '');
  const [sessionRange, setSessionRange] = useState<SessionRange>(
    () => INITIAL_HASH?.time ?? 'today',
  );
  const [sessionTotal, setSessionTotal] = useState(0);
  const sessionCursorRef = useRef<string | null>(null);
  const sessionListRequestRef = useRef(0);
  // REQ-026：布局偏好持久化（读取时范围校验）
  const [railWidth, setRailWidth] = useState(() =>
    loadNumber(LAYOUT_KEYS.railWidth, 300, LAYOUT_RANGES.railWidth),
  );
  const [railCollapsed, setRailCollapsed] = useState(() =>
    loadBool(LAYOUT_KEYS.railCollapsed, false),
  );
  const [selectedTurn, setSelectedTurn] = useState<number | null>(
    () => INITIAL_HASH?.turn ?? null,
  );
  /** 轨迹 rail（详情内右栏）折叠态；宽度由 SplitPane 自行持久化（D18）。 */
  const [trajectoryRailCollapsed, setTrajectoryRailCollapsed] = useState(true);
  const [trajectoryFocus, setTrajectoryFocus] = useState(false);
  const [loadingMoreEvents, setLoadingMoreEvents] = useState(false);
  const [moreEventsError, setMoreEventsError] = useState<string | null>(null);
  const eventPageRequest = useRef<object | null>(null);
  const [fontPx, setFontPx] = useState(() =>
    loadNumber(LAYOUT_KEYS.fontSize, BASE_FONT_PX, LAYOUT_RANGES.fontSize),
  ); // REQ-012：8–28px
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [promptContextKey, setPromptContextKey] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteLoadError, setPaletteLoadError] = useState(false);
  const [PaletteComponent, setPaletteComponent] = useState<PaletteModule['CommandPalette'] | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [cursorIndex, setCursorIndex] = useState(0);
  const [providerFilter, setProviderFilter] = useState<ProviderKey[]>(
    () => (INITIAL_HASH?.provider as ProviderKey[]) ?? [],
  );
  const [statusFilter, setStatusFilter] = useState<TraceStatus[]>(
    () => (INITIAL_HASH?.status as TraceStatus[]) ?? [],
  );
  const [focusEventId, setFocusEventId] = useState<string | null>(null);
  const [focusEventRequest, setFocusEventRequest] = useState(0);
  const sessionFiltersRef = useRef({
    q: sessionQ,
    range: sessionRange,
    provider: providerFilter,
    status: statusFilter,
  });
  const [compareLeft, setCompareLeft] = useState(() => INITIAL_HASH?.left ?? '');
  const [compareRight, setCompareRight] = useState(() => INITIAL_HASH?.right ?? '');
  const [missionRange, setMissionRange] = useState<MissionRange>(() => INITIAL_HASH?.range ?? '7d');
  const [paletteHintSeen, setPaletteHintSeen] = useState(() =>
    loadBool(LAYOUT_KEYS.paletteHintSeen, false),
  );
  /** Mission 视图的 SSE 失效计数：sessions_changed 时 +1（REQ-027，只标失效不轮询）。 */
  const [missionInvalidateKey, setMissionInvalidateKey] = useState(0);
  const [proxyLiveStatus, setProxyLiveStatus] = useState<BusEvents['proxy_status'] | null>(null);
  const [fridaLiveStatus, setFridaLiveStatus] = useState<BusEvents['frida_status'] | null>(null);
  const [fridaSaved, setFridaSaved] = useState<BusEvents['frida_capture'][]>([]);
  const [latestHookId, setLatestHookId] = useState(0);
  const [proxyLiveUpdates, setProxyLiveUpdates] = useState<BusEvents['proxy_request'][]>([]);
  const [proxyStreams, setProxyStreams] = useState<LiveStreamEntry[]>([]);
  const [liveReset, setLiveReset] = useState(0);
  const [proxyFocusedId, setProxyFocusedId] = useState<number | null>(null);
  const [traceLinksVersion, setTraceLinksVersion] = useState(0);
  const clearProxyFocus = useCallback(() => setProxyFocusedId(null), []);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const focusSearchOnExpand = useRef(false);
  const selectedKeyRef = useRef<string | null>(selectedKey);
  const metadataEpochRef = useRef(0);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    storeLocale(next);
  }, []);

  useEffect(() => {
    localeRef.current = locale;
    document.documentElement.lang = locale;
    // ui/* 基础组件不接收 locale prop，其 aria-label 走 ta() 读这里的当前语言。
    setActiveLocale(locale);
  }, [locale]);

  const switchView = useCallback((next: AppView | 'team') => {
    startTransition(() => setView(next)); // REQ-002：视图切换用 startTransition
  }, []);

  useEffect(() => {
    storeNumber(LAYOUT_KEYS.railWidth, railWidth);
  }, [railWidth]);
  useEffect(() => {
    storeBool(LAYOUT_KEYS.railCollapsed, railCollapsed);
  }, [railCollapsed]);
  useEffect(() => {
    storeNumber(LAYOUT_KEYS.fontSize, fontPx);
    // A− / A+ 此前只作为 prop 传给 EventInspector，对其余界面完全无效。
    // 改为驱动全局 --ui-scale，字号刻度整体跟随（tokens.css §3.1）。
    document.documentElement.style.setProperty(
      '--ui-scale',
      String(fontPx / BASE_FONT_PX),
    );
  }, [fontPx]);

  // REQ-023：health 只在启动时取一次，MUST NOT 轮询
  useEffect(() => {
    void api
      .health()
      .then((h) => setHealth(h))
      .catch((err: unknown) => {
        console.error('[health] 获取失败:', err);
      });
  }, []);

  // REQ-015（G7.6）：会话索引由 App 单一持有，SessionList/CompareBoard 全部读这一份
  const loadSessions = useCallback(
    async (mode: 'first' | 'next') => {
      const epoch = metadataEpochRef.current;
      const request = ++sessionListRequestRef.current;
      const filters = sessionFiltersRef.current;
      setSessionsLoading(true);
      try {
        const result = await api.listSessions({
          dataSource: 'scan',
          limit: 50,
          cursor: mode === 'next' ? sessionCursorRef.current ?? undefined : undefined,
          provider: filters.provider.length > 0 ? filters.provider : undefined,
          status: filters.status.length > 0 ? filters.status : undefined,
          q: filters.q.trim() !== '' ? filters.q.trim() : undefined,
          range: filters.range,
        });
        if (metadataEpochRef.current !== epoch || sessionListRequestRef.current !== request) return;
        startTransition(() => {
          setSessions((prev) => (mode === 'first' ? result.items : mergeSessionsPatch(prev, result.items)));
        });
        sessionCursorRef.current = result.nextCursor;
        setHasMoreSessions(result.hasMore);
        setSessionTotal(result.total);
        setSessionsError(null);
        setOfflineSamples(false);
      } catch (err) {
        if (metadataEpochRef.current !== epoch || sessionListRequestRef.current !== request) return;
        console.error('[sessions] 列表加载失败:', err);
        setSessionsError(formatError(err, localeRef.current));
        // REQ-014：API 不可用时用本地样本兜底，状态栏显示「离线样本」
        startTransition(() => {
          setSessions((prev) => (prev.length === 0 ? [...localSamples] : prev));
        });
        setOfflineSamples(true);
      } finally {
        if (metadataEpochRef.current === epoch && sessionListRequestRef.current === request) setSessionsLoading(false);
      }
    },
    [],
  );

  const loadMoreSessions = useCallback(() => {
    if (!hasMoreSessions || sessionsLoading) {
      return;
    }
    void loadSessions('next');
  }, [hasMoreSessions, sessionsLoading, loadSessions]);

  // 过滤状态同步到 ref（异步 fetch 读取同一份快照）
  useEffect(() => {
    sessionFiltersRef.current = {
      q: sessionQ,
      range: sessionRange,
      provider: providerFilter,
      status: statusFilter,
    };
  }, [sessionQ, sessionRange, providerFilter, statusFilter]);

  // 过滤变更（含首帧）→ 防抖拉第一页，替换而非追加（分页下不做纯前端过滤）
  useEffect(() => {
    sessionListRequestRef.current += 1;
    setSessionsLoading(true);
    const timer = setTimeout(() => {
      void loadSessions('first');
    }, 250);
    return () => clearTimeout(timer);
  }, [sessionQ, sessionRange, providerFilter, statusFilter, loadSessions]);

  // REQ-004：SSE 局部 patch——失效缓存 + 一次 keys 批量补丁，不重拉全量
  useEffect(() => {
    const es = new EventSource('/api/events');
    const seen = new Set<string>();
    const listen = (name: string, callback: (event: MessageEvent) => void): void => {
      es.addEventListener(name, event => {
        const message = event as MessageEvent;
        // connected has no wire id and inherits the previous event's id on a
        // native EventSource reconnect. It must never be deduplicated away.
        if (name !== 'connected' && message.lastEventId) {
          if (seen.has(message.lastEventId)) return;
          seen.add(message.lastEventId);
          if (seen.size > 512) seen.delete(seen.values().next().value!);
        }
        callback(message);
      });
    };
    es.onopen = () => setLive(true);
    es.onerror = () => setLive(false);
    listen('connected', (event) => {
      const state = JSON.parse((event as MessageEvent).data) as SseConnected;
      if (state.resume !== 'reset') return;
      metadataEpochRef.current += 1;
      // Only a bounded metadata snapshot is needed when the ephemeral journal
      // cannot cover a gap. Never restore missed original/body fragments.
      recordCache.clear(); eventDetailCache.clear();
      setProxyLiveUpdates([]); setProxyStreams([]); setProxyLiveStatus(null);
      setFridaLiveStatus(null); setFridaSaved([]); setLatestHookId(0);
      setProxyFocusedId(null); setLiveReset(value => value + 1);
      setTraceLinksVersion(value => value + 1);
      setMissionInvalidateKey(value => value + 1); setTeamInvalidateKey(value => value + 1);
      setTaskChanges(previous => ({ version: previous.version + 1, keys: [], runIds: [], reset: true }));
      selectedKeyRef.current = null; setSelectedKey(null); setDetail(null); setSelectedTurn(null); setPending(false);
      setPromptContextKey(null); eventPageRequest.current = null; setLoadingMoreEvents(false); setMoreEventsError(null); setDetailError(null);
      void loadSessions('first');
    });
    listen('proxy_stream_started', (event) => {
      const stream = JSON.parse((event as MessageEvent).data) as BusEvents['proxy_stream_started'];
      setProxyStreams(previous => previous.some(item => item.requestId === stream.requestId)
        ? previous : [...previous.slice(-49), { ...stream, ended: false }]);
    });
    listen('proxy_stream_ended', (event) => {
      const { requestId } = JSON.parse((event as MessageEvent).data) as BusEvents['proxy_stream_ended'];
      setProxyStreams(previous => previous.map(item => item.requestId === requestId ? { ...item, ended: true } : item));
    });
    listen('scan_started', () => {
      setScanning(true);
    });
    listen('scan_completed', () => {
      setScanning(false);
      setLastScanAt(new Date().toISOString());
    });
    listen('proxy_status', (event) => {
      setProxyLiveStatus(JSON.parse((event as MessageEvent).data) as BusEvents['proxy_status']);
    });
    listen('frida_status', event => {
      let value: unknown;
      try { value = JSON.parse(event.data); } catch { return; }
      if (typeof value !== 'object' || value === null) return;
      const status = value as Record<string, unknown>;
      if (typeof status.running !== 'boolean' || status.pid !== undefined &&
        (typeof status.pid !== 'number' || !Number.isSafeInteger(status.pid) || status.pid <= 0)) return;
      setFridaLiveStatus({ running: status.running, ...(status.pid === undefined ? {} : { pid: status.pid as number }) });
    });
    listen('frida_capture', event => {
      let value: unknown;
      try { value = JSON.parse(event.data); } catch { return; }
      if (typeof value !== 'object' || value === null) return;
      const id = (value as Record<string, unknown>).id;
      if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) return;
      setFridaSaved(previous => previous.some(item => item.id === id) ? previous : [...previous.slice(-19), { id }]);
    });
    listen('proxy_request', (event) => {
      const update = JSON.parse((event as MessageEvent).data) as BusEvents['proxy_request'];
      if (update.item !== undefined) startTransition(() => setProxyLiveUpdates(previous => [...previous.slice(-49), update]));
    });
    listen('hook_events_changed', event => {
      try {
        const value: unknown = JSON.parse(event.data);
        if (value && typeof value === 'object' && 'latestId' in value && typeof value.latestId === 'number' && Number.isSafeInteger(value.latestId) && value.latestId > 0) setLatestHookId(value.latestId);
      } catch { return; /* malformed hints never trigger IO */ }
    });
    listen('trace_links_changed', () => {
      // Relation-only invalidation: no source-detail/body refetch and no polling.
      setTraceLinksVersion(version => version + 1);
    });
    listen('sessions_changed', (event) => {
      const epoch = metadataEpochRef.current;
      const data = JSON.parse((event as MessageEvent).data) as { keys: string[] };
      setTaskChanges(previous => ({ version: previous.version + 1, keys: data.keys, runIds: [] }));
      setMissionInvalidateKey((k) => k + 1);
      for (const key of data.keys) {
        invalidateSessionDetail(key);
      }
      if (data.keys.length === 0) {
        return;
      }
      // A changed native owner may invalidate a different open session's
      // parent-reference uniqueness. Mark metadata evidence stale, no IO here.
      setTraceLinksVersion(version => version + 1);
      void api
        .listSessions({ keys: data.keys, limit: Math.min(500, data.keys.length) })
        .then((result) => {
          if (metadataEpochRef.current !== epoch) return;
          startTransition(() => {
            setSessions((prev) => mergeSessionsPatch(prev, result.items));
          });
          if (selectedKeyRef.current !== null && data.keys.includes(selectedKeyRef.current)) {
            const key = selectedKeyRef.current;
            setDetail(null);
            setPending(false);
            setDetailError(null);
            void api
              .sessionDetail(key, 'slim')
              .then((result) => {
                if (metadataEpochRef.current !== epoch || selectedKeyRef.current !== key) return;
                if (result.pending) {
                  setPending(true);
                  setDetail({ ...result, events: [], eventTotal: 0, hasMore: false });
                  return;
                }
                recordCache.set(`${key}:slim`, result);
                setDetail(result);
              })
              .catch((err: unknown) => {
                if (metadataEpochRef.current !== epoch) return;
                console.error('[sse] 当前会话详情刷新失败:', err);
                if (selectedKeyRef.current === key) {
                  setDetailError(formatError(err, localeRef.current));
                }
              });
          }
        })
        .catch((err) => {
          if (metadataEpochRef.current !== epoch) return;
          // 失败时保留现有列表，但必须记录错误（禁止空 catch）
          console.error('[sse] sessions_changed patch 失败:', err);
        });
    });
    // §7.8 team_runs_changed → 本地 patch/reconnect（TeamShell 内部处理增量）
    listen('team_runs_changed', event => {
      const data = JSON.parse(event.data) as { runIds: string[] };
      setTaskChanges(previous => ({ version: previous.version + 1, keys: [], runIds: data.runIds }));
      setTeamInvalidateKey((k) => k + 1);
    });
    return () => es.close();
  }, [loadSessions]);

  const selectSession = useCallback(
    (key: string, targetEventId?:string) => {
      const epoch = metadataEpochRef.current;
      if (selectedKeyRef.current !== key) {
        setSelectedTurn(null);
        setFocusEventId(null);
      }
      selectedKeyRef.current = key;
      eventPageRequest.current = null;
      setLoadingMoreEvents(false);
      setMoreEventsError(null);
      setSelectedKey(key);
      const cached = recordCache.get(`${key}:slim`);
      if (cached !== undefined && (targetEventId===undefined||cached.events.some(event=>event.id===targetEventId))) {
        setDetail(cached);
        setPending(false);
        setDetailError(null);
        return;
      }
      setDetail(null);
      setPending(false);
      setDetailError(null);
      void api
        .sessionDetail(key, 'slim',undefined,targetEventId===undefined?undefined:5000)
        .then((result) => {
          if (metadataEpochRef.current !== epoch || selectedKeyRef.current !== key) return;
          if (result.pending) {
            setPending(true); // REQ-009：解密中占位，等待 SSE 通知
            setDetail({ ...result, events: [], eventTotal: 0, hasMore: false });
            return;
          }
          recordCache.set(`${key}:slim`, result);
          setDetail(result);
          setDetailError(null);
        })
        .catch((err: unknown) => {
          if (metadataEpochRef.current !== epoch || selectedKeyRef.current !== key) return;
          // REQ-022：失败必须可见 —— 错误码 + 重试（禁止空 catch）
          console.error('[detail] 会话详情加载失败:', err);
          setDetailError(formatError(err, localeRef.current));
        });
    },
    [],
  );

  const loadMoreEvents = useCallback(() => {
    if (detail === null || !detail.hasMore || selectedKey === null || eventPageRequest.current !== null) return;
    const key = selectedKey;
    const base = detail;
    const request = {};
    eventPageRequest.current = request;
    setLoadingMoreEvents(true);
    setMoreEventsError(null);
    void api.sessionDetail(key, 'slim', base.events.length, 2000).then((page) => {
      if (selectedKeyRef.current !== key || eventPageRequest.current !== request) return;
      if (page.eventOffset !== base.events.length || (page.hasMore && page.events.length === 0)) {
        throw new Error('Invalid event page: unexpected offset or empty continuation');
      }
      setDetail((current) => {
        // A live update may replace the detail while this page is in flight.
        if (current !== base) return current;
        const merged: SessionDetailResponse = {
          ...base, events: [...base.events, ...page.events],
          eventTotal: page.eventTotal, hasMore: page.hasMore,
        };
        recordCache.set(`${key}:slim`, merged);
        return merged;
      });
    }).catch((err: unknown) => {
      if (selectedKeyRef.current === key && eventPageRequest.current === request) {
        setMoreEventsError(formatError(err, localeRef.current));
      }
    }).finally(() => {
      if (eventPageRequest.current === request) {
        eventPageRequest.current = null;
        setLoadingMoreEvents(false);
      }
    });
  }, [detail, selectedKey]);

  // ui-design-v2 §3.1：会话诊断（L1）——只依赖已有 slim 数据。
  const findingsResult = useMemo(
    () => (detail !== null && detail.events.length > 0 ? computeFindings(detail.session, detail.events as TraceEventSlim[]) : null),
    [detail],
  );
  const activateFinding = useCallback(
    (finding: Finding) => {
      if (detail !== null) {
        const targetIds = new Set(finding.evidence.eventIds);
        const target = detail.events.find((e) => targetIds.has(e.id)) ??
          detail.events.find((e) => e.phase === finding.evidence.phase);
        if (target !== undefined) {
          // 甘特与 Inspector 已删除：定位到目标事件所在的回合。
          setFocusEventId(target.id);
          setFocusEventRequest(value => value + 1);
          return;
        }
      }
    },
    [detail],
  );

  const startCompare = useCallback(
    (left: ProviderKey, right: ProviderKey, sourceAgents: readonly [string, string]) => {
      const pick = (provider: ProviderKey, sourceAgent: string): string | null => {
        const candidates = sessions
          .filter((s) => s.provider === provider && s.dataSource === 'scan' && s.sourceAgent === sourceAgent)
          .sort((a, b) => b.startedAt.localeCompare(a.startedAt) || a.id.localeCompare(b.id));
        return candidates[0]?.id ?? null;
      };
      const leftKey = pick(left, sourceAgents[0]);
      const rightKey = pick(right, sourceAgents[1]);
      setCompareLeft(leftKey ?? '');
      setCompareRight(rightKey ?? '');
      switchView('compare');
    },
    [sessions, switchView],
  );

  const adjustFont = useCallback((delta: number) => {
    setFontPx((prev) => Math.min(28, Math.max(8, prev + delta)));
  }, []);

  const triggerScan = useCallback(() => {
    void api
      .scan()
      .catch((err: unknown) => {
        console.error('[scan] 手动扫描失败:', err);
      });
  }, []);

  useEffect(() => {
    installKeyboardShortcuts();
    setEscapeFallback(() => {
      setFocusEventId(null);
      setCursorIndex(-1);
    });
    return () => setEscapeFallback(null);
  }, []);

  const openPalette = useCallback(() => {
    setPaletteLoadError(false);
    setPaletteOpen(true);
    void import('./components/CommandPalette.js').then(module => {
      setPaletteComponent(() => module.CommandPalette);
    }).catch((error: unknown) => {
      console.error('Command palette failed to load', error);
      setPaletteOpen(false);
      setPaletteLoadError(true);
    });
  }, []);

  useEffect(() => {
    if (!railCollapsed && view === 'session' && focusSearchOnExpand.current) {
      focusSearchOnExpand.current = false;
      searchInputRef.current?.focus();
    }
  }, [railCollapsed, view]);

  // REQ-008（D1）：单一全局监听 + 映射表
  useEffect(() => {
    const unsubs: Array<() => void> = [];
    const add = (spec: Parameters<typeof registerShortcut>[0], handler: () => void): void => {
      unsubs.push(registerShortcut(spec, handler));
    };
    add({ key: '1' }, () => switchView('task'));
    add({ key: '2' }, () => switchView('intake'));
    add({ key: '3' }, () => switchView('compare'));
    add({ key: '4' }, () => switchView('proxy'));
    add({ key: '5' }, () => switchView('frida'));
    add({ key: '6' }, () => switchView('mission'));
    add({ key: '/' }, () => {
      if (view !== 'session') return;
      if (searchInputRef.current !== null) searchInputRef.current.focus();
      else { focusSearchOnExpand.current = true; setRailCollapsed(false); }
    });
    add({ key: 'j' }, () => {
      setCursorIndex((prev) => Math.min(sessions.length - 1, prev + 1));
    });
    add({ key: 'k' }, () => {
      setCursorIndex((prev) => Math.max(0, prev - 1));
    });
    add({ key: 'Enter' }, () => {
      const target = sessions[cursorIndex];
      if (target !== undefined) {
        selectSession(target.id);
      }
    });
    add({ key: '[' }, () => setRailCollapsed((prev) => !prev));
    add({ key: ']' }, () => setTrajectoryRailCollapsed((prev) => !prev));
    add({ key: '\\', ctrlOrMeta: true }, () => theme.cycle());
    add({ key: 'k', ctrlOrMeta: true }, () => {
      if (paletteOpen) setPaletteOpen(false);
      else openPalette();
    });
    add({ key: '?' }, () => setHelpOpen((prev) => !prev));
    return () => {
      for (const unsubscribe of unsubs) {
        unsubscribe();
      }
    };
  }, [sessions, cursorIndex, selectSession, switchView, theme, setRailCollapsed, paletteOpen, openPalette, view]);

  // REQ-024（D3）：状态变 → 写 hash（replaceState 不触发 hashchange，避免循环）
  useEffect(() => {
    if (view === 'task') { history.replaceState(null, '', serializeTaskRoute(taskRoute)); return; }
    // §7.3 team 视图用独立 hash 序列化（与既有 session/agent/compare/... 分开）
    if (view === 'team') {
      history.replaceState(null, '', serializeTeamViewHash(teamHash));
      return;
    }
    const state: HashState = {
      view,
      ...(selectedKey !== null ? { key: selectedKey } : {}),
      ...(providerFilter.length > 0 ? { provider: providerFilter } : {}),
      ...(statusFilter.length > 0 ? { status: statusFilter } : {}),
      ...(sessionQ !== '' ? { q: sessionQ } : {}),
      ...(view === 'session' ? { time: sessionRange } : {}),
      ...(view === 'session' && selectedTurn !== null ? { turn: selectedTurn } : {}),
      ...(compareLeft !== '' ? { left: compareLeft } : {}),
      ...(compareRight !== '' ? { right: compareRight } : {}),
      ...(view === 'mission' ? { range: missionRange } : {}),
    };
    history.replaceState(null, '', serializeHash(state));
  }, [view, selectedKey, providerFilter, statusFilter, sessionQ, sessionRange, selectedTurn, compareLeft, compareRight, missionRange, teamHash, taskRoute]);

  // REQ-024：hashchange → 解析并应用（脏 hash 回落默认视图，不抛错）
  useEffect(() => {
    const onHashChange = (): void => {
      if (window.location.hash === '#/team') { switchView('team'); setTeamHash(DEFAULT_TEAM_HASH); return; }
      if (window.location.hash.startsWith('#/task') || window.location.hash.startsWith('#/team') || (window.location.hash.startsWith('#/session?') && parseTaskRoute(window.location.hash).task !== null)) {
        setTaskRoute(parseTaskRoute(window.location.hash)); switchView('task'); return;
      }
      const state = parseHash(window.location.hash);
      if (state === null) {
        switchView('session');
        return;
      }
      switchView(state.view);
      if (state.key !== undefined) {
        selectSession(state.key);
      }
      if (state.provider !== undefined) {
        setProviderFilter(state.provider as ProviderKey[]);
      }
      if (state.status !== undefined) {
        setStatusFilter(state.status as TraceStatus[]);
      }
      if (state.q !== undefined) {
        setSessionQ(state.q);
      }
      if (state.time !== undefined) {
        setSessionRange(state.time);
      }
      if (state.turn !== undefined) {
        setSelectedTurn(state.turn);
      }
      if (state.left !== undefined) {
        setCompareLeft(state.left);
      }
      if (state.right !== undefined) {
        setCompareRight(state.right);
      }
      if (state.range !== undefined && state.view === 'mission') {
        setMissionRange(state.range);
      }
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [switchView, selectSession]);

  // 首帧详情加载（其余状态已由 useState 初始化自 INITIAL_HASH）
  useEffect(() => {
    if (INITIAL_HASH?.key !== undefined) {
      selectSession(INITIAL_HASH.key);
    }
  }, [switchView, selectSession]);

  return (
    <div className={`app ${trajectoryFocus && view === 'session' ? 'app-trajectory-focus' : ''}`}>
      <AppHeader locale={locale} onSearch={openPalette}>
        <button type="button" className="btn" onClick={() => adjustFont(-2)}>
          {t('common.fontSmall', locale)}
        </button>
        <button type="button" className="btn" onClick={() => adjustFont(2)}>
          {t('common.fontLarge', locale)}
        </button>
        <button type="button" className="btn" onClick={() => setFontPx(BASE_FONT_PX)}>
          {t('common.fontReset', locale)}
        </button>
        <button type="button" className="btn" onClick={() => setSettingsOpen(true)}>
          {t('settings.title', locale)}
        </button>
        <LanguageToggle locale={locale} onChange={setLocale} />
        <ThemeToggle
          theme={theme.theme}
          effective={theme.effective}
          onCycle={theme.cycle}
        />
        <LiveIndicator connected={live} locale={locale} />
      </AppHeader>
      <nav className="task-primary-nav" aria-label={taskCopy(locale).tasks}>
        <div><button type="button" aria-current={view === 'task' || view === 'session' || view === 'team' ? 'page' : undefined} onClick={() => switchView('task')}>{taskCopy(locale).tasks}</button>
        <button type="button" aria-current={view === 'intake' || view === 'proxy' || view === 'frida' ? 'page' : undefined} onClick={() => { setIntakeChannel('native'); switchView('intake'); }}>{taskCopy(locale).intake}</button>
        <button type="button" onClick={() => setSettingsOpen(true)}>{taskCopy(locale).settings}</button></div>
        <details><summary>{taskCopy(locale).compat}</summary><div className="task-secondary-menu"><ViewTabs active={view === 'task' || view === 'intake' || view === 'team' ? 'session' : view} onChange={switchView} locale={locale} /></div></details>
      </nav>
      {paletteLoadError && <div className="workbench-error" role="alert">
        <span>{t('workbench.searchUnavailable', locale)}</span>
        <button type="button" className="btn" onClick={openPalette}>{t('common.retry', locale)}</button>
      </div>}
      {liveReset > 0 && <p role="status">{locale === 'zh' ? '实时恢复窗口已重置，已刷新有界元数据；更早的流片段不可恢复，请查看已保存原文。' : 'Live recovery window reset. Bounded metadata refreshed; earlier stream fragments are unavailable. Inspect retained originals.'}</p>}
      {/* §7.3 team 视图入口已移除（团队运行统一在任务列表中展示）。
          team 视图保留用于团队任务详情：点击团队任务 → switchView('team')。
          D15：Sessions(任务) | Agents | ...，AppShell 不含 team */}

      {view === 'task' && <ErrorBoundary label={taskCopy(locale).tasks}><TaskWorkbench locale={locale} route={taskRoute} onRoute={setTaskRoute} changes={taskChanges} providerPreset={providerFilter[0] ?? ''} onProviderPresetChange={value => setProviderFilter(value ? [value] : [])}
        onIntake={() => { setIntakeChannel(taskRoute.origin === 'imported' ? 'import' : 'native'); switchView('intake'); }}
        onOpenRequest={id => { setProxyFocusedId(id); switchView('proxy'); }} /></ErrorBoundary>}
      {view === 'intake' && <ErrorBoundary label={taskCopy(locale).intake}><DataIntake key={intakeChannel} locale={locale} initialChannel={intakeChannel}
        onConfigure={() => setSettingsOpen(true)} onTasks={() => switchView('task')}
        proxy={<Suspense fallback={<p role="status">{t('common.loading', locale)}</p>}><ProxyView key={liveReset} locale={locale} liveStatus={proxyLiveStatus} liveUpdates={proxyLiveUpdates} latestHookId={latestHookId}
          sessions={sessions} focusedRequestId={proxyFocusedId} onFocusedRequestHandled={clearProxyFocus} traceInvalidateKey={traceLinksVersion}
          onOpenSession={key => { setTaskRoute({ ...taskRoute, task: 'collected:' + key, origin: 'collected', member: 'main', event: null }); switchView('task'); }} /></Suspense>}
        frida={<Suspense fallback={<p role="status">{t('common.loading', locale)}</p>}><FridaView key={liveReset} locale={locale} liveStatus={fridaLiveStatus} savedNotifications={fridaSaved} connected={live} /></Suspense>} /></ErrorBoundary>}
      {view === 'session' && (
        <div className="view-body session-view-body">
          <SessionList
            items={sessions}
            selectedId={selectedKey}
            onSelect={selectSession}
            locale={locale}
            hasMore={hasMoreSessions}
            loading={sessionsLoading}
            error={sessionsError}
            onLoadMore={loadMoreSessions}
            onRetry={() => void loadSessions('first')}
            offlineSamples={offlineSamples}
            providerFilter={providerFilter}
            statusFilter={statusFilter}
            q={sessionQ}
            onQChange={setSessionQ}
            range={sessionRange}
            onRangeChange={setSessionRange}
            onProviderFilterChange={setProviderFilter}
            onStatusFilterChange={setStatusFilter}
            total={sessionTotal}
            cursorIndex={cursorIndex}
            searchInputRef={searchInputRef}
            width={railWidth}
            collapsed={railCollapsed}
            onResize={setRailWidth}
            onToggleCollapse={() => setRailCollapsed((prev) => !prev)}
            onOpenTeams={() => switchView('team')}
          />
          <main className="main">
            {pending && <p className="hint">{t('pending.decrypting', locale)}</p>}
            {detailError !== null && (
              <ErrorState
                code="SESSION_DETAIL_FAILED"
                message={detailError}
                onRetry={() => {
                  if (selectedKey !== null) {
                    selectSession(selectedKey);
                  }
                }}
              />
            )}
            {detailError === null &&
              detail !== null &&
              !pending &&
              detail.events.length === 0 && (
                <EmptyState
                  icon={<span aria-hidden="true" />}
                  title={t('state.noEvents', locale)}
                  description={t('state.empty', locale)}
                  action={
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        if (selectedKey !== null) {
                          selectSession(selectedKey);
                        }
                      }}
                    >
                      {t('state.retry', locale)}
                    </button>
                  }
                />
              )}
            {detailError === null &&
              detail === null &&
              !pending && (
                <SessionStart locale={locale} recent={sessions[0] ?? null} loading={sessionsLoading}
                  filtered={sessionQ.trim() !== '' || sessionRange !== 'all' || providerFilter.length > 0 || statusFilter.length > 0}
                  offlineSamples={offlineSamples}
                  onClearFilters={() => { setSessionQ(''); setSessionRange('all'); setProviderFilter([]); setStatusFilter([]); }}
                  onSelect={selectSession} onSearch={openPalette} onCapture={() => switchView('proxy')}
                  onTeams={() => switchView('team')} onSettings={() => setSettingsOpen(true)} />
              )}
            {detail !== null && detail.events.length > 0 && (
              <div className="session-inspector">
                <SessionToolbar
                  session={detail.session}
                  events={detail.events as TraceEventSlim[]}
                  eventTotal={detail.eventTotal}
                  hasMore={detail.hasMore}
                  locale={locale}
                  onBack={() => {
                    setSelectedKey(null);
                    setDetail(null);
                    selectedKeyRef.current = null;
                    setDetailError(null);
                    setPending(false);
                  }}
                  onRescan={() => {
                    if (selectedKey === null) {
                      return;
                    }
                    void api
                      .rescanSession(selectedKey)
                      .then(() => {
                        if (selectedKey !== null) {
                          selectSession(selectedKey);
                        }
                      })
                      .catch((err: unknown) => {
                        console.error('[session] 重扫失败:', err);
                      });
                  }}
                  onDelete={() => {
                    if (selectedKey === null) {
                      return;
                    }
                    const key = selectedKey;
                    void api
                      .deleteSession(key)
                      .then(() => {
                        setSessions((prev) => prev.filter((s) => s.id !== key));
                        setSelectedKey(null);
                        setDetail(null);
                      })
                      .catch((err: unknown) => {
                        console.error('[session] 删除失败:', err);
                      });
                  }}
                  onCopyId={() => {
                    if (selectedKey !== null) {
                      void navigator.clipboard.writeText(selectedKey).catch((err: unknown) => {
                        console.error('[session] 复制失败:', err);
                      });
                    }
                  }}
                  onExport={() => {
                    if (selectedKey !== null) {
                      window.open(`/api/sessions/${encodeURIComponent(selectedKey)}/report`, '_blank');
                    }
                  }}
                  onPromptContext={() => {
                    if (selectedKey !== null) {
                      setPromptContextKey(selectedKey);
                    }
                  }}
                />
                {/* 会话视图必须有自己的滚动容器：签名区是 flex:0 0 auto，
                    没有它时时间线只能分到「剩下的高度」——1280×800 下剩 0px，
                    且 overflow 一路 visible 到 document，滚都滚不到。 */}
                <div className="session-scroll">
                <div className="session-canvas">
                  <SessionCaptureLinksPanel key={selectedKey ?? ''} sessionKey={selectedKey ?? ''} locale={locale} invalidateKey={traceLinksVersion}
                    traceExportEnabled={!offlineSamples && detail.session.dataSource === 'scan'}
                    onOpenSession={key => selectSession(key)}
                    onOpenRequest={id => { setProxyFocusedId(id); switchView('proxy'); }} />
                  {findingsResult !== null && (
                    <details className="session-findings-panel">
                      <summary>{t('session.findings', locale)}</summary>
                      <SessionFindings
                        result={findingsResult}
                        locale={locale}
                        onActivate={activateFinding}
                      />
                    </details>
                  )}
                  <TrajectoryPane
                    locale={locale}
                    sessionKey={selectedKey ?? ''}
                    detail={detail}
                    selectedTurn={selectedTurn}
                    onSelectedTurnChange={setSelectedTurn}
                    focusEventId={focusEventId}
                    focusEventRequest={focusEventRequest}
                    onSelectAgent={(key) => {
                      setFocusEventId(null);
                      selectSession(key);
                    }}
                    hasMoreEvents={detail.hasMore}
                    loadingMoreEvents={loadingMoreEvents}
                    moreEventsError={moreEventsError}
                    onLoadMoreEvents={loadMoreEvents}
                    focused={trajectoryFocus}
                    onToggleFocus={() => setTrajectoryFocus((prev) => !prev)}
                    railCollapsed={trajectoryRailCollapsed}
                    onToggleRailCollapse={() => setTrajectoryRailCollapsed((prev) => !prev)}
                  />
                  {/* REQ-121：热力图 + 8 轴能力雷达是「看一眼就够」的画像层，
                      放在时间线之后并默认折叠 —— 它们此前钉在首屏，占掉约 45%
                      高度，把用户真正要逐条读的时间线挤没了。 */}
                  <details className="session-visuals-panel">
                    <summary>{t('session.visuals', locale)}</summary>
                    <SessionVisuals detail={detail} locale={locale} />
                  </details>
                  {/* agent-collaboration-replay §5.1 / §8.3：Agent 协作回放章节，
                      紧跟会话画像之后。runIds 为空时主组件返回 null，
                      章节内容为空（spec §5.1.1 规则 2）。
                      §8.3：内容区包 .collab-replay-body 支持垂直滚动 + sticky summary。 */}
                  <details className="session-collab-replay-panel">
                    <summary>{t('session.teamReplay.title', locale)}</summary>
                    <div className="collab-replay-body">
                      <AgentCollabReplay sessionKey={selectedKey ?? ''} locale={locale} />
                    </div>
                  </details>
                </div>
                </div>
              </div>
            )}
          </main>
        </div>
      )}
      {view === 'agent' && (
        <div className="view-body">
          <main className="main">
            <ErrorBoundary label={t('view.agent',locale)}>
            <Suspense fallback={<p role="status">{t('common.loading',locale)}</p>}>
            <AgentOverview
              locale={locale}
              sessions={sessions}
              onCompareProviders={startCompare}
              onBrowseSessions={(provider) => {
                setSessionQ('');setSessionRange('all');setProviderFilter(provider === undefined ? [] : [provider]);setStatusFilter([]);switchView('session');
              }}
              onSelectSession={(key) => {
                switchView('session');
                selectSession(key);
              }}
            />
            </Suspense>
            </ErrorBoundary>
          </main>
        </div>
      )}
      {view === 'compare' && (
        <div className="view-body">
          <main className="main">
            <Suspense fallback={<p role="status">{t('common.loading', locale)}</p>}>
            <CompareBoard
              sessions={sessions}
              sessionsLoading={sessionsLoading}
              locale={locale}
              leftKey={compareLeft}
              rightKey={compareRight}
              onLeftChange={setCompareLeft}
              onRightChange={setCompareRight}
              onOpenRun={(key,eventId)=>{
                setTaskRoute({ ...taskRoute, task: 'collected:' + key, origin: 'collected', member: 'main', event: eventId === undefined ? null : key + ':event:' + eventId }); switchView('task');
                if(eventId!==undefined){setFocusEventId(eventId);setFocusEventRequest(value=>value+1);}
              }}
              onOpenCalls={()=>switchView('proxy')}
              onBrowseRuns={()=>{setSessionQ('');setSessionRange('all');setProviderFilter([]);setStatusFilter([]);switchView('session');}}
            />
            </Suspense>
          </main>
        </div>
      )}
      {view === 'proxy' && (
        <div className="view-body">
          <main className="main">
            <ErrorBoundary label={t('view.proxy',locale)}>
            <Suspense fallback={<p role="status">{t('common.loading', locale)}</p>}>
            <ProxyView key={liveReset} locale={locale} liveStatus={proxyLiveStatus} liveUpdates={proxyLiveUpdates}
              latestHookId={latestHookId}
              sessions={sessions} focusedRequestId={proxyFocusedId} onFocusedRequestHandled={clearProxyFocus} traceInvalidateKey={traceLinksVersion}
              livePreview={<Suspense fallback={<p role="status">{t('common.loading', locale)}</p>}><ProxyLivePanel streams={proxyStreams} locale={locale} invalidateKey={traceLinksVersion}
                onOpenSession={key => { setTaskRoute({ ...taskRoute, task: 'collected:' + key, origin: 'collected', member: 'main', event: null }); switchView('task'); }} /></Suspense>}
              onOpenSession={key => { setTaskRoute({ ...taskRoute, task: 'collected:' + key, origin: 'collected', member: 'main', event: null }); switchView('task'); }} />
            </Suspense>
            </ErrorBoundary>
          </main>
        </div>
      )}
      {view === 'frida' && (
        <div className="view-body">
          <main className="main">
            <ErrorBoundary label={t('view.frida',locale)}>
            <Suspense fallback={<p role="status">{t('common.loading',locale)}</p>}>
              <FridaView key={liveReset} locale={locale} liveStatus={fridaLiveStatus} savedNotifications={fridaSaved} connected={live} />
            </Suspense>
            </ErrorBoundary>
          </main>
        </div>
      )}
      {view === 'mission' && (
        <div className="view-body">
          <MissionControl
            locale={locale}
            initialRange={missionRange}
            invalidateKey={missionInvalidateKey}
          />
        </div>
      )}
      {view === 'team' && (
        <div className="view-body">
          <ErrorBoundary label={t('team.runListTitle',locale)}>
          <Suspense fallback={<p role="status">{t('common.loading',locale)}</p>}>
          <TeamShell
            locale={locale}
            teamHash={teamHash}
            onTeamHashChange={setTeamHash}
            invalidateKey={teamInvalidateKey}
          />
          </Suspense>
          </ErrorBoundary>
        </div>
      )}

      {settingsOpen && (
        <ErrorBoundary label={t('settings.title',locale)} fallback={()=>
          <Modal title={t('settings.title',locale)} onClose={()=>setSettingsOpen(false)}>
            <p role="alert">{t('state.error',locale)} · {t('settings.codeFailed',locale)}</p>
          </Modal>}>
          <Suspense fallback={<Modal title={t('settings.title',locale)} onClose={()=>setSettingsOpen(false)}><p role="status">{t('common.loading',locale)}</p></Modal>}>
            <SettingsModal locale={locale} onClose={() => setSettingsOpen(false)} />
          </Suspense>
        </ErrorBoundary>
      )}
      {promptContextKey !== null && (
        <PromptContextModal
          sessionKey={promptContextKey}
          locale={locale}
          onClose={() => setPromptContextKey(null)}
        />
      )}
      {paletteOpen && PaletteComponent !== null && (
        <PaletteComponent
          sessions={sessions}
          locale={locale}
          events={(detail?.events ?? []) as TraceEventSlim[]}
          view={view}
          providerFilter={providerFilter}
          onClose={() => setPaletteOpen(false)}
          onAction={(action) => {
            setPaletteHintSeen(true);
            storeBool(LAYOUT_KEYS.paletteHintSeen, true);
            if (action.type === 'session') {
              selectSession(action.key);
            } else if (action.type === 'compare') {
              // REQ-111：直接进对比视图，会话 key 来自共享 store（不发额外请求）。
              setCompareLeft(action.left);
              setCompareRight(action.right);
              switchView('compare');
            } else if (action.type === 'goto') {
              // REQ-112：定位到目标事件所在的回合（focusEventId 驱动 TrajectoryPane 展开滚动）。
              setFocusEventId(action.eventId);
              setFocusEventRequest(value => value + 1);
            } else if (action.type === 'filter') {
              // REQ-113：再次选择同一 provider 取消过滤。
              setProviderFilter((prev) =>
                view === 'task' ? prev.includes(action.provider) ? [] : [action.provider] : prev.includes(action.provider)
                  ? prev.filter((p) => p !== action.provider)
                  : [...prev, action.provider],
              );
            } else if (action.type === 'view') {
              switchView(action.view as AppView);
            } else if (action.type === 'theme') {
              theme.cycle();
            } else if (action.type === 'language') {
              setLocale(locale === 'zh' ? 'en' : 'zh');
            } else if (action.type === 'scan') {
              triggerScan();
            } else if (action.type === 'settings') {
              setSettingsOpen(true);
            } else if (action.type === 'export' && selectedKey !== null) {
              window.open(`/api/sessions/${encodeURIComponent(selectedKey)}/report`, '_blank');
            }
          }}
        />
      )}
      {helpOpen && <HelpModal locale={locale} onClose={() => setHelpOpen(false)} />}
      {!paletteHintSeen && view === 'session' && (
        <div className="palette-hint mono">{t('palette.hint', locale)}</div>
      )}
      <StatusBar
        live={live}
        locale={locale}
        /* 状态栏是系统级读数：显示全库总量，不是当前筛选/已加载的那一页。
           筛选后的条数由列表底部的「共 N 条」负责。 */
        sessionCount={health?.sessionCount ?? sessionTotal}
        eventCount={health?.eventCount ?? 0}
        scanning={scanning}
        lastScanAt={lastScanAt}
        dbSizeBytes={health?.dbSizeBytes ?? null}
        walSizeBytes={health?.walSizeBytes ?? null}
        offlineSamples={offlineSamples}
        onScan={triggerScan}
      />
    </div>
  );
}
