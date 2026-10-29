import { act } from 'react';
import { readFile } from 'node:fs/promises';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { FoldingProject, FoldingTrial } from '../../core/agent-folding-types.js';
import { validateFoldingProject, validateFoldingRunPlan } from '../../core/agent-folding-validation.js';
import { AgentFoldingWorkbench } from './AgentFoldingWorkbench.js';

let host: HTMLDivElement, root: Root;
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); vi.stubGlobal('fetch', vi.fn()); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const button = (label: string): HTMLButtonElement => [...host.querySelectorAll('button')].find(item => item.textContent === label)!;
const settle = async (): Promise<void> => { for (let n = 0; n < 15; n++) await Promise.resolve(); };
function change(input: HTMLTextAreaElement | HTMLInputElement, value: string): void { Object.getOwnPropertyDescriptor(input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); }
async function importFile(file: File): Promise<void> { const input = host.querySelector('input[type=file]')!; Object.defineProperty(input, 'files', { configurable: true, value: [file] }); await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); await new Promise(resolve => setTimeout(resolve, 30)); }); }
function fixture(): FoldingProject {
  const source = 'official', ref = 'grade-ref';
  const cases = ['regressed', 'gained-a', 'gained-b'].map(id => ({ id, title: `Independent task ${id}`, turns: [`Customer input for ${id}`], customerId: id, tags: [], checks: [{ id: 'terminal', kind: 'external' as const, expected: 'Task is complete', required: true }], requiredChains: [['main', 'specialist-1']], split: 'train' as const, evidenceIds: [ref] }));
  const trials: FoldingTrial[] = cases.flatMap(item => [0, 1, 2].flatMap(repetition => ['baseline', 'candidate'].map(variantId => {
    const passed = variantId === 'baseline' ? item.id === 'regressed' : item.id !== 'regressed';
    const id = `${variantId}-${item.id}-${repetition}`;
    return { id, experimentId: 'one-boundary', variantId, caseId: item.id, repetition, sourceId: source, grade: passed ? 1 : 0, checks: [{ id: 'terminal', label: 'Task terminal fact', passed, evidenceId: ref }], answer: `Recorded answer ${id}`, latencyMs: null, inputTokens: 100, outputTokens: 20, modelCalls: 1, toolCalls: 1, model: 'recorded-model', byAgent: {}, actions: [{ name: 'update_account', args: { customer_id: item.customerId, requested: '<script>alert(1)</script>' }, evidenceId: ref }], events: [{ id: `${id}-event-1`, sequence: 1, role: 'handoff', agentId: 'main', targetAgentId: 'specialist-1', name: 'Delegate work', content: 'Original ordered event', startMs: null, durationMs: null, evidenceId: ref, complete: true }, { id: `${id}-event-2`, sequence: 2, role: 'verification', agentId: 'specialist-1', targetAgentId: null, name: 'Check terminal state', content: 'Original recorded verification', startMs: null, durationMs: null, evidenceId: ref, complete: true }], harnessError: null, evidenceIds: [ref] } as FoldingTrial;
  })));
  return { version: 1, kind: 'agent-folding-project', id: 'ui-evidence-test', title: 'Pinned recorded experiment', createdAt: '2026-10-29T00:00:00.000Z', sources: [{ id: source, kind: 'official_recording', title: 'Pinned source', url: 'https://example.com/pinned', revision: 'a'.repeat(40), observedAt: null, model: 'recorded-model', limitations: ['No timing or full bodies were recorded.'] }],
    agents: Array.from({ length: 7 }, (_, n) => ({ id: n ? `specialist-${n}` : 'main', name: n ? `Specialist ${n}` : 'Main loop', owner: null, isMain: n === 0, prompt: `Role instructions ${n}`, tools: ['read_account'], invokedBy: n ? ['main'] : [], returns: 'conclusion/evidence/actions_taken/confidence/caveats', talksToUser: n === 4, externalOwner: n === 5, contextNeed: n === 0 ? 'none' : 'unknown', proposed: n === 0 ? 'main' : n === 3 ? 'as_tool' : n >= 4 ? 'keep' : 'fold', rationale: { zh: '需要保留来源与验收。', en: 'Inspect source and independent acceptance.' }, evidenceIds: [ref] })),
    boundaries: [{ id: 'boundary-one', fromAgentId: 'main', targetAgentIds: ['specialist-1'], proposed: 'fold', title: { zh: '折叠第一分工', en: 'Fold first specialist' }, rationale: { zh: '测试共享上下文。', en: 'Test shared context.' }, requirements: ['Keep independent verification.'], evidenceIds: [ref] }], cases, traffic: [], experiments: [{ id: 'one-boundary', title: 'One boundary experiment', boundaryId: 'boundary-one', operation: 'fold', baselineVariantId: 'baseline', candidateVariantId: 'candidate', caseIds: cases.map(item => item.id), expectedRepetitions: 3, controls: { taskSet: 'verified', grader: 'verified', model: 'same_recorded', nonTarget: 'verified', intervention: 'verified', execution: 'verified', baselineRevision: 'v0', candidateRevision: 'v1', skillAblation: 'not_run', notes: [] }, trialIds: trials.map(item => item.id), evidenceIds: [ref] }], trials,
    evidence: [{ id: ref, sourceId: source, path: 'recordings/results.jsonl', pointer: '/row/4', sha256: null, kind: 'grade', excerpt: 'Recorded grade and check result', text: '<img src=x onerror=alert(1)>', complete: true, native: null }], humanDecisions: [], limitations: ['Reference records are historical, not current model claims.'] };
}

