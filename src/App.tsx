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
  TraceEventSlim,
  TracePhase,
  TraceStatus,
} from './core/trace-types.js';
import { TRACE_PHASES } from './core/trace-types.js';
import {
  errorMessage,
  getStoredLocale,
  setActiveLocale,
  storeLocale,
  t,
  type Locale,
} from './i18n.js';
import { api, ApiError } from './api/client.js';
import { invalidateSessionDetail, recordCache } from './cache/caches.js';
import { mergeSessionsPatch } from './core/list-utils.js';
import { localSamples } from './generated/local-samples.js';
import { LanguageToggle } from './components/LanguageToggle.js';
import { LiveIndicator } from './components/LiveIndicator.js';
import { SessionList } from './components/SessionList.js';
import { SessionToolbar } from './components/SessionToolbar.js';
import { SessionFindings } from './components/SessionFindings.js';
import { PhaseRibbon } from './components/PhaseRibbon.js';
import { SessionVisuals } from './components/SessionVisuals.js';
import { PhaseTiles } from './components/PhaseTiles.js';
import { TimeCompositionBar } from './components/TimeCompositionBar.js';
import { computeTimeComposition, type TimeSegmentKey } from './core/time-composition.js';
import { computePhaseTrends } from './core/phase-trend.js';
import { TrajectoryPane } from './components/trajectory/TrajectoryPane.js';
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
  loadRibbonMode,
  storeBool,
  storeNumber,
  storeRibbonMode,
} from './layout.js';
import {
  installKeyboardShortcuts,
  registerShortcut,
  setEscapeFallback,
} from './keyboard.js';
import { HelpModal } from './components/HelpModal.js';
import { parseHash, serializeHash, type HashState, type RibbonMode } from './hash-router.js';
import type { CommandPaletteProps } from './components/CommandPalette.js';
import { computeFindings, type Finding } from './core/session-findings.js';

