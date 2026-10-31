import '../../styles/components/stage-replay.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { TeamActivitySlim, TeamRunSnapshot } from '../../core/trace-types.js';
import { serializeHash } from '../../hash-router.js';
import { t, type I18nKey, type Locale } from '../../i18n.js';
import { teamApi, type TeamActivityDetailResponse, type TeamSelection } from '../team/team-client.js';
import { buildReplayStages, type ReplayPhase } from './stage-replay-model.js';

const labels: Record<ReplayPhase, [string, string]> = {
  setup: ['建立任务与成员', 'Task & member setup'], assignment: ['分配与归属', 'Assignment & ownership'],
  execution: ['执行活动', 'Execution'], coordination: ['协调与交接记录', 'Coordination & handoff'],
  report: ['任务状态上报', 'Task status report'], output: ['输出或归属确认', 'Output or ownership confirmation'],
  verification: ['验证记录', 'Verification evidence'], unknown: ['待核实控制事件', 'Unclassified control event'],
};

export function StageReplay({ snapshot, activities, coverage, onSelect, locale }: {
  snapshot: TeamRunSnapshot; activities: readonly TeamActivitySlim[]; coverage: 'complete' | 'partial' | 'unavailable';
  onSelect: (selection: TeamSelection | null) => void; locale: Locale;
}): React.JSX.Element {
  // A changed run/stamp creates a new player. No old cursor/body or timer crosses run boundaries.
  return <StagePlayer key={`${snapshot.summary.id}:${snapshot.summary.stamp}`} snapshot={snapshot} activities={activities} coverage={coverage} onSelect={onSelect} locale={locale} />;
}

