import { useMemo } from 'react';

import type { Locale, I18nKey } from '../../i18n.js';
import { t } from '../../i18n.js';
import type { TraceSession, TurnKeySource, TurnModel } from '../../core/trace-types.js';
import { computeCacheRate } from '../../core/turn-analysis.js';
import type { RibbonMode } from '../../core/turn-ribbon.js';
import { IconChevronDown, IconChevronRight, IconCost, IconSpeed } from '../icons/index.js';

export interface TrajectoryStatBarProps {
  locale: Locale;
  /** D3：派生出的 turn 模型（含 segmentationSource 与 completeness）。 */
  model: TurnModel;
  /** 当前选中的 agent 的会话（D2：stat bar 描述 agent，SessionHeaderCard 描述会话）。 */
  session: TraceSession;
  /** D2：stat bar 命名它描述的是哪个 agent。 */
  agentLabel: string;
  /** D10/D18：色带模式（时间 / Token）。 */
  ribbonMode: RibbonMode;
  onRibbonModeChange: (mode: RibbonMode) => void;
  /** D16：分析面板打开零请求；开关由 Pane 持有。 */
  analysisOpen: boolean;
  onToggleAnalysis: () => void;
  /** D3：adapter 声明的 turn-key provenance（口径行输入）。 */
  turnKeySource: TurnKeySource;
}

const PROVENANCE_KEY: Record<TurnKeySource, I18nKey> = {
  native_boundary: 'trajectory.provenance.nativeBoundary',
  stream_structure: 'trajectory.provenance.streamStructure',
  message_identity: 'trajectory.provenance.messageIdentity',
  unavailable: 'trajectory.provenance.unavailable',
};

/** D17：segmentationSource !== 'turn_key'，或 turn_key 且 provenance !==
 * native_boundary → 渲染 D3 口径行。wording 全部来自 i18n，前端不自行措辞。 */
export function segmentationCriteriaKey(
  model: TurnModel,
  turnKeySource: TurnKeySource,
): I18nKey | null {
  if (model.segmentationSource === 'turn_key' && turnKeySource === 'native_boundary') {
    return null;
  }
  switch (model.segmentationSource) {
    case 'turn_key':
      return 'trajectory.criteria.turnKey';
    case 'llm_boundary':
      return 'trajectory.criteria.llmBoundary';
    case 'user_prompt_boundary':
      return 'trajectory.criteria.userPromptBoundary';
    case 'sequence_fallback':
      return 'trajectory.criteria.sequenceFallback';
  }
}