it('starts with the boundary workflow and performs no implicit reads or executions', () => {
  act(() => root.render(<AgentFoldingWorkbench locale="en"/>));
  expect(host.querySelector('h1')!.textContent).toBe('Agent boundary evaluation');
  expect(host.textContent).toContain('Load official recorded example');
  expect(host.textContent).toContain('six specialists');
  expect(fetch).not.toHaveBeenCalled();
});

it('blocks adoption on any regressed task even when aggregate performance improves and keeps audit separate', () => {
  const project = fixture(); expect(validateFoldingProject(project)).toEqual(project);
  act(() => root.render(<AgentFoldingWorkbench locale="en" initialProject={project}/>));
  const gate = host.querySelector('[aria-label="Adoption gate"]')!;
  expect(gate.textContent).toContain('Adoption blocked'); expect(gate.textContent).toContain('higher overall average');
  expect(host.textContent).toContain('Audit proposal'); expect(host.textContent).toContain('Experimental disposition');
  expect(host.textContent).toContain('Official recorded model run'); expect(host.querySelectorAll('.af-inventory tbody tr')).toHaveLength(7);
  expect(host.textContent).toContain('Missing'); expect(fetch).not.toHaveBeenCalled();
});

it('drills from a failed case to one repetition, checks, exact action arguments and an ordered trace with unknown clocks', () => {
  act(() => root.render(<AgentFoldingWorkbench locale="en" initialProject={fixture()}/>));
  act(() => button('regressed · rep 2 · Inspect failure').click());
  expect((host.querySelector('.af-inspection select') as HTMLSelectElement).value).toBe('2');
  const candidate = host.querySelector('[data-trial="candidate-regressed-2"]')!;
  expect(candidate.querySelector('[data-passed=false]')!.textContent).toContain('Task terminal fact');
  expect(candidate.textContent).toContain('update_account'); expect(candidate.textContent).toContain('customer_id');
  expect(candidate.textContent).toContain('Time not recorded'); expect(candidate.querySelectorAll('.af-event')).toHaveLength(2);
  expect(host.querySelector('script')).toBeNull();
  act(() => candidate.querySelector<HTMLButtonElement>('.af-event')!.click());
  expect(host.querySelector('[aria-label="Selected source evidence"]')!.textContent).toContain('/row/4');
  expect(host.querySelector('img')).toBeNull(); expect(fetch).not.toHaveBeenCalled();
});