function StagePlayer({ snapshot, activities, coverage, onSelect, locale }: Parameters<typeof StageReplay>[0]): React.JSX.Element {
  const zh = locale === 'zh';
  const say = (a: string, b: string): string => zh ? a : b;
  const model = useMemo(() => buildReplayStages(snapshot.summary.id, activities), [snapshot.summary.id, activities]);
  const [filter, setFilter] = useState('collaboration');
  const [mode, setMode] = useState<'timed' | 'undated'>('timed');
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [delay, setDelay] = useState(1800);
  const baseStages = model[mode];
  const hasControlEvidence = baseStages.some(stage => stage.phase !== 'execution');
  const stages = baseStages.filter(stage => filter === 'all' || (filter === 'collaboration' ? !hasControlEvidence || stage.phase !== 'execution' : stage.phase === filter));
  const cursor = Math.min(index, Math.max(0, stages.length - 1));
  const current = stages[cursor];
  const selectRef = useRef(onSelect); selectRef.current = onSelect;
  useEffect(() => {
    const activity = current?.activities[0];
    selectRef.current(activity?.taskId ? { kind: 'task', id: activity.taskId } : activity?.agentId ? { kind: 'agent', id: activity.agentId } : null);
  }, [current?.id]);
  useEffect(() => {
    if (!playing || mode !== 'timed' || cursor >= stages.length - 1) return;
    const timer = window.setTimeout(() => { setIndex(cursor + 1); if (cursor + 1 >= stages.length - 1) setPlaying(false); }, delay);
    return () => window.clearTimeout(timer);
  }, [playing, mode, cursor, stages.length, delay]);
  useEffect(() => {
    const pause = (): void => { if (document.hidden) setPlaying(false); };
    document.addEventListener('visibilitychange', pause);
    return () => document.removeEventListener('visibilitychange', pause);
  }, []);
  const seek = (next: number): void => { setPlaying(false); setIndex(Math.max(0, Math.min(stages.length - 1, next))); };
  const switchMode = (next: 'timed' | 'undated'): void => { setPlaying(false); setIndex(0); setMode(next); };
  const actor = snapshot.agents.find(agent => agent.id === current?.agentId);
  const task = snapshot.tasks.find(item => item.id === current?.taskId);
  const recent = stages.slice(Math.max(0, cursor - 3), Math.min(stages.length, cursor + 4));
  return <section className="stage-replay" aria-label={say('协作阶段回放', 'Collaboration stage replay')}>
    <header className="sr-heading"><div><span className="sr-eyebrow">{say('证据驱动 · 历史步骤', 'Evidence-based · historical steps')}</span><h3>{say('协作阶段回放', 'Collaboration stage replay')}</h3></div><span className="sr-count">{stages.length} {say('当前范围步骤 /', 'steps in scope /')} {model.timed.length} {say('有时间步骤', 'timed steps')} · {model.undated.length} {say('时间未知', 'undated')}</span></header>
    <details className="sr-method"><summary>{say('回放范围与证据边界', 'Replay scope & evidence limits')}</summary><p className="sr-scope">{say('默认聚焦协作节点，可切换全部原生执行轮次；播放按步骤推进，不模拟真实耗时或推断因果。成员与任务名称来自快照，历史状态只依据所选步骤。', 'Collaboration checkpoints are shown by default; all explicit native execution turns remain available. Playback advances by step, without simulated durations or causal claims. Names come from the snapshot; historical state uses the selected evidence only.')}</p></details>
    {coverage !== 'complete' && <p className="sr-warning" role="status">{coverage === 'partial' ? say(`仅回放已加载的 ${activities.length} 条活动，较早步骤可能尚未加载。`, `Only ${activities.length} loaded activities are replayed; earlier steps may be absent.`) : say('活动证据不可用，请重试读取。', 'Activity evidence unavailable. Retry loading.')}</p>}
    <div className="sr-modes"><select aria-label={say('阶段范围', 'Stage scope')} value={filter} onChange={event => { setPlaying(false); setIndex(0); setFilter(event.target.value); }}>
      <option value="collaboration">{say('协作节点', 'Collaboration checkpoints')}</option><option value="all">{say('全部执行轮次', 'All execution turns')}</option><option value="assignment">{say('分配与归属', 'Assignment & ownership')}</option><option value="report">{say('任务状态上报', 'Task status reports')}</option><option value="unknown">{say('待核实事件', 'Unclassified events')}</option>
    </select><button type="button" aria-pressed={mode === 'timed'} onClick={() => switchMode('timed')}>{say('有时间记录', 'Timed records')} · {model.timed.length}</button><button type="button" aria-pressed={mode === 'undated'} onClick={() => switchMode('undated')}>{say('时间未知，单独查看', 'Undated, separate review')} · {model.undated.length}</button></div>
    <div className="sr-controls">
      <button type="button" onClick={() => seek(cursor - 1)} disabled={cursor === 0 || !current} aria-label={say('上一步', 'Previous step')}>←</button>
      <button type="button" className="sr-play" disabled={mode !== 'timed' || stages.length < 2} onClick={() => { if (cursor >= stages.length - 1) setIndex(0); setPlaying(value => cursor >= stages.length - 1 ? true : !value); }}>{playing && cursor < stages.length - 1 ? say('暂停', 'Pause') : say('播放', 'Play')}</button>
      <button type="button" onClick={() => seek(cursor + 1)} disabled={!current || cursor >= stages.length - 1} aria-label={say('下一步', 'Next step')}>→</button>
      <label className="sr-progress"><span>{current ? cursor + 1 : 0} / {stages.length}</span><input type="range" aria-label={say('回放进度', 'Replay progress')} min={0} max={Math.max(0, stages.length - 1)} value={cursor} disabled={!current} onChange={event => seek(Number(event.target.value))} /></label>
      <select aria-label={say('每步播放间隔', 'Playback step interval')} value={delay} onChange={event => setDelay(Number(event.target.value))}><option value={1800}>{say('每步 1.8 秒', '1.8s per step')}</option><option value={900}>{say('每步 0.9 秒', '0.9s per step')}</option><option value={3000}>{say('每步 3 秒', '3s per step')}</option></select>
    </div>
    {!current ? <p className="sr-empty">{say('此分组暂无可回放步骤。时间未知记录不会被塞入时间轴。', 'No steps in this group. Undated evidence is never inserted into the timeline.')}</p> : <>
      <div className="sr-layout">
        <nav className="sr-steps" aria-label={say('阶段定位', 'Stage navigation')}>{recent.map(stage => {
          const position = stages.indexOf(stage);
          return <button type="button" key={stage.id} aria-current={stage.id === current.id ? 'step' : undefined} onClick={() => seek(position)}><span className="sr-step-no">{position + 1}</span><span><strong>{labels[stage.phase][zh ? 0 : 1]}</strong><small>{stage.time ? new Date(stage.time).toLocaleString(zh ? 'zh-CN' : 'en-GB', {timeZone:'UTC'}) + ' UTC' : say('时间未知', 'Time unknown')}</small></span></button>;
        })}</nav>
        <article className="sr-current" key={current.id}>
          <span className="sr-eyebrow">{say('当前步骤', 'Current step')} · {cursor + 1}</span><h4>{labels[current.phase][zh ? 0 : 1]}</h4>
          <time>{current.time ?? say('时间未知：仅保留源记录顺序', 'Time unknown: source record order only')}</time>
          {current.ambiguous && <p className="sr-warning">{say('顺序有歧义 · 不表示因果。', 'Ambiguous order: tied times or separate sources do not establish causality.')}</p>}
          <div className="sr-context"><div data-active-agent={actor?.id}><span>{say('当前成员', 'Current member')}</span><strong>{actor?.displayName ?? say('成员未知', 'Unknown member')}</strong><small>{say('此步骤执行者', 'Actor in this step; no live or final-state claim')}</small></div><div data-active-task={task?.id}><span>{say('当前任务', 'Current task')}</span><strong className="sr-task-preview" title={task?.title}>{task ? `#${task.nativeId} · ${task.title}` : say('任务未关联', 'Task unlinked')}</strong>{task && <details className="sr-task-full"><summary>{say('完整任务标题', 'Full task title')}</summary><p>{task.title}</p></details>}<small>{say('仅采用显式任务引用', 'Explicit task references only')}</small></div></div>
          <p>{current.activities.length} {say('条源活动；成功仅指该操作结果。完成上报不等于交付或验收。', 'source activities; success describes the operation only. Completion reports do not prove delivery or acceptance.')}</p>
          {current.phase === 'unknown' && <p className="sr-warning">{say('收件人或送达可能未被记录。查看证据，不能由工具成功状态推定消息送达。', 'Recipient or delivery may be missing. Inspect evidence; tool success does not prove delivery.')}</p>}
          <StageEvidence key={current.id} runId={snapshot.summary.id} activities={current.activities} locale={locale} />
        </article>
      </div>
      <div className="sr-participants" aria-label={say('当前成员高亮', 'Current member highlight')}>{snapshot.agents.filter(agent => stages.slice(0, cursor + 1).some(stage => stage.agentId === agent.id)).map(agent => <span key={agent.id} className={agent.id === current.agentId ? 'sr-active' : ''}>{agent.displayName}{agent.id === current.agentId ? say(' · 当前', ' · current') : ''}</span>)}</div>
    </>}
  </section>;
}

