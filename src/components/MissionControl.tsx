import { useCallback, useEffect, useMemo, useState } from 'react';

import type { Locale } from '../i18n.js';
import { t, ZH, type I18nKey } from '../i18n.js';
import type {
  MissionDayPoint,
  MissionHealth,
  MissionHourPoint,
  MissionQuality,
  MissionResponse,
  MissionUsage,
  MissionWidget,
} from '../core/trace-types.js';
import { api } from '../api/client.js';
import { EmptyState, ErrorState, Skeleton } from './ui/States.js';
import { HBarChart } from './charts/HBarChart.js';
import { DonutChart } from './charts/DonutChart.js';
import { HeatmapGrid } from './charts/HeatmapGrid.js';
import { Histogram } from './charts/Histogram.js';
import { CalendarGrid } from './charts/CalendarGrid.js';
import { ComboBarLine } from './charts/ComboBarLine.js';
import { StackedAreaChart } from './charts/StackedAreaChart.js';

export type MissionSection = 'a' | 'b' | 'c';
export type MissionRange = '7d' | '30d' | 'all';

export interface MissionControlProps {
  locale: Locale;
  /** 测试注入；缺省走 api.mission。 */
  load?: (range: MissionRange) => Promise<MissionResponse>;
  /** SSE sessions_changed 外部失效计数（REQ-027：stamp 失效 + 手动刷新，不轮询）。 */
  invalidateKey?: number;
  initialRange?: MissionRange;
}

function entries(
  usage: MissionUsage,
  quality: MissionQuality,
  health: MissionHealth,
): Array<{ id: string; widget: MissionWidget<unknown> }> {
  const out: Array<{ id: string; widget: MissionWidget<unknown> }> = [];
  for (const [id, widget] of Object.entries(usage)) {
    out.push({ id, widget: widget as MissionWidget<unknown> });
  }
  for (const [id, widget] of Object.entries(quality)) {
    out.push({ id, widget: widget as MissionWidget<unknown> });
  }
  for (const [id, widget] of Object.entries(health)) {
    out.push({ id, widget: widget as MissionWidget<unknown> });
  }
  return out;
}

function sectionIds(section: MissionSection): string[] {
  if (section === 'a') {
    return ['toolTop', 'skillTop', 'subagent', 'heatmap', 'promptHabits', 'activity'];
  }
  if (section === 'b') {
    return [
      'closure', 'costEfficiency', 'toolFailure', 'tokenTrend', 'apiQuality',
      'errorReasons', 'riskyCommands', 'drift', 'contextPressure', 'models',
      'depth', 'toolEcology', 'scenes', 'heavyScenes', 'parallelism',
    ];
  }
  return ['collectors', 'dualChannel', 'calendar', 'hotSessions'];
}

function fmtNum(v: number): string {
  return v.toLocaleString();
}

function fmtPct(v: number | null): string {
  return v === null ? '—' : `${(v * 100).toFixed(1)}%`;
}

/** 通用小表格：把扁平对象渲染成 label/value 行（B 区数值 widget 用）。 */
function KeyValueTable({ data }: { data: Record<string, unknown> }): React.JSX.Element {
  const rows = Object.entries(data).filter(([, v]) => v !== null && v !== undefined);
  return (
    <div className="mission-kv">
      {rows.map(([key, value]) => (
        <div className="mission-kv-row" key={key}>
          <span className="mission-kv-key">{key}</span>
          <span className="mission-kv-value mono">
            {typeof value === 'number' ? fmtNum(value) : String(value)}
          </span>
        </div>
      ))}
    </div>
  );
}

function NamedCountList({ rows }: { rows: Array<{ name: string; count: number }> }): React.JSX.Element {
  return (
    <HBarChart
      rows={rows.map((row) => ({ label: row.name, value: row.count }))}
    />
  );
}

