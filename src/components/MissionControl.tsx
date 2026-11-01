import { agentMetricLabel } from './task/overview-agent-copy.js';
import { LineChart } from './charts/LineChart.js';
import { Card, CardBody, CardHeader } from './ui/Display.js';
import { Tooltip } from './ui/Overlay.js';
import { Button, IconButton } from './ui/Button.js';
import { SegmentedControl } from './ui/Controls.js';
import { IconInfo, IconRefresh } from './icons/index.js';
import { PageSkeleton } from './ui/PageSkeleton.js';
import { fmtDur } from '../core/session-findings.js';
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
import { EmptyState, ErrorState } from './ui/States.js';
import { HBarChart } from './charts/HBarChart.js';
import { Histogram } from './charts/Histogram.js';
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
    'activity', 'toolFailure', 'errorReasons',
    'closure', 'tokenTrend', 'drift', 'riskyCommands',
    'depth', 'heavyScenes',
  ],
  engineer: [
    'toolTop', 'skillTop', 'subagent', 'promptHabits',
    'toolEcology', 'scenes', 'parallelism', 'contextPressure', 'models',
  ],
  ops: ['collectors', 'dualChannel'],
};

export const ROLE_ORDER: readonly MissionRole[] = ['manager', 'engineer', 'ops'];

