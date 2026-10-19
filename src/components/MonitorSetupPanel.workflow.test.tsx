import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import type { MonitorConnectionProfile } from '../core/trace-types.js';
import { t } from '../i18n.js';
import { MonitorSetupPanel } from './MonitorSetupPanel.js';

const profile: MonitorConnectionProfile = { id: '00000000-0000-4000-8000-000000000001', label: 'Synthetic recipe', agent: 'codex', projectDirectory: '/synthetic/project',
  executable: null, proxyPort: 7779, noProxy: null, revision: 1, createdAt: '2026-10-18T00:00:00.000Z', updatedAt: '2026-10-18T00:00:00.000Z' };
const response = (value: unknown) => new Response(JSON.stringify(value));
const roots = new Set<ReturnType<typeof createRoot>>();
async function mount(props: Partial<React.ComponentProps<typeof MonitorSetupPanel>> = {}) {
  const container = document.createElement('div');document.body.appendChild(container);const root = createRoot(container);roots.add(root);
  await act(async () => root.render(<MonitorSetupPanel locale="en" {...props} />));return { container, root };
}
const button = (container: HTMLElement, label: string) => [...container.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === label)!;
const edit = (input: HTMLInputElement, text: string): void => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text);input.dispatchEvent(new Event('input', { bubbles: true })); };
async function choose(container: HTMLElement, id = profile.id) {
  await act(async () => { const select = container.querySelector('select')!;select.value = id;select.dispatchEvent(new Event('change', { bubbles: true })); });
}
afterEach(() => { act(() => { for (const root of roots) root.unmount();roots.clear(); });document.body.replaceChildren();vi.useRealTimers();vi.unstubAllGlobals(); });

it('releases an abort-ignoring profile read at5s, retries explicitly and rejects the old late response', async () => {
  vi.useFakeTimers();let finish!: (value: Response) => void;let signal: AbortSignal | undefined;let count = 0;
  const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (++count === 1) { signal = init?.signal as AbortSignal;return new Promise<Response>(resolve => { finish = resolve; }); }
    return response({ items: [profile] });
  });vi.stubGlobal('fetch', fetcher);const { container } = await mount();
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(signal?.aborted).toBe(true);expect(container.textContent).toContain('MONITOR_PROFILES_TIMEOUT');expect(button(container, 'Reload connections').disabled).toBe(false);
  await act(async () => button(container, 'Reload connections').click());
  await act(async () => finish(response({ items: [{ ...profile, label: 'LATE_RECIPE_NEVER_SHOWN' }] })));
  expect(container.textContent).not.toContain('LATE_RECIPE_NEVER_SHOWN');expect(container.textContent).toContain('Synthetic recipe');expect(fetcher).toHaveBeenCalledTimes(2);
});

it('preserves a timed-out save draft, blocks duplicate writes and recovers only after explicit successful profile reload', async () => {
  vi.useFakeTimers();let finish!: (value: Response) => void;let signal: AbortSignal | undefined;
  const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'PUT') { signal = init.signal as AbortSignal;return new Promise<Response>(resolve => { finish = resolve; }); }
    return response({ items: [profile] });
  });vi.stubGlobal('fetch', fetcher);const { container } = await mount();await choose(container);
  act(() => edit(container.querySelector('input')!, 'Retained user draft'));
  act(() => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
  expect(signal?.aborted).toBe(true);expect(container.textContent).toContain('MONITOR_SAVE_TIMEOUT');
  act(() => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(1);
  expect(container.querySelector<HTMLInputElement>('input')!.value).toBe('Retained user draft');
  await act(async () => button(container, 'Reload connections').click());
  expect(container.querySelector<HTMLInputElement>('input')!.value).toBe('Retained user draft');
  await act(async () => finish(response({ ...profile, label: 'LATE_SAVE_NEVER_ADOPTED', revision: 2 })));
  expect(container.querySelector<HTMLInputElement>('input')!.value).toBe('Retained user draft');expect(container.textContent).not.toContain('LATE_SAVE_NEVER_ADOPTED');
});

