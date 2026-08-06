import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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
import { HeatmapGrid } from './charts/HeatmapGrid.js';
import { Histogram } from './charts/Histogram.js';
import { CalendarGrid } from './charts/CalendarGrid.js';
import { ComboBarLine } from './charts/ComboBarLine.js';
import { StackedAreaChart } from './charts/StackedAreaChart.js';

export type MissionRange = '7d' | '30d' | 'all';
export type MissionRole = 'manager' | 'engineer' | 'ops';

/** REQ-117：旧 A/B/C 标签页锚点 → 角色分组锚点（标签页已移除）。 */
export const LEGACY_SECTION_ROLE: Record<string, MissionRole> = {
  a: 'manager',
  b: 'engineer',
  c: 'ops',
};

/**
 * REQ-117：把旧的 `#mission-a|b|c` 锚点重写为 `#mission-role-<role>`。
 * 无旧锚点时返回 null（调用方不做任何跳转）。
 */
export function redirectLegacyMissionHash(hash: string): string | null {
  const match = /#mission-([abc])(?![\w-])/.exec(hash);
  if (match === null) {
    return null;
  }
  return hash.replace(match[0], `#mission-role-${LEGACY_SECTION_ROLE[match[1]!]!}`);
}

/** REQ-109：25+ widget 按角色分 3 组（规格表 + 其余 widget 就近归类）。
 * 侧边栏仅做滚动导航（G-UI-8），MUST NOT 隐藏其他角色的 widget。 */
export const ROLE_GROUPS: Record<MissionRole, string[]> = {
  manager: [
    'activity', 'costEfficiency', 'toolFailure', 'errorReasons',
    'closure', 'apiQuality', 'tokenTrend', 'drift', 'riskyCommands',
    'depth', 'heavyScenes',
  ],
  engineer: [
    'toolTop', 'skillTop', 'subagent', 'promptHabits',
    'toolEcology', 'scenes', 'parallelism', 'contextPressure', 'models',
  ],
  ops: ['heatmap', 'collectors', 'dualChannel', 'calendar', 'hotSessions'],
};

export const ROLE_ORDER: readonly MissionRole[] = ['manager', 'engineer', 'ops'];

