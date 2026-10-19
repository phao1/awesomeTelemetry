import Database from 'better-sqlite3';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { createServer as createViteServer } from 'vite';
import type { LocalSessionConfig, MonitorConnectionProfile, ProxyRequestListItem, ProxyRuntimeStatus } from '../core/trace-types.js';
import { t, type I18nKey } from '../i18n.js';
import { MonitorSetupPanel } from './MonitorSetupPanel.js';

it('persists a real isolated recipe, generates pinned inert commands, starts only a local listener and verifies one synthetic self-test', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'monitor-recipe-ui-'));
  const runtime = await createViteServer({ configFile: false, appType: 'custom', server: { middlewareMode: true, watch: null, hmr: false } });
  const { DEFAULT_LOCAL_SESSION_CONFIG } = await runtime.ssrLoadModule('/local-sessions/config.ts');
  const { createAgentObservabilityServer } = await runtime.ssrLoadModule('/server/server.ts');
  const { initSchema } = await runtime.ssrLoadModule('/server/storage/schema.ts');
  const db = new Database(':memory:');db.pragma('foreign_keys=ON');initSchema(db);
  const config = structuredClone(DEFAULT_LOCAL_SESSION_CONFIG) as LocalSessionConfig;
  for (const provider of Object.values(config.providers)) { provider.enabled = false;provider.path = join(directory, 'disabled-source'); }
  const server = createAgentObservabilityServer({ db, config, captureDirectory: join(directory, 'originals'), caDirectory: join(directory, 'ca'),
    projectConfigPath: join(directory, 'project.json'), userConfigPath: join(directory, 'user.json') });
  const container = document.createElement('div');document.body.appendChild(container);const root = createRoot(container), nativeFetch = fetch;
  const pending = new Set<Promise<Response>>(), calls: Array<{ path: string; method: string; body: unknown }> = [];
  const statuses: ProxyRuntimeStatus[] = [], opened: number[] = [];
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const probe = createServer();await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));const proxyPort = (probe.address() as AddressInfo).port;
    await new Promise<void>((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
    // Adapt relative browser URLs only. All API/config/CA/proxy/self-test logic
    // is real and isolated; generated terminal commands are never executed.
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), origin);
      if (url.origin !== origin || !url.pathname.startsWith('/api/proxy/')) throw new Error('Unexpected non-isolated recipe IO');
      calls.push({ path: url.pathname, method: init?.method ?? 'GET', body: init?.body === undefined ? null : JSON.parse(String(init.body)) });
      const result = nativeFetch(url, init).then(async value => { await value.clone().arrayBuffer();return value; });pending.add(result);
      void result.then(() => pending.delete(result), () => pending.delete(result));return result;
    });
    const settle = async (): Promise<void> => {
      for (let pass = 0; pass < 10; pass += 1) { await act(async () => { await Promise.all([...pending]); });if (pending.size === 0) return; }
      throw new Error('Repeated recipe IO without an explicit user action');
    };
    const button = (key: I18nKey): HTMLButtonElement => {
      const label = t(key, 'en'), found = [...container.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === label);expect(found, label).toBeDefined();return found!;
    };
    const edit = (input: HTMLInputElement, value: string): void => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);input.dispatchEvent(new Event('input', { bubbles: true })); };
    await act(async () => root.render(<MonitorSetupPanel locale="en" initialAgent="codex" onStatus={value => statuses.push(value)} onOpenCapture={id => opened.push(id)} />));await settle();
    expect(calls.map(call => call.path)).toEqual(['/api/proxy/profiles']);expect(container.textContent).toContain(t('monitor.flow.empty', 'en'));
    act(() => edit(container.querySelector<HTMLInputElement>('input')!, 'ISOLATED_RECIPE_ONLY'));
    act(() => edit(container.querySelector<HTMLInputElement>('[placeholder="/absolute/project/path"]')!, directory));
    act(() => edit(container.querySelector<HTMLInputElement>('input[type="number"]')!, String(proxyPort)));
    await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));await settle();
    const id = container.querySelector<HTMLSelectElement>('select')!.value;expect(id).toMatch(/^[a-f0-9-]{36}$/);
    const stored = JSON.parse(await readFile(join(directory, 'monitor-profiles.json'), 'utf8')) as { profiles: MonitorConnectionProfile[] };
    expect(stored.profiles).toHaveLength(1);expect(stored.profiles[0]).toMatchObject({ id, label: 'ISOLATED_RECIPE_ONLY', agent: 'codex', revision: 1, projectDirectory: directory, proxyPort });
    expect(calls.filter(call => call.path === '/api/proxy/profiles' && call.method === 'GET')).toHaveLength(1);
    await act(async () => button('monitor.command').click());await settle();
    const command = container.querySelector<HTMLTextAreaElement>('textarea')!.value;
    expect(command).toContain("'launch'");expect(command).toContain(id);expect(command).toContain("'--revision' '1'");
    expect(statuses).toHaveLength(0);expect((await nativeFetch(origin + '/api/proxy/status').then(value => value.json()) as ProxyRuntimeStatus).running).toBe(false);
    const shell = container.querySelector<HTMLSelectElement>('.monitor-command select')!;
    act(() => { shell.value = 'powershell';shell.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(container.querySelector<HTMLTextAreaElement>('textarea')!.value).toContain('& ');expect(calls.filter(call => call.path.endsWith('/plan'))).toHaveLength(1);
    await act(async () => button('monitor.startListener').click());await settle();
    expect(statuses.at(-1)?.running).toBe(true);expect(statuses.at(-1)?.port).toBe(proxyPort);
    await act(async () => button('monitor.diagnose').click());await settle();
    expect(container.textContent).toContain(t('monitor.diagnosticTitle', 'en'));expect(container.textContent).toContain(t('monitor.unverified', 'en'));
    await act(async () => button('monitor.selfTest').click());await settle();
    expect(container.textContent).toContain(t('monitor.selfTestPassed', 'en'));expect(container.textContent).toContain(t('monitor.selfTestUnverified', 'en'));
    const open = [...container.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.startsWith(t('monitor.selfTestOpen', 'en')))!;
    act(() => open.click());expect(opened).toHaveLength(1);
    const page = await nativeFetch(origin + '/api/proxy/requests?limit=50').then(value => value.json()) as { items: ProxyRequestListItem[] };
    expect(page.items).toHaveLength(1);expect(page.items[0]?.id).toBe(opened[0]);expect(page.items[0]?.model).toBe('agent-observe-self-test');
    expect(page.items[0]).not.toHaveProperty('requestBody');
    // Harness cleanup stops only its owned listener. Recipe deletion must not
    // delete the separately retained synthetic capture/original evidence.
    expect((await nativeFetch(origin + '/api/proxy/stop', { method: 'POST' })).status).toBe(200);
    await act(async () => button('monitor.delete').click());expect(calls.some(call => call.method === 'DELETE')).toBe(false);
    await act(async () => button('common.confirm').click());await settle();
    expect((JSON.parse(await readFile(join(directory, 'monitor-profiles.json'), 'utf8')) as { profiles: unknown[] }).profiles).toHaveLength(0);
    expect((await nativeFetch(origin + `/api/proxy/requests/${opened[0]}/body/request`)).status).toBe(200);
    expect(calls.filter(call => call.method === 'POST').map(call => call.path)).toEqual(['/api/proxy/profiles', `/api/proxy/profiles/${id}/start`, `/api/proxy/profiles/${id}/self-test`]);
    expect(calls.filter(call => call.method === 'DELETE')).toEqual([{ path: `/api/proxy/profiles/${id}`, method: 'DELETE', body: { expectedRevision: 1 } }]);
    expect(calls.some(call => call.path.includes('/launch'))).toBe(false);
  } finally {
    act(() => root.unmount());container.remove();vi.unstubAllGlobals();
    await new Promise<void>((resolve, reject) => server.close((error?: Error) => error ? reject(error) : resolve()));
    db.close();await runtime.close();await rm(directory, { recursive: true, force: true });
  }
});