it('retains human keep notes without overriding measured regressions', () => {
  act(() => root.render(<AgentFoldingWorkbench locale="en" initialProject={fixture()}/>));
  const select = host.querySelector<HTMLSelectElement>('.af-human select')!;
  act(() => { select.value = 'keep_change'; select.dispatchEvent(new Event('change', { bubbles: true })); change(host.querySelector<HTMLTextAreaElement>('.af-human textarea')!, 'Owner Alex will investigate the regression before release.'); });
  act(() => button('Record decision').click());
  expect(host.textContent).toContain('Owner Alex');
  expect(host.querySelector('[aria-label="Adoption gate"]')!.textContent).toContain('Adoption blocked');
  expect(host.textContent).toContain('keep_change'); expect(fetch).not.toHaveBeenCalled();
});

it('uses the real FileReader, downgrades imported provenance and rejects malformed or oversized projects', async () => {
  act(() => root.render(<AgentFoldingWorkbench locale="en"/>));
  await importFile(new File([JSON.stringify(fixture())], 'project.json'));
  expect(host.querySelector('[role=alert]')).toBeNull(); expect(host.querySelector('.af-provenance')!.textContent).toContain('User import');
  await importFile(new File(['{"version":200}'], 'invalid.json'));
  expect(host.querySelector('[role=alert]')!.textContent).toContain('Invalid project');
  const oversized = new File(['{}'], 'large.json'); Object.defineProperty(oversized, 'size', { value: 8 * 1024 * 1024 + 1 });
  const readSpy = vi.spyOn(FileReader.prototype, 'readAsText'); await importFile(oversized);
  expect(host.querySelector('[role=alert]')!.textContent).toContain('exceeds 8 MiB'); expect(readSpy).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
});

it('loads the official recorded project on demand with boolean-only status and no execution', async () => {
  vi.mocked(fetch).mockImplementation(async url => new Response(JSON.stringify(String(url).endsWith('/status') ? { anthropicConfigured: true, modelConfigured: true, model: 'explicit-model', paidExecution: 'cli_only' } : fixture()), { status: 200 }));
  act(() => root.render(<AgentFoldingWorkbench locale="en"/>));
  await act(async () => { button('Load official recorded example').click(); await settle(); });
  expect(fetch).toHaveBeenCalledTimes(2); expect(host.textContent).toContain('Pinned recorded experiment'); expect(host.textContent).toContain('Historical pinned example');
  expect(vi.mocked(fetch).mock.calls.every(([, options]) => !options?.method || options.method === 'GET')).toBe(true);
});

it('ignores cancelled late reads and aborts owned requests on unmount', async () => {
  const resolve: Array<(value: Response) => void> = [];
  vi.mocked(fetch).mockImplementation(() => new Promise(done => { resolve.push(done); }));
  act(() => root.render(<AgentFoldingWorkbench locale="en"/>));
  act(() => button('Load official recorded example').click());
  const signal = vi.mocked(fetch).mock.calls[0]![1]!.signal as AbortSignal;
  act(() => button('Cancel').click()); expect(signal.aborted).toBe(true);
  await act(async () => { resolve[0]!(new Response(JSON.stringify(fixture()))); resolve[1]!(new Response(JSON.stringify({ anthropicConfigured: false, modelConfigured: false, model: null, paidExecution: 'cli_only' }))); await settle(); });
  expect(host.querySelector('.af-verdict')).toBeNull();
  act(() => button('Run fixed offline smoke').click());
  const smokeSignal = vi.mocked(fetch).mock.calls.at(-1)![1]!.signal as AbortSignal;
  expect(vi.mocked(fetch).mock.calls.at(-1)![1]!.body).toBe('{}');
  act(() => root.render(<div/>)); expect(smokeSignal.aborted).toBe(true);
});