/** 按 widget id 渲染数据（服务端口径行由 WidgetPanel 统一渲染）。 */
function WidgetData({
  id,
  data,
  locale,
}: {
  id: string;
  data: unknown;
  locale: Locale;
}): React.JSX.Element {
  switch (id) {
    case 'toolTop': {
      const rows = data as MissionUsage['toolTop']['data'];
      if (rows === null) {
        return <EmptyState icon="—" title={t('state.empty', locale)} description="" />;
      }
      return (
        <HBarChart
          rows={rows.map((row) => ({
            label: row.tool,
            value: row.calls,
            tone: row.errors > 0 && row.errors === row.calls ? 'danger' : undefined,
          }))}
        />
      );
    }
    case 'subagent': {
      const data2 = data as NonNullable<MissionUsage['subagent']['data']>;
      return <NamedCountList rows={data2.rows} />;
    }
    case 'heatmap': {
      const heat = data as NonNullable<MissionUsage['heatmap']['data']>;
      return <HeatmapGrid grid={heat.grid} peak={heat.peak} />;
    }
    case 'activity': {
      const points = data as MissionHourPoint[];
      if (points === null) {
        return <EmptyState icon="—" title={t('state.empty', locale)} description="" />;
      }
      return (
        <ComboBarLine
          bars={points.map((p) => p.sessions)}
          line={points.map((p) => p.messages)}
          labels={points.map((p) => p.hour.slice(11, 13))}
        />
      );
    }
    case 'toolFailure': {
      const rows = data as NonNullable<MissionQuality['toolFailure']['data']>;
      return (
        <HBarChart
          rows={rows.map((row) => ({
            label: `${row.tool} (${row.errors}/${row.attempts})`,
            value: Math.round(row.rate * 1000),
            tone: row.rate >= 0.5 ? 'danger' : row.rate > 0 ? 'attention' : undefined,
          }))}
        />
      );
    }
    case 'depth': {
      const rows = data as NonNullable<MissionQuality['depth']['data']>;
      return <Histogram buckets={rows.map((row) => ({ label: row.name, value: row.count }))} />;
    }
    case 'collectors': {
      const c = data as NonNullable<MissionHealth['collectors']['data']>;
      return (
        <div className="mission-collectors">
          {c.scanStateRows === 0 && (
            <div className="mission-alert">
              {t('mission.alert.scanState', locale)}
            </div>
          )}
          <KeyValueTable
            data={{
              scanState: c.scanStateRows,
              schema: c.schemaVersion,
              dbMB: +(c.dbSizeBytes / 1024 / 1024).toFixed(2),
              walMB: +(c.walSizeBytes / 1024 / 1024).toFixed(2),
              proxy: c.proxy.running ? `:${c.proxy.port ?? '?'}` : 'off',
              frida: c.frida.running ? `pid=${c.frida.pid ?? '?'}` : 'off',
            }}
          />
          <div className="mission-provider-grid">
            {c.providers.map((p) => (
              <span key={p.key} className={`mission-provider ${p.ready ? 'ok' : 'bad'}`}>
                {p.key} · {p.sessionCount} · {p.lastScanAt === null ? t('mission.neverScanned', locale) : p.lastScanAt.slice(0, 10)}
              </span>
            ))}
          </div>
        </div>
      );
    }
    case 'calendar': {
      const days = data as NonNullable<MissionHealth['calendar']['data']>;
      return <CalendarGrid days={days} />;
    }
    case 'tokenTrend':
    case 'drift': {
      const points = data as MissionDayPoint[];
      if (points === null || points.length === 0) {
        return <EmptyState icon="—" title={t('state.empty', locale)} description="" />;
      }
      return (
        <StackedAreaChart
          series={[
            { label: 'input', points: points.map((p) => p.input) },
            { label: 'output', points: points.map((p) => p.output) },
            { label: 'cache', points: points.map((p) => p.cacheRead + p.cacheWrite) },
          ]}
          xLabels={points.map((p) => p.day.slice(5))}
        />
      );
    }
    case 'models':
    case 'errorReasons':
    case 'skillTop': {
      const rows = (data as Array<{ name: string; count: number }>) ?? [];
      return <NamedCountList rows={rows} />;
    }
    case 'contextPressure': {
      const cp = data as NonNullable<MissionQuality['contextPressure']['data']>;
      return <KeyValueTable data={{ peak: fmtPct(cp.peakPct), p50: fmtPct(cp.p50Pct), p95: fmtPct(cp.p95Pct), over80: cp.over80Pct, over95: cp.over95Pct, compactions: cp.compactions, window: cp.windowSource }} />;
    }
    case 'donut':
      // 保留位：占比类 widget 的环形图（B13 模型分布等）
      return <DonutChart slices={[]} />;
    default:
      if (data === null) {
        return <EmptyState icon="—" title={t('state.empty', locale)} description="" />;
      }
      if (Array.isArray(data)) {
        return <NamedCountList rows={data as Array<{ name: string; count: number }>} />;
      }
      if (typeof data === 'object') {
        return <KeyValueTable data={data as Record<string, unknown>} />;
      }
      return <span className="mono">{String(data)}</span>;
  }
}

