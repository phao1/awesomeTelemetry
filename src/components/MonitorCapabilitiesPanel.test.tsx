import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PROVIDER_KEYS, type MonitorCapabilityReport } from '../core/trace-types.js';
import { MonitorCapabilitiesPanel } from './MonitorCapabilitiesPanel.js';

const roots: Root[] = [];
function report(platform = 'win32'): MonitorCapabilityReport {
  return { manifestVersion: 1, generatedAt: '2026-10-16T01:02:03.456Z', platform,
    scope: 'terminal_child_and_descendants', listener: 'shared_not_process_filtered',
    agents: PROVIDER_KEYS.map(provider => ({ provider, processRecipe: provider === 'claude' || provider === 'codex' || provider === 'opencode' ? provider : null,
      nativeScanner: 'implemented', installedVersion: null, runtimeVerification: 'unverified' })),
    transports: [
      ...(['http1_json_sse', 'https_connect', 'compressed_semantics', 'live_identity_sse'] as const).map(id => ({ id, level: 'controlled_test' as const, testedPlatforms: ['darwin'] })),
      { id: 'agent_websocket', level: 'unsupported', testedPlatforms: [] }, { id: 'http2_grpc', level: 'unverified', testedPlatforms: [] },
      { id: 'mtls_pinning', level: 'unverified', testedPlatforms: [] }, { id: 'electron_cdp', level: 'dev_only', testedPlatforms: [] },
      { id: 'trae_cn_frida', level: 'experimental', testedPlatforms: [] },
    ] };
}
function response(data: unknown, status = 200): Response { return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(data) } as Response; }
async function flush(): Promise<void> { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); }
function render(locale: 'en' | 'zh' = 'en') {
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container); roots.push(root); const configure = vi.fn();
  act(() => root.render(<MonitorCapabilitiesPanel locale={locale} onConfigure={configure} />));
  return { root, container, configure };
}
function button(container: HTMLElement, text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find(node => node.textContent === text); expect(found, text).toBeDefined(); return found!;
}
afterEach(() => { act(() => { for (const root of roots.splice(0)) root.unmount(); }); document.body.replaceChildren(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('actionable monitoring capability matrix', () => {
  it('describes current controlled WS connection evidence without upgrading actual Agent certification', async () => {
    const current = report('darwin'); current.transports = current.transports.map(item => item.id === 'agent_websocket' ? { ...item, level: 'controlled_test', testedPlatforms: ['darwin'] } : item);
    vi.stubGlobal('fetch', vi.fn(async () => response(current))); const { container } = render(); await flush();
    const row = container.querySelector('[data-capability-transport="agent_websocket"]')!;
    expect(row.textContent).toContain('Controlled local test'); expect(row.textContent).toContain('bidirectional application-message archives');
    expect(row.textContent).toContain('Not wire frames, per-response accounting or actual Agent certification');
    expect(container.textContent).toContain('Actual Agent unverified'); expect(row.textContent).not.toContain('No model WebSocket/WSS capture');
  });
  it('loads one no-store manifest and configures only implemented recipes, without saving or starting anything', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => response(report())); vi.stubGlobal('fetch', fetchMock);
    const { container, configure } = render(); await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1); expect(fetchMock.mock.calls[0]![0]).toBe('/api/proxy/capabilities');
    expect(fetchMock.mock.calls[0]![1]?.cache).toBe('no-store');
    expect(container.querySelectorAll('[data-capability-agent]')).toHaveLength(9);
    const actions = container.querySelectorAll<HTMLButtonElement>('[data-configure-agent]');
    expect([...actions].map(action => action.dataset.configureAgent)).toEqual(['claude', 'codex', 'opencode']);
    expect([...actions].map(action => action.textContent)).toEqual(['Configure claude', 'Configure codex', 'Configure opencode']);
    for (const action of actions) act(() => action.click());
    expect(configure.mock.calls).toEqual([['claude'], ['codex'], ['opencode']]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('Unknown; not an installation check');
    expect(container.textContent).toContain('Actual Agent unverified');
    expect(container.textContent).toContain('not a process/project traffic filter');
    expect(container.textContent).toContain('New terminal child');
  });
  it('separates controlled darwin evidence from the current platform and explains encoded offline versus identity live semantics', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(report('win32')))); const { container } = render(); await flush();
    expect(container.textContent).toContain('win32'); expect(container.textContent).toContain('darwin');
    expect(container.textContent).toContain('does not certify the current platform');
    expect(container.querySelectorAll('[data-capability-transport]')).toHaveLength(9);
    expect(container.textContent).toContain('gzip / br / deflate'); expect(container.textContent).toContain('after capture');
    expect(container.textContent).toContain('identity only'); expect(container.textContent).toContain('No model WebSocket/WSS capture');
    expect(container.textContent).toContain('Dev-only'); expect(container.textContent).toContain('Experimental');
  });
  it('changes language without refetching or polling and preserves explicit refresh', async () => {
    vi.useFakeTimers(); const fetchMock = vi.fn(async () => response(report())); vi.stubGlobal('fetch', fetchMock);
    const { container, root, configure } = render(); await flush();
    act(() => root.render(<MonitorCapabilitiesPanel locale="zh" onConfigure={configure} />)); await flush();
    expect(container.textContent).toContain('能力矩阵'); expect(container.textContent).toContain('未知，不代表未安装');
    expect(container.textContent).toContain('真实 Agent 未验证'); expect(container.textContent).toContain('仅开发模式');
    expect(button(container, '配置 claude')).toBeDefined(); expect(button(container, '配置 codex')).toBeDefined(); expect(button(container, '配置 opencode')).toBeDefined();
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); }); expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => button(container, '刷新能力矩阵').click()); await flush(); expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('times out even an abort-ignoring response and rejects its late result before local retry', async () => {
    vi.useFakeTimers(); let resolve!: (value: Response) => void; const delayed = new Promise<Response>(done => { resolve = done; });
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>().mockImplementationOnce(() => delayed).mockResolvedValue(response(report()));
    vi.stubGlobal('fetch', fetchMock); const { container } = render();
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Loading');
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(fetchMock.mock.calls[0]![1]?.signal?.aborted).toBe(true); expect(container.querySelector('[role="alert"]')?.textContent).toContain('5 seconds');
    await act(async () => { resolve(response(report())); await delayed; }); expect(container.querySelector('[data-capability-agent]')).toBeNull();
    await act(async () => button(container, 'Retry').click()); await flush();
    expect(container.querySelector('[role="alert"]')).toBeNull(); expect(container.querySelectorAll('[data-capability-agent]')).toHaveLength(9);
  });
  it('clears old evidence while refreshing and gives bilingual retry guidance with inert technical errors', async () => {
    let fail = false; const fetchMock = vi.fn(async () => fail ? response({ error: { code: 'CAPABILITY_TEST_ERROR', message: '<script>unsafe()</script>' } }, 503) : response(report()));
    vi.stubGlobal('fetch', fetchMock); const { container, root, configure } = render(); await flush(); fail = true;
    await act(async () => button(container, 'Refresh capabilities').click()); await flush();
    expect(container.querySelector('[data-capability-agent]')).toBeNull(); expect(container.textContent).toContain('CAPABILITY_TEST_ERROR');
    expect(container.textContent).toContain('<script>unsafe()</script>'); expect(container.querySelector('script,img')).toBeNull();
    act(() => root.render(<MonitorCapabilitiesPanel locale="zh" onConfigure={configure} />));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('能力信息读取失败'); expect(fetchMock).toHaveBeenCalledTimes(2);
    fail = false; await act(async () => button(container, '重试').click()); await flush(); expect(container.querySelector('[role="alert"]')).toBeNull();
  });
  it('aborts its owned request and drops a late response after unmount', async () => {
    let resolve!: (value: Response) => void; const delayed = new Promise<Response>(done => { resolve = done; });
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) => delayed); vi.stubGlobal('fetch', fetchMock);
    const { root, container, configure } = render(); act(() => root.unmount()); roots.splice(roots.indexOf(root), 1);
    expect(fetchMock.mock.calls[0]![1]?.signal?.aborted).toBe(true);
    await act(async () => { resolve(response(report())); await delayed; }); expect(container.textContent).toBe(''); expect(configure).not.toHaveBeenCalled();
  });
  it('clears the matrix immediately on refresh, retains loading and prevents overlapping refreshes', async () => {
    let resolve!: (value: Response) => void; const delayed = new Promise<Response>(done => { resolve = done; });
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>().mockResolvedValueOnce(response(report())).mockImplementationOnce(() => delayed);
    vi.stubGlobal('fetch', fetchMock); const { container } = render(); await flush();
    act(() => button(container, 'Refresh capabilities').click());
    expect(container.querySelector('[data-capability-agent]')).toBeNull(); expect(container.querySelector('[role="status"]')?.textContent).toContain('Loading');
    expect(button(container, 'Refresh capabilities').disabled).toBe(true);
    act(() => button(container, 'Refresh capabilities').click()); expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => { resolve(response(report())); await delayed; }); await flush();
    expect(container.querySelectorAll('[data-capability-agent]')).toHaveLength(9); expect(button(container, 'Refresh capabilities').disabled).toBe(false);
  });
  it('shows missing evidence as empty, not installed or certified support, and permits explicit refresh', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ ...report(), agents: [], transports: [] })));
    const { container, configure } = render(); await flush();
    expect(container.querySelector('[role="status"]')?.textContent).toContain('No capability evidence');
    expect(container.querySelector('[data-configure-agent]')).toBeNull(); expect(configure).not.toHaveBeenCalled();
    expect(button(container, 'Refresh capabilities').disabled).toBe(false);
  });
});
