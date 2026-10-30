import { parseArchitectureTransfer } from '../../core/agent-folding-transfer.js';
import { useCallback, useMemo, useState } from 'react';
import type { Locale } from '../../i18n.js';
import { useTaskRead } from '../task/task-data.js';
import { architectureApi, downloadArchitecture } from './architecture-client.js';
import { foldingComparison } from '../../core/agent-folding-metrics.js';
import { buildFoldingComparisonReport } from '../../core/agent-folding-report.js';
import type { FoldingMetricRun } from '../../core/agent-folding-metrics.js';
export function ArchitectureComparisonResult({ a, b, onLocate }: { a: FoldingMetricRun[]; b: FoldingMetricRun[]; onLocate: (id: string) => void }) {
  const result = useMemo(() => foldingComparison(a, b), [a, b]);
  const n = (v: number | null) => v === null ? '未知' : Number.isInteger(v) ? String(v) : v.toFixed(2);
  const stats = (s: typeof result.rows[number]['a']) => <><strong>{n(s.median)}</strong><small> · n={s.n} · 均值 {n(s.mean)} · {n(s.min)}–{n(s.max)} · CV {n(s.cv)}%{s.single ? ' · 单样本' : ''}{s.variable ? ' · 波动大' : ''}</small></>;
  return <><div className="architecture-toolbar">{(['html', 'markdown', 'csv'] as const).map(format => <button className="btn" key={format} onClick={() => downloadArchitecture(`architecture-comparison.${format === 'markdown' ? 'md' : format}`, buildFoldingComparisonReport(a, b, format), format === 'html' ? 'text/html' : 'text/plain')}>导出 {format.toUpperCase()}</button>)}</div>
    <p>{result.confounded ? `有混杂：${result.changes.join('、')}` : '描述性对比，不能证明单一改动的因果收益'}</p><p>{result.regressions === null ? '未知：没有逐用例结果，无法判断有没有用例从通过变失败。' : `逐用例回归：${result.regressions.join('、') || '未观察到'}`}</p>
    {(['quality', 'responsibilities', 'chains', 'process', 'tokens', 'details'] as const).map((section, index) => <section key={section}><h3>{index + 1} · {{ quality: '质量', responsibilities: '职责去向', chains: '调用链', process: '过程与时延', tokens: 'Token 与开销', details: '逐次明细' }[section]}</h3>
      {section === 'responsibilities' ? <p>未知：需要边界证据和独立验证，指标汇总不证明职责已被替代。</p> : section === 'details' ? [...a.map(r => ['A', r] as const), ...b.map(r => ['B', r] as const)].map(([g, r]) => <details key={g + r.id}><summary>{g} · {r.id}</summary><button className="btn" disabled={!r.taskId} onClick={() => { if (r.taskId) onLocate(r.taskId); }}>查看来源任务</button><p>{Object.entries(r.labels).map(([k, v]) => `${k}: ${v ?? '未知'}`).join(' · ')}</p>{r.limitations.map((l, i) => <p key={i}>{l}</p>)}</details>) : <><table><thead><tr><th>指标</th><th>A 中位数 / 组内</th><th>B 中位数 / 组内</th><th>B − A</th><th>B / A</th></tr></thead><tbody>{result.rows.filter(r => r.section === section).map(r => <tr key={r.key}><th>{r.label}</th><td>{stats(r.a)}</td><td>{stats(r.b)}</td><td title={r.reason ?? ''}>{r.comparable ? n(r.delta) : `不可比 · ${r.reason}`}</td><td>{r.comparable ? n(r.ratio) : '—'}</td></tr>)}</tbody></table>{section === 'chains' && <p>评测覆盖的生产调用链：未知。关联完整度不等于调用链覆盖。</p>}</>}
    </section>)}<details><summary>口径与限制</summary>{result.limitations.map((l, i) => <p key={i}>{l}</p>)}</details></>;
}
export function ArchitectureCompare({ a, b, locale, onLocate, onClose }: { a: string[]; b: string[]; locale: Locale; onLocate: (id: string) => void; onClose: () => void }) {
  const read = useCallback((signal: AbortSignal) => architectureApi.compare(a, b, signal), [a, b]);
  const data = useTaskRead(JSON.stringify([a, b]), read, 35000);
  return <section className="architecture-panel"><header className="architecture-heading"><h2>{locale === 'zh' ? '任务架构对比' : 'Task architecture comparison'}</h2><button className="btn" onClick={onClose}>关闭</button></header><p>A · {a.length} 次 / B · {b.length} 次</p>{data.loading && <p role="status">正在读取本地记录…</p>}{data.error && <p role="alert">{data.error} <button className="btn" onClick={data.retry}>重试</button></p>}{data.value && <ArchitectureComparisonResult {...data.value} onLocate={onLocate} />}</section>;
}

export function ImportedArchitectureCompare({ onLocate, onClose }: { onLocate: (id: string) => void; onClose: () => void }) {
  const [state] = useState(() => { try { return { value: parseArchitectureTransfer(sessionStorage.getItem('agent-architecture-comparison') ?? ''), error: '' }; } catch { return { value: null, error: '临时报告不存在或无效，请从评测结果页重新打开。' }; } });
  const [a, setA] = useState(state.value?.variants[0]?.id ?? ''), [b, setB] = useState(state.value?.variants[1]?.id ?? '');
  const aa = state.value?.runs.filter(r => r.run.variantId === a) ?? [], bb = state.value?.runs.filter(r => r.run.variantId === b) ?? [];
  return <section className="architecture-panel"><header className="architecture-heading"><h2>导入结果对比</h2><button className="btn" onClick={onClose}>关闭</button></header><p>本标签页临时报告；链接不包含报告数据。{state.value?.synthetic ? '合成示例，不代表真实表现。' : ''}</p>{state.error && <p role="alert">{state.error}</p>}<div className="architecture-toolbar">{(['A', 'B'] as const).map(g => <label key={g}>{g}<select aria-label={`选择 ${g} 组`} value={g === 'A' ? a : b} onChange={e => (g === 'A' ? setA : setB)(e.target.value)}>{state.value?.variants.map(v => <option key={v.id} value={v.id}>{v.product} · {v.id}</option>)}</select></label>)}</div>{a !== b && aa.length > 0 && bb.length > 0 && aa.length <= 40 && bb.length <= 40 ? <ArchitectureComparisonResult a={aa} b={bb} onLocate={onLocate} /> : <p>请选择两个不同且各含 1–40 次运行的组。</p>}</section>;
}