it('bounds cases and paired trace events while retaining full project data', () => {
  const project = fixture(), original = project.cases[0]!;
  project.cases.push(...Array.from({ length: 197 }, (_, n) => ({ ...original, id: `unrun-${n}`, title: `Unrun ${n}` })));
  project.experiments[0]!.caseIds = project.cases.map(item => item.id);
  for (const trial of project.trials) trial.events = Array.from({ length: 120 }, (_, n) => ({ ...trial.events[0]!, id: `${trial.id}-event-${n}`, sequence: n + 1 }));
  act(() => root.render(<AgentFoldingWorkbench locale="en" initialProject={project}/>));
  expect(host.querySelectorAll('.af-case-row')).toHaveLength(50); expect(host.querySelectorAll('.af-event')).toHaveLength(100);
  act(() => button('Next cases').click()); expect(host.querySelectorAll('.af-case-row')).toHaveLength(50);
  const traceNext = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === 'Next trace')!;
  act(() => traceNext.click()); expect(host.querySelectorAll('.af-event')).toHaveLength(100);
  expect(fetch).not.toHaveBeenCalled();
});

it('preserves the project through locale changes without IO', () => {
  act(() => root.render(<AgentFoldingWorkbench locale="en" initialProject={fixture()}/>));
  act(() => root.render(<AgentFoldingWorkbench locale="zh"/>));
  expect(host.textContent).toContain('阻止自动采纳'); expect(host.textContent).toContain('Pinned recorded experiment'); expect(fetch).not.toHaveBeenCalled();
});


it('renders the actual pinned 132-trial official catalog with seven roles and bounded original evidence', async () => {
  const project = validateFoldingProject(JSON.parse(await readFile('data/agent-folding/support-desk-project.json', 'utf8')));
  expect(project.trials).toHaveLength(132); expect(project.agents).toHaveLength(7);
  act(() => root.render(<AgentFoldingWorkbench locale="en" initialProject={project}/>));
  expect(host.textContent).toContain('published support-desk evidence');
  expect(host.querySelectorAll('.af-inventory tbody tr')).toHaveLength(7);
  expect(host.querySelectorAll('.af-case-row').length).toBeLessThanOrEqual(50);
  expect(host.querySelectorAll('.af-event').length).toBeLessThanOrEqual(100);
  expect(host.querySelector('.af-provenance')!.textContent).toContain('Official recorded model run');
  expect(host.textContent).toContain('Agent as tool'); expect(host.textContent).toContain('Keep boundary');
  expect(fetch).not.toHaveBeenCalled();
});

it('owns a ten-second metadata deadline and aborts both example reads without polling', async () => {
  vi.useFakeTimers();
  try {
    vi.mocked(fetch).mockImplementation(() => new Promise(() => {}));
    act(() => root.render(<AgentFoldingWorkbench locale="en"/>));
    act(() => button('Load official recorded example').click());
    const signal = vi.mocked(fetch).mock.calls[0]![1]!.signal as AbortSignal;
    await act(async () => { await vi.advanceTimersByTimeAsync(10001); });
    expect(signal.aborted).toBe(true); expect(host.querySelector('[role=alert]')!.textContent).toContain('timed out');
    expect(fetch).toHaveBeenCalledTimes(2);
  } finally { vi.useRealTimers(); }
});

