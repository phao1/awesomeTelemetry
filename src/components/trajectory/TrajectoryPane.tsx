import { useEffect, useMemo, useState } from 'react';

import type { Locale } from '../../i18n.js';
import type {
  SessionAnnotations,
  SessionAnnotationsUpdate,
  SessionDetailResponse,
  SessionIndexEntry,
  SessionMergeGroupInfo,
  TraceEvent,
  TraceEventRaw,
  TraceEventSlim,
} from '../../core/trace-types.js';
import { deriveTurns, turnKeySourceForProvider } from '../../core/turn-model.js';
import type { RibbonMode } from '../../core/turn-ribbon.js';
import { TrajectoryRail } from './TrajectoryRail.js';
import { TrajectoryStatBar } from './TrajectoryStatBar.js';
import { TurnRibbon } from './TurnRibbon.js';
import { TurnList } from './TurnList.js';
import { AgentHierarchyPanel } from './AgentHierarchyPanel.js';
import { AnnotationsPanel } from './AnnotationsPanel.js';
import { TrajectoryAnalysisPanel } from './TrajectoryAnalysisPanel.js';

export interface TrajectoryPaneProps {
  locale: Locale;
  sessionKey: string;
  /** 已加载的 slim detail（App 持有；打开时恰好一次请求，D16）。 */
  detail: SessionDetailResponse;
  ribbonMode: RibbonMode;
  onRibbonModeChange: (mode: RibbonMode) => void;
  /** hash `turn`：选中的回合索引（D18），受控。 */
  selectedTurn: number | null;
  onSelectedTurnChange: (index: number | null) => void;
  /** findings / 命令面板定位事件 → 展开并滚动到其所在回合。 */
  focusEventId?: string | null;
  /** Agent 层级切换 agent（App 重新 selectSession）。 */
  onSelectAgent: (key: string) => void;
  railCollapsed: boolean;
  onToggleRailCollapse: () => void;
  /** 测试注入（默认走 api；请求预算断言用）。 */
  fetchAnnotations?: (key: string) => Promise<SessionAnnotations>;
  saveAnnotations?: (key: string, update: SessionAnnotationsUpdate) => Promise<SessionAnnotations>;
  fetchGroups?: () => Promise<{ groups: SessionMergeGroupInfo[] }>;
  fetchMembers?: (keys: string[]) => Promise<{ items: SessionIndexEntry[] }>;
  loadDetail?: (key: string, eventId: string) => Promise<TraceEvent>;
  loadRaw?: (key: string, eventId: string) => Promise<TraceEventRaw>;
}

/**
 * D2 TrajectoryPane：会话详情主区 —— 上下文 rail（Agent 层级 + 注解）与
 * turn 区域（统计条 + 色带 + 回合列表 + 分析面板）。SessionHeaderCard /
 * PhaseRibbon / PhaseTiles 保留在其上方（由 App 渲染），这里不重复会话身份。
 *
 * D16 请求预算：detail 打开 = slim + 1 次 annotations；session-groups 按需；
 * ≥2 成员时 1 次批量 keys 拉取；卡正文 / Raw 各 ≤1 次（LRU 缓存）；
 * 色带切模式、回合展开/折叠、分析面板打开 = 0 请求。
 */
export function TrajectoryPane({
  locale,
  sessionKey,
  detail,
  ribbonMode,
  onRibbonModeChange,
  selectedTurn,
  onSelectedTurnChange,
  focusEventId = null,
  onSelectAgent,
  railCollapsed,
  onToggleRailCollapse,
  fetchAnnotations,
  saveAnnotations,
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
  const [activeTurnIndex, setActiveTurnIndex] = useState<number | null>(0);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  /** 色带激活 / findings 定位目标（TurnList 滚动 + 展开，零请求）。 */
  const [focusTurnIndex, setFocusTurnIndex] = useState<number | null>(null);

  // findings / 命令面板：focusEventId → 其所在回合。
  useEffect(() => {
    if (focusEventId === null) {
      return;
    }
    const index = model.turns.findIndex((turn) =>
      turn.messages.some((message) => message.eventId === focusEventId),
    );
    if (index >= 0) {
      setFocusTurnIndex(index);
    }
  }, [focusEventId, model]);

  const toggleTurn = (index: number): void => {
    onSelectedTurnChange(selectedTurn === index ? null : index);
    setActiveTurnIndex(index);
  };

  const activateSegment = (index: number): void => {
    setFocusTurnIndex(index);
    setActiveTurnIndex(index);
  };

  const turnCount = model.complete ? model.turns.length : null;

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
      <AnnotationsPanel
        locale={locale}
        sessionKey={sessionKey}
        fetchAnnotations={fetchAnnotations}
        saveAnnotations={saveAnnotations}
      />
    </>
  );

  const turnArea = (
    <>
      <TrajectoryStatBar
        locale={locale}
        model={model}
        session={detail.session}
        agentLabel={detail.session.sourceAgent}
        ribbonMode={ribbonMode}
        onRibbonModeChange={onRibbonModeChange}
        analysisOpen={analysisOpen}
        onToggleAnalysis={() => setAnalysisOpen((prev) => !prev)}
        turnKeySource={turnKeySource}
      />
      {analysisOpen && <TrajectoryAnalysisPanel model={model} locale={locale} />}
      <TurnRibbon
        model={model}
        mode={ribbonMode}
        locale={locale}
        activeTurnIndex={activeTurnIndex}
        onActivate={activateSegment}
      />
      <TurnList
        model={model}
        sessionKey={sessionKey}
        locale={locale}
        durationSource={detail.session.durationSource}
        expandedIndex={selectedTurn}
        onToggleTurn={toggleTurn}
        onActiveTurnChange={setActiveTurnIndex}
        focusTurnIndex={focusTurnIndex}
        loadDetail={loadDetail}
        loadRaw={loadRaw}
      />
    </>
  );

  return (
    <div className="trajectory-pane">
      <TrajectoryRail
        rail={rail}
        turnArea={turnArea}
        collapsed={railCollapsed}
        onToggleCollapse={onToggleRailCollapse}
      />
    </div>
  );
}