it('does not silently adopt a newer revision during reload, and requires explicit review before another write', async () => {
  let revision = 1;
  const fetcher = vi.fn(async () => response({ items: [{ ...profile, revision }] }));vi.stubGlobal('fetch', fetcher);const { container } = await mount();await choose(container);
  act(() => edit(container.querySelector('input')!, 'Unsent draft'));
  revision = 2;await act(async () => button(container, 'Reload connections').click());
  expect(container.querySelector<HTMLInputElement>('input')!.value).toBe('Unsent draft');expect(container.textContent).toContain('Saved revision changed');
  act(() => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(fetcher).toHaveBeenCalledTimes(2);
  act(() => button(container, 'Review saved version').click());expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  await act(async () => button(container, 'Discard draft and switch').click());
  expect(container.querySelector<HTMLInputElement>('input')!.value).toBe(profile.label);expect(container.textContent).not.toContain('Saved revision changed');
});

it('confirms switching away from a dirty recipe and keeps the prior draft when cancelled', async () => {
  const other = { ...profile, id: '00000000-0000-4000-8000-000000000002', label: 'Other saved recipe' };
  const fetcher = vi.fn(async () => response({ items: [profile, other] }));vi.stubGlobal('fetch', fetcher);const { container } = await mount();await choose(container);
  act(() => edit(container.querySelector('input')!, 'Keep my draft'));await choose(container, other.id);
  expect(container.querySelector('[role="dialog"]')).not.toBeNull();expect(document.activeElement?.textContent).not.toBe('Discard draft and switch');
  act(() => button(container, 'Keep editing').click());expect(container.querySelector<HTMLInputElement>('input')!.value).toBe('Keep my draft');expect(fetcher).toHaveBeenCalledTimes(1);
});

it('owns a plan timeout even if fetch ignores abort and never restores its late command after cancellation', async () => {
  vi.useFakeTimers();let finish!: (value: Response) => void;let signal: AbortSignal | undefined;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => String(input).endsWith('/profiles') ? response({ items: [profile] })
    : new Promise<Response>(resolve => { signal = init?.signal as AbortSignal;finish = resolve; })));
  const { container } = await mount();await choose(container);act(() => button(container, 'Generate launch command').click());
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });expect(signal?.aborted).toBe(true);expect(container.textContent).toContain('MONITOR_PLAN_TIMEOUT');
  await act(async () => finish(response({ profile, commands: { posix: 'LATE_COMMAND_NEVER_SHOWN', powershell: 'late' } })));
  expect(container.querySelector('textarea')).toBeNull();expect(button(container, 'Generate launch command').disabled).toBe(false);
});

it('rejects another recipe identity even when diagnostic revisions match', async () => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => response(String(input).endsWith('/profiles') ? { items: [profile] }
    : { profileId: 'WRONG_RECIPE', profileRevision: 1 })));
  const { container } = await mount();await choose(container);await act(async () => button(container, 'Check connection status').click());
  expect(container.textContent).toContain('MONITOR_PROFILE_CONFLICT');expect(container.textContent).not.toContain('Connection diagnostic snapshot');
});

it('propagates uncertain listener start, ignores late readiness and only a fresh explicit status check recovers it', async () => {
  vi.useFakeTimers();let finish!: (value: Response) => void;let signal: AbortSignal | undefined;
  const idle = { running: false, starting: false, port: null, requestCount: 0, startedAt: null };
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (path.endsWith('/start')) { signal = init?.signal as AbortSignal;return new Promise<Response>(resolve => { finish = resolve; }); }
    return response(path.endsWith('/status') ? idle : { items: [profile] });
  });vi.stubGlobal('fetch', fetcher);const uncertain = vi.fn(), status = vi.fn();
  const { container } = await mount({ onRuntimeUncertain: uncertain, onStatus: status });await choose(container);
  act(() => { button(container, 'Start this connection listener').click();button(container, 'Start this connection listener').click(); });
  await act(async () => { await vi.advanceTimersByTimeAsync(12000); });
  expect(signal?.aborted).toBe(true);expect(uncertain).toHaveBeenCalledTimes(1);expect(button(container, 'Start this connection listener').disabled).toBe(true);
  await act(async () => finish(response({ profile, status: { ...idle, running: true, port: 7779 }, commands: { posix: 'LATE_READY_NEVER_SHOWN', powershell: 'late' } })));
  expect(status).not.toHaveBeenCalled();expect(container.textContent).not.toContain('LATE_READY_NEVER_SHOWN');
  await act(async () => button(container, 'Refresh listener status').click());expect(status).toHaveBeenCalledWith(idle);expect(button(container, 'Start this connection listener').disabled).toBe(false);
  expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/start'))).toHaveLength(1);
});

