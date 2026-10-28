import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createTeamExperimentDemo } from '../../core/team-experiment-demo.js';
import { validateTeamExperimentReport } from '../../core/team-experiment-validation.js';
import { TeamExperimentReplay } from './TeamExperimentReplay.js';

let host: HTMLDivElement, root: Root;
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); vi.stubGlobal('fetch', vi.fn()); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const button = (label: string): HTMLButtonElement => [...host.querySelectorAll('button')].find(b => b.textContent === label)!;
const change = (input: HTMLInputElement | HTMLSelectElement, value: string): void => {
  const prototype = input instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLSelectElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
};

it('selects an exact same-row block and reveals full public content without IO', () => {
  const report = createTeamExperimentDemo('team_quality');
  const expected = report.trials.find(t => t.variantId === 'team' && t.repetition === 1)!.evidence!.events.find(e => e.id === 'peer-question')!;
  act(() => root.render(<TeamExperimentReplay report={report} locale="zh"/>));
  const blocks = [...host.querySelectorAll<HTMLButtonElement>('.team-exp-block')];
  const selected = blocks.find(b => b.title.includes(expected.name))!;
  act(() => selected.click());
  const inspector = host.querySelector('aside')!;
  expect(inspector.textContent).toContain(expected.id);
  expect(inspector.querySelector('pre')!.textContent).toBe(expected.detail);
  expect(selected.getAttribute('aria-pressed')).toBe('true');
  expect([...host.querySelectorAll('.team-exp-block')].every(b => b.parentElement?.className === 'team-exp-track')).toBe(true);
  expect(inspector.textContent).toContain('没有原始会话定位');
  expect(fetch).not.toHaveBeenCalled();
});

it('seeks and steps through recorded content with one shared clock', () => {
  act(() => root.render(<TeamExperimentReplay report={createTeamExperimentDemo('subagents_win')} locale="en"/>));
  const slider = host.querySelector<HTMLInputElement>('input[aria-label="Replay time"]')!;
  act(() => change(slider, '0'));
  expect(host.querySelectorAll('.team-exp-record')).toHaveLength(3);
  expect(host.querySelector('.team-exp-records')!.textContent).not.toContain('制定实现与验证计划');
  act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Next event"]')!.click());
  expect(Number(slider.value)).toBeGreaterThan(0);
  expect(host.querySelector('.team-exp-records')!.textContent).toContain('制定实现与验证计划');
  expect(fetch).not.toHaveBeenCalled();
});

it('plays, pauses and clears its owned timer on unmount', () => {
  vi.useFakeTimers();
  act(() => root.render(<TeamExperimentReplay report={createTeamExperimentDemo('single_wins')} locale="en"/>));
  const slider = host.querySelector<HTMLInputElement>('input[aria-label="Replay time"]')!;
  act(() => button('Play').click());
  expect(Number(slider.value)).toBe(0);
  act(() => vi.advanceTimersByTime(500));
  expect(Number(slider.value)).toBeGreaterThanOrEqual(400);
  act(() => button('Pause').click());
  const paused = slider.value;
  act(() => vi.advanceTimersByTime(500));
  expect(slider.value).toBe(paused);
  act(() => button('Play').click());
  expect(vi.getTimerCount()).toBe(1);
  act(() => root.render(<div/>));
  expect(vi.getTimerCount()).toBe(0);
});

it('filters by member, kind and repetition while preserving scope and no network', () => {
  act(() => root.render(<TeamExperimentReplay report={createTeamExperimentDemo('team_quality')} locale="en"/>));
  const member = host.querySelector<HTMLSelectElement>('.team-exp-record-filters select')!;
  act(() => change(member, 'team/verify'));
  expect(host.querySelectorAll('.team-exp-lane')).toHaveLength(1);
  const type = host.querySelectorAll<HTMLSelectElement>('.team-exp-record-filters select')[1]!;
  act(() => change(type, 'message'));
  expect(host.querySelectorAll('.team-exp-record')).toHaveLength(1);
  expect(host.querySelector('.team-exp-records')!.textContent).toContain('向接口成员质疑并发假设');
  act(() => change(host.querySelector<HTMLSelectElement>('select[aria-label="Repetition"]')!, '2'));
  expect(host.querySelector('.team-exp-lane-heading small')!.textContent).toContain('single');
  expect(fetch).not.toHaveBeenCalled();
});

