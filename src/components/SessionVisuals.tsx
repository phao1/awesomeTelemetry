import { useMemo } from 'react';

import type { Locale } from '../i18n.js';
import { t } from '../i18n.js';
import type {
  SessionDetailResponse,
  TraceEventSlim,
  TraceRecord,
} from '../core/trace-types.js';
import { computeSpeedMetrics } from '../core/speed-metrics.js';
import { scanTimingReason, scanTimingValue, type ScanTimingMetric } from '../core/scan-timing.js';
import { buildEventDensity, computeSessionRadar } from '../core/session-visuals.js';
import { fmtDur } from '../core/session-findings.js';
import { HeatmapChart } from './charts/HeatmapChart.js';
import { RadarChart } from './charts/RadarChart.js';

export interface SessionVisualsProps {
  detail: SessionDetailResponse;
  locale: Locale;
}

/**
 * REQ-121：会话详情 L2 诊断层可视化 —— 事件密度热力图 + 8 轴能力雷达图。
 * 只读已加载的 slim 详情，MUST NOT 发额外请求（G11.9）。
 */
export function SessionVisuals({ detail, locale }: SessionVisualsProps): React.JSX.Element | null {
  const events = detail.events as TraceEventSlim[];

  const density = useMemo(() => buildEventDensity(events), [events]);
  const radar = useMemo(() => {
    const speed = computeSpeedMetrics(detail as unknown as TraceRecord);
    const all = computeSessionRadar(detail.session, events, speed);
    const timingAxes: Partial<Record<(typeof all)[number]['axis'], ScanTimingMetric>> = { speed: 'e2e', ttft: 'ttft', tps: 'tps' };
    const side = { ...detail, hasMore: detail.hasMore || events.length < detail.session.eventCount };
    const points = all.filter(point => {
      if (scanTimingValue(point.raw) === null) return false;
      const metric = timingAxes[point.axis];
      return metric === undefined || scanTimingReason(side, side, metric, point.raw, point.raw) === null;
    });
    return { points, omitted: all.filter(point => !points.includes(point)).map(point => point.axis) };
  }, [detail, events]);

  if (events.length === 0) {
    return null;
  }

  const bucketMs = density.bucketMinutes * 60_000;
  const titles = density.buckets.map((count, i) => {
    const at = new Date(density.startMs + i * bucketMs);
    return `${at.toLocaleTimeString([], { hour12: false })} · ${count}`;
  });

  return (
    <div className="session-visuals">
      <section className="session-heatmap">
        <h4 className="session-visuals-title">
          {t('session.heatmap.title', locale)}
          <span className="mono session-visuals-meta">
            {t('session.heatmap.bucket', locale)
              .replace('{n}', String(density.bucketMinutes))
              .replace('{peak}', String(density.peak))}
          </span>
        </h4>
        <HeatmapChart
          buckets={density.buckets}
          peak={density.peak}
          titles={titles}
          ariaLabel={t('session.heatmap.title', locale)}
        />
        <p className="hint session-visuals-hint">
          {t('session.heatmap.criteria', locale).replace('{dur}', fmtDur(detail.session.totalDurationMs))}
        </p>
      </section>
      <section className="session-radar">
        <h4 className="session-visuals-title">{t('session.radar.title', locale)}</h4>
        <RadarChart
          data={radar.points.map((point) => ({
            axis: t(`session.radar.axis.${point.axis}`, locale),
            values: [point.value],
          }))}
          colors={['var(--accent-fg)']}
          fills={['var(--accent-subtle)']}
          size={200}
          ariaLabel={t('session.radar.title', locale)}
        />
        <p className="hint session-visuals-hint">{t('session.radar.criteria', locale)}</p>
        {radar.omitted.length > 0 && <p className="hint" role="status">
          {t('scan.timing.notComparable', locale)} · {radar.omitted.map(axis => t(`session.radar.axis.${axis}`, locale)).join(', ')}
        </p>}
      </section>
    </div>
  );
}