function fmtMs(ms: number | null): string {
  return ms === null ? '—' : ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms.toFixed(0)}ms`;
}

function fmtTokens(n: number | null): string {
  return n === null ? '—' : n.toLocaleString();
}

/**
 * D6 统计条：agent 作用域的 pills + agent 名称 + 口径行 + 色带模式 + 分析入口。
 * 未知值渲染 — 加 tooltip（REQ-017），禁止用 0 冒充。
 */
export function TrajectoryStatBar({
  locale,
  model,
  session,
  agentLabel,
  ribbonMode,
  onRibbonModeChange,
  analysisOpen,
  onToggleAnalysis,
  turnKeySource,
}: TrajectoryStatBarProps): React.JSX.Element {
  const totals = useMemo(() => {
    let input = 0;
    let output = 0;
    let cacheRead = 0;
    let duration = 0;
    let tools = 0;
    for (const turn of model.turns) {
      input += turn.tokens.input;
      output += turn.tokens.output;
      cacheRead += turn.tokens.cacheRead;
      duration += turn.durationMs;
      tools += turn.toolCount;
    }
    return { input, output, cacheRead, duration, tools };
  }, [model.turns]);

  const incomplete = !model.complete;
  const rounds = useMemo(() => {
    let count = 0;
    for (const turn of model.turns) {
      if (turn.kind === 'init' || turn.kind === 'user') {
        count += 1;
      }
    }
    return count;
  }, [model.turns]);

  const cacheRate = useMemo(
    () => computeCacheRate(totals.input, totals.cacheRead),
    [totals.input, totals.cacheRead],
  );

  const criteriaKey = segmentationCriteriaKey(model, turnKeySource);
  const provenanceLabel =
    model.segmentationSource === 'turn_key'
      ? t(PROVENANCE_KEY[turnKeySource], locale)
      : null;

  const pill = (
    label: string,
    value: string,
    tooltip?: string,
  ): React.JSX.Element => (
    <span className="trajectory-pill" title={tooltip}>
      <span className="trajectory-pill-label">{label}</span>
      <span className="trajectory-pill-value mono">{value}</span>
    </span>
  );

  return (
    <div className="trajectory-statbar">
      <div className="trajectory-statbar-row">
        <span className="trajectory-statbar-agent" title={t('trajectory.statBar.agent', locale).replace('{name}', agentLabel)}>
          <IconSpeed size={12} />
          {t('trajectory.statBar.agent', locale).replace('{name}', agentLabel)}
        </span>
        {pill(
          t('trajectory.pill.turns', locale),
          incomplete ? '—' : String(model.turns.length),
          incomplete ? t('trajectory.unavailable.incomplete', locale) : undefined,
        )}
        {rounds > 1 &&
          pill(t('trajectory.pill.rounds', locale), String(rounds))}
        {pill(
          t('trajectory.pill.model', locale),
          model.turns.find((turn) => turn.model !== null)?.model ?? session.primaryModel ?? '—',
          model.turns.every((turn) => turn.model === null) && (session.primaryModel ?? null) === null
            ? t('trajectory.unavailable.noModel', locale)
            : undefined,
        )}
        {pill(
          t('trajectory.pill.input', locale),
          incomplete ? '—' : fmtTokens(totals.input),
          incomplete ? t('trajectory.unavailable.incomplete', locale) : undefined,
        )}
        {pill(
          t('trajectory.pill.output', locale),
          incomplete ? '—' : fmtTokens(totals.output),
          incomplete ? t('trajectory.unavailable.incomplete', locale) : undefined,
        )}
        {pill(
          t('trajectory.pill.cacheRate', locale),
          incomplete ? '—' : cacheRate === null ? '—' : `${(cacheRate * 100).toFixed(1)}%`,
          cacheRate === null && !incomplete
            ? t('trajectory.unavailable.noCacheDenominator', locale)
            : incomplete
              ? t('trajectory.unavailable.incomplete', locale)
              : undefined,
        )}
        {pill(
          t('trajectory.pill.duration', locale),
          incomplete ? '—' : fmtMs(totals.duration),
          incomplete ? t('trajectory.unavailable.incomplete', locale) : undefined,
        )}
        {pill(
          t('trajectory.pill.tools', locale),
          incomplete ? '—' : String(totals.tools),
          incomplete ? t('trajectory.unavailable.incomplete', locale) : undefined,
        )}
        <span className="trajectory-statbar-controls">
          <span className="timeline-mode" role="group" aria-label={t('trajectory.ribbon.modeGroup', locale)}>
            <button
              type="button"
              className={`timeline-chip ${ribbonMode === 'time' ? 'timeline-chip-on' : ''}`}
              aria-pressed={ribbonMode === 'time'}
              onClick={() => onRibbonModeChange('time')}
            >
              {t('trajectory.ribbon.mode.time', locale)}
            </button>
            <button
              type="button"
              className={`timeline-chip ${ribbonMode === 'token' ? 'timeline-chip-on' : ''}`}
              aria-pressed={ribbonMode === 'token'}
              onClick={() => onRibbonModeChange('token')}
            >
              {t('trajectory.ribbon.mode.token', locale)}
            </button>
          </span>
          <button
            type="button"
            className="btn ui-btn-sm"
            aria-expanded={analysisOpen}
            onClick={onToggleAnalysis}
          >
            {analysisOpen ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
            {analysisOpen ? t('trajectory.analysis.close', locale) : t('trajectory.analysis.open', locale)}
          </button>
        </span>
      </div>
      {criteriaKey !== null && (
        <p className="trajectory-criteria">
          <IconCost size={12} />
          {criteriaKey === 'trajectory.criteria.turnKey' && provenanceLabel !== null
            ? t(criteriaKey, locale).replace('{provenance}', provenanceLabel)
            : t(criteriaKey, locale)}
        </p>
      )}
    </div>
  );
}
