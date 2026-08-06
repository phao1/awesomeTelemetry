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
  ProviderKey,
  SessionDetailResponse,
  SessionIndexEntry,
  SessionRange,
  TraceEvent,
  TraceEventSlim,
  TracePhase,
  TraceStatus,
} from './core/trace-types.js';
import { TRACE_PHASES } from './core/trace-types.js';
import { errorMessage, getStoredLocale, storeLocale, t, type Locale } from './i18n.js';
import { api, ApiError } from './api/client.js';
import { invalidateSessionDetail, recordCache } from './cache/caches.js';
import { mergeSessionsPatch } from './core/list-utils.js';
import { localSamples } from './generated/local-samples.js';
import { LanguageToggle } from './components/LanguageToggle.js';
import { LiveIndicator } from './components/LiveIndicator.js';
import { SessionList } from './components/SessionList.js';
import { SessionToolbar } from './components/SessionToolbar.js';
import { SessionFindings } from './components/SessionFindings.js';
import { TraceTimeline } from './components/TraceTimeline.js';
import { EventInspector } from './components/EventInspector.js';
import { AgentOverview } from './components/AgentOverview.js';
import { CompareBoard } from './components/CompareBoard.js';
import { ProxyView } from './components/ProxyView.js';
import { FridaView } from './components/FridaView.js';
import { MissionControl, type MissionRange } from './components/MissionControl.js';
import { SettingsModal } from './components/SettingsModal.js';

/** 错误展示本地化：已知错误码按当前语言翻译，未知码回退原始 message。 */
function formatError(err: unknown, locale: Locale): string {
  if (err instanceof ApiError) {
    const localized = errorMessage(err.code, locale);
    return localized === err.code ? err.message : localized;
  }
  return err instanceof Error ? err.message : String(err);
}
import { TranscriptModal } from './components/TranscriptModal.js';
import { TokenTextModal } from './components/TokenTextModal.js';
import { PromptContextModal } from './components/PromptContextModal.js';
import { ThemeToggle } from './components/ThemeToggle.js';
import { ErrorState, EmptyState } from './components/ui/States.js';
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
import { parseHash, serializeHash, type HashState, type TimelineLayout } from './hash-router.js';
import type { CommandPaletteProps } from './components/CommandPalette.js';
import { computeFindings, type Finding } from './core/session-findings.js';

const PAGE_SIZE = 2000;
/** 首帧 hash 在模块加载时解析一次：避免 state→hash 写入 effect 先把它覆盖掉。 */
const INITIAL_HASH = parseHash(window.location.hash);

interface PaletteModule {
  CommandPalette: (props: CommandPaletteProps) => React.JSX.Element;
}

