import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HealthDrawer } from './HealthDrawer.js';
import type { TaskContext } from '../../../core/task-types.js';
import type { HealthInput, HealthReport } from '../../../core/task-health/types.js';
import input from '../../../core/__fixtures__/task-health/g1-serial.input.json';
import missing from '../../../core/__fixtures__/task-health/g5-missing.input.json';
import { analyzeTaskHealth } from '../../../core/task-health/report.js';
const context: TaskContext = { task: { id: input.taskId, origin: 'collected', provenanceKnown: true, rootSessionKey: 'main', runId: null, title: 'Health task', provider: 'codex', startedAt: input.t0, updatedAt: input.snapshotAt, recordedStatus: 'success', memberCount: 2, loadedMemberCount: 1, eventCount: 14 }, members: [], importSession: null, warnings: [] };
const makeReport = (id = 'saved'): HealthReport => analyzeTaskHealth(input as HealthInput, undefined, { id, generatedAt: input.snapshotAt });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
let host: HTMLDivElement, root: Root;
const button = (text: string) => { const node = [...host.querySelectorAll('button')].find(node => node.textContent === text); if (!node) throw new Error('Missing ' + text); return node; };
const settle = async () => { await act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); }); };
function Harness(props: Partial<Parameters<typeof HealthDrawer>[0]> = {}) {
  const [id, setId] = useState('new');
  return <HealthDrawer context={context} locale="zh" reportId={id} onReport={setId} onClose={() => {}} onLocate={() => {}} {...props}/>;
}
const mount = (props: Partial<Parameters<typeof HealthDrawer>[0]> = {}) => act(() => root.render(<Harness {...props}/>));
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); vi.stubGlobal('fetch', vi.fn().mockImplementation((_url, init) => Promise.resolve(json(init?.method === 'POST' ? makeReport() : { items: [] })))); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });
it('loads history once, generates explicit all-member scope, renders null reasons and direct export URLs', async () => {
  mount(); await settle(); expect(fetch).toHaveBeenCalledTimes(1); expect(host.textContent).toContain('数据覆盖不足');
  act(() => button('普通监测').click()); await settle();
  const init = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'POST')![1]!;
  expect(JSON.parse(init.body as string)).toEqual({ mode: 'standard', member: 'all' });
  expect(host.querySelectorAll('.health-card')).toHaveLength(5); expect(host.textContent).toContain('— ('); expect(host.textContent).toContain('日志口径');
  expect([...host.querySelectorAll('a')].map(a => a.getAttribute('href'))).toEqual(['html', 'md', 'json'].map(format => `/api/health-reports/saved/export?format=${format}`));
  mount({ locale: 'en' }); await settle(); expect(fetch).toHaveBeenCalledTimes(2); expect(host.textContent).toContain('Standard monitoring');
  expect(button('Deep monitoring · Available in P4').disabled).toBe(true);
});
it('shows BUSY as a translated error without automatic retry', async () => {
  mount(); await settle(); vi.mocked(fetch).mockResolvedValueOnce(json({ error: { code: 'BUSY', message: 'Busy' } }, 409));
  act(() => button('普通监测').click()); await settle(); expect(host.textContent).toContain('已有健康分析正在进行'); expect(fetch).toHaveBeenCalledTimes(2);
});
it('cancels generation and discards late success even if the transport ignores abort', async () => {
  mount(); await settle(); let finish!: (response: Response) => void;
  vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  act(() => button('普通监测').click()); const signal = vi.mocked(fetch).mock.calls.at(-1)![1]!.signal!;
  act(() => button('取消').click()); expect(signal.aborted).toBe(true); finish(json(makeReport())); await settle();
  expect(host.querySelector('.health-report')).toBeNull(); expect(host.textContent).toContain('已取消');
});
it('scope changes abort old work and generate main scope with no search/page filters', async () => {
  mount(); await settle(); let finish!: (response: Response) => void;
  vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  act(() => button('普通监测').click()); const signal = vi.mocked(fetch).mock.calls.at(-1)![1]!.signal!;
  const select = host.querySelector('select')!; act(() => { select.value = 'main'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(signal.aborted).toBe(true); finish(json(makeReport('late'))); await settle(); expect(host.querySelector('.health-report')).toBeNull();
  const r = makeReport(); r.scope.member = 'main'; vi.mocked(fetch).mockResolvedValueOnce(json(r));
  act(() => button('普通监测').click()); await settle(); expect(JSON.parse(vi.mocked(fetch).mock.calls.at(-1)![1]!.body as string)).toEqual({ mode: 'standard', member: 'main' });
});
it('reads saved history on selection, preserves expired indicator and locates exact evidence', async () => {
  const r = makeReport('history'); vi.mocked(fetch).mockResolvedValueOnce(json({ items: [{ id: r.id, generatedAt: r.generatedAt, mode: 'standard', revision: r.revision, expired: true, reportId: null }] })).mockResolvedValueOnce(json(r));
  const locate = vi.fn(); mount({ onLocate: locate }); await settle();
  act(() => button(`${r.generatedAt} · 普通监测 · 数据已更新`).click()); await settle();
  expect(String(vi.mocked(fetch).mock.calls.at(-1)![0])).toBe('/api/health-reports/history');
  const e = r.evidence.find(e => r.findings.some(f => f.evidenceIds.includes(e.id)) && e.recordIds.length)!;
  const target = [...host.querySelectorAll('button')].find(n => n.textContent === `定位证据 · ${e.recordIds[0]}`)!;
  act(() => target.click()); expect(locate).toHaveBeenCalledWith(e, e.recordIds[0]);
  mount({ onLocate: locate, evidenceUnavailable: true }); expect(host.textContent).toContain('原证据不可访问');
});
it('prepares records through member=all then refreshes member coverage', async () => {
  mount(); await settle();
  vi.mocked(fetch).mockResolvedValueOnce(json({ context: { ...context, task: { ...context.task, loadedMemberCount: 2 } }, items: [], total: 0, offset: 0, limit: 200, hasMore: false, hasPrevious: false, window: 'fixed', warnings: [] }));
  act(() => button('准备数据').click()); await settle(); expect(String(vi.mocked(fetch).mock.calls.at(-1)![0])).toContain('member=all'); expect(host.textContent).toContain('2/2 成员已解析');
});
it('discloses insufficient report coverage and does not turn missing cache into zero', async () => {
  const r = analyzeTaskHealth(missing as HealthInput, undefined, { id: 'missing', generatedAt: input.snapshotAt }); r.taskId = input.taskId;
  mount(); await settle(); vi.mocked(fetch).mockResolvedValueOnce(json(r)); act(() => button('普通监测').click()); await settle();
  expect(host.textContent).toContain('数据不足'); expect(host.textContent).toContain('缓存命中率'); expect(host.textContent).toContain('— ('); expect(host.textContent).not.toContain('缓存命中率（model.cache_hit） · 第 2 轮起 · 值: 0');
});
it('task replacement and unmount abort pending report requests', async () => {
  mount(); await settle(); vi.mocked(fetch).mockImplementationOnce(() => new Promise(() => {})); act(() => button('普通监测').click()); const signal = vi.mocked(fetch).mock.calls.at(-1)![1]!.signal!;
  mount({ context: { ...context, task: { ...context.task, id: 'collected:other' } } }); await settle(); expect(signal.aborted).toBe(true); expect(host.querySelector('.health-report')).toBeNull();
});
it('uses the selected UTC interval and keeps the current-window option disabled without endpoints', async () => {
  mount(); await settle(); expect(host.querySelector<HTMLOptionElement>('option[value=window]')!.disabled).toBe(true);
  mount({ from: input.t0, to: input.snapshotAt });
  const select = host.querySelector('select')!; act(() => { select.value = 'window'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  const r = makeReport(); r.scope = { member: 'all', from: input.t0, to: input.snapshotAt }; vi.mocked(fetch).mockResolvedValueOnce(json(r));
  act(() => button('普通监测').click()); await settle(); expect(JSON.parse(vi.mocked(fetch).mock.calls.at(-1)![1]!.body as string)).toEqual({ mode: 'standard', member: 'all', from: input.t0, to: input.snapshotAt });
});
it('enforces the owned 50s deadline and manual history refresh without polling', async () => {
  mount(); await settle(); vi.useFakeTimers();
  vi.mocked(fetch).mockImplementationOnce(() => new Promise(() => {})); act(() => button('普通监测').click()); const signal = vi.mocked(fetch).mock.calls.at(-1)![1]!.signal!;
  act(() => vi.advanceTimersByTime(50000)); expect(signal.aborted).toBe(true); expect(host.textContent).toContain('请求未完成');
  act(() => button('刷新历史').click()); await settle(); expect(fetch).toHaveBeenCalledTimes(3);
  act(() => vi.advanceTimersByTime(100000)); expect(fetch).toHaveBeenCalledTimes(3);
});
it('invalidates source-owned results without polling or rereading a saved report automatically', async () => {
  mount(); await settle(); act(() => button('普通监测').click()); await settle(); expect(host.querySelector('.health-report')).not.toBeNull();
  const calls = vi.mocked(fetch).mock.calls.length; mount({ sourceVersion: 1 }); await settle();
  expect(host.querySelector('.health-report')).toBeNull(); expect(host.textContent).toContain('数据已更新'); expect(fetch).toHaveBeenCalledTimes(calls);
});
