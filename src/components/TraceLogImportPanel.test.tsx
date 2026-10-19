import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../api/client.js';
import type { TraceLogSession, TraceLogTurn, TraceLogTurnDetail } from '../core/trace-types.js';
import { TraceLogImportPanel } from './TraceLogImportPanel.js';

const session = (id = 'a'.repeat(64)): TraceLogSession => ({ id, fileName: 'trace.json', sourceMember: null, importedAt: '2026-10-16T00:00:00.000Z',
  source: { id: '00000000-0000-4000-8000-000000000000', bytes: 100, sha256: id, status: 'complete', error: null },
  nativeSessionId: 'native', ideType: 'codex', model: 'synthetic', title: id.startsWith('a') ? 'Synthetic session' : 'Other session', startedAt: null, endedAt: null, turnCount: 1 });
const turn: TraceLogTurn = { sequence: 0, turnId: 'turn-1', turnNumber: 1, model: 'synthetic', requestTime: null, responseTime: null, isError: null, reported: { input_tokens: 1, output_tokens: null }, hasOutput: false };
const detail = (id = 'a'.repeat(64)): TraceLogTurnDetail => ({ sessionId: id, sequence: 0, session: { unknown: 'SESSION_PRESERVED' }, raw: {
  system_prompt: 'SYSTEM_PRESERVED', messages: '[{"role":"user","content":"<script>INERT_ONLY</script>"}]', tool_calls: '[{"function":{"name":"NEVER_EXECUTE"}}]', unknown: 'TURN_PRESERVED',
} });
let container: HTMLDivElement, root: ReturnType<typeof createRoot>;
beforeEach(() => {
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  vi.spyOn(api, 'traceLogImports').mockResolvedValue({ items: [session()], offset: 0, limit: 20, hasMore: false });
  vi.spyOn(api, 'traceLogTurns').mockResolvedValue({ items: [turn], offset: 0, limit: 20, hasMore: false });
  vi.spyOn(api, 'traceLogTurn').mockResolvedValue(detail());
  vi.spyOn(api, 'importTraceLog').mockResolvedValue({ items: [{ state: 'imported', session: session() }], ignoredEntries: 5 });
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.useRealTimers(); });
const render = async (locale: 'en' | 'zh' = 'en', stopped = true) => act(async () => root.render(<TraceLogImportPanel locale={locale} stopped={stopped} />));
const button = (text: string): HTMLButtonElement => { const value = [...container.querySelectorAll('button')].find(item => item.textContent === text); if (!value) throw new Error('Missing button ' + text); return value; };
const click = async (text: string) => act(async () => button(text).click());
async function pickFile() { await act(async () => { const input = container.querySelector('input')!; Object.defineProperty(input, 'files', { configurable: true, value: [new File(['{}'], 'trace.json')] }); input.dispatchEvent(new Event('change', { bubbles: true })); }); }
const chooseTurn = async () => act(async () => { const value = [...container.querySelectorAll('button')].find(item => item.textContent?.startsWith('#1 · synthetic')); if (!value) throw new Error('Missing turn'); value.click(); });

