import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createTeamExperimentDemo } from '../../core/team-experiment-demo.js';
import { validateTeamExperimentPlan, validateTeamExperimentReport } from '../../core/team-experiment-validation.js';
import { TeamExperimentCenter } from './TeamExperimentCenter.js';

let host: HTMLDivElement, root: Root;
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); vi.stubGlobal('fetch', vi.fn()); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const button = (label: string): HTMLButtonElement => [...host.querySelectorAll('button')].find(b => b.textContent === label)!;
const read = (blob: Blob): Promise<string> => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => reject(r.error); r.readAsText(blob); });
async function importFile(file: File): Promise<void> {
  const input = host.querySelector('input[type=file]')!;
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); await new Promise(resolve => setTimeout(resolve, 50)); });
}
function change(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype = input instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

it('opens structured configuration without executing a model or fetching', () => {
  act(() => root.render(<TeamExperimentCenter locale="en"/>));
  expect(host.textContent).toContain('Start with a synthetic scenario');
  expect(host.querySelectorAll('textarea')).toHaveLength(4);
  expect(host.textContent).toContain('Independent evaluator argv');
  expect(host.textContent).toContain('does not execute the custom task above');
  expect(fetch).not.toHaveBeenCalled();
});

it('loads all four scenarios, shows synthetic recommendation and retains locale without IO', () => {
  act(() => root.render(<TeamExperimentCenter locale="en"/>));
  for (const scenario of ['Single loop fits better', 'Subagent parallel gains', 'Team acceptance gains', 'Insufficient evidence']) {
    act(() => button(scenario).click());
    expect(host.textContent).toContain('SYNTHETIC');
    expect(host.querySelector('[aria-label="Mode recommendation"]')).not.toBeNull();
    expect(host.textContent).toContain('Corrected tokens');
    expect(host.textContent).toContain('Per-case comparison');
  }
  act(() => root.render(<TeamExperimentCenter locale="zh"/>));
  expect(host.textContent).toContain('模拟结果'); expect(fetch).not.toHaveBeenCalled();
});

it('imports a local report with the actual FileReader and rejects malformed input', async () => {
  act(() => root.render(<TeamExperimentCenter locale="en"/>));
  const report = createTeamExperimentDemo('subagents_win'); report.plan.name = 'Imported task comparison';
  await importFile(new File([JSON.stringify(report)], 'trial.json', { type: 'application/json' }));
  expect(host.textContent).toContain('Imported task comparison');
  expect(host.querySelector('[role=alert]')).toBeNull();
  await importFile(new File(['{"version":8}'], 'bad.json'));
  expect(host.querySelector('[role=alert]')!.textContent).toContain('Invalid report');
  expect(fetch).not.toHaveBeenCalled();
});

it('exports every report field and reimports the same Blob through FileReader', async () => {
  let emitted: Blob | undefined, filename = '';
  vi.stubGlobal('URL', class extends URL { static override createObjectURL(blob: Blob) { emitted = blob; return 'blob:team-report'; } static override revokeObjectURL = vi.fn(); });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { filename = this.download; });
  act(() => root.render(<TeamExperimentCenter locale="en"/>));
  act(() => button('Team acceptance gains').click());
  act(() => button('Export report').click());
  expect(filename).toBe('team-experiment-report.json');
  let raw: unknown;
  await act(async () => { raw = JSON.parse(await read(emitted!)) as unknown; });
  expect(validateTeamExperimentReport(raw)).toEqual(createTeamExperimentDemo('team_quality'));
  act(() => root.render(<TeamExperimentCenter key="reimport" locale="en"/>));
  await importFile(new File([emitted!], filename));
  expect(host.textContent).toContain('模拟 · team_quality');
  expect(host.querySelectorAll('.team-exp-variant-lanes')).toHaveLength(3);
  expect(fetch).not.toHaveBeenCalled();
});

it('exports an editable executable plan retaining distinct prompts and argv', async () => {
  let emitted: Blob | undefined;
  vi.stubGlobal('URL', class extends URL { static override createObjectURL(blob: Blob) { emitted = blob; return 'blob:team-plan'; } static override revokeObjectURL = vi.fn(); });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  act(() => root.render(<TeamExperimentCenter locale="en"/>));
  const prompts = [...host.querySelectorAll('textarea')];
  act(() => { change(prompts[1]!, 'Keep all work in one context.'); change(prompts[2]!, 'Delegate independent evidence checks.'); });
  act(() => button('Validate and export real plan').click());
  let content = '';
  await act(async () => { content = await read(emitted!); });
  const plan = validateTeamExperimentPlan(JSON.parse(content));
  expect(plan.variants.map(v => v.prompt)).toEqual(['Keep all work in one context.', 'Delegate independent evidence checks.']);
  expect(plan.schedule).toBe('parallel'); expect(plan.task.caseIds).toHaveLength(3);
  expect(plan.variants.every(v => Array.isArray(v.driver))).toBe(true);
  expect(host.textContent).toContain('Plan validated and exported'); expect(fetch).not.toHaveBeenCalled();
});

it('runs only the fixed fixture on explicit action with the bounded non-executable DTO', async () => {
  const report = createTeamExperimentDemo('single_wins');
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(report), { status: 200 }));
  act(() => root.render(<TeamExperimentCenter locale="en"/>));
  await act(async () => { button('Run built-in paired fixture (6 trials)').click(); await new Promise(resolve => setTimeout(resolve, 0)); });
  expect(fetch).toHaveBeenCalledTimes(1);
  const [url, options] = vi.mocked(fetch).mock.calls[0]!;
  expect(url).toBe('/api/team-experiments/demo');
  const input = JSON.parse(options!.body as string) as Record<string, unknown>;
  expect(Object.keys(input).sort()).toEqual(['name', 'repetitions', 'schedule', 'variants']);
  expect(JSON.stringify(input)).not.toContain('driver'); expect(JSON.stringify(input)).not.toContain('repository');
  expect(host.textContent).toContain('no real model was called');
  expect(host.textContent).toContain('SYNTHETIC');
});