it('builds an ungraded multi-turn own-system task and exports a concrete external plan without executing it', async () => {
  const project = fixture(); project.sources[0]!.kind = 'native_telemetry'; project.cases = []; project.experiments = []; project.trials = [];
  let exported: Blob | undefined;
  vi.stubGlobal('URL', class extends URL { static override createObjectURL(blob: Blob) { exported = blob; return 'blob:external-plan'; } static override revokeObjectURL = vi.fn(); });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  act(() => root.render(<AgentFoldingWorkbench locale="en" initialProject={project}/>));
  act(() => { change(host.querySelector<HTMLInputElement>('[aria-label="New task ID"]')!, 'own-customer-request'); change(host.querySelector<HTMLTextAreaElement>('[aria-label="New task turn 0"]')!, 'Please update my account.'); change(host.querySelector<HTMLTextAreaElement>('[aria-label="New task success criteria"]')!, 'Independent evaluator confirms only the requested field changed.'); button('Add user turn').click(); });
  act(() => change(host.querySelector<HTMLTextAreaElement>('[aria-label="New task turn 1"]')!, 'Keep the existing delivery address.'));
  act(() => button('Add ungraded task').click());
  expect(host.textContent).toContain('own-customer-request'); expect(host.textContent).toContain('with no grade');
  expect(host.querySelectorAll('.af-trial')).toHaveLength(2); expect(host.textContent).toContain('no outcome is invented');
  act(() => {
    change(host.querySelector<HTMLInputElement>('.af-plan .af-toolbar input')!, 'own-model');
    change(host.querySelector<HTMLInputElement>('[aria-label="External repository"]')!, '/tmp/own-agent-task');
    change(host.querySelector<HTMLInputElement>('[aria-label="External baseline"]')!, '["/usr/bin/own-agent","--baseline"]');
    change(host.querySelector<HTMLInputElement>('[aria-label="External candidate"]')!, '["/usr/bin/own-agent","--fold-one"]');
    change(host.querySelector<HTMLInputElement>('[aria-label="External evaluator"]')!, '["/usr/bin/independent-evaluator"]');
  });
  act(() => button('Validate and export trial plan').click());
  expect(exported).toBeDefined();
  let raw = '';
  await act(async () => { raw = await new Promise<string>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(exported!); }); });
  const plan = validateFoldingRunPlan(JSON.parse(raw));
  expect(plan.adapter).toBe('external'); expect(plan.caseIds).toEqual(['own-customer-request']);
  expect(plan.external!.cases[0]!.turns).toHaveLength(2); expect(plan.external!.cases[0]!.checks).toHaveLength(1);
  expect(fetch).not.toHaveBeenCalled();
});

it('records owner boundary proposals independently of measured regressions', () => {
  act(() => root.render(<AgentFoldingWorkbench locale="en" initialProject={fixture()}/>));
  const proposal = host.querySelector<HTMLSelectElement>('[aria-label="Owner boundary proposal"]')!;
  act(() => { proposal.value = 'keep'; proposal.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(host.textContent).toContain('Owner proposal recorded');
  expect(host.querySelector('[aria-label="Adoption gate"]')!.textContent).toContain('Adoption blocked');
  expect(host.querySelector('.af-provenance')!.textContent).toContain('User import');
  expect(button('Validate and export trial plan').disabled).toBe(true);
  expect(fetch).not.toHaveBeenCalled();
});

it('hides native candidates and excerpts when source invalidation arrives without refetching', () => {
  const project = fixture(); project.sources[0]!.kind = 'native_telemetry';
  act(() => root.render(<AgentFoldingWorkbench locale="en" initialProject={project} diagnosisInvalidateKey={1}/>));
  expect(host.querySelector('.af-inventory')).not.toBeNull();
  act(() => root.render(<AgentFoldingWorkbench locale="en" diagnosisInvalidateKey={2}/>));
  expect(host.textContent).toContain('Previous candidates and excerpts are hidden');
  expect(host.querySelector('.af-inventory')).toBeNull(); expect(button('Export project').disabled).toBe(true);
  expect(fetch).not.toHaveBeenCalled();
});

it('includes the official independent confirmation cases by default in the exported concrete plan', async () => {
  const project = validateFoldingProject(JSON.parse(await readFile('data/agent-folding/support-desk-project.json', 'utf8')));
  let exported: Blob | undefined;
  vi.stubGlobal('URL', class extends URL { static override createObjectURL(blob: Blob) { exported = blob; return 'blob:confirmation-plan'; } static override revokeObjectURL = vi.fn(); });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  act(() => root.render(<AgentFoldingWorkbench locale="en" initialProject={project}/>));
  act(() => change(host.querySelector<HTMLInputElement>('.af-plan .af-toolbar input')!, 'explicit-current-model'));
  act(() => button('Validate and export trial plan').click());
  let raw = '';
  await act(async () => { raw = await new Promise<string>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(exported!); }); });
  const plan = validateFoldingRunPlan(JSON.parse(raw));
  expect(plan.adapter).toBe('support-desk'); expect(plan.caseIds).toHaveLength(project.cases.length);
  expect(project.cases.filter(item => item.split === 'confirmation').every(item => plan.caseIds.includes(item.id))).toBe(true);
  expect(host.textContent).toContain('excluded from training feedback'); expect(fetch).not.toHaveBeenCalled();
});