describe('lazy TraceLog import inspection', () => {
  it('loads metadata only once; locale does not refetch; selected turns preserve fields as inert text and absent output stays absent', async () => {
    await render(); expect(api.traceLogImports).toHaveBeenCalledTimes(1); expect(api.traceLogTurns).not.toHaveBeenCalled(); expect(api.traceLogTurn).not.toHaveBeenCalled();
    await click('Synthetic session'); expect(api.traceLogTurns).toHaveBeenCalledTimes(1); expect(api.traceLogTurn).not.toHaveBeenCalled();
    await chooseTurn(); expect(api.traceLogTurn).toHaveBeenCalledExactlyOnceWith('a'.repeat(64), 0, expect.any(AbortSignal));
    expect(container.textContent).toContain('INERT_ONLY'); expect(container.querySelector('script')).toBeNull();
    await click('System prompt'); expect(container.textContent).toContain('SYSTEM_PRESERVED');
    await click('Proposed tool calls'); expect(container.textContent).toContain('NEVER_EXECUTE');
    await click('Output'); expect(container.textContent).toContain('No output_text');
    await click('Raw session'); expect(container.textContent).toContain('SESSION_PRESERVED');
    await click('Raw turn'); expect(container.textContent).toContain('TURN_PRESERVED');
    expect(container.querySelector('a')?.getAttribute('href')).toBe('/api/trace-imports/' + 'a'.repeat(64) + '/source');
    await render('zh'); expect(api.traceLogImports).toHaveBeenCalledTimes(1); expect(api.traceLogTurns).toHaveBeenCalledTimes(1); expect(api.traceLogTurn).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('导出器报告值'); expect(container.textContent).toContain('可能是相邻请求间隙估算');
  });
  it('uploads only after explicit selection/action and blocks active-monitor submission while allowing inspection', async () => {
    await render('en', false); await pickFile(); expect(button('Import file').disabled).toBe(true); expect(api.importTraceLog).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Stop monitoring'); await render('en', true); await click('Import file');
    expect(api.importTraceLog).toHaveBeenCalledTimes(1); expect(api.importTraceLog).toHaveBeenCalledWith(expect.any(File), expect.any(AbortSignal));
    expect(container.textContent).toContain('Completed; new / duplicate / skipped non-log entries: 1 / 0 / 5');
    expect(api.traceLogImports).toHaveBeenCalledTimes(2); expect(api.traceLogTurn).not.toHaveBeenCalled();
  });
  it('rejects late aborted detail after selecting another session', async () => {
    vi.mocked(api.traceLogImports).mockResolvedValue({ items: [session(), session('b'.repeat(64))], offset: 0, limit: 20, hasMore: false });
    let finish!: (value: TraceLogTurnDetail) => void; let signal!: AbortSignal;
    vi.mocked(api.traceLogTurn).mockImplementation((_id, _sequence, owned) => { signal = owned!; return new Promise(resolve => { finish = resolve; }); });
    await render(); await click('Synthetic session'); await chooseTurn(); await click('Other session'); expect(signal.aborted).toBe(true);
    await act(async () => finish(detail())); expect(container.textContent).not.toContain('INERT_ONLY'); expect(container.textContent).not.toContain('SYSTEM_PRESERVED');
  });
  it('limits text preview, explicitly expands and adjusts readable font without executing content', async () => {
    const value = detail(); value.raw.messages = 'x'.repeat(70000); vi.mocked(api.traceLogTurn).mockResolvedValue(value);
    await render(); await click('Synthetic session'); await chooseTurn(); expect(container.querySelector('[role="tabpanel"] pre')!.textContent!.length).toBe(65536);
    await click('Expand full field'); expect(container.querySelector('[role="tabpanel"] pre')!.textContent!.length).toBe(70000);
    await click('A+'); expect((container.querySelector('[role="tabpanel"] pre') as HTMLElement).style.fontSize).toBe('14px');
  });
  it('shows explicit list failure and retry; no stale value is shown while retrying', async () => {
    vi.mocked(api.traceLogImports).mockRejectedValueOnce(new ApiError('TRACE_IMPORT_FAILED', 'not user content'));
    await render(); expect(container.querySelector('[role="alert"]')?.textContent).toContain('TRACE_IMPORT_FAILED');
    await click('Refresh imports'); expect(container.querySelector('[role="alert"]')).toBeNull(); expect(button('Synthetic session')).not.toBeNull();
  });
  it('cancel/timeout never labels an uncertain import successful or automatically retries', async () => {
    vi.useFakeTimers(); let signal!: AbortSignal;
    vi.mocked(api.importTraceLog).mockImplementation((_file, owned) => { signal = owned!; return new Promise((_resolve, reject) => owned!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))); });
    await render(); await pickFile(); await click('Import file'); expect(signal.aborted).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(120000); }); expect(signal.aborted).toBe(true);
    expect(container.textContent).toContain('refresh the list before retrying'); expect(container.textContent).not.toContain('Completed;'); expect(api.importTraceLog).toHaveBeenCalledTimes(1);
  });
  it('aborts upload and metadata requests on unmount', async () => {
    let uploadSignal!: AbortSignal; vi.mocked(api.importTraceLog).mockImplementation((_file, owned) => { uploadSignal = owned!; return new Promise(() => undefined); });
    await render(); await pickFile(); await click('Import file'); const listSignal = vi.mocked(api.traceLogImports).mock.calls[0]![1]!;
    await act(async () => root.unmount()); expect(uploadSignal.aborted).toBe(true); expect(listSignal.aborted).toBe(true);
  });
});