it('ignores late cancelled fixture results after the user chooses another scenario', async () => {
  let resolveRequest!: (value: Response) => void;
  vi.mocked(fetch).mockImplementation(() => new Promise(resolve => { resolveRequest = resolve; }));
  act(() => root.render(<TeamExperimentCenter locale="en"/>));
  act(() => button('Run built-in paired fixture (6 trials)').click());
  const signal = vi.mocked(fetch).mock.calls[0]![1]!.signal as AbortSignal;
  act(() => button('Subagent parallel gains').click());
  expect(signal.aborted).toBe(true);
  await act(async () => { resolveRequest(new Response(JSON.stringify(createTeamExperimentDemo('single_wins')), { status: 200 })); await new Promise(resolve => setTimeout(resolve, 0)); });
  expect(host.textContent).toContain('模拟 · subagents_win');
  expect(host.textContent).not.toContain('模拟 · single_wins');
});

it('aborts an owned fixture when the view unmounts', () => {
  vi.mocked(fetch).mockImplementation(() => new Promise(() => {}));
  act(() => root.render(<TeamExperimentCenter locale="en"/>));
  act(() => button('Run built-in paired fixture (6 trials)').click());
  const signal = vi.mocked(fetch).mock.calls[0]![1]!.signal as AbortSignal;
  act(() => root.render(<div/>));
  expect(signal.aborted).toBe(true);
});

it('links an illustrative recommendation to the exact retained collaboration event', () => {
  act(() => root.render(<TeamExperimentCenter locale="en"/>));
  act(() => button('Subagent parallel gains').click());
  const locate = button('Locate recommendation evidence');
  expect(locate).toBeDefined();
  act(() => locate.click());
  expect(host.querySelector('aside')!.textContent).toContain('lead-wait');
  expect(host.querySelector('aside h4')!.textContent).toBe('等待成员结果');
  expect(host.querySelector('.team-exp-record[data-selected=true]')).not.toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});

it('rejects over-limit files before any read or execution', async () => {
  act(() => root.render(<TeamExperimentCenter locale="en"/>));
  const file = new File(['{}'], 'large.json'); Object.defineProperty(file, 'size', { value: 16 * 1024 * 1024 + 1 });
  const readSpy = vi.spyOn(FileReader.prototype, 'readAsText');
  await importFile(file);
  expect(host.querySelector('[role=alert]')!.textContent).toContain('exceeds 16 MiB');
  expect(readSpy).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
});

it('mounts at most one selected trial and 100 acceptance rows for a 30-trial by 1000-case report', async () => {
  const report = createTeamExperimentDemo('single_wins');
  const seeds = report.trials.filter(t => t.repetition === 1);
  report.plan.repetitions = 10;
  report.plan.task.caseIds = Array.from({ length: 1000 }, (_, i) => `case-${i}`);
  report.plan.task.expectedTests = 1000;
  report.trials = Array.from({ length: 10 }, (_, index) => seeds.map(seed => {
    const trial = structuredClone(seed), repetition = index + 1, id = `${trial.variantId}-${repetition}`;
    trial.id = id; trial.repetition = repetition;
    trial.run.id = id; trial.run.repetition = repetition;
    trial.run.verdict!.passed = 1000; trial.run.verdict!.total = 1000;
    trial.cases = report.plan.task.caseIds.map(caseId => ({ id: caseId, status: 'passed' as const, detail: `Independent result for ${caseId}` }));
    return trial;
  })).flat();
  expect(validateTeamExperimentReport(report).trials).toHaveLength(30);
  act(() => root.render(<TeamExperimentCenter locale="en"/>));
  await importFile(new File([JSON.stringify(report)], 'large-valid-report.json'));
  expect(host.querySelector('[role=alert]')).toBeNull();
  expect(host.querySelectorAll('.team-exp-case-detail')).toHaveLength(0);
  const details = host.querySelector<HTMLDetailsElement>('.team-exp-trial-records')!;
  await act(async () => { details.querySelector('summary')!.click(); await new Promise(resolve => setTimeout(resolve, 5)); });
  expect(host.querySelectorAll('.team-exp-selected-trial')).toHaveLength(1);
  expect(host.querySelectorAll('.team-exp-case-detail')).toHaveLength(100);
  const selector = details.querySelector('select')!;
  act(() => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(selector, 'team-10'); selector.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(host.querySelector('.team-exp-selected-trial h3')!.textContent).toBe('team-10');
  expect(host.querySelectorAll('.team-exp-case-detail')).toHaveLength(100);
  act(() => button('Next acceptance details').click());
  expect(host.querySelector('.team-exp-case-detail')!.textContent).toContain('case-100');
  expect(host.querySelectorAll('.team-exp-case-detail')).toHaveLength(100);
  await act(async () => { details.querySelector('summary')!.click(); await new Promise(resolve => setTimeout(resolve, 5)); });
  expect(host.querySelectorAll('.team-exp-case-detail')).toHaveLength(0);
  expect(host.querySelectorAll('.team-exp-selected-trial')).toHaveLength(0);
  expect(fetch).not.toHaveBeenCalled();
});