/** --ui-scale 的基准字号：fontPx 等于它时缩放为 1（同 tokens.css §3.1 的 --text-base）。 */
const BASE_FONT_PX = 13;
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
  const [health, setHealth] = useState<{
    dbSizeBytes: number;
    walSizeBytes: number;
    sessionCount: number;
    eventCount: number;
  } | null>(null);
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
  const [timeSegFilter, setTimeSegFilter] = useState<TimeSegmentKey | null>(null);
  // fix-session-detail-display delta：会话列表服务端过滤 + 甘特布局模式
  const [sessionQ, setSessionQ] = useState(() => INITIAL_HASH?.q ?? '');
  const [sessionRange, setSessionRange] = useState<SessionRange>(
    () => INITIAL_HASH?.time ?? 'today',
  );
  const [sessionTotal, setSessionTotal] = useState(0);
  const sessionCursorRef = useRef<string | null>(null);
  // REQ-026：布局偏好持久化（读取时范围校验）
  const [railWidth, setRailWidth] = useState(() =>
    loadNumber(LAYOUT_KEYS.railWidth, 300, LAYOUT_RANGES.railWidth),
  );
  const [railCollapsed, setRailCollapsed] = useState(() =>
    loadBool(LAYOUT_KEYS.railCollapsed, false),
  );
  // add-trajectory-inspector D18：色带模式（hash 优先于 localStorage）。
  const [ribbonMode, setRibbonMode] = useState<RibbonMode>(
    () => INITIAL_HASH?.ribbon ?? loadRibbonMode(LAYOUT_KEYS.trajectoryRibbonMode),
  );
  const [selectedTurn, setSelectedTurn] = useState<number | null>(
    () => INITIAL_HASH?.turn ?? null,
  );
  /** 轨迹 rail（详情内右栏）折叠态；宽度由 SplitPane 自行持久化（D18）。 */
  const [trajectoryRailCollapsed, setTrajectoryRailCollapsed] = useState(false);
  const [fontPx, setFontPx] = useState(() =>
    loadNumber(LAYOUT_KEYS.fontSize, BASE_FONT_PX, LAYOUT_RANGES.fontSize),
  ); // REQ-012：8–28px
  const [settingsOpen, setSettingsOpen] = useState(false);
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
  const [focusEventId, setFocusEventId] = useState<string | null>(null);
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
    // ui/* 基础组件不接收 locale prop，其 aria-label 走 ta() 读这里的当前语言。
    setActiveLocale(locale);
  }, [locale]);

  const switchView = useCallback((next: AppView) => {
    startTransition(() => setView(next)); // REQ-002：视图切换用 startTransition
  }, []);

  useEffect(() => {
    storeNumber(LAYOUT_KEYS.railWidth, railWidth);
  }, [railWidth]);
  useEffect(() => {
    storeBool(LAYOUT_KEYS.railCollapsed, railCollapsed);
  }, [railCollapsed]);
  useEffect(() => {
    storeRibbonMode(LAYOUT_KEYS.trajectoryRibbonMode, ribbonMode);
  }, [ribbonMode]);
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

  const timeComposition = useMemo(
    () => computeTimeComposition((detail?.events ?? []) as TraceEventSlim[]),
    [detail],
  );
  const phaseCounts = useMemo(() => {
    const counts = Object.fromEntries(
      TRACE_PHASES.map((phase) => [phase, 0]),
    ) as Record<TracePhase, number>;
    for (const e of detail?.events ?? []) {
      counts[e.phase as TracePhase] += 1;
    }
    return counts;
  }, [detail]);
  const phaseTrends = useMemo(
    () => computePhaseTrends((detail?.events ?? []) as TraceEventSlim[]),
    [detail],
  );
  const visibleEvents = useMemo(() => {
    if (detail === null) {
      return [];
    }
    let events = detail.events.filter((e) => deferredPhaseFilter.includes(e.phase as TracePhase));
    if (timeSegFilter !== null) {
      const segment = timeComposition.segments.find((s) => s.key === timeSegFilter);
      if (segment !== undefined) {
        const ids = new Set(segment.eventIds);
        events = events.filter((e) => ids.has(e.id));
      }
    }
    return events;
  }, [detail, deferredPhaseFilter, timeSegFilter, timeComposition]);

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
          // 甘特与 Inspector 已删除：定位到目标事件所在的回合。
          setFocusEventId(target.id);
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
      setFocusEventId(null);
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
    add({ key: ']' }, () => setTrajectoryRailCollapsed((prev) => !prev));
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
  }, [sessions, cursorIndex, selectSession, switchView, theme, setRailCollapsed]);

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
      ...(view === 'session' ? { ribbon: ribbonMode } : {}),
      ...(view === 'session' && selectedTurn !== null ? { turn: selectedTurn } : {}),
      ...(compareLeft !== '' ? { left: compareLeft } : {}),
      ...(compareRight !== '' ? { right: compareRight } : {}),
      ...(view === 'mission' ? { range: missionRange } : {}),
    };
    history.replaceState(null, '', serializeHash(state));
  }, [view, selectedKey, phaseFilter, providerFilter, statusFilter, sessionQ, sessionRange, ribbonMode, selectedTurn, compareLeft, compareRight, missionRange]);

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
      if (state.ribbon !== undefined) {
        setRibbonMode(state.ribbon);
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
    <div className="app">
      <AppHeader locale={locale}>
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
                  /* 这里曾复用通用空态文案「暂无数据」——它说的是「没有数据」，
                     而实际状态是「你还没选」，两句话互相矛盾。改成引导语。 */
                  description={t('session.selectHint', locale)}
                />
              )}
            {detail !== null && detail.events.length > 0 && (
              <div className="session-inspector">
                <SessionToolbar
                  session={detail.session}
                  events={detail.events as TraceEventSlim[]}
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
                <div className="session-signals">
                  <PhaseRibbon
                    events={detail.events as TraceEventSlim[]}
                    active={phaseFilter}
                    onSelectOnly={(phase) => setPhaseFilter([phase])}
                    locale={locale}
                  />
                  <TimeCompositionBar
                    composition={timeComposition}
                    locale={locale}
                    active={timeSegFilter}
                    onToggle={setTimeSegFilter}
                  />
                  <PhaseTiles
                    active={phaseFilter}
                    onToggle={togglePhase}
                    locale={locale}
                    counts={phaseCounts}
                    visibleCount={visibleEvents.length}
                    onSelectAll={() => setPhaseFilter([...TRACE_PHASES])}
                    onClearAll={() => setPhaseFilter([])}
                    findingPhases={[]}
                    trends={phaseTrends}
                  />
                </div>
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
                  <TrajectoryPane
                    locale={locale}
                    sessionKey={selectedKey ?? ''}
                    detail={detail}
                    ribbonMode={ribbonMode}
                    onRibbonModeChange={setRibbonMode}
                    selectedTurn={selectedTurn}
                    onSelectedTurnChange={setSelectedTurn}
                    focusEventId={focusEventId}
                    onSelectAgent={(key) => {
                      setFocusEventId(null);
                      selectSession(key);
                    }}
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
              sessionsLoading={sessionsLoading}
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
            } else if (action.type === 'filter') {
              // REQ-113：再次选择同一 provider 取消过滤。
              setProviderFilter((prev) =>
                prev.includes(action.provider)
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
