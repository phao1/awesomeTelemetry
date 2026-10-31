import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { t, type Locale } from '../../i18n.js';
import type {
  SessionDetailResponse,
  SessionIndexEntry,
  SessionMergeGroupInfo,
  TraceEvent,
  TraceEventRaw,
  TraceEventSlim,
} from '../../core/trace-types.js';
import { deriveTurns, turnKeySourceForProvider } from '../../core/turn-model.js';
import { TrajectoryRail } from './TrajectoryRail.js';
import { TrajectoryStatBar } from './TrajectoryStatBar.js';
import { TurnList } from './TurnList.js';
import { TurnNavigator } from './TurnNavigator.js';
import { AgentHierarchyPanel } from './AgentHierarchyPanel.js';
import { TrajectoryAnalysisPanel } from './TrajectoryAnalysisPanel.js';
import { InvestigationToolbar } from './InvestigationToolbar.js';
import { RecordInspector } from './RecordInspector.js';

export interface TrajectoryPaneProps {
  locale: Locale;
  sessionKey: string;
  /** 已加载的 slim detail（App 持有；打开时恰好一次请求，D16）。 */
  detail: SessionDetailResponse;
  /** hash `turn`：选中的回合索引（D18），受控。 */
  selectedTurn: number | null;
  onSelectedTurnChange: (index: number | null) => void;
  /** findings / 命令面板定位事件 → 展开并滚动到其所在回合。 */
  focusEventId?: string | null;
  /** Distinguishes repeated explicit jumps to the same event from metadata refreshes. */
  focusEventRequest?: number;
  /** Agent 层级切换 agent（App 重新 selectSession）。 */
  onSelectAgent: (key: string) => void;
  hasMoreEvents?: boolean;
  loadingMoreEvents?: boolean;
  moreEventsError?: string | null;
  onLoadMoreEvents?: () => void;
  focused?: boolean;
  onToggleFocus?: () => void;
  railCollapsed: boolean;
  onToggleRailCollapse: () => void;
  /** 测试注入（默认走 api；请求预算断言用）。 */
  fetchGroups?: () => Promise<{ groups: SessionMergeGroupInfo[] }>;
  fetchMembers?: (keys: string[]) => Promise<{ items: SessionIndexEntry[] }>;
  loadDetail?: (key: string, eventId: string) => Promise<TraceEvent>;
  loadRaw?: (key: string, eventId: string) => Promise<TraceEventRaw>;
}

/**
 * D2 TrajectoryPane：会话详情主区 —— 上下文 rail（Agent 层级）与
 * turn 区域（单行等宽回合导航 + 回合列表）。
 * SessionHeaderCard 保留在上方；统计和分析按需在列表下方展开。
 *
 * D16 请求预算：detail 打开 = slim；session-groups 按需；
 * ≥2 成员时 1 次批量 keys 拉取；卡正文 / Raw 各 ≤1 次（LRU 缓存）；
 * 回合展开/折叠、分析面板打开 = 0 请求。
 */