function StageEvidence({ runId, activities, locale }: { runId: string; activities: readonly TeamActivitySlim[]; locale: Locale }): React.JSX.Element {
  const [limit,setLimit] = useState(8);
  return <div className="sr-evidence-list">{activities.slice(0,limit).map(activity => <Evidence key={activity.id} runId={runId} activity={activity} locale={locale} />)}{limit < activities.length && <button type="button" onClick={()=>setLimit(value=>value+8)}>{locale==='zh'?'显示更多源活动':'Show more source activities'} · {limit} / {activities.length}</button>}</div>;
}
function Evidence({runId, activity, locale}: {runId: string; activity: TeamActivitySlim; locale: Locale}): React.JSX.Element {
  const [detail, setDetail] = useState<TeamActivityDetailResponse | null>(null);
  const [error,setError] = useState<string|null>(null);
  const [loading,setLoading] = useState(false);
  const mounted=useRef(true);
  useEffect(()=>{ mounted.current=true; return ()=>{mounted.current=false;}; },[]);
  const load = (): void => {
    if (loading || detail) return;
    setLoading(true);setError(null);
    teamApi.activityDetail(runId,activity.id,'body').then(value=>{if(mounted.current)setDetail(value);}).catch(()=>{if(mounted.current)setError(locale==='zh'?'正文不可用；保留源定位与证据 ID。':'Body unavailable; source references and evidence IDs remain available.');}).finally(()=>{if(mounted.current)setLoading(false);});
  };
  return <details className="sr-evidence" onToggle={event=>{if(event.currentTarget.open)load();}}>
    <summary>{locale==='zh'?'展开源证据':'Expand source evidence'} · {t(`session.teamReplay.activityKind.${activity.kind}` as I18nKey,locale)}</summary>
    <dl><dt>{locale==='zh'?'操作结果':'Operation result'}</dt><dd>{t(`status.${activity.status}` as I18nKey,locale)}</dd><dt>ID</dt><dd><code>{activity.id}</code></dd><dt>{locale==='zh'?'证据 ID':'Evidence IDs'}</dt><dd>{activity.evidenceIds.join('\n') || '—'}</dd></dl>
    {activity.sessionKey && <a href={serializeHash({view:'session',key:activity.sessionKey,time:'all'})}>{locale==='zh'?'打开来源会话':'Open source session'} · {activity.eventId ?? (locale==='zh'?'事件未精确关联':'Event unlinked')}</a>}
    {loading && <p role="status">{locale==='zh'?'读取证据…':'Loading evidence…'}</p>}
    {error && <p role="status">{error} <button type="button" onClick={load}>{locale==='zh'?'重试':'Retry'}</button></p>}
    {detail && <><p>{locale==='zh'?'以下为按需读取的脱敏源片段；截断会在正文标记，原文件未改动。':'On-demand redacted source excerpts. Truncation is marked; original files are unchanged.'}</p>{detail.body ? Object.entries(detail.body).filter(([,body])=>body!==null).map(([key,body])=><div key={key}><strong>{({input:'输入',output:'返回',message:'消息',result:'映射说明'} as Record<string,string>)[key] && locale==='zh' ? ({input:'输入',output:'返回',message:'消息',result:'映射说明'} as Record<string,string>)[key] : key}</strong><pre>{body}</pre></div>) : <p>{locale==='zh'?'未保留正文。':'No retained body.'}</p>}</>}
  </details>;
}
