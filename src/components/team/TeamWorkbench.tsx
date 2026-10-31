import '../../styles/components/team-workbench.css';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { TeamActivitySlim, TeamRunSnapshot, TeamTaskStatus } from '../../core/trace-types.js';
import { t, type I18nKey, type Locale } from '../../i18n.js';
import { serializeHash } from '../../hash-router.js';
import { Drawer } from '../ui/Modal.js';
import type { TeamSelection } from './team-client.js';

const PAGE_SIZE = 8;
const words = {
  overview: ['团队工作概览', 'Team work overview'], members: ['成员与分工', 'Members & responsibilities'],
  tasks: ['任务与阻塞', 'Tasks & blockers'], completed: ['已完成任务', 'Completed tasks'],
  blocked: ['阻塞任务', 'Blocked tasks'], unknown: ['状态未知', 'Unknown status'],
  scope: ['基于已记录快照；状态不代表当前在线，任务总数不等于工作量或质量。', 'Recorded snapshot; states do not indicate live presence. Task counts are not workload or quality.'],
  search: ['搜索成员、角色或任务', 'Search members, roles or tasks'], clear: ['清除筛选', 'Clear filters'],
  all: ['全部状态', 'All states'], noMatch: ['没有匹配项，请调整筛选。', 'No matches. Adjust the filters.'],
  noAgents: ['尚无成员证据。', 'No retained member evidence.'], noTasks: ['尚无任务证据。', 'No retained task evidence.'],
  noOwner: ['尚无指派证据', 'No assignment evidence'], noAssigned: ['尚无关联任务', 'No linked tasks'],
  selected: ['选中详情', 'Selected detail'], pick: ['选择成员或任务', 'Select a member or task'],
  pickHint: ['在左侧查看分工，选择一项后追踪任务、依赖和已记录关系。', 'Review responsibilities on the left, then select an item to inspect tasks, dependencies and recorded relationships.'],
  close: ['关闭详情', 'Close detail'], relations: ['已记录关系', 'Recorded relationships'],
  relationHint: ['结构和协作关系不等于消息通信；保留证据置信度和历史边界。', 'Structural and collaboration relationships are not messages; confidence and historical boundaries are retained.'],
  noRelations: ['未保留此成员的关系证据。', 'No retained relationship evidence for this member.'],
  communicationMissing: ['通信证据不可用：无法确认谁向谁发送了什么。结构关系不能代替通信证据。', 'Communication evidence unavailable: sender, recipient and message cannot be confirmed. Structure does not prove communication.'],
  communicationAvailable: ['通信完整性', 'Communication coverage'], communicationHint: ['消息正文与收件人不在本快照中；仅凭事件不推断收发关系。', 'Message bodies and recipients are outside this snapshot; events alone do not establish sender–recipient relationships.'],
  assigned: ['关联任务', 'Linked tasks'], owners: ['记录负责人', 'Recorded owners'], dependencies: ['前置任务', 'Prerequisites'],
  dependencyHint: ['依赖关系不等于已确认的阻塞原因。', 'Dependencies are not confirmed causes of blocking.'],
  none: ['无已记录项', 'No retained items'], historical: ['历史关系', 'Historical relationship'],
  evidence: ['证据 ID', 'Evidence IDs'], source: ['来源会话', 'Source session'], role: ['原生角色', 'Native role'],
  model: ['模型', 'Model'], events: ['已加载执行事件', 'Loaded execution events'],
  eventScope: ['仅显示已加载事件，最多最近 10 条；不宣称完整顺序或因果。', 'Loaded events only, at most 10 most recent; no complete ordering or causality is claimed.'],
  eventsUnavailable: ['执行事件尚未加载或读取失败，可使用原有执行账本检查。', 'Execution events are not loaded or failed to load; use the existing execution ledger to investigate.'],
  partial: ['活动分页尚未完整加载。', 'Activity pages are incomplete.'],
  snapshotPartial: ['任务证据完整性', 'Task evidence coverage'],
  prev: ['上一页', 'Previous page'], next: ['下一页', 'Next page'], range: ['当前显示', 'Showing'],
  status: ['筛选任务状态', 'Filter task status'], linked: ['与选中项关联', 'Linked to selection'],
  failed: ['失败任务', 'Failed tasks'],
} as const;