export interface MissionControlProps {
  locale: Locale;
  /** 测试注入；缺省走 api.mission。 */
  load?: (range: MissionRange) => Promise<MissionResponse>;
  /** SSE sessions_changed 外部失效计数（REQ-027：stamp 失效 + 手动刷新，不轮询）。 */
  invalidateKey?: number;
  initialRange?: MissionRange;
  onRangeChange?: (range: MissionRange) => void;
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
function KeyValueTable({ data, locale = 'en' }: { data: Record<string, unknown>; locale?: Locale }): React.JSX.Element {
  const rows = Object.entries(data).filter(([, v]) => v !== null && v !== undefined);
  return (
    <div className="mission-kv">
      {rows.map(([key, value]) => (
        <div className="mission-kv-row" key={key}>
          <span className="mission-kv-key">{agentMetricLabel(key,locale)}</span>
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
          <KeyValueTable locale={locale}
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
    case 'drift': {
      const points=(data as MissionDayPoint[]).filter(p=>p.e2eP95Ms!=null);
      return points.length?<LineChart label={locale==='zh'?'任务墙钟 P95':'Task wall-clock P95'} labels={points.map(p=>p.day.slice(5))} series={[{label:'P95',points:points.map(p=>p.e2eP95Ms!)}]}/>:<EmptyState icon="—" title="—" description={locale==='zh'?'缺少可靠时长分位':'Reliable duration quantiles unavailable'}/>;
    }
    case 'tokenTrend': {
      const points = data as MissionDayPoint[];
      if (points === null || points.length === 0) {
        return <EmptyState icon="—" title={t('state.empty', locale)} description="" />;
      }
      return (
        <div><StackedAreaChart
          series={[
            { label: 'input', points: points.map((p) => p.input) },
            { label: 'output', points: points.map((p) => p.output) },
            { label: 'cache', points: points.map((p) => p.cacheRead + p.cacheWrite) },
          ]}
          xLabels={points.map((p) => p.day.slice(5))}
        />{id==='tokenTrend'&&<ul aria-label={locale==='zh'?'每日缓存命中率':'Daily cache hit rate'}>{points.map(p=><li key={p.day}>{p.day} · {p.cacheHitRate==null?'—':(p.cacheHitRate*100).toFixed(1)+'%'}{p.cacheHitRate!=null&&p.cacheKnownMembers<p.cacheTotalMembers?` · ${locale==='zh'?'部分':'Partial'} (${p.cacheKnownMembers}/${p.cacheTotalMembers} ${locale==='zh'?'成员':'members'})`:''}</li>)}</ul>}</div>
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
          <KeyValueTable locale={locale} data={{ peak: fmtPct(cp.peakPct), p50: fmtPct(cp.p50Pct), p95: fmtPct(cp.p95Pct), over80: cp.over80Pct, over95: cp.over95Pct, compactions: cp.compactions, saved: cp.savedTokens, window: cp.windowSource }} />
          <Histogram buckets={cp.histogram.map((h) => ({ label: h.name, value: h.count }))} />
        </>
      );
    }
    case 'closure': {
      const c = data as NonNullable<MissionQuality['closure']['data']>;
      return (
        <KeyValueTable locale={locale}
          data={{
            success: fmtPct(c.successRate),
            ok: c.ok,
            err: c.err,
            e2eP50: c.e2eP50Ms === null ? '—' : fmtDur(c.e2eP50Ms),
            e2eP90: c.e2eP90Ms === null ? '—' : fmtDur(c.e2eP90Ms),
            e2eP99: c.e2eP99Ms === null ? '—' : fmtDur(c.e2eP99Ms),
            turnsP50: c.turnsP50,
            repair: c.repairSessions,
          }}
        />
      );
    }
    case 'parallelism': {
      const p = data as NonNullable<MissionQuality['parallelism']['data']>;
      return (
        <KeyValueTable locale={locale}
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
          <KeyValueTable locale={locale}
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
                {t('mission.modelTokens',locale).replace('{input}',fmtNum(row.input)).replace('{output}',fmtNum(row.output)).replace('{cacheRead}',fmtNum(row.cacheRead)).replace('{cacheWrite}',fmtNum(row.cacheWrite))}
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
        <KeyValueTable locale={locale}
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
        return <KeyValueTable locale={locale} data={data as Record<string, unknown>} />;
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
  // 8.7：criteria 口径文案走共享 i18n 字典（服务端下发 key，前端渲染 zh/en）；
  // 未知 key 回退到服务端原文（REQ-010：前端不自行编写口径）。
  const criteriaKey = `mission.criteria.${id}` as I18nKey;
  const criteriaText =
    criteriaKey in ZH ? t(criteriaKey, locale) : widget.criteria;
  // 口径原文是给实现者看的（含 SQL 片段、内部代号、规格编号），此前直接当正文渲染。
  // 正文改用一句人话，完整口径收进「计算口径」折叠层，两边信息都不丢。
  const summaryKey = `mission.summary.${id}` as I18nKey;
  return (
    <Card className="mission-widget" id={`widget-${id}`}>
      <CardHeader title={titleKey in ZH ? t(titleKey, locale) : id} description={summaryKey in ZH ? t(summaryKey, locale) : undefined} actions={<Tooltip label={criteriaText}><IconButton label={t('mission.criteriaLabel', locale)} icon={<IconInfo/>}/></Tooltip>}/><CardBody>
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
    </CardBody></Card>
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
  onRangeChange,
}: MissionControlProps): React.JSX.Element {
  const defaultLoad = useCallback((range: MissionRange) => api.mission({ range }), []);
  const loader = load ?? defaultLoad;
  const [range, setRange] = useState<MissionRange>(initialRange);
  const [response, setResponse] = useState<MissionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [stale, setStale] = useState(false);
  useEffect(()=>{setRange(initialRange);},[initialRange]);
  useEffect(() => {
    let current=true;
    setResponse(null);
    setError(null);
    void loader(range)
      .then((result) => {
        if(!current)return;
        if(!result||!result.usage||!result.quality||!result.health||!result.meta)throw new Error('Invalid overview response');
        setResponse(result);
        setStale(false);
      })
      .catch((err: unknown) => {
        if(!current)return;
        console.error('[mission] 加载失败:', err);
        setError(err instanceof Error ? err.message : String(err));
      });
    return ()=>{current=false;};
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
  const uniqueWidgets=allWidgets.filter(w=>!['toolFailure','tokenTrend','toolTop'].includes(w.id));
  return <div className="mission-view">
    <div className="architecture-toolbar"><SegmentedControl activeId={range} onChange={value=>{setRange(value as MissionRange);onRangeChange?.(value as MissionRange);}} items={(['7d','30d','all'] as const).map(id=>({id,label:t(`mission.range.${id}`,locale)}))}/><Button icon={<IconRefresh/>} onClick={()=>setRetryKey(k=>k+1)}>{t('common.refresh',locale)}</Button>{stale&&<span>{t('mission.stale',locale)}</span>}{meta&&<span className="ui-muted">{meta.generatedAt.slice(0,16).replace('T',' ')} UTC</span>}</div>
    {error&&<ErrorState code="MISSION_LOAD_FAILED" message={error} onRetry={()=>setRetryKey(k=>k+1)}/>}
    {!response&&!error&&<PageSkeleton locale={locale}/>}
    <div className="overview-chart-grid">{uniqueWidgets.map(({id,widget})=><WidgetPanel key={id} id={id} widget={widget} locale={locale}/>)}</div>
  </div>;
}