it('exports returns skill-off as a third controlled variant while leaving account thin-fold without it', async () => {
  const project = validateFoldingProject(JSON.parse(await readFile('data/agent-folding/support-desk-project.json', 'utf8')));
  let exported: Blob | undefined;
  vi.stubGlobal('URL', class extends URL { static override createObjectURL(blob: Blob) { exported = blob; return 'blob:ablation-plan'; } static override revokeObjectURL = vi.fn(); });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  act(() => root.render(<AgentFoldingWorkbench locale="en" initialProject={project}/>));
  const boundary = host.querySelector<HTMLSelectElement>('.af-boundary-picker select')!;
  act(() => { boundary.value = 'returns'; boundary.dispatchEvent(new Event('change', { bubbles: true })); });
  act(() => change(host.querySelector<HTMLInputElement>('.af-plan .af-toolbar input')!, 'explicit-current-model'));
  act(() => button('Validate and export trial plan').click());
  let raw = '';
  await act(async () => { raw = await new Promise<string>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(exported!); }); });
  expect(validateFoldingRunPlan(JSON.parse(raw)).skillAblation).toBe(true);
  expect(host.textContent).toContain('Add returns skill-off control');
  act(() => { boundary.value = 'account'; boundary.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(host.textContent).not.toContain('Add returns skill-off control');
  expect(fetch).not.toHaveBeenCalled();
});

it('inspects the actual skill-off third trial separately and never turns its failures into main-fold regressions', () => {
  const project = fixture(), experiment = project.experiments[0]!;
  for (const trial of project.trials) { trial.grade = 1; trial.checks[0]!.passed = true; }
  experiment.ablationVariantId = 'skill-off';
  const controls = project.trials.filter(trial => trial.variantId === 'candidate').map(trial => ({ ...structuredClone(trial), id: `off-${trial.id}`, variantId: 'skill-off', grade: 0 as const, checks: trial.checks.map(check => ({ ...check, passed: false })), events: trial.events.map(event => ({ ...event, id: `off-${event.id}` })) }));
  project.trials.push(...controls); experiment.trialIds.push(...controls.map(trial => trial.id));
  act(() => root.render(<AgentFoldingWorkbench locale="en" initialProject={project}/>));
  expect(host.querySelector('[aria-label="Adoption gate"]')!.textContent).not.toContain('Adoption blocked');
  expect(host.querySelectorAll('[data-trial]')).toHaveLength(3);
  expect(host.querySelector('.af-trial-ablation')!.textContent).toContain('Skill-off ablation');
  expect(host.querySelector('.af-ablation-summary')!.textContent).toContain('separate from main-fold regressions');
  expect(host.querySelector('.af-ablation-summary')!.textContent).toContain('Ablation regressions');
  expect(fetch).not.toHaveBeenCalled();
});


it('keeps action-argument comparison unknown when one paired trial is missing', () => {
  const project = fixture();
  project.trials = project.trials.filter(trial => trial.id !== 'candidate-regressed-0');
  project.experiments[0]!.trialIds = project.experiments[0]!.trialIds.filter(id => id !== 'candidate-regressed-0');
  act(() => root.render(<AgentFoldingWorkbench locale="en" initialProject={project}/>));
  const route = host.querySelector('.af-paired-routes')!;
  expect(route.textContent).toContain('Insufficient action-argument evidence');
  expect(route.textContent).not.toContain('No observed action-argument difference');
  expect(fetch).not.toHaveBeenCalled();
});