export function TrajectoryPane({
  locale,
  sessionKey,
  detail,
  selectedTurn,
  onSelectedTurnChange,
  focusEventId = null,
  focusEventRequest = 0,
  onSelectAgent,
  hasMoreEvents = false,
  loadingMoreEvents = false,
  moreEventsError = null,
  onLoadMoreEvents,
  focused = false,
  onToggleFocus,
  railCollapsed,
  onToggleRailCollapse,
  fetchGroups,
  fetchMembers,
  loadDetail,
  loadRaw,
}: TrajectoryPaneProps): React.JSX.Element {
  const turnKeySource = useMemo(
    () => turnKeySourceForProvider(detail.session.provider),
    [detail.session.provider],
  );
  const model = useMemo(
    () => deriveTurns(detail.events as TraceEventSlim[], detail, turnKeySource),
    [detail, turnKeySource],
  );

  /** 双向高亮：列表滚动写回 top-most visible 回合（rAF 节流在 TurnList）。 */
  const [activeTurnIndex, setActiveTurnIndex] = useState<number | null>(model.turns.find(turn => turn.index === selectedTurn)?.index ?? model.turns[0]?.index ?? null);
  const [extensionsOpen, setExtensionsOpen] = useState(false);
  /** 回合导航 / findings 定位目标（TurnList 滚动 + 展开，零请求）。 */
  const [focusTurnIndex, setFocusTurnIndex] = useState<number | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const [inspected, setInspected] = useState<{ sessionKey: string; eventId: string } | null>(null);
  const externalFocusHandled = useRef<string | null>(null);
  const inspectorOpener = useRef<HTMLElement | null>(null);
  const closeInspector = useCallback(() => setInspected(null), []);
  const inspectedMessage = inspected?.sessionKey === sessionKey
    ? model.turns.flatMap(turn => turn.messages).find(message => message.eventId === inspected.eventId) ?? null : null;

  useEffect(() => {
    setActiveTurnIndex(model.turns.find(turn => turn.index === selectedTurn)?.index ?? model.turns[0]?.index ?? null);
    setFocusTurnIndex(null);
  }, [sessionKey]);

  // findings / 命令面板：focusEventId → 其所在回合。
  useEffect(() => {
    if (focusEventId === null) {
      externalFocusHandled.current = null;
      return;
    }
    const signature = JSON.stringify([sessionKey, focusEventId, focusEventRequest]);
    if (externalFocusHandled.current === signature) return;
    const index = model.turns.findIndex((turn) =>
      turn.messages.some((message) => message.eventId === focusEventId),
    );
    if (index >= 0) {
      setFocusTurnIndex(model.turns[index]!.index);
      setFocusRequest((prev) => prev + 1);
      setInspected({ sessionKey, eventId: focusEventId });
      externalFocusHandled.current = signature;
    }
  }, [focusEventId, focusEventRequest, model, sessionKey]);

  const toggleTurn = (index: number): void => {
    onSelectedTurnChange(selectedTurn === index ? null : index);
    setActiveTurnIndex(index);
  };

  const activateSegment = (index: number): void => {
    setFocusTurnIndex(index);
    setFocusRequest((prev) => prev + 1);
    setActiveTurnIndex(index);
    const scroller = document.querySelector<HTMLElement>('.session-scroll');
    const readingArea = document.querySelector<HTMLElement>('.turn-list');
    const navigator = document.querySelector<HTMLElement>('.trajectory-overview');
    const investigation = document.querySelector<HTMLElement>('.investigation-toolbar');
    if (scroller && readingArea && navigator) {
      const gap = readingArea.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      const visibleTop = navigator.getBoundingClientRect().height + (investigation?.getBoundingClientRect().height ?? 0);
      scroller.scrollTop += gap - visibleTop;
    }
  };

  const turnCount = model.complete ? model.turns.length : null;
  const inspectEvent = (eventId: string): void => {
    const turn = model.turns.find(item => item.messages.some(message => message.eventId === eventId));
    if (!turn) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && !active.closest('.record-inspector')) {
      inspectorOpener.current = active.closest('.investigation-search-results')
        ? document.querySelector<HTMLInputElement>('.investigation-toolbar input') : active;
    }
    setInspected({ sessionKey, eventId });
    activateSegment(turn.index);
  };

  const rail = (
    <>
      <AgentHierarchyPanel
        locale={locale}
        sessionKey={sessionKey}
        session={detail.session}
        turnCount={turnCount}
        onSelectAgent={onSelectAgent}
        fetchGroups={fetchGroups}
        fetchMembers={fetchMembers}
      />
    </>
  );

  const turnArea = (
    <TurnList
      model={model}
      hasMore={hasMoreEvents}
      loadingMore={loadingMoreEvents}
      loadMoreError={moreEventsError}
      onLoadMore={onLoadMoreEvents}
      sessionKey={sessionKey}
      locale={locale}
      durationSource={detail.session.durationSource}
      expandedIndex={selectedTurn}
      onToggleTurn={toggleTurn}
      onActiveTurnChange={setActiveTurnIndex}
      focusTurnIndex={focusTurnIndex}
      focusRequest={focusRequest}
      loadDetail={loadDetail}
      loadRaw={loadRaw}
      onInspect={inspectEvent}
    />
  );

  return (
    <div className="trajectory-pane">
      <InvestigationToolbar key={sessionKey} model={model} locale={locale} selectedEventId={inspectedMessage?.eventId ?? null}
        onInspect={inspectEvent} focused={focused} onToggleFocus={onToggleFocus}
        agentsOpen={!railCollapsed} onToggleAgents={onToggleRailCollapse} />
      <div className="trajectory-reading-layout">
      <div className="trajectory-reading-main">
      <section className="trajectory-overview" aria-label={t('trajectory.overview', locale)}>
        <TurnNavigator model={model} locale={locale}
          activeTurnIndex={activeTurnIndex} onActivate={activateSegment} />
      </section>
      <TrajectoryRail
        rail={rail}
        turnArea={turnArea}
        collapsed={railCollapsed || focused}
        onToggleCollapse={onToggleRailCollapse}
      />
      </div>
      {inspectedMessage !== null && <RecordInspector sessionKey={sessionKey} session={detail.session}
        message={inspectedMessage} locale={locale} onClose={closeInspector} loadDetail={loadDetail} loadRaw={loadRaw} restoreFocusRef={inspectorOpener} />}
      </div>
      <details className="trajectory-extensions" onToggle={(event) => setExtensionsOpen(event.currentTarget.open)}>
        <summary>{t('trajectory.analysis.title', locale)} · {t('trajectory.stats.expand', locale)}</summary>
        <TrajectoryStatBar locale={locale} model={model} session={detail.session}
          agentLabel={detail.session.sourceAgent} turnKeySource={turnKeySource} />
        {extensionsOpen && <TrajectoryAnalysisPanel model={model} locale={locale} onActivate={activateSegment} />}
      </details>
    </div>
  );
}
