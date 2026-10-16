import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MonitorSetupPanel } from './MonitorSetupPanel.js';
import type { MonitorConnectionDiagnostics, MonitorConnectionPlan, MonitorConnectionProfile } from '../core/trace-types.js';

const profile: MonitorConnectionProfile = { id: '00000000-0000-4000-8000-000000000001', label: 'Synthetic project', agent: 'claude', projectDirectory: '/synthetic/project', executable: null, proxyPort: 7779, noProxy: null, revision: 1, createdAt: '2026-10-16T00:00:00.000Z', updatedAt: '2026-10-16T00:00:00.000Z' };
const plan: MonitorConnectionPlan = { profile, controlUrl: 'http://127.0.0.1:4173', proxyUrl: 'http://127.0.0.1:7779', caCertUrl: 'http://127.0.0.1:4173/api/ca-cert', caSha256: 'a'.repeat(64), commands: { posix: "'node' '/app/bin/agent-observe.js' 'launch' '--profile' 'synthetic' '--'", powershell: "& 'node' '/app/bin/agent-observe.js' 'launch'" }, warnings: ['process_and_descendants', 'transport_unverified'], status: { running: true, starting: false, port: 7779, requestCount: 0, startedAt: null } };
const mounted: Root[] = [];
const diagnostic: MonitorConnectionDiagnostics = { profileId: profile.id, profileRevision: 1, checkedAt: '2026-10-16T00:00:00.000Z', expectedPort: 7779, listener: 'listening', ca: { state: 'available', sha256: 'a'.repeat(64), validUntil: '2030-01-01T00:00:00.000Z' }, trust: { scope: 'selected_child_runtime', variable: 'NODE_EXTRA_CA_CERTS', runtimeVerified: false, osTrust: 'not_checked' }, traffic: { state: 'waiting', scope: 'shared_listener' }, status: { ...plan.status, diagnostics: { phase: 'waiting_for_traffic', runId: 'synthetic', cleanupPending: false, listening: true, observedRequests: 0, activeRequests: 0, pendingWrites: 0, persistedRequests: 0, interruptedRequests: 0, captureErrors: 0, lastError: null, lastRequestAt: null } }, issues: [{ code: 'traffic_waiting', severity: 'warning', message: 'No traffic', nextStep: 'Inspect terminal' }, { code: 'trust_unverified', severity: 'warning', message: 'Unknown trust', nextStep: 'Verify runtime' }] };
function response(data: unknown, status = 200): Response { return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(data) } as Response; }
async function render(onStatus = vi.fn()) {
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container); mounted.push(root);
  await act(async () => { root.render(<MonitorSetupPanel locale="zh" onStatus={onStatus} />); });
  return container;
}
function button(container: HTMLElement, text: string): HTMLButtonElement { return [...container.querySelectorAll('button')].find(item => item.textContent === text)!; }
async function selectProfile(container: HTMLElement) {
  await act(async () => { const select = container.querySelector('select')!; select.value = profile.id; select.dispatchEvent(new Event('change', { bubbles: true })); });
}
afterEach(async () => { for (const root of mounted.splice(0)) await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('explicit process-scoped connection setup', () => {
  it('checks only on demand, keeps trust unknown and invalidates snapshots locally without polling on SSE status changes', async () => {
    const fetchMock = vi.fn(async (url: string) => response(String(url).endsWith('/profiles') ? { items: [profile] } : diagnostic));
    vi.stubGlobal('fetch', fetchMock);
    const container = await render(); await selectProfile(container);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => button(container, '检查接入状态').click());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]![0]).toBe(`/api/proxy/profiles/${profile.id}/diagnostics`);
    expect(container.textContent).toContain('目标运行时信任未验证，系统信任未检查');
    expect(container.textContent).toContain('本轮尚未见请求');
    expect(container.textContent).toContain('不能据此确认');
    const equivalent = { startedAt: '2026-10-16T00:00:00.001Z', diagnostics: diagnostic.status.diagnostics, requestCount: diagnostic.status.requestCount, port: diagnostic.status.port, starting: false, running: true };
    await act(async () => mounted[mounted.length - 1]!.render(<MonitorSetupPanel locale="zh" runtimeStatus={equivalent} />));
    expect(container.textContent).not.toContain('此快照已过时');
    const changed = { ...diagnostic.status, diagnostics: { ...diagnostic.status.diagnostics!, observedRequests: 1, phase: 'capturing' as const } };
    await act(async () => mounted[mounted.length - 1]!.render(<MonitorSetupPanel locale="zh" runtimeStatus={changed} />));
    expect(container.textContent).toContain('此快照已过时');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(container.textContent).not.toContain('连接已验证');
  });

  it('aborts an explicit check at five seconds, clears old evidence and gives retry guidance', async () => {
    let stall = false, aborted = false;
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (String(url).endsWith('/profiles')) return Promise.resolve(response({ items: [profile] }));
      if (!stall) return Promise.resolve(response(diagnostic));
      return new Promise((_resolve, reject) => init!.signal!.addEventListener('abort', () => { aborted = true; reject(new DOMException('aborted', 'AbortError')); }));
    }));
    const container = await render(); await selectProfile(container);
    await act(async () => button(container, '检查接入状态').click());
    expect(container.textContent).toContain('接入诊断快照');
    stall = true; vi.useFakeTimers();
    await act(async () => button(container, '检查接入状态').click());
    expect(container.textContent).not.toContain('接入诊断快照');
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(aborted).toBe(true);
    expect(container.textContent).toContain('检查超过 5 秒未完成');
    expect(button(container, '检查接入状态').disabled).toBe(false);
    expect(container.textContent).not.toContain('接入诊断快照');
  });

  it('rejects a changed recipe report and renders technical errors as text, never HTML', async () => {
    let changed = true;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => response(String(url).endsWith('/profiles') ? { items: [profile] } : { ...diagnostic, profileRevision: changed ? 2 : 1, status: { ...diagnostic.status, diagnostics: { ...diagnostic.status.diagnostics, lastError: '<script>unsafe()</script>' } } })));
    const container = await render(); await selectProfile(container);
    await act(async () => button(container, '检查接入状态').click());
    expect(container.textContent).toContain('配置已被修改'); expect(container.textContent).not.toContain('接入诊断快照');
    changed = false;
    await act(async () => button(container, '检查接入状态').click());
    expect(container.textContent).toContain('<script>unsafe()</script>'); expect(container.querySelector('script')).toBeNull();
  });

  it('aborts the owned check when the drawer unmounts without another fetch', async () => {
    let aborted = false;
    const fetchMock = vi.fn((url: string, init?: RequestInit) => String(url).endsWith('/profiles')
      ? Promise.resolve(response({ items: [profile] }))
      : new Promise((_resolve, reject) => init!.signal!.addEventListener('abort', () => { aborted = true; reject(new DOMException('aborted', 'AbortError')); })));
    vi.stubGlobal('fetch', fetchMock);
    const container = await render(); await selectProfile(container);
    await act(async () => button(container, '检查接入状态').click());
    const root = mounted.pop()!; await act(async () => root.unmount());
    expect(aborted).toBe(true); expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('loads one metadata list, generates commands only on demand and never reports Agent readiness', async () => {
    const fetchMock = vi.fn(async (url: string) => response(String(url).endsWith('/profiles') ? { items: [profile] } : plan));
    vi.stubGlobal('fetch', fetchMock);
    const container = await render();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await selectProfile(container);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => button(container, '生成启动命令').click());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(container.querySelector('textarea')!.value).toBe(plan.commands.posix);
    expect(container.textContent).toContain('此页面没有启动 Agent');
    expect(container.textContent).toContain('配置就绪不等于已验证接入');
    expect(fetchMock.mock.calls.every(([url]) => !String(url).includes('/launch'))).toBe(true);
  });

  it('uses compare-and-swap saves and hides launch actions for unsaved changes', async () => {
    let requestBody: unknown;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') { requestBody = JSON.parse(String(init.body)); return response({ ...profile, label: 'Changed', revision: 2 }); }
      return response({ items: [profile] });
    }));
    const container = await render(); await selectProfile(container);
    await act(async () => {
      const input = container.querySelector('input')!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Changed');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(button(container, '生成启动命令').disabled).toBe(true);
    await act(async () => { container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(requestBody).toEqual({ expectedRevision: 1, settings: { label: 'Changed', agent: 'claude', projectDirectory: '/synthetic/project', executable: null, proxyPort: 7779, noProxy: null } });
    expect(button(container, '生成启动命令').disabled).toBe(false);
  });

  it('starts only the saved listener through the shared API, not an external Agent process', async () => {
    const onStatus = vi.fn();
    const fetchMock = vi.fn(async (url: string) => response(String(url).endsWith('/profiles') ? { items: [profile] } : plan));
    vi.stubGlobal('fetch', fetchMock);
    const container = await render(onStatus); await selectProfile(container);
    await act(async () => button(container, '开启此配置的代理监听').click());
    expect(fetchMock.mock.calls[1]![0]).toBe(`/api/proxy/profiles/${profile.id}/start`);
    expect(onStatus).toHaveBeenCalledWith(plan.status);
    expect(container.textContent).toContain('此页面没有启动 Agent');
  });

  it('keeps an actionable reload after a corrupt profile error and renders observed strings inertly', async () => {
    let failing = true;
    vi.stubGlobal('fetch', vi.fn(async () => failing
      ? response({ error: { code: 'MONITOR_PROFILE_INVALID', message: '<script>unsafe()</script>' } }, 500)
      : response({ items: [{ ...profile, label: '<img src=x onerror=unsafe()>' }] })));
    const container = await render();
    expect(container.textContent).toContain('不会覆盖损坏配置');
    expect(container.textContent).not.toContain('加载中');
    expect(container.querySelector('script,img')).toBeNull();
    failing = false;
    await act(async () => button(container, '重新载入配置').click());
    expect(container.textContent).toContain('<img src=x onerror=unsafe()>');
    expect(container.querySelector('script,img')).toBeNull();
  });
});
