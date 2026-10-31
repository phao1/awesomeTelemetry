import { useDeferredValue, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { Ref } from 'react';
import type { Locale } from '../../i18n.js';
import type { TeamExperimentEvent, TeamExperimentEventKind, TeamExperimentMode, TeamExperimentReport, TeamExperimentTrial } from '../../core/team-experiment-types.js';
import { summarizeTeamTrial } from '../../core/team-experiment-analysis.js';
import { serializeTaskRoute } from '../../task-route.js';

export const TEAM_MODE_LABELS = {
  single_loop: ['单 Agent loop', 'Single agent loop'],
  subagents: ['主子 Agent', 'Main + subagents'],
  agent_team: ['Agent Team', 'Agent team'],
} as const satisfies Record<TeamExperimentMode, readonly [string, string]>;
const KINDS = {
  model: ['模型', 'Model'], tool: ['工具', 'Tool'], task: ['工作', 'Work'],
  message: ['消息', 'Message'], wait: ['显式等待', 'Recorded wait'], handoff: ['交接', 'Handoff'],
  verification: ['验收', 'Verification'], artifact: ['产物', 'Artifact'], rework: ['返工', 'Rework'], context: ['上下文', 'Context'],
} as const satisfies Record<TeamExperimentEventKind, readonly [string, string]>;
const TOPOLOGY = { single: ['单成员', 'Single member'], fan_out: ['父子扇出', 'Parent / child fan-out'], peer_network: ['同伴通信网络', 'Peer messaging network'], unknown: ['证据不足', 'Insufficient evidence'] } as const;
const PAGE = 100;
function value(n: number | null): string { return n === null ? '—' : n.toLocaleString(undefined, { maximumFractionDigits: 2 }); }
interface Item { key: string; trial: TeamExperimentTrial; event: TeamExperimentEvent }
export interface TeamExperimentReplayHandle { locate: (trialId: string, eventId: string) => void }
function nativeLink(event: TeamExperimentEvent): string | null {
  return event.sessionKey ? serializeTaskRoute({ task: `collected:${event.sessionKey}`, origin: 'collected', member: 'all', mode: 'trajectory',
    event: event.eventId ? `${event.sessionKey}:event:${event.eventId}` : null }) : null;
}

/** Local evidence playback. The cursor never invokes a driver, tool or capture. */
export function TeamExperimentReplay({ report, locale, ref }: { report: TeamExperimentReport; locale: Locale; ref?: Ref<TeamExperimentReplayHandle> }): React.JSX.Element {
  const zh = locale === 'zh', text = (cn: string, en: string) => zh ? cn : en;
  const [repetition, setRepetition] = useState(1), [variantId, setVariantId] = useState('all');
  const [member, setMember] = useState('all'), [kind, setKind] = useState('all');
  const [playing, setPlaying] = useState(false), [speed, setSpeed] = useState(1), [page, setPage] = useState(0);
  const [selectedKey, setSelectedKey] = useState<string | null>(null), [font, setFont] = useState(13);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [dependencyPage, setDependencyPage] = useState(0);
  const detailRef = useRef<HTMLElement>(null);
  const stickyRef = useRef<HTMLDivElement>(null);
  const trials = useMemo(() => report.trials.filter(t => t.repetition === repetition && (variantId === 'all' || t.variantId === variantId)), [report, repetition, variantId]);
  const all = useMemo(() => trials.flatMap(trial => (trial.evidence?.events ?? []).map(event => ({ key: `${trial.id}/${event.id}`, trial, event }))).sort((a, b) => a.event.startMs - b.event.startMs || a.key.localeCompare(b.key)), [trials]);
  const extent = Math.max(1, ...all.map(i => i.event.startMs + (i.event.durationMs ?? 0)), ...trials.map(t => t.run.e2eMs ?? 0));
  const [cursorValue, setCursorValue] = useState(Number.MAX_SAFE_INTEGER);
  const cursor = Math.min(extent, cursorValue);
  const deferredKind = useDeferredValue(kind);
  const matching = useMemo(() => all.filter(i => (member === 'all' || `${i.trial.variantId}/${i.event.agentId}` === member) && (deferredKind === 'all' || i.event.kind === deferredKind)), [all, member, deferredKind]);
  const revealed = matching.filter(i => i.event.startMs <= cursor);
  const index = Math.min(page, Math.max(0, Math.ceil(revealed.length / PAGE) - 1)), visible = revealed.slice(index * PAGE, (index + 1) * PAGE);
  const selected = revealed.find(i => i.key === selectedKey) ?? null;
  const points = [...new Set(matching.map(i => i.event.startMs))];
  const dependencyIndex = Math.min(dependencyPage, Math.max(0, Math.ceil((selected?.event.dependsOn.length ?? 0) / 20) - 1));
  const memberLimit = Math.max(1, Math.floor(64 / Math.max(1, trials.length)));
  const moving = playing && cursor < extent;
  useEffect(() => {
    if (!moving) return;
    let previous = performance.now();
    const timer = setInterval(() => {
      const now = performance.now(), delta = now - previous; previous = now;
      setCursorValue(old => Math.min(extent, Math.min(extent, old) + delta * speed));
    }, 100);
    return () => clearInterval(timer);
  }, [moving, speed, extent]);
  const seek = (next: number): void => { setPlaying(false); setCursorValue(next); setPage(0); };
  const revealDetail = (): void => {
    requestAnimationFrame(() => {
      const detail = detailRef.current, sticky = stickyRef.current;
      if (!detail || !sticky) return;
      const track = sticky.querySelector<HTMLElement>('.team-exp-trajectories');
      const selectedBlock = sticky.querySelector<HTMLElement>('.team-exp-block[aria-pressed="true"]');
      if (track && selectedBlock) {
        const viewport = track.getBoundingClientRect(), block = selectedBlock.getBoundingClientRect();
        if (block.top < viewport.top) track.scrollTop += block.top - viewport.top;
        else if (block.bottom > viewport.bottom) track.scrollTop += block.bottom - viewport.bottom;
      }
      const scroller = detail.closest<HTMLElement>('.team-exp-center');
      const gap = Number.parseFloat(getComputedStyle(sticky).getPropertyValue('--space-2')) || 0;
      const inset = sticky.getBoundingClientRect().height + gap;
      detail.style.scrollMarginTop = `${inset}px`;
      if (scroller) {
        // Measure the real sticky stack after selection/roster changes. Scroll
        // the document reader so the detail's heading, not its bottom, is visible.
        scroller.scrollTop += detail.getBoundingClientRect().top - scroller.getBoundingClientRect().top - scroller.clientTop - inset;
      } else detail.scrollIntoView?.({ block: 'start' });
    });
  };
  const pick = (item: Item): void => {
    setPlaying(false); setSelectedKey(item.key); setDependencyPage(0);
    setExpanded(old => old.includes(item.trial.id) ? old : [...old, item.trial.id]);
    const selectedIndex = revealed.findIndex(i => i.key === item.key);
    if (selectedIndex >= 0) setPage(Math.floor(selectedIndex / PAGE));
    revealDetail();
  };
  const locate = (trialId: string, eventId: string): void => {
    const trial = report.trials.find(t => t.id === trialId), event = trial?.evidence?.events.find(e => e.id === eventId);
    if (!trial || !event) return;
    const nextItems = report.trials.filter(t => t.repetition === trial.repetition).flatMap(t => (t.evidence?.events ?? []).map(e => ({ key: `${t.id}/${e.id}`, event: e }))).sort((a, b) => a.event.startMs - b.event.startMs || a.key.localeCompare(b.key));
    setPlaying(false); setRepetition(trial.repetition); setVariantId('all'); setMember('all'); setKind('all');
    setDependencyPage(0);
    setCursorValue(Number.MAX_SAFE_INTEGER); setSelectedKey(`${trial.id}/${event.id}`);
    setPage(Math.floor(nextItems.findIndex(i => i.key === `${trial.id}/${event.id}`) / PAGE));
    setExpanded(old => old.includes(trial.id) ? old : [...old, trial.id]);
    revealDetail();
  };
  useImperativeHandle(ref, () => ({ locate }));
  const changeScope = (): void => { setPlaying(false); setPage(0); setSelectedKey(null); setMember('all'); setCursorValue(Number.MAX_SAFE_INTEGER); };
  const nameOf = (item: Item): string => item.trial.evidence?.agents.find(a => a.id === item.event.agentId)?.name ?? item.event.agentId;
  const position = (event: TeamExperimentEvent): React.CSSProperties => ({ left: `${event.startMs / extent * 100}%`, width: `${Math.max(.45, Math.min(event.durationMs ?? 0, Math.max(0, cursor - event.startMs)) / extent * 100)}%` });
  const mode = (trial: TeamExperimentTrial): string => TEAM_MODE_LABELS[report.plan.variants.find(v => v.id === trial.variantId)!.mode][zh ? 0 : 1];
  const peek = (e: TeamExperimentEvent): string => `${KINDS[e.kind][zh ? 0 : 1]} · ${e.name} · ${value(e.startMs / 1000)}s · ${e.durationMs === null ? text('时长未知', 'Duration unknown') : `${value(e.durationMs)}ms`} · ${e.timing}`;
  const coverageLabel = (flag: boolean | undefined): string => flag === true ? text('完整', 'Complete') : flag === false ? text('未确认完整', 'Completeness unconfirmed') : text('未知', 'Unknown');
  const caseEvidenceUnknown = (trial: TeamExperimentTrial): boolean => !trial.cases || !trial.run.verdict || trial.cases.length !== report.plan.task.expectedTests || trial.cases.some(c => c.status === 'unknown') || trial.cases.filter(c => c.status === 'passed').length !== trial.run.verdict.passed;
  const issueCount = trials.filter(trial => trial.run.error || trial.evidenceError || !trial.run.telemetry?.complete || !trial.evidence || Object.values(trial.evidence.coverage).some(flag => !flag) || caseEvidenceUnknown(trial)).length;
  return <section className="team-exp-replay" aria-label={text('任务轨迹回放', 'Task trajectory replay')}>
    <div className="team-exp-sticky" ref={stickyRef}>
      <div className="team-exp-reader-title"><h2 title={report.plan.name}>{report.plan.name} · {text('协作回放', 'Collaboration replay')}</h2><span>{report.synthetic ? text('模拟证据', 'Synthetic evidence') : text('已记录证据', 'Recorded evidence')}</span></div>
      <div className="team-exp-replay-toolbar">
        <button className="btn" aria-label={text('上一事件', 'Previous event')} onClick={() => seek([...points].reverse().find(p => p < cursor) ?? 0)}>←</button>
        <button className="btn" onClick={() => { if (moving) setPlaying(false); else { if (cursor >= extent) setCursorValue(0); setPlaying(true); setPage(0); } }}>{moving ? text('暂停', 'Pause') : text('播放', 'Play')}</button>
        <button className="btn" aria-label={text('下一事件', 'Next event')} onClick={() => seek(points.find(p => p > cursor) ?? extent)}>→</button>
        <input type="range" aria-label={text('回放时间', 'Replay time')} min={0} max={extent} step={1} value={cursor} onChange={e => seek(Number(e.target.value))}/>
        <output>{value(cursor / 1000)} / {value(extent / 1000)}s</output>
        <select aria-label={text('回放速度', 'Replay speed')} value={speed} onChange={e => setSpeed(Number(e.target.value))}>{[.5, 1, 2, 5, 10].map(n => <option key={n} value={n}>{n}×</option>)}</select>
        <select aria-label={text('重复轮次', 'Repetition')} value={repetition} onChange={e => { changeScope(); setRepetition(Number(e.target.value)); }}>{Array.from({ length: report.plan.repetitions }, (_, i) => <option key={i} value={i + 1}>{text('第', 'Trial')} {i + 1} {text('轮', '')}</option>)}</select>
        <select aria-label={text('筛选组合', 'Filter variant')} value={variantId} onChange={e => { changeScope(); setVariantId(e.target.value); }}><option value="all">{text('全部组合', 'All variants')}</option>{report.plan.variants.map(v => <option key={v.id} value={v.id}>{TEAM_MODE_LABELS[v.mode][zh ? 0 : 1]} · {v.id}</option>)}</select>
      </div>
      <div className="team-exp-trajectories">
        {trials.length === 0 && <p>{text('这轮尚无已保留的运行。', 'No retained runs for this repetition.')}</p>}
        {trials.map(trial => {
          const eligible = (trial.evidence?.agents ?? []).filter(a => member === 'all' || `${trial.variantId}/${a.id}` === member);
          const shown = eligible.slice(0, member === 'all' && !expanded.includes(trial.id) ? Math.min(4, memberLimit) : memberLimit);
          const selectedAgent = selected?.trial.id === trial.id ? eligible.find(a => a.id === selected.event.agentId) : null;
          if (selectedAgent && !shown.includes(selectedAgent)) shown.splice(Math.max(0, shown.length - 1), 1, selectedAgent);
          return <div className="team-exp-variant-lanes" key={trial.id}>
          <div className="team-exp-lane-heading"><strong>{mode(trial)}</strong><small>{trial.variantId} · {trial.run.status}</small>{member === 'all' && eligible.length > 4 && <button className="btn" onClick={() => setExpanded(old => old.includes(trial.id) ? old.filter(id => id !== trial.id) : [...old, trial.id])}>{expanded.includes(trial.id) ? text('收起成员', 'Collapse members') : text(`展开成员（最多 ${memberLimit}）`, `Expand members (up to ${memberLimit})`)}</button>}{shown.length < eligible.length && <small>{text(`显示 ${shown.length}/${eligible.length}；可筛选其他成员`, `${shown.length}/${eligible.length} shown; filter to other members`)}</small>}</div>
          {shown.map(agent => {
            const items = visible.filter(i => i.trial.id === trial.id && i.event.agentId === agent.id);
            const painted = [...items.filter(i => i.key !== selectedKey), ...items.filter(i => i.key === selectedKey)];
            return <div className="team-exp-lane" key={agent.id}><span title={agent.name}>{agent.name}</span><div className="team-exp-track" aria-label={`${mode(trial)} · ${agent.name}`}>
              <i className="team-exp-playhead" aria-hidden="true" style={{ left: `${cursor / extent * 100}%` }}/>
              {painted.map(item => <button key={item.key} type="button" className={`team-exp-block team-exp-kind-${item.event.kind}`} data-status={item.event.status} aria-pressed={selectedKey === item.key} aria-label={`${agent.name} · ${peek(item.event)}`} title={peek(item.event)} style={position(item.event)} onClick={() => pick(item)}/>)}
            </div></div>;
          })}
          {!trial.evidence?.agents.length && <p>{text('成员轨迹未采集，仍可查看独立验收。', 'Member trajectory unavailable; independent acceptance remains available.')}</p>}
        </div>; })}
      </div>
      <div className="team-exp-legend">{(['model', 'tool', 'message', 'wait', 'verification', 'rework'] as const).map(k => <span className={`team-exp-kind-${k}`} key={k}>▰ {KINDS[k][zh ? 0 : 1]}</span>)}</div>
    </div>
    <div className="team-exp-record-filters"><label>{text('成员', 'Member')} <select value={member} onChange={e => { setMember(e.target.value); setPage(0); setSelectedKey(null); }}><option value="all">{text('全部成员', 'All members')}</option>{trials.flatMap(t => (t.evidence?.agents ?? []).map(a => <option key={`${t.variantId}/${a.id}`} value={`${t.variantId}/${a.id}`}>{t.variantId} · {a.name}</option>))}</select></label>
      <label>{text('类型', 'Type')} <select value={kind} onChange={e => { setKind(e.target.value); setPage(0); setSelectedKey(null); }}><option value="all">{text('全部类型', 'All types')}</option>{Object.entries(KINDS).map(([k, label]) => <option key={k} value={k}>{label[zh ? 0 : 1]}</option>)}</select></label>
      <span>{text('当前页历史记录回放，非逐 Token 重现；游标到达起点后可查看完整已存正文，不重新执行。', 'Current-page historical replay, not token streaming. Full retained content becomes available at its recorded start; nothing executes.')}</span>
    </div>
    <details className="team-exp-diagnostics"><summary>{text('本轮协作指标与覆盖', 'Coordination metrics and coverage')} · {issueCount ? text(`${issueCount} 次运行需检查证据`, `${issueCount} trials need evidence review`) : text('本轮证据已齐备', 'Evidence retained for this repetition')}</summary>
      <div className="team-exp-table-scroll"><table><thead><tr><th>{text('运行 / 观察结构', 'Trial / observed structure')}</th><th>{text('执行机', 'Host')}</th><th>{text('成员覆盖', 'Roster coverage')}</th><th>{text('活动覆盖', 'Activity coverage')}</th><th>{text('通信覆盖', 'Communication coverage')}</th><th>{text('模型工具采集', 'Model/tool capture')}</th><th>{text('并发峰值', 'Peak agents')}</th><th>{text('工作重叠 ms', 'Work overlap ms')}</th><th>{text('累计成员等待 ms', 'Agent wait ms')}</th><th>{text('消息 / 交接 / 返工', 'Messages / handoffs / rework')}</th><th>{text('上下文 Token', 'Context tokens')}</th></tr></thead><tbody>{trials.map(t => { const s = summarizeTeamTrial(t); return <tr key={t.id}><th>{t.id} · {TOPOLOGY[s.topology][zh ? 0 : 1]}</th><td>{t.run.host}</td><td>{coverageLabel(t.evidence?.coverage.roster)}</td><td>{coverageLabel(t.evidence?.coverage.activities)}</td><td>{coverageLabel(t.evidence?.coverage.communication)}</td><td>{coverageLabel(t.run.telemetry?.complete)}</td><td>{value(s.peakActiveAgents)}</td><td>{value(s.overlapMs)}</td><td>{value(s.waitMs)}</td><td>{value(s.messages)} / {value(s.handoffs)} / {value(s.reworks)}</td><td>{value(s.contextTokens)}</td></tr>; })}</tbody></table></div>
      {trials.map(trial => { const summary = summarizeTeamTrial(trial); return <details className="team-exp-trial-evidence" key={trial.id}>
        <summary>{trial.id} · {trial.run.host} · {trial.run.status}{(trial.run.error || trial.evidenceError) ? text(' · 有错误记录', ' · errors retained') : ''}</summary>
        <p>{text('模型与工具采集完整性：', 'Model/tool capture completeness: ')}{coverageLabel(trial.run.telemetry?.complete)} · {text('实际模型：', 'Actual model: ')}{trial.run.telemetry?.actualModel ?? text('未知', 'Unknown')}</p>
        <p>{caseEvidenceUnknown(trial) ? text('独立具名验收缺失、未知或与汇总不一致；质量结论未知。', 'Named independent acceptance is missing, unknown or inconsistent with its aggregate; quality is unknown.') : text('具名用例与独立验收汇总一致。', 'Named cases agree with independent aggregate acceptance.')}</p>
        {trial.run.error && <><h4>{text('执行错误', 'Execution error')}</h4><pre>{trial.run.error}</pre></>}
        {trial.evidenceError && <><h4>{text('采集证据错误', 'Capture evidence error')}</h4><pre>{trial.evidenceError}</pre></>}
        {summary.warnings.length > 0 && <ul>{summary.warnings.map(warning => <li key={warning.code}>{warning[zh ? 'zh' : 'en']}</li>)}</ul>}
      </details>; })}
      <p>{text('等待来自显式事件；上下文和协调记录不额外加入 Token 总量。通信不证明团队机制或沟通价值。', 'Waits require explicit events; context and coordination records are not added to token totals. Messaging alone does not prove team semantics or value.')}</p>
    </details>
    <div className="team-exp-reading-grid">
      <div className="team-exp-records"><div className="team-exp-record-heading"><h3>{text('详细记录', 'Detailed records')}</h3><span>{revealed.length ? index * PAGE + 1 : 0}–{index * PAGE + visible.length} / {revealed.length}</span><button className="btn" disabled={!index} onClick={() => setPage(index - 1)}>{text('上一页', 'Previous')}</button><button className="btn" disabled={(index + 1) * PAGE >= revealed.length} onClick={() => setPage(index + 1)}>{text('下一页', 'Next')}</button></div>
        {visible.length === 0 && <p>{text('当前游标和筛选下没有记录。播放、前进或调整筛选。', 'No records at this cursor and filter. Play, step forward or change filters.')}</p>}
        {visible.map(item => <article key={item.key} className="team-exp-record" data-selected={selectedKey === item.key}>
          <button className="team-exp-record-select" aria-pressed={selectedKey === item.key} onClick={() => pick(item)}><time>{value(item.event.startMs / 1000)}s</time><span className={`team-exp-event-kind team-exp-kind-${item.event.kind}`}>{KINDS[item.event.kind][zh ? 0 : 1]}</span><strong>{item.event.name}</strong><small>{item.trial.variantId} · {nameOf(item)}</small></button>
          {item.event.detail && <p className="team-exp-record-preview">{item.event.detail.slice(0, 220)}{item.event.detail.length > 220 ? '…' : ''}</p>}
        </article>)}
      </div>
      <aside className="team-exp-inspector" ref={detailRef} aria-label={text('选中记录详情', 'Selected record details')}>
        <div className="team-exp-record-heading"><h3>{text('记录详情', 'Record details')}</h3><button className="btn" aria-label={text('缩小正文', 'Smaller text')} disabled={font <= 8} onClick={() => setFont(f => Math.max(8, f - 1))}>A−</button><button className="btn" aria-label={text('放大正文', 'Larger text')} disabled={font >= 28} onClick={() => setFont(f => Math.min(28, f + 1))}>A+</button><button className="btn" aria-label={text('重置正文大小', 'Reset text size')} onClick={() => setFont(13)}>R</button></div>
        {selected ? <><h4>{selected.event.name}</h4><p>{selected.trial.variantId} · {nameOf(selected)} · {KINDS[selected.event.kind][zh ? 0 : 1]}</p><pre className="team-exp-public-detail" style={{ fontSize: `${font}px` }}>{selected.event.detail ?? text('没有保留公开正文。', 'No retained public content.')}</pre>
          <dl><div><dt>{text('事件 ID', 'Event ID')}</dt><dd>{selected.event.id}</dd></div><div><dt>{text('时间 / 时长', 'Start / duration')}</dt><dd>{value(selected.event.startMs)}ms / {value(selected.event.durationMs)}ms · {selected.event.timing}</dd></div><div><dt>{text('状态', 'Status')}</dt><dd>{selected.event.status}</dd></div><div><dt>{text('收件成员', 'Target member')}</dt><dd>{selected.event.targetAgentId ?? '—'}</dd></div><div><dt>{text('依赖', 'Dependencies')}</dt><dd>{selected.event.dependsOn.length ? <><span>{dependencyIndex * 20 + 1}–{Math.min((dependencyIndex + 1) * 20, selected.event.dependsOn.length)} / {selected.event.dependsOn.length}</span><div>{selected.event.dependsOn.slice(dependencyIndex * 20, (dependencyIndex + 1) * 20).map(id => <button className="btn" key={id} onClick={() => locate(selected.trial.id, id)}>{id}</button>)}</div>{selected.event.dependsOn.length > 20 && <><button className="btn" disabled={!dependencyIndex} onClick={() => setDependencyPage(dependencyIndex - 1)}>{text('上一页依赖', 'Previous dependencies')}</button><button className="btn" disabled={(dependencyIndex + 1) * 20 >= selected.event.dependsOn.length} onClick={() => setDependencyPage(dependencyIndex + 1)}>{text('下一页依赖', 'Next dependencies')}</button></>}</> : '—'}</dd></div><div><dt>Token</dt><dd>{value(selected.event.tokens)}</dd></div></dl>
          {nativeLink(selected.event) ? <a href={nativeLink(selected.event)!} target="_blank" rel="noreferrer">{text('打开原始任务记录', 'Open original task record')}</a> : <p>{text('没有原始会话定位，不推测关联。', 'No original session locator; no association is inferred.')}</p>}
        </> : <p>{text('点击轨迹块或记录，查看完整的工具参数、执行结果、公开模型输出和协作信息。', 'Select a trajectory block or record for full tool parameters, results, public model output and collaboration evidence.')}</p>}
      </aside>
    </div>
  </section>;
}
