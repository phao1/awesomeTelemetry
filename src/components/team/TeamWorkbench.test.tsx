import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TeamActivitySlim, TeamRunSnapshot } from '../../core/trace-types.js';
import type { TeamSelection } from './team-client.js';
import { TeamWorkbench } from './TeamWorkbench.js';

function snapshot(memberCount = 2, taskCount = 3): TeamRunSnapshot {
  const completeness: TeamRunSnapshot['completeness'] = { topology: 'complete', tasks: 'partial', communication: 'unavailable', timing: 'partial', tools: 'partial', outputs: 'partial', tokens: 'unavailable', cost: 'unavailable', verification: 'unavailable' };
  return {
    summary: { id: 'r', provider: 'codex', nativeRunId: 'native-r', runIdentityConfidence: 'native', title: 'Team', goalFingerprint: null, status: 'blocked', startedAt: null, endedAt: null, topologyKind: 'two_level', counts: { agents: memberCount, tasks: taskCount, communications: 0, activities: 0, rounds: 0, artifacts: 0 }, tokenAvailable: false, costAvailable: false, costCurrency: null, completeness, updatedAt: '2026-10-18T00:00:00Z', stamp: 's' },
    agents: Array.from({ length: memberCount }, (_, i) => ({ id: `a${i}`, runId: 'r', nativeId: `native-a${i}`, displayName: i === 0 ? '存储工程师 · Storage Engineer · 很长的职责名称' : `Member ${i}`, role: i === 0 ? 'storage-engineer' : 'team-mate', roleClass: 'teammate', model: null, state: i === 0 ? 'blocked' : 'unknown', createdAt: null, endedAt: null, sessionKeys: i === 0 ? ['source/key?one'] : [], evidenceIds: [`e-agent-${i}`] })),
    tasks: Array.from({ length: taskCount }, (_, i) => ({ id: `t${i}`, runId: 'r', nativeId: `native-t${i}`, title: i === 0 ? '修复存储与恢复的阻塞问题' : `Task ${i}`, descriptionAvailable: false, priority: null, status: i === 0 ? 'blocked' : i === 1 ? 'completed' : 'unknown', createdAt: null, startedAt: null, completedAt: null, cancelledAt: null, failedAt: null, resultAvailable: false, evidenceIds: [`e-task-${i}`] })),
    assignments: [{ id: 'assign', runId: 'r', taskId: 't0', agentId: 'a0', assignedAt: null, unassignedAt: null, assignmentKind: 'assigned', evidenceIds: ['e-assign'] }],
    agentEdges: memberCount < 2 ? [] : [{ id: 'edge', runId: 'r', fromAgentId: 'a0', toAgentId: 'a1', kind: 'reviews', validFrom: null, validTo: null, confidence: 'native', evidenceIds: ['edge-source'] }],
    taskDependencies: taskCount < 2 ? [] : [{ id: 'dep', runId: 'r', upstreamTaskId: 't1', downstreamTaskId: 't0', validFrom: null, validTo: null, confidence: 'correlated', evidenceIds: ['dep-source'] }],
    artifacts: [], completeness, anomalies: [], metrics: {} as TeamRunSnapshot['metrics'],
  };
}

function activity(): TeamActivitySlim {
  return { id: 'event-opaque-1', runId: 'r', agentId: 'a0', taskId: 't0', roundId: null, kind: 'tool_call', status: 'error', startedAt: '2026-10-18T00:00:01Z', endedAt: null, nativeSequence: null, sessionKey: 'source/key?one', eventId: 'source-event', turnKey: null, messageId: null, artifactId: null, tokenUsage: null, costUsd: null, costSource: null, costCurrency: null, hasInput: true, hasOutput: false, hasRaw: true, evidenceIds: ['event-source'], orderConfidence: 'ambiguous' };
}

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', vi.fn());
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
function mount(data: TeamRunSnapshot, extra: Partial<React.ComponentProps<typeof TeamWorkbench>> = {}): void {
  function Harness(): React.JSX.Element {
    const [selection, setSelection] = useState<TeamSelection | null>(null);
    return <TeamWorkbench snapshot={data} locale="zh" selection={selection} onSelect={setSelection} {...extra} />;
  }
  act(() => root.render(<Harness />));
}
function click(selector: string): void { act(() => (container.querySelector(selector) as HTMLButtonElement).click()); }
function search(value: string): void {
  const input = container.querySelector('input')!;
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
}

