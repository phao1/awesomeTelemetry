import { BarList } from './charts/BarList.js';
import { useMemo } from 'react';

import type { Locale } from '../i18n.js';
import { t } from '../i18n.js';
import type { TraceEventSlim } from '../core/trace-types.js';
import { errorDistribution, fmtMs } from './compare-stats.js';
import type { CompareResult } from './compare-types.js';

interface ToolRow {
  tool: string;
  lc: number;
  rc: number;
  lf: number;
  rf: number;
  lDur: number;
  rDur: number;
}

function collectTools(leftEvents: TraceEventSlim[], rightEvents: TraceEventSlim[], limit: number | null): ToolRow[] {
  const map = new Map<string, ToolRow>();
  const bump = (events: TraceEventSlim[], side: 'l' | 'r'): void => {
    for (const e of events) {
      if (e.tool === null) {
        continue;
      }
      const v = map.get(e.tool) ?? {
        tool: e.tool,
        lc: 0,
        rc: 0,
        lf: 0,
        rf: 0,
        lDur: 0,
        rDur: 0,
      };
      if (side === 'l') {
        v.lc += 1;
        v.lDur += e.durationMs;
        if (e.status === 'error') {
          v.lf += 1;
        }
      } else {
        v.rc += 1;
        v.rDur += e.durationMs;
        if (e.status === 'error') {
          v.rf += 1;
        }
      }
      map.set(e.tool, v);
    }
  };
  bump(leftEvents, 'l');
  bump(rightEvents, 'r');
  return [...map.values()]
    .sort((a, b) => b.lc + b.rc - (a.lc + a.rc))
    .slice(0, limit ?? map.size);
}

const fmtRate = (fails: number, calls: number): string =>
  calls === 0 ? '—' : `${((fails / calls) * 100).toFixed(0)}%`;
const fmtAvg = (total: number, calls: number): string =>
  calls === 0 ? '—' : fmtMs(total / calls);

/** 建议 3：工具调用 TOP 榜 —— 次数降序 + 横向条形 + 失败率 + 平均耗时 + 失败原因分布。 */
export function CompareToolAnalysis({
  result,
  locale,
  maxTools = 15,
}: {
  result: CompareResult;
  locale: Locale;
  maxTools?: number | null;
}): React.JSX.Element {
  const leftEvents = result.left.events as TraceEventSlim[];
  const rightEvents = result.right.events as TraceEventSlim[];
  const rows = useMemo(() => collectTools(leftEvents, rightEvents, maxTools), [leftEvents, rightEvents, maxTools]);
  const errors = useMemo(
    () => errorDistribution(leftEvents, rightEvents),
    [leftEvents, rightEvents],
  );
  const max = Math.max(1, ...rows.map((r) => Math.max(r.lc, r.rc)));


  return (
    <div className="compare-tools">
      <table className="ui-table ui-table-compact">
        <thead>
          <tr>
            <th>{locale === 'zh' ? '工具' : 'Tool'}</th>
            <th style={{ textAlign: 'right' }}>{t('compare.toolCall', locale)} A</th>
            <th style={{ textAlign: 'right' }}>{t('compare.toolCall', locale)} B</th>
            <th>Δ</th>
            <th style={{ textAlign: 'right' }}>{t('compare.toolFailRate', locale)} A (n / %)</th>
            <th style={{ textAlign: 'right' }}>{t('compare.toolFailRate', locale)} B (n / %)</th>
            <th style={{ textAlign: 'right' }}>{t('compare.toolAvgDur', locale)} A</th>
            <th style={{ textAlign: 'right' }}>{t('compare.toolAvgDur', locale)} B</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.tool}>
              <td className="mono">{row.tool}</td>
              <td className="mono" style={{ textAlign: 'right' }}>
                {row.lc}
                <div className="ui-bar-meter" style={{ marginTop: 'var(--space-1)' }}>
                  <div className="ui-bar-meter-fill" style={{ width: `${(row.lc / max) * 100}%`, background: 'var(--compare-a)' }} />
                </div>
              </td>
              <td className="mono" style={{ textAlign: 'right' }}>
                {row.rc}
                <div className="ui-bar-meter" style={{ marginTop: 'var(--space-1)' }}>
                  <div className="ui-bar-meter-fill" style={{ width: `${(row.rc / max) * 100}%`, background: 'var(--compare-b)' }} />
                </div>
              </td>
              <td className="mono">{row.rc-row.lc>0?'+':''}{row.rc-row.lc}</td>
              <td className="mono" style={{ textAlign: 'right', color: row.lf > 0 ? 'var(--danger-fg)' : undefined }}>
                {row.lf} / {fmtRate(row.lf, row.lc)}
              </td>
              <td className="mono" style={{ textAlign: 'right', color: row.rf > 0 ? 'var(--danger-fg)' : undefined }}>
                {row.rf} / {fmtRate(row.rf, row.rc)}
              </td>
              <td className="mono" style={{ textAlign: 'right' }}>{fmtAvg(row.lDur, row.lc)}</td>
              <td className="mono" style={{ textAlign: 'right' }}>{fmtAvg(row.rDur, row.rc)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {errors.length > 0 && (
        <section className="compare-err-dist" aria-label={t('compare.toolErrorDist', locale)}>
          <h4>{t('compare.toolErrorDist', locale)}</h4>
          <BarList locale={locale} label={t('compare.toolErrorDist',locale)} items={errors.flatMap(row=>[{label:`${row.tool} · A`,value:row.lf,color:'var(--compare-a)'},{label:`${row.tool} · B`,value:row.rf,color:'var(--compare-b)'}]).filter(row=>row.value>0)}/>

        </section>
      )}
    </div>
  );
}