/** REQ-001：五视图 shell，App.tsx 是唯一 stateful shell。 */
export default function App() {
  const [view, setView] = useState<AppView>(() => INITIAL_HASH?.view ?? 'session');
  const [locale, setLocaleState] = useState<Locale>(() => getStoredLocale());
  const localeRef = useRef<Locale>(locale);
  const theme = useTheme();
  const [live, setLive] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [lastScanAt, setLastScanAt] = useState<string | null>(null);
  const [health, setHealth] = useState<{ dbSizeBytes: number; walSizeBytes: number } | null>(null);
  const [sessions, setSessions] = useState<SessionIndexEntry[]>([]);
  const [hasMoreSessions, setHasMoreSessions] = useState(false);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [offlineSamples, setOfflineSamples] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(() => INITIAL_HASH?.key ?? null);
  const [detail, setDetail] = useState<SessionDetailResponse | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [phaseFilter, setPhaseFilter] = useState<TracePhase[]>(() => {
    const phases = INITIAL_HASH?.phase;
    if (phases === undefined) {
      return [...TRACE_PHASES];
    }
    const valid = phases.filter((phase): phase is TracePhase =>
      (TRACE_PHASES as readonly string[]).includes(phase),
    );
    return valid.length > 0 ? valid : [...TRACE_PHASES];
  });
  const deferredPhaseFilter = useDeferredValue(phaseFilter); // REQ-002
  const [semanticGroup, setSemanticGroup] = useState(true);
  const [selectedEvent, setSelectedEvent] = useState<TraceEventSlim | null>(null);
  const [detailPage, setDetailPage] = useState(0);
  // fix-session-detail-display delta：会话列表服务端过滤 + 甘特布局模式
  const [sessionQ, setSessionQ] = useState(() => INITIAL_HASH?.q ?? '');
  const [sessionRange, setSessionRange] = useState<SessionRange>(
    () => INITIAL_HASH?.time ?? 'today',
  );
  const [sessionTotal, setSessionTotal] = useState(0);
  const [layoutMode, setLayoutMode] = useState<TimelineLayout>(
    () => INITIAL_HASH?.layout ?? 'time',
  );
  const sessionCursorRef = useRef<string | null>(null);
  // REQ-026：布局偏好持久化（读取时范围校验）
  const [railWidth, setRailWidth] = useState(() =>
    loadNumber(LAYOUT_KEYS.railWidth, 300, LAYOUT_RANGES.railWidth),
  );
  const [inspectorWidth, setInspectorWidth] = useState(() =>
    loadNumber(LAYOUT_KEYS.inspectorWidth, 420, LAYOUT_RANGES.inspectorWidth),
  );
  const [railCollapsed, setRailCollapsed] = useState(() =>
    loadBool(LAYOUT_KEYS.railCollapsed, false),
  );
  const [inspectorCollapsed, setInspectorCollapsed] = useState(() =>
    loadBool(LAYOUT_KEYS.inspectorCollapsed, false),
  );
  const [fontPx, setFontPx] = useState(() =>
    loadNumber(LAYOUT_KEYS.fontSize, 14, LAYOUT_RANGES.fontSize),
  ); // REQ-012：8–28px
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [transcriptEvent, setTranscriptEvent] = useState<TraceEventSlim | null>(null);
  const [tokenEvent, setTokenEvent] = useState<TraceEventSlim | null>(null);
  const [promptContextKey, setPromptContextKey] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [PaletteComponent, setPaletteComponent] = useState<PaletteModule['CommandPalette'] | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [cursorIndex, setCursorIndex] = useState(0);
  const [providerFilter, setProviderFilter] = useState<ProviderKey[]>(
    () => (INITIAL_HASH?.provider as ProviderKey[]) ?? [],
  );
  const [statusFilter, setStatusFilter] = useState<TraceStatus[]>(
    () => (INITIAL_HASH?.status as TraceStatus[]) ?? [],
  );
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
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const selectedKeyRef = useRef<string | null>(null);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    storeLocale(next);
  }, []);

  useEffect(() => {
    localeRef.current = locale;
    document.documentElement.lang = locale;
  }, [locale]);

  const switchView = useCallback((next: AppView) => {
    startTransition(() => setView(next)); // REQ-002：视图切换用 startTransition
  }, []);

  useEffect(() => {
    storeNumber(LAYOUT_KEYS.railWidth, railWidth);
  }, [railWidth]);
  useEffect(() => {
    storeNumber(LAYOUT_KEYS.inspectorWidth, inspectorWidth);
  }, [inspectorWidth]);
  useEffect(() => {
    storeBool(LAYOUT_KEYS.railCollapsed, railCollapsed);
  }, [railCollapsed]);
  useEffect(() => {
    storeBool(LAYOUT_KEYS.inspectorCollapsed, inspectorCollapsed);
  }, [inspectorCollapsed]);
  useEffect(() => {
    storeNumber(LAYOUT_KEYS.fontSize, fontPx);
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
        startTransition(() => {
          setSessions((prev) => (mode === 'first' ? result.items : mergeSessionsPatch(prev, result.items)));
        });
        sessionCursorRef.current = result.nextCursor;
        setHasMoreSessions(result.hasMore);
        setSessionTotal(result.total);
        setSessionsError(null);
        setOfflineSamples(false);
      } catch (err) {
        console.error('[sessions] 列表加载失败:', err);
        setSessionsError(formatError(err, localeRef.current));
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
    const timer = setTimeout(() => {
      void loadSessions('first');
    }, 250);
    return () => clearTimeout(timer);
  }, [sessionQ, sessionRange, providerFilter, statusFilter, loadSessions]);

  // REQ-004：SSE 局部 patch——失效缓存 + 一次 keys 批量补丁，不重拉全量
  useEffect(() => {
    const es = new EventSource('/api/events');
    es.onopen = () => setLive(true);
    es.onerror = () => setLive(false);
    es.addEventListener('scan_started', () => {
      setScanning(true);
    });
    es.addEventListener('scan_completed', () => {
      setScanning(false);
      setLastScanAt(new Date().toISOString());
    });
    es.addEventListener('sessions_changed', (event) => {
      const data = JSON.parse((event as MessageEvent).data) as { keys: string[] };
      setMissionInvalidateKey((k) => k + 1);
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
            const key = selectedKeyRef.current;
            setDetail(null);
            setPending(false);
            setDetailError(null);
            void api
              .sessionDetail(key, 'slim')
              .then((result) => {
                if (selectedKeyRef.current !== key) return;
                if (result.pending) {
                  setPending(true);
                  setDetail({ ...result, events: [], eventTotal: 0, hasMore: false });
                  return;
                }
                recordCache.set(`${key}:slim`, result);
                setDetail(result);
              })
              .catch((err: unknown) => {
                console.error('[sse] 当前会话详情刷新失败:', err);
                if (selectedKeyRef.current === key) {
                  setDetailError(formatError(err, localeRef.current));
                }
              });
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
        setDetailError(null);
        return;
      }
      setDetail(null);
      setPending(false);
      setDetailError(null);
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
          setDetailError(null);
        })
        .catch((err: unknown) => {
          // REQ-022：失败必须可见 —— 错误码 + 重试（禁止空 catch）
          console.error('[detail] 会话详情加载失败:', err);
          setDetailError(formatError(err, localeRef.current));
        });
    },
    [],
  );

  const loadMoreEvents = useCallback(() => {
    if (selectedKey === null || detail === null || !detail.hasMore) {
      return;
    }
    const nextPage = detailPage + 1;
    void api
      .sessionDetail(selectedKey, 'slim', nextPage * PAGE_SIZE, PAGE_SIZE)
      .then((result) => {
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
      })
      .catch((err: unknown) => {
        console.error('[detail] 分页加载失败:', err);
      });
  }, [selectedKey, detail, detailPage]);

  const visibleEvents = useMemo(
    () =>
      detail === null
        ? []
        : detail.events.filter((e) => deferredPhaseFilter.includes(e.phase)),
    [detail, deferredPhaseFilter],
  );

  // ui-design-v2 §3.1：会话诊断（L1）——只依赖已有 slim 数据。
  const findingsResult = useMemo(
    () => (detail !== null && detail.events.length > 0 ? computeFindings(detail.session, detail.events as TraceEventSlim[]) : null),
    [detail],
  );
  const activateFinding = useCallback(
    (finding: Finding) => {
      if (finding.evidence.eventIds.length > 0 && detail !== null) {
        const targetIds = new Set(finding.evidence.eventIds);
        const target = detail.events.find((e) => targetIds.has(e.id));
        if (target !== undefined) {
          setSelectedEvent(target);
          return;
        }
      }
      if (finding.evidence.phase !== undefined) {
        setPhaseFilter([finding.evidence.phase]);
      }
    },
    [detail],
  );

  const startCompare = useCallback(
    (left: ProviderKey, right: ProviderKey) => {
      const pick = (provider: ProviderKey): string | null => {
        const candidates = sessions
          .filter((s) => s.provider === provider)
          .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
        return candidates[0]?.id ?? null;
      };
      let leftKey = pick(left);
      let rightKey = pick(right);
      // 同一 provider 选了两个 Agent 时，退化为该 provider 最近的两个不同会话。
      if (left === right && leftKey !== null && rightKey !== null && leftKey === rightKey) {
        const candidates = sessions
          .filter((s) => s.provider === left)
          .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
        leftKey = candidates[0]?.id ?? null;
        rightKey = candidates[1]?.id ?? candidates[0]?.id ?? null;
      }
      if (leftKey !== null) {
        setCompareLeft(leftKey);
      }
      if (rightKey !== null) {
        setCompareRight(rightKey);
      }
      switchView('compare');
    },
    [sessions, switchView],
  );

  const togglePhase = useCallback((phase: TracePhase) => {
    setPhaseFilter((prev) =>
      prev.includes(phase) ? prev.filter((p) => p !== phase) : [...prev, phase],
    );
  }, []);

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
      setSelectedEvent(null);
      setCursorIndex(-1);
    });
    return () => setEscapeFallback(null);
  }, []);

  // REQ-008（D1）：单一全局监听 + 映射表
  useEffect(() => {
    const unsubs: Array<() => void> = [];
    const add = (spec: Parameters<typeof registerShortcut>[0], handler: () => void): void => {
      unsubs.push(registerShortcut(spec, handler));
    };
    add({ key: '1' }, () => switchView('session'));
    add({ key: '2' }, () => switchView('agent'));
    add({ key: '3' }, () => switchView('compare'));
    add({ key: '4' }, () => switchView('proxy'));
    add({ key: '5' }, () => switchView('frida'));
    add({ key: '6' }, () => switchView('mission'));
    add({ key: '/' }, () => searchInputRef.current?.focus());
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
    add({ key: ']' }, () => setInspectorCollapsed((prev) => !prev));
    add({ key: '\\', ctrlOrMeta: true }, () => theme.cycle());
    add({ key: 'k', ctrlOrMeta: true }, () => {
      setPaletteOpen((prev) => {
        if (!prev) {
          void import('./components/CommandPalette.js').then((module) => {
            setPaletteComponent(() => module.CommandPalette);
          });
        }
        return !prev;
      });
    });
    add({ key: '?' }, () => setHelpOpen((prev) => !prev));
    return () => {
      for (const unsubscribe of unsubs) {
        unsubscribe();
      }
    };
  }, [sessions, cursorIndex, selectSession, switchView, theme, setRailCollapsed, setInspectorCollapsed]);

  // REQ-024（D3）：状态变 → 写 hash（replaceState 不触发 hashchange，避免循环）
  useEffect(() => {
    const state: HashState = {
      view,
      ...(selectedKey !== null ? { key: selectedKey } : {}),
      ...(phaseFilter.length < TRACE_PHASES.length ? { phase: phaseFilter } : {}),
      ...(providerFilter.length > 0 ? { provider: providerFilter } : {}),
      ...(statusFilter.length > 0 ? { status: statusFilter } : {}),
      ...(sessionQ !== '' ? { q: sessionQ } : {}),
      ...(view === 'session' ? { time: sessionRange } : {}),
      ...(view === 'session' ? { layout: layoutMode } : {}),
      ...(compareLeft !== '' ? { left: compareLeft } : {}),
      ...(compareRight !== '' ? { right: compareRight } : {}),
      ...(view === 'mission' ? { range: missionRange } : {}),
    };
    history.replaceState(null, '', serializeHash(state));
  }, [view, selectedKey, phaseFilter, providerFilter, statusFilter, sessionQ, sessionRange, layoutMode, compareLeft, compareRight, missionRange]);

  // REQ-024：hashchange → 解析并应用（脏 hash 回落默认视图，不抛错）
  useEffect(() => {
    const onHashChange = (): void => {
      const state = parseHash(window.location.hash);
      if (state === null) {
        switchView('session');
        return;
      }
      switchView(state.view);
      if (state.key !== undefined) {
        selectSession(state.key);
      }
      if (state.phase !== undefined) {
        const valid = state.phase.filter((phase): phase is TracePhase =>
          (TRACE_PHASES as readonly string[]).includes(phase),
        );
        setPhaseFilter(valid.length > 0 ? valid : [...TRACE_PHASES]);
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
      if (state.layout !== undefined) {
        setLayoutMode(state.layout);
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

  const openTranscript = useCallback(
    (event: TraceEventSlim) => {
      setTranscriptEvent(event);
    },
    [],
  );

  return (
    <div className="app">
      <AppHeader locale={locale}>
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
      </AppHeader>
      <ViewTabs active={view} onChange={switchView} locale={locale} />

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
                <EmptyState
                  icon={<span aria-hidden="true" />}
                  title={t('session.selectPrompt', locale)}
                  description={t('state.empty', locale)}
                />
              )}
            {detail !== null && detail.events.length > 0 && (
              <div className="session-inspector">
                <SessionToolbar
                  session={detail.session}
                  events={detail.events as TraceEventSlim[]}
                  locale={locale}
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
                <div className="session-canvas">
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
                  <TraceTimeline
                    events={visibleEvents as TraceEventSlim[]}
                    total={detail.eventTotal}
                    hasMore={detail.hasMore}
                    onLoadMore={loadMoreEvents}
                    onSelectEvent={setSelectedEvent}
                    selectedEventId={selectedEvent?.id ?? null}
                    locale={locale}
                    semanticGroup={semanticGroup}
                    onSemanticGroupChange={setSemanticGroup}
                    layoutMode={layoutMode}
                    onLayoutModeChange={setLayoutMode}
                    phaseFilter={phaseFilter}
                    onPhaseToggle={togglePhase}
                  />
                </div>
              </div>
            )}
          </main>
          <EventInspector
            sessionKey={selectedKey ?? ''}
            event={selectedEvent}
            locale={locale}
            fontPx={fontPx}
            width={inspectorWidth}
            collapsed={inspectorCollapsed}
            onResize={setInspectorWidth}
            onToggleCollapse={() => setInspectorCollapsed((prev) => !prev)}
            onOpenTranscript={openTranscript}
            onOpenTokens={setTokenEvent}
            onClose={() => setSelectedEvent(null)}
            onNavigate={(direction) => {
              const index = visibleEvents.findIndex((e) => e.id === selectedEvent?.id);
              const target = visibleEvents[index + direction];
              if (target !== undefined) {
                setSelectedEvent(target);
              }
            }}
            canNavigate={{
              prev:
                selectedEvent !== null &&
                visibleEvents.findIndex((e) => e.id === selectedEvent.id) > 0,
              next:
                selectedEvent !== null &&
                visibleEvents.findIndex((e) => e.id === selectedEvent.id) < visibleEvents.length - 1,
            }}
          />
        </div>
      )}
      {view === 'agent' && (
        <div className="view-body">
          <main className="main">
            <AgentOverview
              locale={locale}
              sessions={sessions}
              onCompareProviders={startCompare}
              onSelectSession={(key) => {
                switchView('session');
                selectSession(key);
              }}
            />
          </main>
        </div>
      )}
      {view === 'compare' && (
        <div className="view-body">
          <main className="main">
            <CompareBoard
              sessions={sessions}
              locale={locale}
              leftKey={compareLeft}
              rightKey={compareRight}
              onLeftChange={setCompareLeft}
              onRightChange={setCompareRight}
            />
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
      {view === 'mission' && (
        <div className="view-body">
          <MissionControl
            locale={locale}
            initialRange={missionRange}
            invalidateKey={missionInvalidateKey}
            onOpenSession={(key) => {
              switchView('session');
              selectSession(key);
            }}
          />
        </div>
      )}

      {settingsOpen && (
        <SettingsModal locale={locale} onClose={() => setSettingsOpen(false)} />
      )}
      {transcriptEvent !== null && (
        <TranscriptModal
          sessionKey={selectedKey ?? ''}
          title={transcriptEvent.title}
          locale={locale}
          onClose={() => setTranscriptEvent(null)}
        />
      )}
      {tokenEvent !== null && (
        <TokenTextModal event={tokenEvent as TraceEvent} locale={locale} onClose={() => setTokenEvent(null)} />
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
          onClose={() => setPaletteOpen(false)}
          onAction={(action) => {
            setPaletteHintSeen(true);
            storeBool(LAYOUT_KEYS.paletteHintSeen, true);
            if (action.type === 'session') {
              selectSession(action.key);
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
        sessionCount={sessions.length}
        eventCount={sessions.reduce((sum, s) => sum + s.eventCount, 0)}
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