it('aborts an owned operation on unmount and never refetches just for a locale or parent callback change', async () => {
  let signal: AbortSignal | undefined;
  const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => { signal = init?.signal as AbortSignal;return new Promise<Response>(() => undefined); });
  vi.stubGlobal('fetch', fetcher);const { root } = await mount();
  await act(async () => root.render(<MonitorSetupPanel locale="zh" onStatus={() => undefined} />));expect(fetcher).toHaveBeenCalledTimes(1);
  act(() => root.unmount());roots.delete(root);expect(signal?.aborted).toBe(true);
});

it('does not call a failed profile refresh recovery after an uncertain network write', async () => {
  let failRead = false;
  const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'PUT') throw new Error('SYNTHETIC_WRITE_RESPONSE_LOST');
    if (failRead) throw new Error('SYNTHETIC_PROFILE_READ_LOST');
    return response({ items: [profile] });
  });vi.stubGlobal('fetch', fetcher);const { container } = await mount();await choose(container);act(() => edit(container.querySelector('input')!, 'Keep uncertain draft'));
  await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  failRead = true;await act(async () => button(container, 'Reload connections').click());
  act(() => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(1);expect(container.querySelector<HTMLInputElement>('input')!.value).toBe('Keep uncertain draft');
  expect(container.textContent).toContain('Recipe write outcome unconfirmed');
});

it('releases an abort-ignoring synthetic self-test at12s and never treats a late passed report as current', async () => {
  vi.useFakeTimers();let finish!: (value: Response) => void;let signal: AbortSignal | undefined;
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => String(input).endsWith('/profiles') ? response({ items: [profile] })
    : new Promise<Response>(resolve => { finish = resolve;signal = init?.signal as AbortSignal; }));vi.stubGlobal('fetch', fetcher);
  const { container } = await mount();await choose(container);const test = button(container, t('monitor.selfTest', 'en'));
  expect(test).toBeDefined();act(() => test.click());await act(async () => { await vi.advanceTimersByTimeAsync(12000); });
  expect(signal?.aborted).toBe(true);expect(container.textContent).toContain('Self-test outcome unconfirmed');expect(button(container, 'Cancel waiting')).toBeUndefined();
  await act(async () => finish(response({ profileId: profile.id, profileRevision: 1, proxyId: 42, passed: true, checks: { forwarding: true, persistence: true, originals: true, parsing: true } })));
  expect(container.textContent).not.toContain(t('monitor.selfTestPassed', 'en'));expect(test.disabled).toBe(true);expect(fetcher).toHaveBeenCalledTimes(2);
});

it('requires scoped safe-focus recipe-delete confirmation and only removes the selected recipe after exact acceptance', async () => {
  const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => response(init?.method === 'DELETE' ? { deleted: true } : { items: [profile] }));
  vi.stubGlobal('fetch', fetcher);const { container } = await mount();await choose(container);
  act(() => button(container, 'Delete connection').click());expect(fetcher).toHaveBeenCalledTimes(1);expect(container.textContent).toContain('not Agent configuration or capture originals');
  expect(document.activeElement?.textContent).not.toBe('Confirm');
  await act(async () => button(container, 'Confirm').click());
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(1);expect(container.querySelector('select')!.value).toBe('');
  expect(container.textContent).not.toContain('Synthetic recipe');
});

it('keeps an empty port editable and rejects it locally rather than persisting zero or coercing an unknown value', async () => {
  const fetcher = vi.fn(async () => response({ items: [profile] }));vi.stubGlobal('fetch', fetcher);const { container } = await mount();await choose(container);
  const port = container.querySelector<HTMLInputElement>('input[type="number"]')!;act(() => edit(port, ''));expect(port.value).toBe('');
  act(() => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(container.textContent).toContain('MONITOR_PROFILE_INVALID');expect(fetcher).toHaveBeenCalledTimes(1);
});

it('rejects a contradictory passed self-test instead of certifying incomplete checks or Agent/TLS support', async () => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => response(String(input).endsWith('/profiles') ? { items: [profile] }
    : { profileId: profile.id, profileRevision: 1, scope: 'local_http_sse', synthetic: true, agentVerified: false, tlsVerified: false, proxyId: 42, passed: true,
      checks: { forwarding: true, persistence: false, originals: true, parsing: true } })));
  const { container } = await mount();await choose(container);await act(async () => button(container, t('monitor.selfTest', 'en')).click());
  expect(container.textContent).not.toContain(t('monitor.selfTestPassed', 'en'));expect(container.textContent).toContain('Contradictory synthetic self-test evidence');
});