export interface TeamWorkbenchProps {
  snapshot: TeamRunSnapshot;
  activities?: readonly TeamActivitySlim[];
  activityCoverage?: 'complete' | 'partial' | 'unavailable';
  selection: TeamSelection | null;
  onSelect: (selection: TeamSelection | null) => void;
  locale: Locale;
}

/** Presentation only: no fetching, inferred ownership, message edges or body reads. */
export function TeamWorkbench({ snapshot, activities = [], activityCoverage = 'unavailable', selection, onSelect, locale }: TeamWorkbenchProps): React.JSX.Element {
  const w = (key: keyof typeof words): string => words[key][locale === 'zh' ? 0 : 1];
  const rootRef = useRef<HTMLElement>(null);
  const [compact, setCompact] = useState(false);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [agentPage, setAgentPage] = useState(0);
  const [taskPage, setTaskPage] = useState(0);
  const close = useCallback(() => onSelect(null), [onSelect]);
  useLayoutEffect(() => {
    const update = (): void => setCompact((rootRef.current?.clientWidth || window.innerWidth) < 760);
    update(); window.addEventListener('resize', update);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    if (rootRef.current) observer?.observe(rootRef.current);
    return () => { observer?.disconnect(); window.removeEventListener('resize', update); };
  }, []);

  const model = useMemo(() => {
    const agents = new Map(snapshot.agents.map(agent => [agent.id, agent]));
    const tasks = new Map(snapshot.tasks.map(task => [task.id, task]));
    const taskIds = new Map<string, Set<string>>();
    const ownerIds = new Map<string, Set<string>>();
    for (const assignment of snapshot.assignments) {
      if (assignment.unassignedAt !== null) continue;
      if (!taskIds.has(assignment.agentId)) taskIds.set(assignment.agentId, new Set());
      taskIds.get(assignment.agentId)!.add(assignment.taskId);
      if (!ownerIds.has(assignment.taskId)) ownerIds.set(assignment.taskId, new Set());
      ownerIds.get(assignment.taskId)!.add(assignment.agentId);
    }
    return { agents, tasks, taskIds, ownerIds };
  }, [snapshot]);
  const selectedAgent = selection?.kind === 'agent' ? model.agents.get(selection.id) : undefined;
  const selectedTask = selection?.kind === 'task' ? model.tasks.get(selection.id) : undefined;
  const hasSelection = selectedAgent !== undefined || selectedTask !== undefined;
  const needle = query.trim().toLocaleLowerCase();
  const matches = (...values: string[]): boolean => values.some(value => value.toLocaleLowerCase().includes(needle));
  const filteredAgents = snapshot.agents.filter(agent => matches(agent.displayName, agent.role, agent.nativeId,
    ...[...model.taskIds.get(agent.id) ?? []].map(id => model.tasks.get(id)?.title ?? id)));
  const filteredTasks = snapshot.tasks.filter(task => (status === 'all' || task.status === status) && matches(task.title, task.nativeId,
    ...[...model.ownerIds.get(task.id) ?? []].map(id => model.agents.get(id)?.displayName ?? id)));
  const page = <T,>(items: T[], value: number): { rows: T[]; start: number; index: number } => {
    const index = Math.min(value, Math.max(0, Math.ceil(items.length / PAGE_SIZE) - 1));
    const start = index * PAGE_SIZE;
    return { rows: items.slice(start, start + PAGE_SIZE), start, index };
  };
  const agentSlice = page(filteredAgents, agentPage);
  const taskSlice = page(filteredTasks, taskPage);
  const select = (kind: 'agent' | 'task', id: string): void => onSelect(selection?.kind === kind && selection.id === id ? null : { kind, id });
  const agentLabel = (id: string): string => model.agents.get(id)?.displayName ?? id;
  const taskLabel = (id: string): string => model.tasks.get(id)?.title ?? id;
  const taskState = (value: TeamTaskStatus): string => t(`team.taskStatus.${value}` as I18nKey, locale);
  const count = (value: TeamTaskStatus): number => snapshot.tasks.filter(task => task.status === value).length;
  const pager = (total: number, slice: { start: number; index: number; rows: unknown[] }, set: (value: number) => void, label: string): React.JSX.Element => <nav className="tw-pager" aria-label={label}>
    <span>{w('range')} {total === 0 ? 0 : slice.start + 1}–{slice.start + slice.rows.length} / {total}</span>
    <button type="button" disabled={slice.index === 0} onClick={() => set(slice.index - 1)} aria-label={`${label} · ${w('prev')}`}>←</button>
    <button type="button" disabled={slice.start + PAGE_SIZE >= total} onClick={() => set(slice.index + 1)} aria-label={`${label} · ${w('next')}`}>→</button>
  </nav>;
  const evidence = (ids: readonly string[]): React.JSX.Element => <details className="tw-evidence"><summary>{w('evidence')} · {ids.length}</summary>{ids.length === 0 ? <p>{w('none')}</p> : <><p>{w('range')} 1–{Math.min(20, ids.length)} / {ids.length}</p><ul>{ids.slice(0, 20).map(id => <li key={id}><code>{id}</code></li>)}</ul></>}</details>;
  const relatedEvents = activities.filter(event => selectedAgent ? event.agentId === selectedAgent.id : selectedTask ? event.taskId === selectedTask.id : false)
    .sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? '') || a.id.localeCompare(b.id));

  const detail = <div className="tw-detail-content">
    {hasSelection ? <>
      <span className="tw-kicker">{selectedAgent ? w('members') : w('tasks')}</span>
      <h3>{selectedAgent?.displayName ?? selectedTask?.title}</h3>
      <p className={`tw-state tw-state-${selectedAgent?.state ?? selectedTask?.status}`}>{selectedAgent ? t(`session.teamReplay.agentState.${selectedAgent.state}` as I18nKey, locale) : selectedTask ? taskState(selectedTask.status) : ''}</p>
      {selectedAgent && <>
        <dl className="tw-meta"><div><dt>{w('role')}</dt><dd>{selectedAgent.role}</dd></div><div><dt>{w('model')}</dt><dd>{selectedAgent.model ?? '—'}</dd></div></dl>
        <h4>{w('assigned')}</h4>
        <ul className="tw-links">{[...model.taskIds.get(selectedAgent.id) ?? []].map(id => <li key={id}><button type="button" onClick={() => onSelect({ kind: 'task', id })}>{taskLabel(id)}</button></li>)}</ul>
        {(model.taskIds.get(selectedAgent.id)?.size ?? 0) === 0 && <p>{w('noAssigned')}</p>}
        <h4>{w('relations')}</h4><p>{w('relationHint')}</p>
        <ul className="tw-relations">{snapshot.agentEdges.filter(edge => edge.fromAgentId === selectedAgent.id || edge.toAgentId === selectedAgent.id).map(edge => <li key={edge.id}>
          <button type="button" onClick={() => onSelect({ kind: 'agent', id: edge.fromAgentId === selectedAgent.id ? edge.toAgentId : edge.fromAgentId })}>
            {agentLabel(edge.fromAgentId)} <span>→ {t(`session.teamReplay.edgeKind.${edge.kind}` as I18nKey, locale)} →</span> {agentLabel(edge.toAgentId)}
          </button><small>{edge.confidence}{edge.validTo !== null ? ` · ${w('historical')}` : ''}</small>{evidence(edge.evidenceIds)}
        </li>)}</ul>
        {!snapshot.agentEdges.some(edge => edge.fromAgentId === selectedAgent.id || edge.toAgentId === selectedAgent.id) && <p>{w('noRelations')}</p>}
        {selectedAgent.sessionKeys.map(key => <a className="tw-source" key={key} href={serializeHash({ view: 'session', key, time: 'all' })}>{w('source')} · {key}</a>)}
        {evidence(selectedAgent.evidenceIds)}
      </>}
      {selectedTask && <>
        <h4>{w('owners')}</h4><ul className="tw-links">{[...model.ownerIds.get(selectedTask.id) ?? []].map(id => <li key={id}><button type="button" onClick={() => onSelect({ kind: 'agent', id })}>{agentLabel(id)}</button></li>)}</ul>
        {(model.ownerIds.get(selectedTask.id)?.size ?? 0) === 0 && <p>{w('noOwner')}</p>}
        <h4>{w('dependencies')}</h4><p>{w('dependencyHint')}</p>
        <ul className="tw-links">{snapshot.taskDependencies.filter(dep => dep.downstreamTaskId === selectedTask.id && dep.validTo === null).map(dep => <li key={dep.id}><button type="button" onClick={() => onSelect({ kind: 'task', id: dep.upstreamTaskId })}>{taskLabel(dep.upstreamTaskId)}</button><small>{dep.confidence}</small>{evidence(dep.evidenceIds)}</li>)}</ul>
        {evidence(selectedTask.evidenceIds)}
      </>}
      <h4>{w('events')}{activityCoverage !== 'unavailable' ? ` · ${relatedEvents.length}` : ''}</h4>
      <p>{activityCoverage === 'unavailable' ? w('eventsUnavailable') : w('eventScope')}</p>
      {activityCoverage === 'partial' && <p>{w('partial')}</p>}
      {activityCoverage !== 'unavailable' && <ol className="tw-events">{relatedEvents.slice(0, 10).map(event => <li key={event.id}>
        <strong>{t(`session.teamReplay.activityKind.${event.kind}` as I18nKey, locale)}</strong> · {t(`status.${event.status}` as I18nKey, locale)}
        <time>{event.startedAt ?? '—'}</time><code>{event.id}</code>
        {event.orderConfidence === 'ambiguous' && <small>{t('team.ambiguousOrder', locale)}</small>}
        {event.sessionKey && <a href={serializeHash({ view: 'session', key: event.sessionKey, time: 'all' })}>{w('source')}</a>}
        {evidence(event.evidenceIds)}
      </li>)}</ol>}
    </> : <div className="tw-placeholder"><h3>{w('pick')}</h3><p>{w('pickHint')}</p></div>}
  </div>;

  return <section className="team-workbench" ref={rootRef} aria-label={w('overview')}>
    <div className="tw-stats">
      <div><span>{w('members')}</span><strong>{snapshot.agents.length}</strong></div>
      <div><span>{w('completed')}</span><strong>{count('completed')} / {snapshot.tasks.length}</strong></div>
      <div><span>{w('blocked')}</span><strong>{count('blocked')}</strong></div>
      <div><span>{w('failed')}</span><strong>{count('failed')}</strong></div>
      <div><span>{w('unknown')}</span><strong>{count('unknown')}</strong></div>
    </div>
    <p className="tw-scope">{w('scope')} {w('snapshotPartial')}: {t(`team.completeness.${snapshot.completeness.tasks}` as I18nKey, locale)}</p>
    <div className="tw-communication" role="note">{snapshot.completeness.communication === 'unavailable' ? w('communicationMissing') : <>{w('communicationAvailable')}: {t(`team.completeness.${snapshot.completeness.communication}` as I18nKey, locale)}. {w('communicationHint')}</>}</div>
    <div className="tw-toolbar"><input type="search" aria-label={w('search')} placeholder={w('search')} value={query} onChange={event => { setQuery(event.target.value); setAgentPage(0); setTaskPage(0); }} />
      <select aria-label={w('status')} value={status} onChange={event => { setStatus(event.target.value); setTaskPage(0); }}><option value="all">{w('all')}</option>{(['pending', 'ready', 'claimed', 'running', 'blocked', 'completed', 'failed', 'cancelled', 'unknown'] as const).map(value => <option key={value} value={value}>{taskState(value)}</option>)}</select>
      {(query !== '' || status !== 'all') && <button type="button" onClick={() => { setQuery(''); setStatus('all'); setAgentPage(0); setTaskPage(0); }}>{w('clear')}</button>}
    </div>
    <div className={`tw-grid ${compact ? 'tw-compact' : ''}`}>
      <div className="tw-lists">
        <section aria-label={w('members')} className="tw-section"><h3>{w('members')} <span>{filteredAgents.length} / {snapshot.agents.length}</span></h3>
          <div className="tw-rows">{agentSlice.rows.map(agent => {
            const assigned = [...model.taskIds.get(agent.id) ?? []];
            const linked = selectedTask !== undefined && (model.ownerIds.get(selectedTask.id)?.has(agent.id) ?? false);
            return <button type="button" className={`tw-row tw-member ${linked ? 'tw-linked' : ''}`} key={agent.id} title={agent.displayName} aria-pressed={selectedAgent?.id === agent.id} onClick={() => select('agent', agent.id)}>
              <span className="tw-identity"><strong>{agent.displayName}</strong><small>{agent.role} · {t(`session.teamReplay.agentState.${agent.state}` as I18nKey, locale)}</small></span>
              <span className="tw-responsibility">{assigned.length === 0 ? w('noAssigned') : <>{taskLabel(assigned[0]!)}{assigned.length > 1 ? ` · +${assigned.length - 1}` : ''}</>}{linked && <small>{w('linked')}</small>}</span>
            </button>;
          })}</div>
          {filteredAgents.length === 0 && <p>{snapshot.agents.length === 0 ? w('noAgents') : w('noMatch')}</p>}
          {pager(filteredAgents.length, agentSlice, setAgentPage, w('members'))}
        </section>
        <section aria-label={w('tasks')} className="tw-section"><h3>{w('tasks')} <span>{filteredTasks.length} / {snapshot.tasks.length}</span></h3>
          <div className="tw-rows">{taskSlice.rows.map(task => {
            const owners = [...model.ownerIds.get(task.id) ?? []];
            const linked = selectedAgent !== undefined && (model.taskIds.get(selectedAgent.id)?.has(task.id) ?? false);
            return <button type="button" className={`tw-row tw-task ${linked ? 'tw-linked' : ''}`} key={task.id} title={task.title} aria-pressed={selectedTask?.id === task.id} onClick={() => select('task', task.id)}>
              <span className="tw-identity"><strong>{task.title}</strong><small>{owners.length > 0 ? owners.map(agentLabel).join(' · ') : w('noOwner')}{linked ? ` · ${w('linked')}` : ''}</small></span>
              <span className={`tw-state tw-state-${task.status}`}>{taskState(task.status)}</span>
            </button>;
          })}</div>
          {filteredTasks.length === 0 && <p>{snapshot.tasks.length === 0 ? w('noTasks') : w('noMatch')}</p>}
          {pager(filteredTasks.length, taskSlice, setTaskPage, w('tasks'))}
        </section>
      </div>
      {!compact && <aside className="tw-detail" aria-label={w('selected')}><div className="tw-detail-head"><strong>{w('selected')}</strong>{hasSelection && <button type="button" onClick={close} aria-label={w('close')}>×</button>}</div>{detail}</aside>}
    </div>
    {compact && <Drawer title={w('selected')} open={hasSelection} onClose={close} className="tw-drawer">{detail}</Drawer>}
  </section>;
}