describe('Team workbench observed responsibility and evidence workflow', () => {
  it('shows observed completion, blocked and unknown counts without claiming zero messages or live presence', () => {
    mount(snapshot());
    expect(container.querySelector('.tw-stats')!.textContent).toContain('1 / 3');
    expect(container.textContent).toContain('状态不代表当前在线');
    expect(container.textContent).toContain('任务证据完整性: 部分');
    expect(container.querySelector('.tw-communication')!.textContent).toContain('无法确认谁向谁发送了什么');
    expect(container.textContent).not.toMatch(/0 messages|0 条消息/);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('links member → assigned task → actual owner and prerequisite, without fetching bodies', () => {
    mount(snapshot()); click('.tw-member');
    expect(container.querySelector('.tw-task.tw-linked')!.textContent).toContain('修复存储');
    expect(container.querySelector('.tw-detail')!.textContent).toContain('原生角色storage-engineer');
    click('.tw-detail .tw-links button');
    expect(container.querySelector('.tw-detail h3')!.textContent).toBe('修复存储与恢复的阻塞问题');
    expect(container.querySelector('.tw-member.tw-linked')).not.toBeNull();
    expect(container.querySelector('.tw-detail')!.textContent).toContain('Task 1');
    expect(container.querySelector('.tw-detail')!.textContent).toContain('不等于已确认的阻塞原因');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('preserves relation direction, kind, historical boundary and exact evidence IDs', () => {
    const data = snapshot(); data.agentEdges[0]!.validTo = '2026-10-18T00:00:00Z';
    mount(data); click('.tw-member');
    const relation = container.querySelector('.tw-relations li')!;
    expect(relation.textContent).toContain('→ 评审 →'); expect(relation.textContent).toContain('历史关系');
    expect(relation.textContent).toContain('native'); expect(relation.textContent).toContain('edge-source');
    click('.tw-relations button'); expect(container.querySelector('.tw-detail h3')!.textContent).toBe('Member 1');
    expect(container.querySelector('.tw-communication')!.textContent).toContain('结构关系不能代替通信证据');
  });
  it('does not invent ownership from role labels, lifecycle or inactive assignments', () => {
    const data = snapshot(); data.assignments[0]!.unassignedAt = '2026-10-18T00:00:00Z';
    mount(data); click('.tw-task');
    expect(container.querySelector('.tw-detail')!.textContent).toContain('尚无指派证据');
    expect(container.querySelector('.tw-member.tw-linked')).toBeNull();
  });
  it('pages a 100-member / 1000-task snapshot with exact omitted counts and searchable long names', () => {
    mount(snapshot(100, 1000));
    expect(container.querySelectorAll('.tw-member')).toHaveLength(8); expect(container.querySelectorAll('.tw-task')).toHaveLength(8);
    expect(container.querySelector('.tw-section .tw-pager')!.textContent).toContain('1–8 / 100');
    click('.tw-section .tw-pager button:last-child');
    expect(container.querySelector('.tw-member')!.textContent).toContain('Member 8');
    search('Storage Engineer');
    expect(container.querySelectorAll('.tw-member')).toHaveLength(1);
    expect(container.querySelector('.tw-member strong')!.textContent).toContain('很长的职责名称');
    expect(container.querySelectorAll('.tw-task')).toHaveLength(1);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('keeps status filtering separate from member search and restores all rows explicitly', () => {
    mount(snapshot());
    const select = container.querySelector('select')!;
    act(() => { select.value = 'blocked'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(container.querySelectorAll('.tw-task')).toHaveLength(1);
    search('no such member'); expect(container.textContent).toContain('没有匹配项');
    click('.tw-toolbar > button'); expect(container.querySelectorAll('.tw-task')).toHaveLength(3);
    expect(container.querySelectorAll('.tw-member')).toHaveLength(2);
  });
  it('retains partial event coverage, ambiguous ordering and source IDs without reading input/output/raw', () => {
    mount(snapshot(), { activities: [activity()], activityCoverage: 'partial' }); click('.tw-member');
    expect(container.querySelector('.tw-detail')!.textContent).toContain('活动分页尚未完整加载');
    expect(container.querySelector('.tw-events')!.textContent).toContain('event-opaque-1');
    expect(container.querySelector('.tw-events')!.textContent).toContain('event-source');
    expect(container.querySelector('.tw-events a')!.getAttribute('href')).toBe('#/session?key=source%2Fkey%3Fone&time=all');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('renders an accessible right drawer on narrow screens and closes selection without data mutation', () => {
    vi.stubGlobal('innerWidth', 600); mount(snapshot()); click('.tw-member');
    expect(container.querySelector('.tw-detail')).toBeNull();
    expect(container.querySelector('[role="dialog"]')!.textContent).toContain('存储工程师');
    click('[role="dialog"] .ui-drawer-header button');
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector('.tw-member')!.getAttribute('aria-pressed')).toBe('false');
  });
  it('explains empty evidence and supports English without substituting unavailable states with zero', () => {
    const data = snapshot(0, 0); data.assignments = [];
    mount(data, { locale: 'en' });
    expect(container.textContent).toContain('No retained member evidence');
    expect(container.textContent).toContain('No retained task evidence');
    expect(container.textContent).toContain('Communication evidence unavailable');
    expect(container.querySelectorAll('.tw-row')).toHaveLength(0);
  });
  it('preserves the full long task title in the selected detail and tooltip without rewriting the snapshot', () => {
    const data = snapshot();
    data.tasks[0]!.title = '长任务标题、职责与验收要求。'.repeat(30);
    const before = JSON.stringify(data);
    mount(data); click('.tw-task');
    expect(container.querySelector('.tw-task')!.getAttribute('title')).toBe(data.tasks[0]!.title);
    expect(container.querySelector('.tw-detail h3')!.textContent).toBe(data.tasks[0]!.title);
    expect(JSON.stringify(data)).toBe(before);
  });
});
