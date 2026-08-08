import { useMemo } from 'react';

import type { Locale } from '../../i18n.js';
import { t } from '../../i18n.js';
import type { TurnModel } from '../../core/trace-types.js';
import { analyzeTurns, type AnomalyRule, type TrajectoryAnomaly } from '../../core/turn-analysis.js';
import { HBarChart } from '../charts/HBarChart.js';
import { IconError, IconSuccess, IconWarning } from '../icons/index.js';

export interface TrajectoryAnalysisPanelProps {
  model: TurnModel;
  locale: Locale;
}

const ANOMALY_LABEL: Record<AnomalyRule, string> = {
  slow_turn: 'trajectory.analysis.anomaly.slowTurn',
  high_input: 'trajectory.analysis.anomaly.highInput',
  tool_error: 'trajectory.analysis.anomaly.toolError',
  low_cache: 'trajectory.analysis.anomaly.lowCache',
};

function fmtMs(ms: number | null): string {
  return ms === null ? '—' : ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms.toFixed(0)}ms`;
}

function pct(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toFixed(1)}%`;
}

/**
 * §2 / 8.7 分析面板：纯客户端算术（analyzeTurns），打开零请求（D16）。
 * 不完整模型渲染 banner + 所有总量为 —（D17，禁止部分和冒充总量）。
 * 异常条目 = 图标 + 文字（颜色不单独承载含义）。
 */
export function TrajectoryAnalysisPanel({
  model,
  locale,
}: TrajectoryAnalysisPanelProps): React.JSX.Element {
  const analysis = useMemo(() => analyzeTurns(model), [model]);
  const incomplete = !analysis.complete;
  const overview = analysis.overview;

  const anomalyRow = (anomaly: TrajectoryAnomaly): React.JSX.Element => {
    const Icon = anomaly.severity === 'danger' ? IconError : IconWarning;
    return (
      <li
        key={`${anomaly.rule}-${anomaly.turnIndex}`}
        className={`anomaly-row anomaly-row-${anomaly.severity}`}
      >
        <Icon size={12} />
        <span className="anomaly-row-detail">
          {t('trajectory.analysis.turnIndex', locale).replace('{index}', String(anomaly.turnIndex))} ·{' '}
          {t(ANOMALY_LABEL[anomaly.rule] as never, locale).replace('{detail}', anomaly.detail)}
        </span>
      </li>
    );
  };

  return (
    <section className="trajectory-analysis" aria-label={t('trajectory.analysis.title', locale)}>
      {incomplete && (
        <div className="turn-list-banner" role="alert">
          <IconWarning size={12} />
          {t('trajectory.incomplete.banner', locale).replace('{n}', String(analysis.omittedEventCount))}
        </div>
      )}

      <div className="trajectory-analysis-section">
        <h4>{t('trajectory.analysis.overview', locale)}</h4>
        <div className="trajectory-analysis-overview">
          <span className="trajectory-pill">
            <span className="trajectory-pill-label">{t('trajectory.pill.turns', locale)}</span>
            <span className="trajectory-pill-value mono">
              {incomplete ? '—' : overview.turnCount.toLocaleString()}
            </span>
          </span>
          <span className="trajectory-pill">
            <span className="trajectory-pill-label">{t('trajectory.analysis.rounds', locale)}</span>
            <span className="trajectory-pill-value mono">
              {incomplete ? '—' : overview.roundCount.toLocaleString()}
            </span>
          </span>
          <span className="trajectory-pill">
            <span className="trajectory-pill-label">{t('trajectory.analysis.totalDuration', locale)}</span>
            <span className="trajectory-pill-value mono">
              {incomplete ? '—' : fmtMs(overview.totalDurationMs)}
            </span>
          </span>
          <span className="trajectory-pill">
            <span className="trajectory-pill-label">{t('trajectory.pill.input', locale)}</span>
            <span className="trajectory-pill-value mono">
              {incomplete ? '—' : overview.totalInputTokens.toLocaleString()}
            </span>
          </span>
          <span className="trajectory-pill">
            <span className="trajectory-pill-label">{t('trajectory.pill.output', locale)}</span>
            <span className="trajectory-pill-value mono">
              {incomplete ? '—' : overview.totalOutputTokens.toLocaleString()}
            </span>
          </span>
          <span className="trajectory-pill">
            <span className="trajectory-pill-label">{t('trajectory.analysis.cacheRate', locale)}</span>
            <span className="trajectory-pill-value mono">
              {incomplete ? '—' : pct(overview.cacheRate)}
            </span>
          </span>
        </div>
      </div>

      <div className="trajectory-analysis-section">
        <h4>{t('trajectory.analysis.toolUsage', locale)}</h4>
        {analysis.toolUsage.length === 0 ? (
          <p className="hint">{t('common.empty', locale)}</p>
        ) : (
          <HBarChart
            rows={analysis.toolUsage.slice(0, 10).map((row) => ({
              label: row.tool,
              value: row.count,
              tone: 'accent' as const,
            }))}
          />
        )}
      </div>

      <div className="trajectory-analysis-section">
        <h4>{t('trajectory.analysis.topDuration', locale)}</h4>
        <AnalysisTopTable
          rows={analysis.topDurationTurns.map((row) => ({
            index: row.turnIndex,
            value: fmtMs(row.value),
          }))}
          locale={locale}
        />
      </div>

      <div className="trajectory-analysis-section">
        <h4>{t('trajectory.analysis.topTokens', locale)}</h4>
        <AnalysisTopTable
          rows={analysis.topTokenTurns.map((row) => ({
            index: row.turnIndex,
            value: row.value.toLocaleString(),
          }))}
          locale={locale}
        />
      </div>

      <div className="trajectory-analysis-section">
        <h4>{t('trajectory.analysis.cacheTrend', locale)}</h4>
        <AnalysisTopTable
          rows={analysis.cacheTrend.map((point) => ({
            index: point.turnIndex,
            value: pct(point.rate),
          }))}
          locale={locale}
        />
      </div>

      <div className="trajectory-analysis-section">
        <h4>{t('trajectory.analysis.anomalies', locale)}</h4>
        {analysis.anomalies.length === 0 ? (
          <p className="trajectory-criteria">
            <IconSuccess size={12} />
            {t('trajectory.analysis.noAnomalies', locale)}
          </p>
        ) : (
          <ul style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', margin: 0, padding: 0, listStyle: 'none' }}>
            {analysis.anomalies.map(anomalyRow)}
          </ul>
        )}
      </div>
    </section>
  );
}

function AnalysisTopTable({
  rows,
  locale,
}: {
  rows: Array<{ index: number; value: string }>;
  locale: Locale;
}): React.JSX.Element {
  return (
    <table className="trajectory-analysis-table">
      <thead>
        <tr>
          <th>{t('trajectory.pill.turns', locale)}</th>
          <th>{t('trajectory.analysis.title', locale)}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.index}>
            <td className="mono">
              {t('trajectory.analysis.turnIndex', locale).replace('{index}', String(row.index))}
            </td>
            <td className="mono">{row.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