it('bounds record and chart DOM to the same explicit 100-event page', () => {
  const report = createTeamExperimentDemo('single_wins');
  const trial = report.trials[0]!;
  const sample = trial.evidence!.events[0]!;
  trial.evidence!.events = Array.from({ length: 250 }, (_, i) => ({ ...sample, id: `event-${i}`, name: `record-${i}`, startMs: i, durationMs: 1, dependsOn: [] }));
  act(() => root.render(<TeamExperimentReplay report={report} locale="en"/>));
  act(() => change(host.querySelector<HTMLSelectElement>('select[aria-label="Filter variant"]')!, 'single'));
  expect(host.querySelectorAll('.team-exp-record')).toHaveLength(100);
  expect(host.querySelectorAll('.team-exp-block')).toHaveLength(100);
  act(() => button('Next').click());
  expect(host.querySelector('.team-exp-records')!.textContent).toContain('record-100');
  expect(host.querySelector('.team-exp-records')!.textContent).not.toContain('record-0');
});

it('locates a dependency exactly across member and type filters', () => {
  act(() => root.render(<TeamExperimentReplay report={createTeamExperimentDemo('team_quality')} locale="en"/>));
  const filters = host.querySelectorAll<HTMLSelectElement>('.team-exp-record-filters select');
  act(() => change(filters[0]!, 'team/verify'));
  act(() => change(filters[1]!, 'message'));
  act(() => host.querySelector<HTMLButtonElement>('.team-exp-record-select')!.click());
  expect(host.querySelector('aside')!.textContent).toContain('peer-question');
  act(() => button('verify-work').click());
  expect(host.querySelector('aside h4')!.textContent).toBe('检视权限与并发边界');
  expect(filters[0]!.value).toBe('all'); expect(filters[1]!.value).toBe('all');
  expect(host.querySelector<HTMLButtonElement>('.team-exp-record[data-selected=true] button')!.textContent).toContain('检视权限与并发边界');
  expect(fetch).not.toHaveBeenCalled();
});

it('collapses long rosters by default and can explicitly expand members', () => {
  const report = createTeamExperimentDemo('team_quality');
  const trial = report.trials.find(t => t.variantId === 'team' && t.repetition === 1)!;
  trial.evidence!.agents.push(...Array.from({ length: 20 }, (_, i) => ({ id: `worker-${i}`, name: `Worker ${i}`, parentId: 'lead', sessionKey: null })));
  act(() => root.render(<TeamExperimentReplay report={report} locale="en"/>));
  const laneGroup = [...host.querySelectorAll('.team-exp-variant-lanes')].find(group => group.textContent?.includes('Expand members'))!;
  expect(laneGroup.querySelectorAll('.team-exp-lane')).toHaveLength(4);
  act(() => laneGroup.querySelector<HTMLButtonElement>('button')!.click());
  expect(laneGroup.querySelectorAll('.team-exp-lane')).toHaveLength(21);
  expect(laneGroup.textContent).toContain('Collapse members');
  expect(laneGroup.textContent).toContain('21/23 shown');
});

it('steps only through events matching the current member and type', () => {
  const report = createTeamExperimentDemo('team_quality');
  act(() => root.render(<TeamExperimentReplay report={report} locale="en"/>));
  const filters = host.querySelectorAll<HTMLSelectElement>('.team-exp-record-filters select');
  act(() => change(filters[0]!, 'team/verify'));
  act(() => change(filters[1]!, 'message'));
  act(() => change(host.querySelector<HTMLInputElement>('input[aria-label="Replay time"]')!, '0'));
  act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Next event"]')!.click());
  const expected = report.trials.find(t => t.variantId === 'team' && t.repetition === 1)!.evidence!.events.find(e => e.id === 'peer-question')!.startMs;
  expect(Number(host.querySelector<HTMLInputElement>('input[aria-label="Replay time"]')!.value)).toBe(expected);
  expect(host.querySelectorAll('.team-exp-record')).toHaveLength(1);
});