function WidgetPanel({
  id,
  widget,
  locale,
}: {
  id: string;
  widget: MissionWidget<unknown>;
  locale: Locale;
}): React.JSX.Element {
  const reasonKey = `mission.unavailable.${widget.unavailableReason ?? ''}` as I18nKey;
  const reason =
    widget.unavailableReason !== null && reasonKey in ZH
      ? t(reasonKey, locale)
      : (widget.unavailableReason ?? '');
  const titleKey = `mission.widget.${id}` as I18nKey;
  return (
    <section className="mission-widget">
      <h3 className="mission-widget-title">{titleKey in ZH ? t(titleKey, locale) : id}</h3>
      <div className="mission-criteria">{widget.criteria}</div>
      {widget.available && widget.data !== null ? (
        <div className="mission-widget-body">
          <WidgetData id={id} data={widget.data} locale={locale} />
        </div>
      ) : (
        <EmptyState
          icon="—"
          title={t('mission.unavailableTitle', locale)}
          description={reason ?? ''}
        />
      )}
    </section>
  );
}

/**
 * REQ-027：Mission 视图。单列主区 + A/B/C chip 导航；顶部控制条
 * （range 7d/30d/all + 手动刷新 + meta 行）。整个视图 = 1 个请求（G11.9）。
 */
export function MissionControl({
  locale,
  load,
  invalidateKey = 0,
  initialRange = '7d',
}: MissionControlProps): React.JSX.Element {
  const defaultLoad = useCallback((range: MissionRange) => api.mission({ range }), []);
  const loader = load ?? defaultLoad;
  const [range, setRange] = useState<MissionRange>(initialRange);
  const [response, setResponse] = useState<MissionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [section, setSection] = useState<MissionSection>('a');
  const [stale, setStale] = useState(false);

  useEffect(() => {
    setResponse(null);
    setError(null);
    void loader(range)
      .then((result) => {
        setResponse(result);
        setStale(false);
      })
      .catch((err: unknown) => {
        console.error('[mission] 加载失败:', err);
        setError(err instanceof Error ? err.message : String(err));
      });
  }, [loader, range, retryKey]);

  // REQ-027 / 8.4：SSE sessions_changed → 只标 stamp 失效，不自动重拉（不轮询）；
  // 用户点手动刷新后置回 fresh。
  useEffect(() => {
    if (invalidateKey > 0) {
      setStale(true);
    }
  }, [invalidateKey]);

  const meta = response?.meta ?? null;
  const allWidgets = useMemo(() => {
    if (response === null) {
      return [];
    }
    return entries(response.usage, response.quality, response.health);
  }, [response]);
  const visibleIds = sectionIds(section);
  const visible = allWidgets.filter((entry) => visibleIds.includes(entry.id));

  return (
    <main className="main mission-view">
      <div className="mission-toolbar">
        <div className="mission-range">
          {(['7d', '30d', 'all'] as const).map((r) => (
            <button
              key={r}
              type="button"
              className={`btn ${range === r ? 'btn-active' : ''}`}
              onClick={() => setRange(r)}
            >
              {t(`mission.range.${r}`, locale)}
            </button>
          ))}
        </div>
        <button type="button" className="btn" onClick={() => setRetryKey((k) => k + 1)}>
          {t('common.refresh', locale)}
        </button>
        {meta !== null && (
          <span className="mission-meta mono">
            {t('mission.meta', locale)
              .replace('{time}', meta.generatedAt.slice(11, 19))
              .replace('{widgets}', String(meta.widgetCount))
              .replace('{ms}', String(meta.durationMs))
              .replace('{cached}', meta.cached ? t('mission.cached', locale) : t('mission.fresh', locale))}
            {stale ? ` · ${t('mission.stale', locale)}` : ''}
          </span>
        )}
      </div>

      <div className="mission-chips" role="tablist">
        {(['a', 'b', 'c'] as const).map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={section === s}
            className={`chip ${section === s ? 'chip-active' : ''}`}
            onClick={() => setSection(s)}
          >
            {t(`mission.section.${s}`, locale)}
          </button>
        ))}
      </div>

      {error !== null && (
        <ErrorState code="MISSION_LOAD_FAILED" message={error} onRetry={() => setRetryKey((k) => k + 1)} />
      )}
      {response === null && error === null && <Skeleton variant="row" count={6} />}
      {response !== null && (
        <div className="mission-grid">
          {visible.map(({ id, widget }) => (
            <WidgetPanel key={id} id={id} widget={widget} locale={locale} />
          ))}
        </div>
      )}
    </main>
  );
}
