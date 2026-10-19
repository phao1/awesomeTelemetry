import Database from 'better-sqlite3';
import { File as NodeFile } from 'node:buffer';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { createServer as createViteServer } from 'vite';
import type { LocalSessionConfig } from '../core/trace-types.js';
import { TraceLogImportPanel } from './TraceLogImportPanel.js';

it('round-trips a real UI import through the local HTTP/worker store, lazy selected detail and byte-exact original download', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'trace-import-ui-integration-'));
  // Load the real backend through Vite's server-side loader: app and Node
  // remain separate composite TS projects, without expanding either include.
  const runtime = await createViteServer({ configFile: false, appType: 'custom', server: { middlewareMode: true, watch: null, hmr: false } });
  const { DEFAULT_LOCAL_SESSION_CONFIG } = await runtime.ssrLoadModule('/local-sessions/config.ts');
  const { createAgentObservabilityServer } = await runtime.ssrLoadModule('/server/server.ts');
  const { initSchema } = await runtime.ssrLoadModule('/server/storage/schema.ts');
  const db = new Database(':memory:'); db.pragma('foreign_keys=ON'); initSchema(db);
  const config = structuredClone(DEFAULT_LOCAL_SESSION_CONFIG) as LocalSessionConfig;
  for (const provider of Object.values(config.providers)) { provider.enabled = false; provider.path = join(directory, 'disabled-source'); }
  const server = createAgentObservabilityServer({ db, config, captureDirectory: join(directory, 'originals'),
    projectConfigPath: join(directory, 'project.json'), userConfigPath: join(directory, 'user.json'), caDirectory: join(directory, 'ca') });
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container), nativeFetch = fetch;
  const pending = new Set<Promise<Response>>();
  const calls: { method: string; path: string }[] = [];
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    // Only adapt the browser's relative URL to this isolated server. No API or
    // component logic is mocked; the actual upload bytes and worker are used.
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), origin);
      if (url.origin !== origin || !url.pathname.startsWith('/api/trace-imports')) throw new Error('Unexpected non-TraceLog IO');
      calls.push({ method: init?.method ?? 'GET', path: url.pathname + url.search });
      const request = nativeFetch(url, init).then(async response => { await response.clone().arrayBuffer(); return response; });
      pending.add(request);
      void request.then(() => pending.delete(request), () => pending.delete(request));
      return request;
    });
    const settle = async (): Promise<void> => {
      for (let pass = 0; pass < 10; pass += 1) {
        await act(async () => { await Promise.all([...pending]); });
        if (pending.size === 0) return;
      }
      throw new Error('Unexpected repeated TraceLog IO');
    };
    const button = (text: string): HTMLButtonElement => {
      const result = [...container.querySelectorAll('button')].find(item => item.textContent === text);
      expect(result, text).toBeDefined(); return result!;
    };
    await act(async () => root.render(<TraceLogImportPanel locale="en" stopped/>));
    await settle();
    expect(container.textContent).toContain('No imported logs');
    expect(calls).toEqual([{ method: 'GET', path: '/api/trace-imports?offset=0&limit=20' }]);
    const source = JSON.stringify({ session: { session_id: 'synthetic-ui-roundtrip', title: 'Synthetic isolated UI import', ide_type: 'codex' }, turns: [
      { turn_id: 'synthetic-ui-turn', turn_number: 1, model_name: 'synthetic-local-only', system_prompt: 'UI_SYSTEM_PRESERVED',
        messages: '[{"role":"user","content":"<script>UI_INERT_ONLY</script>"}]', output_text: 'UI_ANSWER_PRESERVED', input_tokens: 17, output_tokens: 3,
        tool_calls: '[{"function":{"name":"NEVER_EXECUTE","arguments":"{}"}}]' },
    ] }, null, 2);
    const id = createHash('sha256').update(source).digest('hex');
    act(() => container.querySelector<HTMLElement>('summary')!.click());
    expect(container.querySelector('details')?.open).toBe(true);
    await act(async () => {
      const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
      Object.defineProperty(input, 'files', { configurable: true, value: [new NodeFile([source], 'synthetic-ui.json')] });
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => button('Import file').click()); await settle();
    expect(container.textContent).toContain('Completed; new / duplicate / skipped non-log entries: 1 / 0 / 0');
    expect(container.textContent).toContain('Synthetic isolated UI import');
    expect(calls.filter(call => call.method === 'POST')).toHaveLength(1);
    expect(calls.some(call => call.path.endsWith('/turns/0'))).toBe(false);
    expect(container.textContent).not.toContain('UI_ANSWER_PRESERVED');
    const turn = [...container.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.startsWith('#1 · synthetic-local-only'))!;
    expect(turn).toBeDefined();
    await act(async () => turn.click()); await settle();
    expect(container.textContent).toContain('UI_INERT_ONLY'); expect(container.querySelector('script')).toBeNull();
    const detailReads = calls.filter(call => call.path.endsWith('/turns/0')).length;
    expect(detailReads).toBe(1);
    for (const [field, expected] of [['System prompt', 'UI_SYSTEM_PRESERVED'], ['Proposed tool calls', 'NEVER_EXECUTE'], ['Output', 'UI_ANSWER_PRESERVED']] as const) {
      await act(async () => button(field).click()); await settle();
      expect(container.querySelector('[role="tabpanel"]')?.textContent).toContain(expected);
    }
    expect(calls.filter(call => call.path.endsWith('/turns/0'))).toHaveLength(1);
    const href = container.querySelector<HTMLAnchorElement>('a[download]')!.getAttribute('href')!;
    expect(href).toBe(`/api/trace-imports/${id}/source`);
    const download = await fetch(href);
    expect(download.status).toBe(200);
    expect(Buffer.from(await download.arrayBuffer())).toEqual(Buffer.from(source));
    expect(download.headers.get('x-trace-sha256')).toBe(id);
    await act(async () => button('Import file').click()); await settle();
    expect(container.textContent).toContain('Completed; new / duplicate / skipped non-log entries: 0 / 1 / 0');
    expect(calls.filter(call => call.method === 'POST')).toHaveLength(2);
    expect(calls.every(call => call.path.startsWith('/api/trace-imports'))).toBe(true);
  } finally {
    act(() => root.unmount()); container.remove();
    vi.unstubAllGlobals();
    await new Promise<void>((resolve, reject) => server.close((error?: Error) => error ? reject(error) : resolve()));
    db.close(); await runtime.close(); await rm(directory, { recursive: true, force: true });
  }
});