it('keeps all expanded rosters within a global 64-row chart budget', () => {
  const report = createTeamExperimentDemo('team_quality');
  for (const trial of report.trials.filter(t => t.repetition === 1)) {
    trial.evidence!.agents = Array.from({ length: 64 }, (_, i) => ({ id: `agent-${i}`, name: `Agent ${i}`, parentId: i ? 'agent-0' : null, sessionKey: null }));
  }
  act(() => root.render(<TeamExperimentReplay report={report} locale="en"/>));
  const expand = [...host.querySelectorAll<HTMLButtonElement>('.team-exp-lane-heading button')];
  act(() => expand.forEach(b => b.click()));
  expect(host.querySelectorAll('.team-exp-lane')).toHaveLength(63);
  expect([...host.querySelectorAll('.team-exp-lane-heading')].every(h => h.textContent?.includes('21/64 shown'))).toBe(true);
});

it('pages large dependency sets and locates a later exact dependency', () => {
  const report = createTeamExperimentDemo('single_wins');
  const trial = report.trials[0]!, sample = trial.evidence!.events[0]!;
  trial.evidence!.events = Array.from({ length: 45 }, (_, i) => ({ ...sample, id: `dependency-${i}`, name: `Dependency ${i}`, dependsOn: [] }));
  trial.evidence!.events.push({ ...sample, id: 'dependent', name: 'Dependent record', dependsOn: trial.evidence!.events.map(e => e.id) });
  act(() => root.render(<TeamExperimentReplay report={report} locale="en"/>));
  act(() => [...host.querySelectorAll<HTMLButtonElement>('.team-exp-record-select')].find(b => b.textContent?.includes('Dependent record'))!.click());
  expect(host.querySelector('aside')!.querySelectorAll('dd button')).toHaveLength(22);
  expect(host.querySelector('aside')!.textContent).not.toContain('dependency-20');
  act(() => button('Next dependencies').click());
  expect(host.querySelector('aside')!.textContent).toContain('dependency-20');
  act(() => button('dependency-20').click());
  expect(host.querySelector('aside h4')!.textContent).toBe('Dependency 20');
});

it('retains per-trial host, coverage, capture and execution errors for a validated partial report', () => {
  const partial = createTeamExperimentDemo('incomplete'); partial.synthetic = false;
  const failed = partial.trials.find(t => t.id === 'subagents-2')!;
  failed.run.status = 'failed'; failed.run.error = 'Driver stopped after workspace update'; failed.run.host = 'partial-capture-host';
  failed.evidence!.coverage.roster = false; failed.evidence!.coverage.activities = false;
  failed.evidenceError = 'Missing message segment <unsafe-marker>';
  const report = validateTeamExperimentReport(partial);
  act(() => root.render(<TeamExperimentReplay report={report} locale="en"/>));
  expect(host.querySelector('.team-exp-diagnostics')!.textContent).not.toContain('Driver stopped after workspace update');
  act(() => change(host.querySelector<HTMLSelectElement>('select[aria-label="Repetition"]')!, '2'));
  const diagnostics = host.querySelector('.team-exp-diagnostics')!;
  const row = [...diagnostics.querySelectorAll('tbody tr')].find(tr => tr.textContent?.includes('subagents-2'))!;
  expect(row.textContent).toContain('partial-capture-host');
  expect([...row.querySelectorAll('td')].filter(td => td.textContent === 'Completeness unconfirmed')).toHaveLength(4);
  const detail = [...diagnostics.querySelectorAll('.team-exp-trial-evidence')].find(el => el.querySelector('summary')!.textContent?.includes('subagents-2'))!;
  expect(detail.textContent).toContain('Driver stopped after workspace update');
  expect(detail.textContent).toContain('Missing message segment <unsafe-marker>');
  expect(detail.querySelector('unsafe-marker')).toBeNull();
  expect(detail.textContent).toContain('Named independent acceptance is missing');
  expect(detail.textContent).toContain('Collaboration coverage is incomplete');
  expect(fetch).not.toHaveBeenCalled();
});