export interface MissionControlProps {
  locale: Locale;
  /** 测试注入；缺省走 api.mission。 */
  load?: (range: MissionRange) => Promise<MissionResponse>;
  /** SSE sessions_changed 外部失效计数（REQ-027：stamp 失效 + 手动刷新，不轮询）。 */
  invalidateKey?: number;
  initialRange?: MissionRange;
  /** 热会话下钻：复用 #/sessions?key= hash 路由（REQ-027）。 */
  onOpenSession?: (key: string) => void;
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
  onOpenSession,
}: {
  id: string;
  data: unknown;
  locale: Locale;
  onOpenSession?: (key: string) => void;
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
    case 'errorReasons':
    case 'skillTop': {
      const rows = (data as Array<{ name: string; count: number }>) ?? [];
      return <NamedCountList rows={rows} />;
    }
    case 'contextPressure': {
      const cp = data as NonNullable<MissionQuality['contextPressure']['data']>;
      return (
        <>
          <KeyValueTable data={{ peak: fmtPct(cp.peakPct), p50: fmtPct(cp.p50Pct), p95: fmtPct(cp.p95Pct), over80: cp.over80Pct, over95: cp.over95Pct, compactions: cp.compactions, saved: cp.savedTokens, window: cp.windowSource }} />
          <Histogram buckets={cp.histogram.map((h) => ({ label: h.name, value: h.count }))} />
        </>
      );
    }
    case 'closure': {
      const c = data as NonNullable<MissionQuality['closure']['data']>;
      return (
        <KeyValueTable
          data={{
            success: fmtPct(c.successRate),
            ok: c.ok,
            err: c.err,
            e2eP50: c.e2eP50Ms === null ? '—' : `${fmtNum(c.e2eP50Ms)}ms`,
            e2eP90: c.e2eP90Ms === null ? '—' : `${fmtNum(c.e2eP90Ms)}ms`,
            e2eP99: c.e2eP99Ms === null ? '—' : `${fmtNum(c.e2eP99Ms)}ms`,
            turnsP50: c.turnsP50,
            repair: c.repairSessions,
          }}
        />
      );
    }
    case 'costEfficiency': {
      const c = data as NonNullable<MissionQuality['costEfficiency']['data']>;
      return (
        <KeyValueTable
          data={{
            total: `$${c.totalUsd.toFixed(4)}`,
            perTurn: c.perTurnUsd === null ? '—' : `$${c.perTurnUsd.toFixed(4)}`,
            perOkTool: c.perOkToolUsd === null ? '—' : `$${c.perOkToolUsd.toFixed(4)}`,
            perSession: c.perSessionUsd === null ? '—' : `$${c.perSessionUsd.toFixed(4)}`,
            priced: c.pricedSessions,
            unpriced: c.unpricedSessions,
          }}
        />
      );
    }
    case 'apiQuality': {
      const a = data as NonNullable<MissionQuality['apiQuality']['data']>;
      return (
        <KeyValueTable
          data={{
            cacheHit: fmtPct(a.cacheHitRate),
            ttftP50: a.ttftP50Ms === null ? '—' : `${fmtNum(a.ttftP50Ms)}ms`,
            ttftP95: a.ttftP95Ms === null ? '—' : `${fmtNum(a.ttftP95Ms)}ms`,
            proxyCalls: a.proxyCalls,
            proxyErr: fmtPct(a.proxyErrorRate),
          }}
        />
      );
    }
    case 'parallelism': {
      const p = data as NonNullable<MissionQuality['parallelism']['data']>;
      return (
        <KeyValueTable
          data={{
            sessions: p.sessions,
            avgRatio: p.avgRatio === null ? '—' : p.avgRatio.toFixed(2),
            maxRatio: p.maxRatio === null ? '—' : p.maxRatio.toFixed(2),
            parallel: p.parallelSessions,
          }}
        />
      );
    }
    case 'dualChannel': {
      const d = data as NonNullable<MissionHealth['dualChannel']['data']>;
      return (
        <>
          <KeyValueTable
            data={{
              scan: d.scanSessions,
              proxy: d.proxyRequests,
              both: d.linkedSessions,
              scanOnly: d.scanOnly,
              proxyOnly: d.proxyOnly,
            }}
          />
          {d.hints.map((hint) => (
            <div key={hint} className="mission-alert">{hint}</div>
          ))}
        </>
      );
    }
    case 'models': {
      const rows = data as NonNullable<MissionQuality['models']['data']>;
      return (
        <div className="mission-kv">
          {rows.map((row) => (
            <div className="mission-kv-row" key={row.model}>
              <span className="mission-kv-key">{row.model} · {fmtNum(row.calls)}</span>
              <span className="mission-kv-value mono">
                {row.costSource === 'unknown' ? '—' : `$${row.costUsd.toFixed(4)}`}
              </span>
            </div>
          ))}
        </div>
      );
    }
    case 'toolEcology': {
      const rows = data as NonNullable<MissionQuality['toolEcology']['data']>;
      return (
        <HBarChart
          rows={rows.map((row) => ({
            label: `${row.tool} (${fmtNum(row.inBytes)}B↓/${fmtNum(row.outBytes)}B↑)`,
            value: row.calls,
          }))}
        />
      );
    }
    case 'hotSessions': {
      const rows = data as NonNullable<MissionHealth['hotSessions']['data']>;
      return (
        <div className="mission-kv">
          {rows.map((row) => (
            <button
              key={row.id}
              type="button"
              className="mission-hot-row"
              onClick={() => onOpenSession?.(row.id)}
              title={row.id}
            >
              <span className="mission-kv-key">{row.title || row.id}</span>
              <span className="mission-kv-value mono">
                {row.costSource === 'unknown' ? '—' : `$${row.costUsd.toFixed(4)}`} · {fmtNum(row.tokenTotal)}
              </span>
            </button>
          ))}
        </div>
      );
    }
    case 'scenes':
    case 'heavyScenes': {
      const s = data as { rows: Array<{ scene: string; count: number; tokenSum: number }> };
      return (
        <HBarChart
          rows={s.rows.map((row) => ({
            label: `${row.scene} (${fmtNum(row.tokenSum)} tok)`,
            value: row.count,
          }))}
        />
      );
    }
    case 'riskyCommands': {
      const rows = data as NonNullable<MissionQuality['riskyCommands']['data']>;
      return (
        <div className="mission-kv">
          {rows.map((row) => (
            <div className="mission-kv-row" key={`${row.pattern}-${row.sessionId}`}>
              <span className="mission-kv-key">{row.pattern} × {row.hits}</span>
              <span className="mission-kv-value mono">{row.preview}</span>
            </div>
          ))}
        </div>
      );
    }
    case 'promptHabits': {
      const p = data as NonNullable<MissionUsage['promptHabits']['data']>;
      return (
        <KeyValueTable
          data={{
            n: p.n,
            p50: p.p50,
            p95: p.p95,
            max: p.max,
          }}
        />
      );
    }
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
  onOpenSession,
}: {
  id: string;
  widget: MissionWidget<unknown>;
  locale: Locale;
  onOpenSession?: (key: string) => void;
}): React.JSX.Element {
  const reasonKey = `mission.unavailable.${widget.unavailableReason ?? ''}` as I18nKey;
  const reason =
    widget.unavailableReason !== null && reasonKey in ZH
      ? t(reasonKey, locale)
      : (widget.unavailableReason ?? '');
  const titleKey = `mission.widget.${id}` as I18nKey;
  // 8.7：criteria 口径文案走共享 i18n 字典（服务端下发 key，前端渲染 zh/en）；
  // 未知 key 回退到服务端原文（REQ-010：前端不自行编写口径）。
  const criteriaKey = `mission.criteria.${id}` as I18nKey;
  const criteriaText =
    criteriaKey in ZH ? t(criteriaKey, locale) : widget.criteria;
  return (
    <section className="mission-widget" id={`widget-${id}`}>
      <h3 className="mission-widget-title">{titleKey in ZH ? t(titleKey, locale) : id}</h3>
      <div className="mission-criteria">{criteriaText}</div>
      {widget.available && widget.data !== null ? (
        <div className="mission-widget-body">
          <WidgetData id={id} data={widget.data} locale={locale} onOpenSession={onOpenSession} />
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
 * REQ-027 + REQ-117：Mission 视图。左侧角色分组导航是唯一导航方式
 * （A/B/C 标签页已移除，角色分组已完全覆盖其能力）；顶部控制条
 * （range 7d/30d/all + 手动刷新 + meta 行）。整个视图 = 1 个请求（G11.9）。
 */
export function MissionControl({
  locale,
  load,
  invalidateKey = 0,
  initialRange = '7d',
  onOpenSession,
}: MissionControlProps): React.JSX.Element {
  const defaultLoad = useCallback((range: MissionRange) => api.mission({ range }), []);
  const loader = load ?? defaultLoad;
  const [range, setRange] = useState<MissionRange>(initialRange);
  const [response, setResponse] = useState<MissionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [stale, setStale] = useState(false);
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [activeRole, setActiveRole] = useState<MissionRole | null>('manager');
  const mainRef = useRef<HTMLElement | null>(null);
  const initialScrollDone = useRef(false);

  // REQ-109：`[` 键折叠/展开侧边栏（不劫持输入框）。
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement | null)?.tagName ?? '';
      if (e.key !== '[' || tag === 'INPUT' || tag === 'TEXTAREA') {
        return;
      }
      setNavCollapsed((prev) => !prev);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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
  // REQ-117：不再按 A/B/C 切片，全部 widget 一次性按角色分组呈现。
  const byRole = useMemo(
    () =>
      ROLE_ORDER.map((role) => ({
        role,
        widgets: allWidgets.filter((entry) => ROLE_GROUPS[role].includes(entry.id)),
      })).filter((group) => group.widgets.length > 0),
    [allWidgets],
  );

  const onScroll = (): void => {
    const el = mainRef.current;
    if (el === null) {
      return;
    }
    let current: MissionRole | null = null;
    for (const group of byRole) {
      const node = el.querySelector<HTMLElement>(`#mission-role-${group.role}`);
      if (node !== null && node.offsetTop - 120 <= el.scrollTop) {
        current = group.role;
      }
    }
    setActiveRole(current);
  };

  const scrollToRole = (role: MissionRole): void => {
    document.getElementById(`mission-role-${role}`)?.scrollIntoView?.({ behavior: 'smooth' });
  };

  // REQ-117：旧 A/B/C 标签页锚点重定向到角色分组锚点，并定位到该分组。
  useEffect(() => {
    const rewritten = redirectLegacyMissionHash(window.location.hash);
    if (rewritten === null) {
      return;
    }
    history.replaceState(null, '', rewritten);
    const role = /#mission-role-(\w+)/.exec(rewritten)?.[1] as MissionRole | undefined;
    if (role !== undefined) {
      setActiveRole(role);
    }
  }, []);

  // REQ-117：数据就绪后默认定位到当前角色（缺省「管理者」），只做一次。
  useEffect(() => {
    if (response === null || initialScrollDone.current) {
      return;
    }
    initialScrollDone.current = true;
    scrollToRole(activeRole ?? 'manager');
  }, [response, activeRole]);

  return (
    <main
      className={`main mission-view ${navCollapsed ? 'mission-nav-collapsed' : ''}`}
      ref={(node) => {
        mainRef.current = node;
      }}
      onScroll={onScroll}
    >
      <div className="mission-layout">
        <aside className="mission-nav" aria-label={t('mission.nav.title', locale)}>
          <button
            type="button"
            className="mission-nav-toggle"
            aria-expanded={!navCollapsed}
            onClick={() => setNavCollapsed((prev) => !prev)}
            title={t('mission.nav.collapse', locale)}
          >
            {t('mission.nav.title', locale)}
          </button>
          {!navCollapsed && (
            <nav className="mission-nav-list">
              {byRole.map(({ role }) => (
                <button
                  key={role}
                  type="button"
                  className={`mission-nav-item ${activeRole === role ? 'mission-nav-item-on' : ''}`}
                  onClick={() => scrollToRole(role)}
                >
                  <span className="mission-nav-dot" aria-hidden="true" />
                  {t(`mission.role.${role}`, locale)}
                  <span className="mono mission-nav-count">{ROLE_GROUPS[role].length}</span>
                </button>
              ))}
            </nav>
          )}
        </aside>
        <div className="mission-main">
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

          {error !== null && (
            <ErrorState code="MISSION_LOAD_FAILED" message={error} onRetry={() => setRetryKey((k) => k + 1)} />
          )}
          {response === null && error === null && <Skeleton variant="row" count={6} />}
          {response !== null &&
            byRole.map(({ role, widgets }) => (
              <section key={role} id={`mission-role-${role}`} className="mission-role-section" data-role={role}>
                <h3 className="mission-role-title">{t(`mission.role.${role}`, locale)}</h3>
                <div className="mission-grid">
                  {widgets.map(({ id, widget }) => (
                    <WidgetPanel key={id} id={id} widget={widget} locale={locale} onOpenSession={onOpenSession} />
                  ))}
                </div>
              </section>
            ))}
        </div>
      </div>
    </main>
  );
}
