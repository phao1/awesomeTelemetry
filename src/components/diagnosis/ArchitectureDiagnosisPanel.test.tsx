import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ArchitectureDiagnosisPanel, RealTaskDiagnosisEntry } from './ArchitectureDiagnosisPanel.js';
import type { ArchitectureDiagnosisReport } from '../../core/architecture-diagnosis-types.js';
import { DEFAULT_ARCHITECTURE_THRESHOLDS } from '../../core/architecture-diagnosis-analysis.js';
import { ApiError } from '../../api/client.js';

let host: HTMLDivElement, root: Root;
const taskId = 'collected:session-main';
const words = (en: string) => ({ en, zh: `中文 ${en}` });
const report = (): ArchitectureDiagnosisReport => ({ version: 1, taskId, member: 'all', title: 'Actual source task', origin: 'collected', revision: 'native-v1', analyzedAt: '2026-10-29T00:00:00.000Z', thresholds: { ...DEFAULT_ARCHITECTURE_THRESHOLDS },
  coverage: { context: 'partial', tools: 'complete', handoffs: 'unavailable', nativeEvents: 17, nativeEventTotal: 200, captures: 2, logicalCalls: 3, omitted: 9, reasons: ['bounded_native_records'] }, categories: { context_bloat: 'findings', tool_conflict: 'not_observed', handoff_loss: 'insufficient' },
  findings: [{ id: 'growth', category: 'context_bloat', rule: 'growth', severity: 'warning', confidence: 'heuristic', title: words('Context grew'), explanation: words('Observed input growth is not a quality verdict.'), evidenceIds: ['native', 'capture', 'call'], metrics: [{ key: 'growth', label: words('Growth ratio'), value: 2.5, unit: 'x' }, { key: 'missing', label: words('Unknown'), value: null, unit: '' }], recommendation: { action: 'split_candidate', reason: words('Try an independent branch.'), conditions: words('Only if the branch is independent.'), verification: words('Rerun fixed acceptance checks.') } }],
  evidence: [{ id: 'native', source: 'native_event', taskId, sessionKey: 'session-main', eventId: 'event:exact', captureId: null, callSequence: null, path: '$.events[17].input', excerpt: '<script>unsafe()</script>' }, { id: 'capture', source: 'http_capture', taskId, sessionKey: null, eventId: null, captureId: 7, callSequence: null, path: '$.request.messages', excerpt: 'Retained capture input' }, { id: 'call', source: 'codex_call', taskId, sessionKey: null, eventId: null, captureId: 8, callSequence: 3, path: '$.calls[3].input', excerpt: 'Actual logical-call input' }], limitations: [words('The native sample is bounded.')] });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const button = (name: string) => { const value = [...host.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === name); if (!value) throw new Error('Missing button: ' + name); return value; };
async function settle() { await act(async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); }); }
function mount(props: Partial<Parameters<typeof ArchitectureDiagnosisPanel>[0]> = {}) { act(() => root.render(<ArchitectureDiagnosisPanel taskId={taskId} member="all" locale="en" {...props}/>)); }
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(report()))); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

it('reads only on explicit analysis and shows partial coverage, measured values and exact inert evidence', async () => {
  const locate = vi.fn(); mount({ onLocate: locate });
  expect(fetch).not.toHaveBeenCalled();
  act(() => button('Analyze split and merge').click()); await settle();
  expect(fetch).toHaveBeenCalledTimes(1);
  const [path, init] = vi.mocked(fetch).mock.calls[0]!;
  expect(String(path)).toContain('/api/tasks/collected%3Asession-main/architecture-diagnosis?');
  expect(new URL(String(path), 'http://localhost').searchParams.get('member')).toBe('all'); expect(init!.method).toBeUndefined();
  expect(host.textContent).toContain('Insufficient evidence'); expect(host.textContent).toContain('Partial'); expect(host.textContent).toContain('17 / 200');
  expect(host.textContent).toContain('Heuristic'); expect(host.textContent).toContain('2.5 x'); expect(host.textContent).toContain('—');
  expect(host.textContent).toContain('Only if the branch is independent.'); expect(host.textContent).toContain('Rerun fixed acceptance checks.');
  expect(host.querySelector<HTMLDetailsElement>('.architecture-finding-disclosure')!.open).toBe(false);
  expect(host.querySelector('script')).toBeNull(); expect(host.textContent).toContain('<script>unsafe()</script>');
  expect([...host.querySelectorAll('a')].map(a => a.getAttribute('href'))).toContain('#/task?origin=collected&task=collected%3Asession-main&member=all&event=session-main%3Aevent%3Aevent%3Aexact');
  expect([...host.querySelectorAll('a')].map(a => a.getAttribute('href'))).toContain('/api/proxy/requests/8/codex-calls/3');
  act(() => button('Locate this record').click()); expect(locate).toHaveBeenCalledWith(report().evidence[0]); expect(fetch).toHaveBeenCalledTimes(1);
  act(() => button('Collapse analysis results').click()); expect(host.querySelector('.architecture-report')).toBeNull();
  act(() => button('Expand analysis results').click()); expect(host.querySelector('.architecture-report')).not.toBeNull(); expect(fetch).toHaveBeenCalledTimes(1);
  mount({ locale: 'zh', onLocate: locate }); expect(host.textContent).toContain('中文 Context grew'); expect(fetch).toHaveBeenCalledTimes(1);
});

it('clears conclusions on source invalidation without automatic reads or locale refetches', async () => {
  mount({ invalidateKey: 'one' }); act(() => button('Analyze split and merge').click()); await settle();
  expect(host.textContent).toContain('Context grew'); mount({ invalidateKey: 'two' });
  expect(host.textContent).not.toContain('Context grew'); expect(host.textContent).toContain('Old analysis was cleared'); expect(fetch).toHaveBeenCalledTimes(1);
});

it('cancels, times out and rejects late results even if the transport ignores abort', async () => {
  const replies: Array<(response: Response) => void> = [];
  vi.mocked(fetch).mockImplementation(() => new Promise(resolve => replies.push(resolve)));
  mount(); act(() => button('Analyze split and merge').click());
  const first = vi.mocked(fetch).mock.calls[0]![1]!.signal as AbortSignal;
  act(() => button('Cancel analysis').click()); expect(first.aborted).toBe(true);
  await act(async () => { replies[0]!(json(report())); }); await settle(); expect(host.textContent).not.toContain('Context grew');
  vi.useFakeTimers(); act(() => button('Analyze split and merge').click());
  const second = vi.mocked(fetch).mock.calls[1]![1]!.signal as AbortSignal;
  await act(async () => { await vi.advanceTimersByTimeAsync(30000); }); expect(second.aborted).toBe(false);
  await act(async () => { await vi.advanceTimersByTimeAsync(20000); }); expect(second.aborted).toBe(true); expect(host.textContent).toContain('Read timed out');
  await act(async () => { replies[1]!(json(report())); }); await settle(); expect(host.textContent).not.toContain('Context grew');
  act(() => button('Retry analysis').click());
  await act(async () => { replies[2]!(json(report())); }); await settle(); expect(host.textContent).toContain('Context grew'); expect(host.querySelector('[role=alert]')).toBeNull();
});

it('aborts pending analysis on scope change and unmount, never restoring the previous task', async () => {
  let reply!: (response: Response) => void;
  vi.mocked(fetch).mockImplementation(() => new Promise(resolve => { reply = resolve; }));
  mount(); act(() => button('Analyze split and merge').click());
  const signal = vi.mocked(fetch).mock.calls[0]![1]!.signal as AbortSignal;
  mount({ member: 'main' }); expect(signal.aborted).toBe(true);
  await act(async () => { reply(json(report())); }); await settle(); expect(host.textContent).not.toContain('Context grew');
  act(() => button('Analyze split and merge').click()); const nextSignal = vi.mocked(fetch).mock.calls[1]![1]!.signal as AbortSignal;
  act(() => root.render(<div/>)); expect(nextSignal.aborted).toBe(true);
});

it('bounds findings to twenty per page and each finding to eight evidence rows', async () => {
  const result = report(); result.findings = Array.from({ length: 45 }, (_, i) => ({ ...result.findings[0]!, id: `finding-${i}`, evidenceIds: Array.from({ length: 12 }, (_, n) => `ref-${n}`) }));
  result.evidence = Array.from({ length: 12 }, (_, i) => ({ ...result.evidence[0]!, id: `ref-${i}` }));
  vi.mocked(fetch).mockResolvedValue(json(result)); mount(); act(() => button('Analyze split and merge').click()); await settle();
  expect(host.querySelectorAll('.architecture-finding')).toHaveLength(20); expect(host.querySelector('.architecture-evidence ul')!.children).toHaveLength(8);
  act(() => button('Next findings').click()); expect(host.querySelectorAll('.architecture-finding')).toHaveLength(20);
  act(() => button('Next findings').click()); expect(host.querySelectorAll('.architecture-finding')).toHaveLength(5); expect(fetch).toHaveBeenCalledTimes(1);
});

it('rejects invalid thresholds before reading and never accepts a response for another member', async () => {
  mount(); const input = host.querySelector<HTMLInputElement>('input[type=number]')!;
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '0'); input.dispatchEvent(new Event('input', { bubbles: true })); });
  act(() => button('Analyze split and merge').click()); expect(fetch).not.toHaveBeenCalled(); expect(host.textContent).toContain('outside the allowed range');
  act(() => button('Reset thresholds').click()); vi.mocked(fetch).mockResolvedValue(json({ ...report(), member: 'other' }));
  act(() => button('Analyze split and merge').click()); await settle(); expect(host.textContent).toContain('INVALID_DIAGNOSIS_RESPONSE'); expect(host.textContent).not.toContain('Context grew');
});

it('explains backend busy, changed and cancelled reasons separately from invalid input', async () => {
  for (const [reason, message] of [['BUSY', 'Another analysis is running'], ['SOURCE_CHANGED', 'Source changed'], ['CANCELLED', 'Analysis stopped'], [null, 'Check the task, member and threshold values']] as const) {
    vi.mocked(fetch).mockRejectedValueOnce(new ApiError('BAD_REQUEST', 'Backend diagnosis unavailable.', 409, reason ? { reason } : undefined));
    act(() => root.render(<ArchitectureDiagnosisPanel key={reason ?? 'input'} taskId={taskId} member="all" locale="en"/>));
    act(() => button('Analyze split and merge').click()); await settle();
    expect(host.querySelector('[role=alert]')?.textContent).toContain(message);
    if (reason) expect(host.querySelector('[role=alert]')?.textContent).not.toContain('Check the task, member');
    expect(host.querySelector('.architecture-report')).toBeNull();
  }
  expect(fetch).toHaveBeenCalledTimes(4);
});

it('opens one metadata-only real-task selector and reads a verified source only after another explicit action', async () => {
  const task = { id: taskId, origin: 'collected', title: 'Collected source', provider: 'codex', memberCount: 2 };
  vi.mocked(fetch).mockImplementation(async input => String(input).includes('architecture-diagnosis') ? json(report()) : json({ items: [task], total: 101, offset: 0, limit: 100, hasMore: true }));
  act(() => root.render(<RealTaskDiagnosisEntry locale="en"/>)); expect(fetch).not.toHaveBeenCalled();
  act(() => button('Analyze real task telemetry').click()); await settle(); expect(fetch).toHaveBeenCalledTimes(1); expect(String(vi.mocked(fetch).mock.calls[0]![0])).toBe('/api/tasks?origin=collected&limit=100&offset=0&range=all');
  const selector = host.querySelector('select')!;
  act(() => { selector.value = taskId; selector.dispatchEvent(new Event('change', { bubbles: true })); }); expect(fetch).toHaveBeenCalledTimes(1); expect(host.textContent).toContain('do not automatically become verified evidence');
  act(() => button('Analyze split and merge').click()); await settle(); expect(fetch).toHaveBeenCalledTimes(2); expect(host.textContent).toContain('Context grew');
  act(() => button('Next tasks').click()); await settle(); expect(fetch).toHaveBeenCalledTimes(3); expect(String(vi.mocked(fetch).mock.calls[2]![0])).toContain('offset=100');
});
