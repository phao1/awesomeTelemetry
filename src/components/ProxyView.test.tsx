import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FridaView } from './FridaView.js';
import type { CaptureReparseResponse, CaptureReparseStatus } from '../core/trace-types.js';
import { ProxyView } from './ProxyView.js';
import { PROVIDER_KEYS, type MonitorCapabilityReport, type CaptureNetworkTiming, type OriginalDeletionJob, type ProxyCaptureBodies, type ProxyProtocolAnalysis, type ProxyRequestListItem, type ProxyMonitorDiagnostics } from '../core/trace-types.js';

function render(node: React.JSX.Element): HTMLDivElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    createRoot(container).render(node);
  });
  return container;
}

it('opens TraceLog imports lazily from Proxy without loading source bodies or starting monitoring', async () => {
  const fetcher = vi.fn(async (url: string) => {
    if (url.includes('/proxy/status')) return jsonResponse({ running: false, starting: false, port: null, requestCount: 0, startedAt: null });
    if (url.includes('/proxy/requests')) return jsonResponse({ items: [], nextCursor: null, hasMore: false });
    if (url.includes('/trace-imports')) return jsonResponse({ items: [], offset: 0, limit: 20, hasMore: false });
    throw new Error('Unexpected route: ' + url);
  });
  vi.stubGlobal('fetch', fetcher); const container = document.createElement('div'); document.body.appendChild(container); const root = createRoot(container);
  try {
    await act(async () => { root.render(<ProxyView locale="en" />); await import('./TraceLogImportPanel.js'); });
    expect(fetcher.mock.calls.filter(([url]) => url.includes('/trace-imports'))).toHaveLength(0);
    await act(async () => { [...container.querySelectorAll('button')].find(button => button.textContent === 'Import TraceLog')!.click(); });
    await vi.waitFor(() => expect(container.textContent).toContain('No imported logs'));
    expect(fetcher.mock.calls.filter(([url]) => url.includes('/trace-imports'))).toHaveLength(1);
    expect(container.querySelector('input[type="file"]')).not.toBeNull();
    expect(fetcher.mock.calls.some(([url]) => /\/(source|start)$/.test(url))).toBe(false);
  } finally { act(() => root.unmount()); container.remove(); }
});

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function fullRequest(id: number): Record<string, unknown> {
  return {
    id,
    requestId: `req-${id}`,
    method: 'POST',
    url: 'https://api.example.com/v1/messages',
    hostname: 'api.example.com',
    requestHeaders: { 'content-type': 'application/json' },
    requestBody: '{"messages":[]}',
    responseStatus: 200,
    responseBody: '{}',
    contentType: 'application/json',
    isStreaming: false,
    startedAt: '2026-08-07T00:00:00.000Z',
    completedAt: null,
    durationMs: 100,
    captureMethod: 'mitm',
    ttnetEncrypted: false,
    systemPrompt: null,
    systemPromptLen: 0,
    model: 'claude-sonnet',
    inputTokens: null,
    outputTokens: null,
    parsedSessionId: null,
    parserRoute: '/v1/messages',
    captureGroupId: null,
    requestFormat: 'anthropic_messages',
    rawRequestBody: null,
    rawResponseBody: null,
  };
}

function reparsedResult(): CaptureReparseResponse {
  const usage = { inputTokens: 100, outputTokens: 20, cacheReadTokens: 40, cacheWriteTokens: 0, reasoningTokens: null,
    nativeTotalTokens: null, totalTokens: 160, accounting: 'anthropic_additive_input' as const };
  const completeness = { complete: true, omittedCount: 0, reasons: [] };
  return {
    status: { proxyId: 1, requestId: 'req-1', currentParserVersion: 3, currentMetricVersion: 1, state: 'current', unavailableReason: null,
      snapshot: { parserVersion: 3, metricVersion: 1, sourceFingerprint: 'a'.repeat(64), parsedAt: '2026-10-16T00:00:00.000Z', requestFormat: 'anthropic_messages', state: 'completed', usage, completeness } },
    analysis: { parserVersion: 3, requestFormat: 'anthropic_messages', model: 'REPARSED_LATEST_MODEL', responseId: null, state: 'completed', stopReason: 'end_turn', system: null,
      declarations: [], items: [], errors: [], unknownEvents: 0, usage: { ...usage, snapshots: [] }, completeness },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('selected capture timing and explicit evidence-export wiring', () => {
  it('explicitly reparses twice on the same detail and adopts the returned analysis without another analysis GET', async () => {
    const result = reparsedResult(), initial: CaptureReparseStatus = { ...result.status, state: 'not_parsed', snapshot: null };
    const base = selectedFetcher(captureMetadata());
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => url.endsWith('/reparse') ? jsonResponse(init?.method === 'POST' ? result : initial) : base(url, init));
    vi.stubGlobal('fetch', fetcher);
    const container = document.createElement('div'); document.body.appendChild(container); const root = createRoot(container);
    const button = (label: string) => [...container.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === label)!;
    try {
      await act(async () => { root.render(<ProxyView locale="en" focusedRequestId={1} />); await import('./CaptureReparseControl.js'); });
      await vi.waitFor(() => expect(button('Offline reparse')).toBeDefined());
      expect(fetcher.mock.calls.some(([url]) => url.endsWith('/reparse'))).toBe(false);
      await act(async () => button('Offline reparse').click());
      expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/reparse'))).toHaveLength(1);
      for (let iteration = 0; iteration < 2; iteration += 1) {
        await act(async () => button('Reparse retained originals').click());
        expect(container.textContent).toContain('REPARSED_LATEST_MODEL');
        expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Protocol Analysis');
      }
      expect(fetcher.mock.calls.filter(([url, init]) => url.endsWith('/reparse') && init?.method === 'POST')).toHaveLength(2);
      expect(fetcher.mock.calls.some(([url]) => url.endsWith('/analysis'))).toBe(false);
      const before = fetcher.mock.calls.length;
      await act(async () => root.render(<ProxyView locale="zh" focusedRequestId={1} />));
      expect(container.textContent).toContain('REPARSED_LATEST_MODEL'); expect(fetcher).toHaveBeenCalledTimes(before);
    } finally { act(() => root.unmount()); }
  });

  it('a fresh ordinary analysis started during reparse cannot overwrite the accepted result after it arrives late', async () => {
    const result = reparsedResult(), initial: CaptureReparseStatus = { ...result.status, state: 'not_parsed', snapshot: null };
    let finishPost!: (response: Response) => void, finishRead!: (response: Response) => void;
    let analysisSignal: AbortSignal | undefined;
    const base = selectedFetcher(captureMetadata());
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/reparse')) return init?.method === 'POST' ? new Promise<Response>(resolve => { finishPost = resolve; }) : jsonResponse(initial);
      if (url.endsWith('/analysis')) { analysisSignal = init?.signal as AbortSignal; return new Promise<Response>(resolve => { finishRead = resolve; }); }
      return base(url, init);
    });
    vi.stubGlobal('fetch', fetcher);
    const container = document.createElement('div'); document.body.appendChild(container); const root = createRoot(container);
    const button = (label: string) => [...container.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === label)!;
    try {
      await act(async () => { root.render(<ProxyView locale="en" focusedRequestId={1} />); await import('./CaptureReparseControl.js'); });
      await vi.waitFor(() => expect(button('Offline reparse')).toBeDefined());
      await act(async () => button('Offline reparse').click());
      await act(async () => button('Reparse retained originals').click());
      await act(async () => button('Protocol Analysis').click());
      expect(analysisSignal?.aborted).toBe(false);
      await act(async () => finishPost(jsonResponse(result)));
      expect(container.textContent).toContain('REPARSED_LATEST_MODEL'); expect(analysisSignal?.aborted).toBe(true);
      await act(async () => finishRead(jsonResponse({ ...result.analysis, model: 'LATE_OLD_ANALYSIS' })));
      expect(container.textContent).toContain('REPARSED_LATEST_MODEL'); expect(container.textContent).not.toContain('LATE_OLD_ANALYSIS');
      const before = fetcher.mock.calls.length;
      await act(async () => root.render(<ProxyView locale="en" focusedRequestId={1} traceInvalidateKey={1} />));
      expect(container.textContent).not.toContain('REPARSED_LATEST_MODEL'); expect(fetcher).toHaveBeenCalledTimes(before);
    } finally { act(() => root.unmount()); }
  });
  it('confirmed body deletion hides a pending reparse and rejects its late analysis in the shared detail', async () => {
    const result = reparsedResult(), initial: CaptureReparseStatus = { ...result.status, state: 'not_parsed', snapshot: null };
    let deleted = false, finish!: (response: Response) => void;
    const deletion: OriginalDeletionJob = { id: '00000000-0000-4000-8000-000000000001', proxyId: 1, requestId: 'req-1', state: 'pending', error: null,
      createdAt: '2026-10-16T00:00:00.000Z', updatedAt: '2026-10-16T00:00:00.000Z', completedAt: null };
    const base = selectedFetcher(captureMetadata(), async () => jsonResponse(deleted ? deletion : null));
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => url.endsWith('/reparse') ? init?.method === 'POST' ? new Promise<Response>(resolve => { finish = resolve; }) : jsonResponse(initial) : base(url, init));
    vi.stubGlobal('fetch', fetcher);
    const container = document.createElement('div'); document.body.appendChild(container); const root = createRoot(container);
    const button = (label: string) => [...container.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === label)!;
    try {
      await act(async () => { root.render(<ProxyView locale="en" focusedRequestId={1} />); await import('./CaptureReparseControl.js'); });
      await vi.waitFor(() => expect(button('Offline reparse')).toBeDefined());
      await act(async () => button('Offline reparse').click());
      await act(async () => button('Reparse retained originals').click());
      deleted = true;
      await act(async () => button('Refresh deletion status').click());
      expect(button('Offline reparse').disabled).toBe(true);
      const before = fetcher.mock.calls.length;
      await act(async () => finish(jsonResponse(result)));
      expect(container.textContent).not.toContain('REPARSED_LATEST_MODEL'); expect(fetcher).toHaveBeenCalledTimes(before);
      expect(fetcher.mock.calls.some(([url]) => url.endsWith('/analysis'))).toBe(false);
    } finally { act(() => root.unmount()); }
  });
  it('loads the capability matrix only on demand and opens a blank selected Agent recipe without writes or listener start', async () => {
    const fetcher = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url === '/api/proxy/capabilities') {
        const report: MonitorCapabilityReport = { manifestVersion: 1, generatedAt: '2026-10-16T00:00:00.000Z', platform: 'darwin', scope: 'terminal_child_and_descendants', listener: 'shared_not_process_filtered',
          agents: PROVIDER_KEYS.map(provider => ({ provider, processRecipe: provider === 'claude' || provider === 'codex' || provider === 'opencode' ? provider : null, nativeScanner: 'implemented', installedVersion: null, runtimeVerification: 'unverified' })),
          transports: [
            { id: 'http1_json_sse', level: 'controlled_test', testedPlatforms: ['darwin'] }, { id: 'https_connect', level: 'controlled_test', testedPlatforms: ['darwin'] },
            { id: 'compressed_semantics', level: 'controlled_test', testedPlatforms: ['darwin'] }, { id: 'live_identity_sse', level: 'controlled_test', testedPlatforms: ['darwin'] },
            { id: 'agent_websocket', level: 'unsupported', testedPlatforms: [] }, { id: 'http2_grpc', level: 'unverified', testedPlatforms: [] },
            { id: 'mtls_pinning', level: 'unverified', testedPlatforms: [] }, { id: 'electron_cdp', level: 'dev_only', testedPlatforms: [] }, { id: 'trae_cn_frida', level: 'experimental', testedPlatforms: [] },
          ] };
        return jsonResponse(report);
      }
      if (url === '/api/proxy/profiles') return jsonResponse({ items: [{ id: 'saved-claude', label: 'Existing user recipe', agent: 'claude', projectDirectory: '/keep/user/project', executable: null, proxyPort: 7789, noProxy: null, revision: 1, createdAt: '2026-10-16T00:00:00.000Z', updatedAt: '2026-10-16T00:00:00.000Z' }] });
      if (url.includes('/proxy/requests')) return jsonResponse({ items: [], hasMore: false, nextCursor: null });
      if (url.endsWith('/status')) return jsonResponse({ running: false, starting: false, port: null, requestCount: 0, startedAt: null });
      throw new Error('Unexpected capability setup read: ' + url);
    });
    vi.stubGlobal('fetch', fetcher);
    const container = document.createElement('div'); document.body.appendChild(container); const root = createRoot(container);
    try {
      await act(async () => root.render(<ProxyView locale="zh" />));
      expect(fetcher.mock.calls.map(([url]) => url).sort()).toEqual(['/api/proxy/requests?limit=50', '/api/proxy/status']);
      await act(async () => { [...container.querySelectorAll('button')].find(button => button.textContent === '监控能力与接入')!.click(); await import('./MonitorCapabilitiesPanel.js'); });
      await vi.waitFor(() => expect([...container.querySelectorAll('button')].some(button => button.textContent === '配置 codex')).toBe(true));
      expect(fetcher.mock.calls.filter(([url]) => url === '/api/proxy/capabilities')).toHaveLength(1);
      await act(async () => { [...container.querySelectorAll('button')].find(button => button.textContent === '配置 codex')!.click(); await import('./MonitorSetupPanel.js'); });
      await vi.waitFor(() => expect(container.querySelector('.monitor-setup select')).not.toBeNull());
      expect(container.querySelectorAll<HTMLSelectElement>('.monitor-setup select')[0]!.value).toBe('');
      expect(container.querySelectorAll<HTMLSelectElement>('.monitor-setup select')[1]!.value).toBe('codex');
      expect(container.querySelector<HTMLInputElement>('.monitor-setup input')!.value).toBe('');
      expect(container.querySelector<HTMLInputElement>('[placeholder="/absolute/project/path"]')!.value).toBe('');
      expect(container.textContent).toContain('Existing user recipe');
      expect(fetcher.mock.calls.filter(([url]) => url === '/api/proxy/profiles')).toHaveLength(1);
      expect(fetcher.mock.calls).toHaveLength(4);
      expect(fetcher.mock.calls.every(([, init]) => init?.method === undefined)).toBe(true);
    } finally { act(() => root.unmount()); }
  });
  it('opens selected comparison without reading evidence until one explicit pair submission', async () => {
    const fetchSelected = selectedFetcher(captureMetadata());
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/proxy/requests/1/comparison?base=2') {
        const side = (id: number) => ({ request: { ...fullRequest(id), hasSystemPrompt: false },
          evidence: { request: null, response: null, requestPreviewTruncated: false, responsePreviewTruncated: false },
          originalDeletion: null, analysis: null, analysisUnavailableReason: 'analysis_unavailable' });
        return jsonResponse({ base: side(2), target: side(1), generatedAt: '2026-10-16T00:00:00.000Z' });
      }
      return fetchSelected(url, init);
    });
    vi.stubGlobal('fetch', fetcher);
    const container = document.createElement('div'); document.body.appendChild(container); const root = createRoot(container);
    try {
      await act(async () => root.render(<ProxyView locale="en" focusedRequestId={1} />));
      const initial = fetcher.mock.calls.length;
      await act(async () => { [...container.querySelectorAll('[role="tab"]')].find(tab => tab.textContent === 'Call comparison')!.dispatchEvent(new MouseEvent('click', { bubbles: true })); await import('./CaptureComparisonPanel.js'); });
      const panel = container.querySelector<HTMLElement>('[aria-label="Selected capture comparison"]')!;
      expect(panel).not.toBeNull(); expect(fetcher).toHaveBeenCalledTimes(initial);
      const input = panel.querySelector<HTMLInputElement>('input')!;
      await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '2'); input.dispatchEvent(new Event('input', { bubbles: true })); });
      await act(async () => { panel.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
      expect(fetcher).toHaveBeenCalledTimes(initial + 1);
      expect(fetcher.mock.calls.at(-1)).toEqual(['/api/proxy/requests/1/comparison?base=2', { signal: expect.any(AbortSignal), cache: 'no-store', headers: { accept: 'application/json' } }]);
      expect(panel.querySelector('[data-comparison-result]')).not.toBeNull();
      expect(fetcher.mock.calls.some(([url]) => /context-diff|\/analysis$|\/body\//.test(url))).toBe(false);
    } finally { act(() => root.unmount()); }
  });
  const observedTiming: CaptureNetworkTiming = {
    version: 1, clock: 'proxy_monotonic', responseHeadersMs: 100, firstBodyByteMs: 150,
    firstContentMs: 800, firstContentKind: 'reasoning', firstContentBasis: 'sse_event_dispatch',
    completedMs: 2000, contentTimingStatus: 'observed', serverTiming: 'vendor_raw;dur=37', serverTimingTruncated: false,
  };
  const captureMetadata = (timing?: CaptureNetworkTiming): ProxyCaptureBodies => ({
    request: null, response: null, requestPreviewTruncated: false, responsePreviewTruncated: false, responseHeaders: {},
    transport: { version: 1, state: 'completed', error: null, requestEnded: true, responseEnded: true, statusCode: 200,
      ...(timing === undefined ? {} : { timing }) },
  });
  const selectedFetcher = (capture: ProxyCaptureBodies, availability: () => Promise<Response> = async () => jsonResponse(null), deletion: OriginalDeletionJob | null = null) => vi.fn(async (url: string, _init?: RequestInit) => {
    if (url.endsWith('/original-deletion')) return availability();
    if (/\/export(?:\?mode=metadata)?$/.test(url)) {
      const excluded = new Set(['requestBody', 'responseBody', 'rawRequestBody', 'rawResponseBody', 'systemPrompt']);
      return new Response(JSON.stringify({
        format: 'awesome-telemetry.capture-evidence', formatVersion: 1, exportedAt: '2026-10-16T00:00:00.000Z', schemaVersion: 17,
        request: Object.fromEntries(Object.entries(fullRequest(1)).filter(([key]) => !excluded.has(key))), capture, originalDeletion: deletion,
        analysis: null, analysisUnavailableReason: deletion !== null ? 'original_deleted' : url.includes('?mode=metadata') ? 'metadata_only' : 'analysis_unavailable',
        identities: { source: 'proxy', sourceKey: '1', parserVersion: null, items: [], completeness: { complete: true, omittedCount: 0, reasons: [] }, nextCursor: null, hasMore: false },
        traceLinks: { proxyId: 1, items: [], nextCursor: null, hasMore: false }, limitations: ['original_bodies_not_included'],
      }), { headers: { 'content-type': 'application/json' } });
    }
    if (url.endsWith('/capture')) return jsonResponse(capture);
    if (/\/requests\/\d+$/.test(url)) return jsonResponse({ ...fullRequest(1), durationMs: 9999 });
    if (url.includes('/proxy/requests')) return jsonResponse({ items: [], hasMore: false, nextCursor: null });
    if (url.endsWith('/status')) return jsonResponse({ running: false, starting: false, port: null, requestCount: 0, startedAt: null });
    throw new Error('Unexpected automatic read: ' + url);
  });
  const exportButton = (container: HTMLElement): HTMLButtonElement => {
    const button = [...container.querySelectorAll('button')].find(element => element.textContent === 'Export evidence JSON');
    if (button === undefined) throw new Error('Missing explicit evidence export control');
    return button;
  };

  it.each(['en', 'zh'] as const)('inspects WS transcripts as connection evidence without HTTP analysis/reparse fan-out (%s)', async locale => {
    const capture = captureMetadata();
    capture.request = { id: 'synthetic-ws', bytes: 100, sha256: 'a'.repeat(64), status: 'complete', error: null };
    capture.transport = { version: 1, state: 'completed', error: null, requestEnded: true, responseEnded: true, statusCode: 101,
      websocket: { version: 1, scope: 'connection', archive: 'awsp1', requestMessages: 2, responseMessages: 16, clientCloseCode: 1000, upstreamCloseCode: 1000 } };
    const base = selectedFetcher(capture);
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => /\/requests\/\d+$/.test(url)
      ? jsonResponse({ ...fullRequest(1), method: 'WS', requestFormat: 'unknown', requestBody: '#1 client → upstream\n<script>inert</script>', responseBody: '#2 upstream → client\nOK 中文' }) : base(url, init));
    vi.stubGlobal('fetch', fetcher);
    const container = document.createElement('div'); document.body.appendChild(container); const root = createRoot(container);
    try {
      await act(async () => root.render(<ProxyView locale={locale} focusedRequestId={1} />));
      expect(container.textContent).toContain(locale === 'en' ? 'not one model call' : '不是单次模型调用');
      expect(container.textContent).toContain('2 / 16; 1000 / 1000');
      expect(container.querySelector('script')).toBeNull(); expect(container.textContent).toContain('<script>inert</script>');
      const tabs = [...container.querySelectorAll('[role="tab"]')].map(item => item.textContent);
      expect(tabs).not.toContain(locale === 'en' ? 'Protocol Analysis' : '协议分析');
      expect(container.textContent).not.toContain(locale === 'en' ? 'Offline reparse' : '离线重解析');
      expect(container.querySelector('a[href="/api/proxy/requests/1/body/request"]')?.textContent).toContain('AWSP1');
      const reads = fetcher.mock.calls.length;
      await act(async () => [...container.querySelectorAll('[role="tab"]')].find(item => item.textContent === 'Response')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
      expect(container.textContent).toContain('OK 中文'); expect(fetcher.mock.calls).toHaveLength(reads);
      expect(fetcher.mock.calls.some(([url]) => /\/(analysis|reparse|comparison)$/.test(url) || url.includes('/body/'))).toBe(false);
    } finally { act(() => root.unmount()); }
  });

  it.each(['observed', 'unsupported_encoding', 'legacy'] as const)('shows %s capture timing rather than request total duration, without analysis/export reads', async kind => {
    const timing = kind === 'legacy' ? undefined : kind === 'observed' ? observedTiming : {
      ...observedTiming, firstContentMs: null, firstContentKind: null, firstContentBasis: null, contentTimingStatus: 'unsupported_encoding' as const,
    };
    const fetcher = selectedFetcher(captureMetadata(timing)); vi.stubGlobal('fetch', fetcher);
    const container = document.createElement('div'); document.body.appendChild(container); const root = createRoot(container);
    try {
      await act(async () => root.render(<ProxyView locale="en" focusedRequestId={1} />));
      expect(container.querySelector('[aria-label="Proxy-observed timing"]')).toBeNull();
      const reads = fetcher.mock.calls.length;
      await act(async () => { [...container.querySelectorAll('[role="tab"]')].find(tab => tab.textContent === 'Timing')!.dispatchEvent(new MouseEvent('click', { bubbles: true })); await import('./CaptureTimingPanel.js'); });
      const panel = container.querySelector('[aria-label="Proxy-observed timing"]')!;
      expect(panel).not.toBeNull();
      if (kind === 'legacy') {
        expect(panel.textContent).toContain('Legacy timing is unknown');
        expect(panel.querySelectorAll('dd')).toHaveLength(0);
      } else {
        expect([...panel.querySelectorAll('dl > div')].map(row => [row.querySelector('dt')?.textContent, row.querySelector('dd')?.textContent])).toEqual([
          ['Response headers', '100 ms'], ['First response byte', '150 ms'], ['First meaningful content', kind === 'observed' ? '800 ms' : '—'], ['Network end', '2000 ms'],
        ]);
        expect(panel.textContent).toContain('vendor_raw;dur=37');
        if (kind === 'observed') { expect(panel.textContent).toContain('reasoning'); expect(panel.textContent).toContain('first meaningful SSE event dispatch'); }
        else expect(panel.textContent).toContain('Content timing unavailable for this encoding');
      }
      expect(panel.textContent).not.toContain('9999 ms');
      expect(fetcher).toHaveBeenCalledTimes(reads);
      expect(fetcher.mock.calls.some(([url]) => url.endsWith('/analysis') || url.includes('/export') || url.includes('/body/'))).toBe(false);
    } finally { act(() => root.unmount()); }
  });

  it('requests one evidence GET only on explicit click, downloads locally and does not activate analysis', async () => {
    const fetcher = selectedFetcher(captureMetadata(observedTiming)); vi.stubGlobal('fetch', fetcher);
    const clicks: Array<{ href: string; filename: string }> = []; const blobs: Blob[] = []; const revoke = vi.fn(); const BaseURL = URL;
    vi.stubGlobal('URL', Object.assign(class extends BaseURL {}, { createObjectURL: vi.fn((blob: Blob) => { blobs.push(blob); return 'blob:selected-evidence'; }), revokeObjectURL: revoke }));
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clicks.push({ href: this.href, filename: this.download }); });
    const container = document.createElement('div'); document.body.appendChild(container); const root = createRoot(container);
    try {
      await act(async () => { root.render(<ProxyView locale="en" focusedRequestId={1} />); await import('./CaptureExportControl.js'); });
      const button = exportButton(container); expect(button.disabled).toBe(false);
      expect(fetcher.mock.calls.some(([url]) => url.includes('/export'))).toBe(false); expect(clicks).toHaveLength(0);
      const before = fetcher.mock.calls.length;
      await act(async () => button.click());
      expect(fetcher).toHaveBeenCalledTimes(before + 1);
      expect(fetcher.mock.calls.at(-1)).toEqual(['/api/proxy/requests/1/export', { signal: expect.any(AbortSignal), cache: 'no-store' }]);
      expect(clicks).toEqual([{ href: 'blob:selected-evidence', filename: 'capture-1.json' }]);
      expect(JSON.parse(await blobs[0]!.text()).capture.transport.timing).toEqual(observedTiming);
      expect(fetcher.mock.calls.some(([url, init]) => url.endsWith('/analysis') || url.includes('/body/') || init?.method === 'POST')).toBe(false);
      expect(container.textContent).toContain('Download requested');
    } finally { act(() => root.unmount()); anchorClick.mockRestore(); }
    expect(revoke).toHaveBeenCalledWith('blob:selected-evidence');
  });

  it('disables export while selected-body availability is still loading and enables it only after confirmation', async () => {
    let finish!: (response: Response) => void;
    const pending = new Promise<Response>(resolve => { finish = resolve; });
    const fetcher = selectedFetcher(captureMetadata(), () => pending); vi.stubGlobal('fetch', fetcher);
    const container = document.createElement('div'); document.body.appendChild(container); const root = createRoot(container);
    try {
      await act(async () => { root.render(<ProxyView locale="en" focusedRequestId={1} />); await import('./CaptureExportControl.js'); });
      expect(exportButton(container).disabled).toBe(true);
      await act(async () => exportButton(container).click());
      expect(fetcher.mock.calls.some(([url]) => url.includes('/export'))).toBe(false);
      await act(async () => finish(jsonResponse(null)));
      expect(exportButton(container).disabled).toBe(false);
      expect(container.textContent).not.toContain('Metadata-only export:');
      expect(fetcher.mock.calls.some(([url]) => url.includes('/export') || url.endsWith('/analysis'))).toBe(false);
    } finally { act(() => root.unmount()); }
  });

  it.each(['unknown', 'pending', 'failed', 'complete'] as const)('uses metadata-only export for %s availability without reading or restoring body-derived analysis', async state => {
    const deletion: OriginalDeletionJob | null = state === 'unknown' ? null : {
      id: '11111111-1111-4111-8111-111111111111', proxyId: 1, requestId: 'req-1', state,
      error: state === 'failed' ? 'CAPTURE_STORE_BUSY' : null, createdAt: '2026-10-16T00:00:00.000Z', updatedAt: '2026-10-16T00:00:00.000Z', completedAt: state === 'complete' ? '2026-10-16T00:00:00.000Z' : null,
    };
    let availabilityReads = 0;
    const fetcher = selectedFetcher(captureMetadata(), async () => {
      availabilityReads += 1;
      if (state === 'unknown' && availabilityReads === 1) throw new Error('selected availability unavailable');
      return jsonResponse(deletion);
    }, deletion);
    vi.stubGlobal('fetch', fetcher);
    const BaseURL = URL; const createObjectURL = vi.fn(() => 'blob:selected-metadata');
    vi.stubGlobal('URL', Object.assign(class extends BaseURL {}, { createObjectURL, revokeObjectURL: vi.fn() }));
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const container = document.createElement('div'); document.body.appendChild(container); const root = createRoot(container);
    try {
      await act(async () => { root.render(<ProxyView locale="en" focusedRequestId={1} />); await import('./CaptureExportControl.js'); });
      expect(exportButton(container).disabled).toBe(false);
      expect(container.textContent).toContain('Metadata-only export:');
      expect(container.textContent).not.toContain('{"messages":[]}');
      expect(fetcher.mock.calls.some(([url]) => url.includes('/export'))).toBe(false);
      await act(async () => exportButton(container).click());
      expect(fetcher.mock.calls.filter(([url]) => url.includes('/export')).map(([url]) => url)).toEqual(['/api/proxy/requests/1/export?mode=metadata']);
      expect(createObjectURL).toHaveBeenCalledTimes(1); expect(anchorClick).toHaveBeenCalledTimes(1);
      expect(fetcher.mock.calls.some(([url, init]) => url.endsWith('/analysis') || url.includes('/body/') || init?.method === 'POST')).toBe(false);
      if (state === 'unknown') {
        const refresh = container.querySelector('.original-deletion-control button:last-child') as HTMLButtonElement;
        await act(async () => refresh.click());
        expect(availabilityReads).toBe(2);
        expect(exportButton(container).disabled).toBe(false);
        expect(container.textContent).not.toContain('Metadata-only export:');
        expect(container.textContent).toContain('{"messages":[]}');
        expect(fetcher.mock.calls.filter(([url]) => url.includes('/export'))).toHaveLength(1);
        await act(async () => exportButton(container).click());
        expect(fetcher.mock.calls.filter(([url]) => url.includes('/export')).map(([url]) => url)).toEqual([
          '/api/proxy/requests/1/export?mode=metadata', '/api/proxy/requests/1/export',
        ]);
        expect(fetcher.mock.calls.some(([url]) => url.endsWith('/analysis'))).toBe(false);
      }
    } finally { act(() => root.unmount()); anchorClick.mockRestore(); }
  });
});

describe('REQ-020/021 代理与 Frida 视图', () => {
  it.each(['zh', 'en'] as const)('opens a native Messages error flag source without changing content or fetching again (%s)', async locale => {
    const analysis: ProxyProtocolAnalysis = {
      parserVersion: 3, requestFormat: 'anthropic_messages', model: null, responseId: null, state: 'completed', stopReason: 'end_turn', system: null,
      declarations: [], errors: [], unknownEvents: 0, completeness: { complete: true, omittedCount: 0, reasons: [] },
      usage: { inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null, reasoningTokens: null, nativeTotalTokens: null, totalTokens: null, accounting: 'anthropic_additive_input', snapshots: [] },
      items: [{ phase: 'request', kind: 'tool_result', id: null, callId: 'native-tool', name: null, index: 0, choiceIndex: null, content: 'ENOENT', toolResultIsError: true, complete: true, sourcePath: 'messages[0].content[0]' }],
    };
    const fetcher = vi.fn(async (url: string) => {
      if (url.endsWith('/original-deletion')) return jsonResponse(null);
      if (url.endsWith('/analysis')) return jsonResponse(analysis);
      if (url.endsWith('/capture')) return jsonResponse({ request: null, response: null, requestPreviewTruncated: false, responsePreviewTruncated: false, responseHeaders: {} });
      if (/\/requests\/\d+$/.test(url)) return jsonResponse(fullRequest(1));
      if (url.includes('/proxy/requests')) return jsonResponse({ items: [], hasMore: false, nextCursor: null });
      return jsonResponse({ running: false, starting: false, port: null, requestCount: 0, startedAt: null });
    });
    vi.stubGlobal('fetch', fetcher);
    const container = document.createElement('div'); document.body.appendChild(container); const root = createRoot(container);
    try {
      await act(async () => root.render(<ProxyView locale={locale} focusedRequestId={1} />));
      await act(async () => { [...container.querySelectorAll('[role="tab"]')].find(tab => tab.textContent === (locale === 'zh' ? '协议分析' : 'Protocol Analysis'))!.dispatchEvent(new MouseEvent('click', { bubbles: true })); await import('./ProxyInsights.js'); });
      const label = (locale === 'zh' ? '查看证据' : 'Inspect evidence') + ': messages[0].content[0].is_error';
      await vi.waitFor(() => expect(container.querySelector('[aria-label="' + label + '"]')).not.toBeNull());
      const before = fetcher.mock.calls.length;
      act(() => (container.querySelector('[aria-label="' + label + '"]') as HTMLButtonElement).click());
      const item = container.querySelector('[data-analysis-evidence="item-0"]') as HTMLDetailsElement;
      expect(item.open).toBe(true); expect(document.activeElement).toBe(item);
      expect(item.textContent).toContain('messages[0].content[0].is_error = true');
      expect(item.querySelector('pre')?.textContent).toBe('ENOENT');
      expect(container.textContent).toContain('completed');
      expect(fetcher).toHaveBeenCalledTimes(before);
    } finally { act(() => root.unmount()); }
  });
  it('insight evidence buttons open native usage/declarations or the correct item page without new reads', async () => {
    const analysis: ProxyProtocolAnalysis = {
      parserVersion: 1, requestFormat: 'openai_chat', model: 'demo', responseId: null, state: 'completed', stopReason: null,
      system: null, declarations: [{ name: 'shell', type: 'function', definition: '{"name":"shell"}', sourcePath: 'tools[0]' }],
      errors: [], unknownEvents: 0, completeness: { complete: true, omittedCount: 0, reasons: [] },
      usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 40, cacheWriteTokens: null, reasoningTokens: null, nativeTotalTokens: 120, totalTokens: 120, accounting: 'openai_subsets', snapshots: [{ eventIndex: 4, value: '{"prompt_tokens":100,"prompt_tokens_details":{"cached_tokens":40}}' }] },
      items: Array.from({ length: 55 }, (_, index) => ({ phase: 'request', kind: 'tool_result', id: null, callId: 'call-' + index, name: null,
        content: index === 54 ? '{"is_error":true,"message":"reported failure"}' : 'ok', toolResultIsError: null, index, choiceIndex: null, complete: true, sourcePath: 'messages[' + index + ']' })),
    };
    const fetcher = vi.fn(async (url: string) => {
      if (url.endsWith('/original-deletion')) return jsonResponse(null);
      if (url.endsWith('/analysis')) return jsonResponse(analysis);
      if (url.endsWith('/capture')) return jsonResponse({ request: null, response: null, requestPreviewTruncated: false, responsePreviewTruncated: false, responseHeaders: {} });
      if (/\/requests\/\d+$/.test(url)) return jsonResponse(fullRequest(1));
      if (url.includes('/proxy/requests')) return jsonResponse({ items: [], hasMore: false, nextCursor: null });
      return jsonResponse({ running: false, starting: false, port: null, requestCount: 0, startedAt: null });
    });
    vi.stubGlobal('fetch', fetcher);
    const container = document.createElement('div'); document.body.appendChild(container); const root = createRoot(container);
    try {
      await act(async () => root.render(<ProxyView locale="en" focusedRequestId={1} />));
      await act(async () => { [...container.querySelectorAll('button')].find(button => button.textContent === 'Protocol Analysis')!.click(); });
      const before = fetcher.mock.calls.length;
      await vi.waitFor(async () => {
        await act(async () => { await Promise.resolve(); });
        expect(container.textContent).toContain('40.0%');
      });
      const inspect = async (path: string) => act(async () => { (container.querySelector('[aria-label="Inspect evidence: ' + path + '"]') as HTMLButtonElement).click(); });
      await inspect('analysis.usage.snapshots');
      expect((container.querySelector('[data-analysis-evidence="usage"]') as HTMLDetailsElement).open).toBe(true);
      await inspect('tools[0]');
      const declaration = container.querySelector('[data-analysis-evidence="declaration-0"]')!;
      expect(declaration.closest('details')?.open).toBe(true); expect(document.activeElement).toBe(declaration);
      expect(container.querySelector('[data-analysis-evidence="item-54"]')).toBeNull();
      await inspect('messages[54]');
      const result = container.querySelector('[data-analysis-evidence="item-54"]') as HTMLDetailsElement;
      expect(result.open).toBe(true); expect(document.activeElement).toBe(result);
      expect(result.textContent).toContain('reported failure');
      expect(fetcher).toHaveBeenCalledTimes(before);
      expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/analysis'))).toHaveLength(1);
    } finally { act(() => root.unmount()); }
  });
  it.each(['capture', 'analysis'] as const)('explicitly retries only a failed %s read, clears its error and owns cancellation', async endpoint => {
    let reads = 0;
    const signals: AbortSignal[] = [];
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/original-deletion')) return jsonResponse(null);
      if (url.endsWith('/' + endpoint)) {
        reads += 1;
        if (init?.signal) signals.push(init.signal);
        if (reads === 1) throw new Error('synthetic local read failed');
        return jsonResponse(endpoint === 'capture' ? { request: null, response: null, requestPreviewTruncated: false, responsePreviewTruncated: false, responseHeaders: { 'x-retried': 'metadata' } } : {
          parserVersion: 1, requestFormat: 'anthropic_messages', model: 'retried-analysis', responseId: null, state: 'completed', stopReason: null, system: null, declarations: [], items: [], errors: [], unknownEvents: 0,
          usage: { inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null, reasoningTokens: null, nativeTotalTokens: null, totalTokens: null, accounting: 'unknown', snapshots: [] }, completeness: { complete: true, omittedCount: 0, reasons: [] },
        });
      }
      if (url.endsWith('/capture')) return jsonResponse({ request: null, response: null, requestPreviewTruncated: false, responsePreviewTruncated: false, responseHeaders: {} });
      if (/\/requests\/\d+$/.test(url)) return jsonResponse(fullRequest(1));
      if (url.includes('/proxy/requests')) return jsonResponse({ items: [], hasMore: false, nextCursor: null });
      return jsonResponse({ running: false, starting: false, port: null, requestCount: 0, startedAt: null });
    });
    vi.stubGlobal('fetch', fetcher);
    const container = document.createElement('div'); document.body.appendChild(container); const root = createRoot(container);
    try {
      await act(async () => root.render(<ProxyView locale="zh" focusedRequestId={1} />));
      const click = async (text: string) => act(async () => { [...container.querySelectorAll('button')].find(button => button.textContent === text)!.click(); });
      if (endpoint === 'analysis') { expect(reads).toBe(0); await click('协议分析'); }
      expect(container.textContent).toContain('synthetic local read failed'); expect(reads).toBe(1);
      const retry = container.querySelector('[role="alert"] button') as HTMLButtonElement | null;
      expect(retry).not.toBeNull();
      await act(async () => { retry!.click(); });
      expect(reads).toBe(2); expect(container.textContent).not.toContain('synthetic local read failed');
      if (endpoint === 'analysis') expect(container.textContent).toContain('retried-analysis');
      expect(fetcher.mock.calls.some(([url, init]) => url.includes('/body/') || init?.method === 'POST')).toBe(false);
      await act(async () => root.render(<ProxyView locale="en" focusedRequestId={1} />));
      expect(reads).toBe(2); expect(signals).toHaveLength(2);
    } finally { act(() => root.unmount()); }
    expect(signals.every(signal => signal.aborted)).toBe(true);
  });

  it.each(['capture', 'analysis'] as const)('times out a pending local %s, ignores its late result and offers explicit retry', async endpoint => {
    let complete!: (response: Response) => void;
    let signal: AbortSignal | undefined;
    const late = new Promise<Response>(resolve => { complete = resolve; });
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/' + endpoint)) { signal = init?.signal ?? undefined; return late; }
      if (url.endsWith('/original-deletion')) return jsonResponse(null);
      if (url.endsWith('/capture')) return jsonResponse({ request: null, response: null, requestPreviewTruncated: false, responsePreviewTruncated: false, responseHeaders: {} });
      if (/\/requests\/\d+$/.test(url)) return jsonResponse(fullRequest(1));
      if (url.includes('/proxy/requests')) return jsonResponse({ items: [], hasMore: false, nextCursor: null });
      return jsonResponse({ running: false, starting: false, port: null, requestCount: 0, startedAt: null });
    }));
    const container = document.createElement('div'); document.body.appendChild(container); const root = createRoot(container);
    try {
      vi.useFakeTimers();
      await act(async () => root.render(<ProxyView locale="zh" focusedRequestId={1} />));
      if (endpoint === 'analysis') await act(async () => { [...container.querySelectorAll('button')].find(button => button.textContent === '协议分析')!.click(); });
      await act(async () => { await vi.advanceTimersByTimeAsync(5001); });
      expect(signal?.aborted).toBe(true);
      expect(container.querySelector('[role="alert"]')?.textContent).toContain('5 秒');
      expect(container.querySelector('[role="alert"] button')).not.toBeNull();
      await act(async () => { complete(jsonResponse({ model: 'STALE_AFTER_TIMEOUT', responseHeaders: { 'x-late': 'STALE_AFTER_TIMEOUT' } })); await late; });
      expect(container.textContent).not.toContain('STALE_AFTER_TIMEOUT');
    } finally { act(() => root.unmount()); vi.useRealTimers(); }
  });

  it('loads capacity only after opening its drawer, refreshes exactly twice and restores trigger focus on Escape', async () => {
    const capacity = { databaseBytes: 4096, walBytes: 0, combinedLimitBytes: 200_000_000, walLimitBytes: 20_000_000,
      combinedAdmissionBytes: 180_000_000, walAdmissionBytes: 8_000_000, state: 'ready', reason: null, checkedAt: '2026-10-16T00:00:00.000Z' };
    const fetcher = vi.fn(async (url: string) => {
      if (url.endsWith('/capacity')) return jsonResponse(capacity);
      if (url.endsWith('/storage')) return jsonResponse({ quotaBytes: 10, usedBytes: 4, pendingBytes: 0, activeBodies: 0, maxBodyBytes: 10, maxPendingBytes: 10, exhausted: false });
      if (url.includes('/proxy/requests')) return jsonResponse({ items: [], nextCursor: null, hasMore: false });
      return jsonResponse({ running: false, starting: false, port: null, requestCount: 0, startedAt: null });
    }); vi.stubGlobal('fetch', fetcher);
    const container = document.createElement('div'); document.body.appendChild(container); const root = createRoot(container);
    const capacityCalls = () => fetcher.mock.calls.filter(([url]) => url.endsWith('/capacity') || url.endsWith('/storage'));
    try {
      await act(async () => root.render(<ProxyView locale="en" />)); expect(capacityCalls()).toHaveLength(0);
      const trigger = [...container.querySelectorAll('button')].find(button => button.textContent === 'Capture capacity')!;
      await act(async () => { trigger.focus(); trigger.click(); await new Promise(resolve => setTimeout(resolve, 0)); });
      // Flush the real lazy-module import; no component/API logic is mocked.
      await act(async () => { await import('./CaptureCapacityPanel.js'); });
      expect(container.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Capture capacity'); expect(capacityCalls()).toHaveLength(2);
      expect(container.textContent).toContain('Remaining quota (not free disk)');
      const refresh = [...container.querySelectorAll('button')].find(button => button.textContent === 'Refresh capacity snapshot')!;
      await act(async () => refresh.click()); expect(capacityCalls()).toHaveLength(4);
      act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
      expect(container.querySelector('[role="dialog"]')).toBeNull(); expect(document.activeElement).toBe(trigger);
      expect(fetcher).toHaveBeenCalledTimes(6);
    } finally { act(() => root.unmount()); }
  });
  it('invalidates an open capacity snapshot on runtime changes without requests or an overlay stack', async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url.endsWith('/capacity')) return jsonResponse({ databaseBytes: 4096, walBytes: 0, combinedLimitBytes: 200_000_000, walLimitBytes: 20_000_000, combinedAdmissionBytes: 180_000_000, walAdmissionBytes: 8_000_000, state: 'ready', reason: null, checkedAt: '2026-10-16T00:00:00.000Z' });
      if (url.endsWith('/storage')) return jsonResponse({ quotaBytes: 10, usedBytes: 4, pendingBytes: 0, activeBodies: 0, maxBodyBytes: 10, maxPendingBytes: 10, exhausted: false });
      if (url.includes('/proxy/requests')) return jsonResponse({ items: [], nextCursor: null, hasMore: false });
      return jsonResponse({ running: false, starting: false, port: null, requestCount: 0, startedAt: null });
    }); vi.stubGlobal('fetch', fetcher); const container = document.createElement('div'); document.body.appendChild(container); const root = createRoot(container);
    try {
      await act(async () => root.render(<ProxyView locale="en" />));
      await act(async () => { [...container.querySelectorAll('button')].find(button => button.textContent === 'Capture capacity')!.click(); await import('./CaptureCapacityPanel.js'); });
      const before = fetcher.mock.calls.length;
      const refresh = [...container.querySelectorAll('button')].find(button => button.textContent === 'Refresh capacity snapshot')!;
      refresh.focus();
      await act(async () => root.render(<ProxyView locale="en" liveStatus={{ running: true, starting: false, port: 8888 }} />));
      expect(container.textContent).toContain('snapshot may be stale'); expect(fetcher).toHaveBeenCalledTimes(before); expect(container.querySelectorAll('[role="dialog"]')).toHaveLength(1);
      expect(document.activeElement).toBe(refresh);
    } finally { act(() => root.unmount()); }
  });
  it('clears cached diff/body/downloads and rejects late analysis plus stale reopened detail after confirmation', async () => {
    let finishAnalysis!: (value: Response) => void;
    const ref = (id: number) => ({ id, requestId: `req-${id}`, startedAt: '2026-10-16T00:00:00.000Z', hostname: 'synthetic', model: null, captureMethod: 'mitm', parserRoute: null, requestFormat: 'anthropic_messages', parsedSessionId: null, captureGroupId: null, bodySha256: 'a'.repeat(64), bodyBytes: 10 });
    const job = { id: '11111111-1111-4111-8111-111111111111', proxyId: 1, requestId: 'req-1', state: 'complete', error: null, createdAt: '2026-10-16T00:00:00.000Z', updatedAt: '2026-10-16T00:00:00.000Z', completedAt: '2026-10-16T00:00:00.000Z' };
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/original-deletion')) return jsonResponse(init?.method === 'POST' ? job : null);
      if (url.endsWith('/analysis')) return new Promise<Response>(resolve => { finishAnalysis = resolve; });
      if (url.includes('/context-diff')) return jsonResponse({ base: ref(2), target: ref(1), pairing: { confidence: 'manual', reason: 'cached-diff-secret', warnings: [] }, noChange: true,
        growth: { baseChars: 10, targetChars: 10, deltaChars: 0, messageDelta: 0, toolDelta: 0, inputTokenDelta: null, inputTokenDeltaReason: 'usage_missing' }, indicators: [], categories: [], completeness: { complete: true, omittedCount: 0, reasons: [] }, generatedAt: '2026-10-16T00:00:00.000Z', durationMs: 0 });
      if (url.endsWith('/capture')) return jsonResponse({ request: { id: 'request', bytes: 10, sha256: 'a', status: 'complete', error: null }, response: { id: 'response', bytes: 10, sha256: 'b', status: 'complete', error: null }, requestPreviewTruncated: false, responsePreviewTruncated: false, responseHeaders: {} });
      if (/\/proxy\/requests\/\d+$/.test(url)) return jsonResponse({ ...fullRequest(1), requestBody: 'cached-body-secret', requestHeaders: { authorization: 'retained-header' } });
      if (url.includes('/proxy/requests')) return jsonResponse({ items: [fullRequest(1)], nextCursor: null, hasMore: false });
      return jsonResponse({ running: false, starting: false, port: null, requestCount: 1, startedAt: null });
    }); vi.stubGlobal('fetch', fetchMock);
    const container = document.createElement('div'); document.body.appendChild(container); const root = createRoot(container);
    const press = (name: string) => { const button = [...container.querySelectorAll<HTMLElement>('button,[role="tab"]')].find(element => element.textContent === name); if (button === undefined) throw new Error('Missing control: ' + name); button.click(); };
    try {
      await act(async () => { root.render(<ProxyView locale="zh" />); });
      await act(async () => { (container.querySelector('.proxy-table-row') as HTMLElement).click(); });
      expect(container.textContent).toContain('cached-body-secret'); expect(container.querySelector('a[download]')).not.toBeNull();
      await act(async () => press('上下文差异')); expect(container.textContent).toContain('cached-diff-secret');
      await act(async () => press('协议分析')); expect(finishAnalysis).toBeDefined();
      act(() => press('删除此请求正文')); act(() => (container.querySelector('.original-deletion-control input') as HTMLInputElement).click());
      await act(async () => press('确认删除正文')); expect(container.textContent).not.toContain('cached-diff-secret'); expect(container.querySelector('a[download]')).toBeNull();
      await act(async () => { finishAnalysis(jsonResponse({ parserVersion: 1, requestFormat: 'anthropic_messages', model: null, responseId: null, state: 'completed', stopReason: null, system: 'late-analysis-secret', declarations: [], errors: [], items: [], unknownEvents: 0, completeness: { complete: true, omittedCount: 0, reasons: [] }, usage: { inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null, reasoningTokens: null, nativeTotalTokens: null, totalTokens: null, accounting: 'anthropic_separate_cache', snapshots: [] } })); });
      expect(container.textContent).not.toContain('late-analysis-secret');
      act(() => press('Request')); expect(container.textContent).not.toContain('cached-body-secret');
      act(() => press('上下文差异')); expect(fetchMock.mock.calls.filter(([url]) => url.includes('/context-diff'))).toHaveLength(1);
      act(() => press('Headers')); expect(container.textContent).toContain('retained-header');
      act(() => (container.querySelector('.ui-drawer-header button') as HTMLButtonElement).click());
      await act(async () => (container.querySelector('.proxy-table-row') as HTMLElement).click());
      expect(container.textContent).not.toContain('cached-body-secret'); expect(container.querySelector('a[download]')).toBeNull();
    } finally { await act(async () => root.unmount()); }
  });
  it('never flashes a stale body while deletion status is loading or confirms an existing deletion', async () => {
    let finish!: (value: Response) => void;
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      const url = String(input);
      if (url.endsWith('/original-deletion')) return new Promise<Response>(resolve => { finish = resolve; });
      if (url.endsWith('/capture')) return jsonResponse({ request: null, response: null, responseHeaders: {}, requestPreviewTruncated: false, responsePreviewTruncated: false });
      if (/\/proxy\/requests\/\d+$/.test(url)) return jsonResponse({ ...fullRequest(1), requestBody: 'stale-body-never-render' });
      if (url.includes('/proxy/requests')) return jsonResponse({ items: [fullRequest(1)], nextCursor: null, hasMore: false });
      return jsonResponse({ running: false, starting: false, port: null, requestCount: 1, startedAt: null });
    }));
    const container = document.createElement('div'); document.body.appendChild(container); const root = createRoot(container);
    try {
      await act(async () => root.render(<ProxyView locale="zh" />));
      await act(async () => (container.querySelector('.proxy-table-row') as HTMLElement).click());
      expect(container.textContent).not.toContain('stale-body-never-render');
      await act(async () => finish(jsonResponse({ id: 'job-1', proxyId: 1, requestId: 'req-1', state: 'failed', error: 'CAPTURE_STORE_BUSY', createdAt: '2026-10-16T00:00:00.000Z', updatedAt: '2026-10-16T00:00:00.000Z', completedAt: null })));
      expect(container.textContent).not.toContain('stale-body-never-render'); expect(container.textContent).toContain('文件清理失败');
    } finally { await act(async () => root.unmount()); }
  });
  it.each(['completed', 'http_error', 'network_error', 'timeout', 'cancelled', 'interrupted'] as const)('shows independent %s transport evidence without relabelling processing/original retention', async state => {
    const code = state === 'completed' ? null : state === 'http_error' ? 'HTTP_ERROR' : state === 'network_error' ? 'ECONNREFUSED' : state === 'timeout' ? 'ETIMEDOUT' : state === 'cancelled' ? 'CLIENT_DISCONNECTED' : 'PROXY_STOPPED';
    const statusCode = state === 'network_error' ? null : state === 'http_error' ? 429 : 200;
    const fetchMock = vi.fn(async (input: string) => {
      const url = String(input);
      if (url.endsWith('/original-deletion')) return jsonResponse(null);
      if (url.endsWith('/capture')) return jsonResponse({ request: { id: 'original', bytes: 99, sha256: 'original-digest', status: 'complete', error: null }, response: null,
        requestPreviewTruncated: false, responsePreviewTruncated: false, responseHeaders: {}, processing: { version: 1, status: 'ok', error: null },
        transport: { version: 1, state, error: code, requestEnded: true, responseEnded: state === 'completed' || state === 'http_error', statusCode },
      });
      if (/\/proxy\/requests\/\d+$/.test(url)) return jsonResponse({ ...fullRequest(1), responseStatus: statusCode ?? 0 });
      if (url.includes('/proxy/requests')) return jsonResponse({ items: [{ ...fullRequest(1), responseStatus: statusCode ?? 0, hasSystemPrompt: false }], nextCursor: null, hasMore: false });
      return jsonResponse({ running: true, starting: false, port: 8888, requestCount: 1, startedAt: null });
    });
    vi.stubGlobal('fetch', fetchMock);
    const container = render(<ProxyView locale="zh" />);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    await act(async () => { container.querySelector('tbody tr')!.dispatchEvent(new MouseEvent('click', { bubbles: true })); await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(container.textContent).toContain('观测到的网络终态'); expect(container.textContent).toContain('实际上游状态码');
    expect(container.textContent).toContain('解析任务已执行'); expect(container.textContent).toContain('原文已完整保存');
    if (code !== null) expect(container.textContent).toContain(code);
    else expect(container.textContent).toContain('不代表协议或 Agent 成功');
    expect(container.querySelector('a[download]')?.getAttribute('href')).toBe('/api/proxy/requests/1/body/request');
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/body/'))).toBe(false);
  });
  it('distinguishes waiting, capture and draining from idle without a polling request', async () => {
    const diagnostics: ProxyMonitorDiagnostics = {
      phase: 'waiting_for_traffic', runId: 'synthetic-run', cleanupPending: false,
      listening: true, observedRequests: 0, activeRequests: 0, pendingWrites: 0,
      persistedRequests: 0, interruptedRequests: 0, captureErrors: 0,
      lastRequestAt: null, lastError: null,
      resources: { previewBytes: 32768, previewLimitBytes: 33554432, previewCollectors: 1, previewCollectorLimit: 64,
        queuedBytes: 0, queuedByteLimit: 33554432, queuedJobs: 0, queuedJobLimit: 64, workers: 1, workerLimit: 2,
        previewLimitedRequests: 4, processingRejectedRequests: 5, sseClients: 1, slowSseDisconnects: 6 },
    };
    const fetchMock = vi.fn(async (url: string) => String(url).includes('/proxy/requests')
      ? jsonResponse({ items: [], hasMore: false, nextCursor: null })
      : jsonResponse({ running: true, starting: false, port: 7779, requestCount: 23, startedAt: null, diagnostics }));
    vi.stubGlobal('fetch', fetchMock);
    const container = document.createElement('div'); document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => { root.render(<ProxyView locale="zh" />); });
    expect(container.textContent).toContain('等待流量');
    expect(container.textContent).toContain('Agent 接入尚未验证');
    expect(container.textContent).toContain('全局资源');
    expect(container.textContent).toContain('32768/33554432');
    expect(container.textContent).toContain('4 / 5 / 6');
    expect(container.textContent).not.toContain('正在采集');
    const requests = fetchMock.mock.calls.length;
    await act(async () => root.render(<ProxyView locale="zh" liveStatus={{ running: true, starting: false, port: 7779, diagnostics: { ...diagnostics, phase: 'capturing', observedRequests: 1, activeRequests: 1 } }} />));
    expect(container.textContent).toContain('正在采集');
    expect(container.textContent).not.toContain('代理已在运行，等待流量');
    await act(async () => root.render(<ProxyView locale="zh" liveStatus={{ running: true, starting: false, port: 7779, error: 'CAPTURE_PROCESSING_QUEUE_FULL', diagnostics: { ...diagnostics, phase: 'degraded', observedRequests: 1, captureErrors: 1, lastError: 'CAPTURE_PROCESSING_QUEUE_FULL' } }} />));
    expect(container.textContent).toContain('CAPTURE_PROCESSING_QUEUE_FULL');
    expect(container.textContent).not.toContain('PROXY_LOAD_FAILED');
    await act(async () => root.render(<ProxyView locale="zh" liveStatus={{ running: false, starting: false, port: 7779, diagnostics: { ...diagnostics, phase: 'stopping', cleanupPending: true, activeRequests: 1 } }} />));
    expect(container.textContent).toContain('等待连接关闭和原文落盘');
    expect(container.textContent).not.toContain('代理未运行');
    const stop = [...container.querySelectorAll('button')].find(button => button.textContent === '停止代理')!;
    expect(stop.disabled).toBe(true);
    expect([...container.querySelectorAll('button')].filter(button => button.textContent === '启动代理').every(button => button.disabled)).toBe(true);
    await act(async () => root.render(<ProxyView locale="zh" liveStatus={{ running: false, starting: false, port: 7779, diagnostics: { ...diagnostics, phase: 'failed', cleanupPending: true, lastError: 'PROXY_STOP_FAILED' } }} />));
    expect(container.textContent).toContain('PROXY_STOP_FAILED');
    expect([...container.querySelectorAll('button')].find(button => button.textContent === '停止代理')!.disabled).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(requests);
    await act(async () => root.unmount());
  });
  it('keeps the newest focused request when an earlier detail resolves late', async () => {
    let resolveOld!: (value: Response) => void;
    const delayed = new Promise<Response>(resolve => { resolveOld = resolve; });
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      if (input.endsWith('/original-deletion')) return jsonResponse(null);
      if (input === '/api/proxy/requests/1') return delayed;
      if (input === '/api/proxy/requests/2') return jsonResponse({ ...fullRequest(2), url: 'https://new-focus.test/v1/messages' });
      if (input.endsWith('/capture')) return jsonResponse({ proxyId: 2, request: null, response: null, requestPreviewTruncated: false, responsePreviewTruncated: false });
      if (input.startsWith('/api/proxy/requests?')) return jsonResponse({ items: [], hasMore: false, nextCursor: null });
      return jsonResponse({ running: false, starting: false, port: null, requestCount: 0, startedAt: null });
    }));
    const container = document.createElement('div'); document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => { root.render(<ProxyView locale="zh" focusedRequestId={1} />); });
    await act(async () => { root.render(<ProxyView locale="zh" focusedRequestId={2} />); });
    expect(container.textContent).toContain('new-focus.test');
    await act(async () => { resolveOld(jsonResponse({ ...fullRequest(1), url: 'https://old-focus.test/v1/messages' })); await delayed; });
    expect(container.textContent).toContain('new-focus.test');
    expect(container.textContent).not.toContain('old-focus.test');
    await act(async () => { root.unmount(); });
  });
  it('does not lose committed live rows or status when the initial snapshot resolves late', async () => {
    let resolveList: ((value: Response) => void) | undefined;
    const delayedList = new Promise<Response>(resolve => { resolveList = resolve; });
    vi.stubGlobal('fetch', vi.fn(async (input: string) => String(input).includes('/proxy/requests')
      ? delayedList : jsonResponse({ running: false, starting: false, port: null, requestCount: 0, startedAt: null })));
    const container = document.createElement('div'); document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => { root.render(<ProxyView locale="zh" />); });
    const item = { ...fullRequest(7), hostname: 'late-live-row.test' } as unknown as ProxyRequestListItem;
    await act(async () => {
      root.render(<ProxyView locale="zh" liveStatus={{ running: true, starting: false, port: 7779 }} liveUpdates={[{ id: 7, hostname: item.hostname, item, requestCount: 1 }]} />);
    });
    await act(async () => { resolveList!(jsonResponse({ items: [], hasMore: false, nextCursor: null })); await delayedList; });
    expect(container.textContent).toContain('late-live-row.test');
    expect(container.textContent).toContain('代理运行中');
    await act(async () => { root.unmount(); });
  });
  it('does not resurrect cleared rows from the bounded parent live buffer', async () => {
    const oldItem = { ...fullRequest(1), hostname: 'cleared-row.test' } as unknown as ProxyRequestListItem;
    const newItem = { ...fullRequest(2), hostname: 'new-live-row.test' } as unknown as ProxyRequestListItem;
    vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') return jsonResponse({ ok: true });
      return String(input).includes('/proxy/requests') ? jsonResponse({ items: [oldItem], hasMore: false, nextCursor: null })
        : jsonResponse({ running: true, starting: false, port: 7779, requestCount: 1, startedAt: null });
    }));
    const container = document.createElement('div'); document.body.appendChild(container);
    const root = createRoot(container);
    const oldUpdate = { id: 1, hostname: oldItem.hostname, item: oldItem, requestCount: 1 };
    await act(async () => { root.render(<ProxyView locale="zh" liveUpdates={[oldUpdate]} />); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    await act(async () => { [...container.querySelectorAll('button')].find(button => button.textContent === '清空')!.click(); });
    await act(async () => { [...container.querySelectorAll('button')].find(button => button.textContent === '确认')!.click(); await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(container.textContent).not.toContain('cleared-row.test');
    await act(async () => { root.render(<ProxyView locale="zh" liveUpdates={[oldUpdate, { id: 2, hostname: newItem.hostname, item: newItem, requestCount: 1 }]} />); });
    expect(container.textContent).not.toContain('cleared-row.test');
    expect(container.textContent).toContain('new-live-row.test');
    await act(async () => { root.unmount(); });
  });
  it('loads protocol analysis only on activation, escapes evidence and paginates without more requests', async () => {
    const analysis: ProxyProtocolAnalysis = {
      parserVersion: 1, requestFormat: 'openai_chat', model: 'demo', responseId: 'chat-1',
      state: 'completed', stopReason: 'tool_calls', system: null, declarations: [], errors: [],
      unknownEvents: 0, completeness: { complete: false, omittedCount: 0, reasons: ['response:interrupted'] },
      usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 40, cacheWriteTokens: null, reasoningTokens: 5, nativeTotalTokens: 120, totalTokens: 120, accounting: 'openai_subsets', snapshots: [] },
      items: Array.from({ length: 55 }, (_, index) => ({ phase: 'response', kind: 'tool_call', id: 'tool-' + index, callId: 'call-' + index, name: 'shell-' + index, content: '<img src=x onerror=alert(1)>', toolResultIsError: null, index, choiceIndex: 0, complete: true, sourcePath: 'events[' + index + ']' })),
    };
    const fetchMock = vi.fn(async (input: string) => {
      const url = String(input);
      if (url.endsWith('/original-deletion')) return jsonResponse(null);
      if (url.endsWith('/analysis')) return jsonResponse(analysis);
      if (url.endsWith('/capture')) return jsonResponse({ request: null, response: null, requestPreviewTruncated: false, responsePreviewTruncated: false, responseHeaders: {} });
      if (/\/proxy\/requests\/\d+$/.test(url)) return jsonResponse(fullRequest(1));
      if (url.includes('/proxy/requests')) return jsonResponse({ items: [{ ...fullRequest(1), hasSystemPrompt: false }], nextCursor: null, hasMore: false });
      return jsonResponse({ running: true, starting: false, port: 8888, requestCount: 1, startedAt: null });
    });
    vi.stubGlobal('fetch', fetchMock);
    const container = render(<ProxyView locale="zh" />);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    await act(async () => {
      container.querySelector('tbody tr')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/analysis'))).toHaveLength(0);
    await act(async () => {
      [...container.querySelectorAll('[role="tab"]')].find(tab => tab.textContent === '协议分析')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(container.textContent).toContain('openai_subsets');
    expect(container.textContent).toContain('response:interrupted');
    expect(container.querySelectorAll('summary').length).toBe(52);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).not.toContain('shell-54');
    await act(async () => {
      [...container.querySelectorAll('button')].find(button => button.textContent === '下一页')!.click();
    });
    expect(container.textContent).toContain('shell-54');
    expect(container.querySelectorAll('summary').length).toBe(7);
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/analysis'))).toHaveLength(1);
  });
  it.each(['ok', 'decode_error', 'resource_limit'] as const)('shows %s decoded-view provenance separately from unchanged original downloads', async status => {
    const fetchMock = vi.fn(async (input: string) => {
      const url = String(input);
      if (url.endsWith('/original-deletion')) return jsonResponse(null);
      if (url.endsWith('/capture')) return jsonResponse({ request: { id: 'compressed', bytes: 128, sha256: 'encoded-digest', status: 'complete', error: null }, response: null,
        requestPreviewTruncated: false, responsePreviewTruncated: false, responseHeaders: {},
        processing: { version: 1, status, error: status === 'ok' ? null : status === 'decode_error' ? 'INVALID_UTF8' : 'CAPTURE_PREVIEW_BUDGET_EXCEEDED', contentDecoding: { request: 'gzip', response: 'br' }, previewDroppedBytes: { request: 3, response: 5 } },
      });
      if (/\/proxy\/requests\/\d+$/.test(url)) return jsonResponse(fullRequest(1));
      if (url.includes('/proxy/requests')) return jsonResponse({ items: [{ ...fullRequest(1), hasSystemPrompt: false }], nextCursor: null, hasMore: false });
      return jsonResponse({ running: true, starting: false, port: 8888, requestCount: 1, startedAt: null });
    });
    vi.stubGlobal('fetch', fetchMock);
    const container = render(<ProxyView locale="zh" />);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    await act(async () => { container.querySelector('tbody tr')!.dispatchEvent(new MouseEvent('click', { bubbles: true })); await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(container.textContent).toContain('正文是有界解码视图');
    expect(container.textContent).toContain('原始编码字节');
    expect(container.textContent).toContain('原文已完整保存');
    expect(container.textContent).toContain('未纳入语义预览的字节'); expect(container.textContent).toContain('3 / 5');
    if (status === 'resource_limit') {
      expect(container.textContent).toContain('全局预览预算不足'); expect(container.textContent).toContain('CAPTURE_PREVIEW_BUDGET_EXCEEDED');
    }
    if (status === 'decode_error') {
      expect(container.textContent).toContain('编码或流帧解码不完整'); expect(container.textContent).toContain('INVALID_UTF8');
    }
    expect(container.querySelector('a[download]')?.getAttribute('href')).toBe('/api/proxy/requests/1/body/request');
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/body/'))).toBe(false);
  });
  it('shows original completeness, bounded preview and a direct download without fetching the file', async () => {
    const fetchMock = vi.fn(async (input: string) => {
      const url = String(input);
      if (url.endsWith('/original-deletion')) return jsonResponse(null);
      if (url.endsWith('/capture')) return jsonResponse({
        request: { id: 'original', bytes: 104857600, sha256: 'digest', status: 'complete', error: null },
        response: null, requestPreviewTruncated: true, responsePreviewTruncated: false,
        responseHeaders: { 'set-cookie': ['one=original', 'two=original'] },
        processing: { version: 1, status: 'queue_full', error: 'CAPTURE_PROCESSING_QUEUE_FULL' },
      });
      if (/\/proxy\/requests\/\d+$/.test(url)) return jsonResponse(fullRequest(1));
      if (url.includes('/proxy/requests')) return jsonResponse({ items: [{ ...fullRequest(1), hasSystemPrompt: false }], nextCursor: null, hasMore: false });
      return jsonResponse({ running: true, starting: false, port: 8888, requestCount: 1, startedAt: null });
    });
    vi.stubGlobal('fetch', fetchMock);
    const container = render(<ProxyView locale="zh" />);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    await act(async () => {
      container.querySelector('tbody tr')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(container.textContent).toContain('原文已完整保存');
    expect(container.textContent).toContain('解析队列已满');
    expect(container.textContent).toContain('不等于 Agent 失败或原文丢失');
    expect(container.textContent).toContain('CAPTURE_PROCESSING_QUEUE_FULL');
    expect(container.textContent).toContain('此处仅展示预览');
    const link = container.querySelector('a[download]');
    expect(link?.getAttribute('href')).toBe('/api/proxy/requests/1/body/request');
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/body/'))).toBe(false);
    await act(async () => {
      [...container.querySelectorAll('[role="tab"]')].find(tab => tab.textContent === 'Headers')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(container.textContent).toContain('one=original');
    expect(container.textContent).toContain('two=original');
  });

  it('applies committed live rows and running status without refetching the list', async () => {
    const fetchMock = vi.fn(async (input: string) => String(input).includes('/proxy/requests')
      ? jsonResponse({ items: [], nextCursor: null, hasMore: false })
      : jsonResponse({ running: false, starting: false, port: null, requestCount: 0, startedAt: null }));
    vi.stubGlobal('fetch', fetchMock);
    const container = document.createElement('div'); document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => { root.render(<ProxyView locale="zh" />); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    const calls = fetchMock.mock.calls.length;
    const item = fullRequest(7) as unknown as ProxyRequestListItem;
    await act(async () => {
      root.render(<ProxyView locale="zh" liveStatus={{ running: true, starting: false, port: 8888 }} liveUpdates={[{ id: 7, hostname: item.hostname, item, requestCount: 1 }]} />);
    });
    expect(container.textContent).toContain('代理运行中');
    expect(container.textContent).toContain('api.example.com');
    expect(container.textContent).toContain('1 req');
    expect(fetchMock).toHaveBeenCalledTimes(calls);
    act(() => root.unmount());
  });
  it('代理未启动：空态含启动按钮与 CA 安装提示，不是一句「暂无数据」', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('/proxy/requests')) {
          return jsonResponse({ items: [], nextCursor: null, hasMore: false });
        }
        if (String(url).includes('/proxy/status')) {
          return jsonResponse({ running: false, starting: false, port: null, requestCount: 0, startedAt: null });
        }
        return jsonResponse({});
      }),
    );
    const container = render(<ProxyView locale="zh" />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.textContent).toContain('代理未运行');
    expect(container.textContent).toContain('启动代理');
    expect(container.textContent).toContain('下载 CA 证书');
  });

  it('Frida 前置条件空态说明缺什么', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('/frida/status')) {
          return jsonResponse({ running: false, starting: false, pid: null });
        }
        if (String(url).includes('/frida/captures')) {
          return jsonResponse({ items: [], nextCursor: null, hasMore: false });
        }
        return jsonResponse({});
      }),
    );
    const container = render(<FridaView locale="zh" />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.textContent).toContain('Frida 未安装或未找到 Trae 目标进程');
    expect(container.textContent).toContain('macOS 暂不支持');
  });

  it('§7.2 懒加载：打开抽屉在 Request tab 时零 diff 请求；首次激活 Context Diff 只发一次；离开再回不重发', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const u = String(url);
        if (u.endsWith('/original-deletion')) return jsonResponse(null);
        if (u.includes('/proxy/requests') && u.includes('context-diff')) {
          return jsonResponse({
            base: {
              id: 1,
              requestId: 'req-1',
              startedAt: '2026-08-07T00:00:00.000Z',
              hostname: 'api.example.com',
              model: 'claude-sonnet',
              captureMethod: 'mitm',
              parserRoute: '/v1/messages',
              requestFormat: 'anthropic_messages',
              parsedSessionId: null,
              captureGroupId: null,
              bodySha256: 'a'.repeat(64),
              bodyBytes: 10,
            },
            target: {
              id: 2,
              requestId: 'req-2',
              startedAt: '2026-08-07T00:00:00.000Z',
              hostname: 'api.example.com',
              model: 'claude-sonnet',
              captureMethod: 'mitm',
              parserRoute: '/v1/messages',
              requestFormat: 'anthropic_messages',
              parsedSessionId: null,
              captureGroupId: null,
              bodySha256: 'b'.repeat(64),
              bodyBytes: 12,
            },
            pairing: { confidence: 'capture_group', reason: 'same group', warnings: [] },
            noChange: false,
            growth: {
              baseChars: 10,
              targetChars: 20,
              deltaChars: 10,
              messageDelta: 1,
              toolDelta: 0,
              inputTokenDelta: null,
              inputTokenDeltaReason: 'usage_missing',
            },
            indicators: [],
            categories: [
              { category: 'system', added: 0, removed: 0, modified: 0, unchanged: 0, completeness: { complete: true, omittedCount: 0, reasons: [] }, entries: [] },
              { category: 'messages', added: 1, removed: 0, modified: 0, unchanged: 0, completeness: { complete: true, omittedCount: 0, reasons: [] }, entries: [] },
              { category: 'tools', added: 0, removed: 0, modified: 0, unchanged: 0, completeness: { complete: true, omittedCount: 0, reasons: [] }, entries: [] },
              { category: 'parameters', added: 0, removed: 0, modified: 0, unchanged: 0, completeness: { complete: true, omittedCount: 0, reasons: [] }, entries: [] },
            ],
            completeness: { complete: true, omittedCount: 0, reasons: [] },
            generatedAt: '2026-08-07T00:00:01.000Z',
            durationMs: 5,
          });
        }
        if (u.includes('/proxy/requests') && u.match(/\/proxy\/requests\/\d+$/)) {
          return jsonResponse(fullRequest(Number(u.match(/\/proxy\/requests\/(\d+)/)?.[1] ?? 2)));
        }
        if (u.includes('/proxy/requests')) {
          return jsonResponse({
            items: [
              {
                id: 1,
                requestId: 'req-1',
                method: 'POST',
                url: 'https://api.example.com/v1/messages',
                hostname: 'api.example.com',
                responseStatus: 200,
                contentType: 'application/json',
                isStreaming: false,
                startedAt: '2026-08-07T00:00:00.000Z',
                completedAt: null,
                durationMs: 100,
                captureMethod: 'mitm',
                ttnetEncrypted: false,
                systemPromptLen: 0,
                model: 'claude-sonnet',
                inputTokens: null,
                outputTokens: null,
                parsedSessionId: null,
                parserRoute: '/v1/messages',
                captureGroupId: null,
                requestFormat: 'anthropic_messages',
                hasSystemPrompt: false,
              },
            ],
            nextCursor: null,
            hasMore: false,
          });
        }
        if (u.includes('/proxy/status')) {
          return jsonResponse({ running: true, starting: false, port: 8888, requestCount: 1, startedAt: null });
        }
        return jsonResponse({});
      }),
    );
    const container = render(<ProxyView locale="zh" />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    // 打开请求详情抽屉（Request tab）→ 尚无异义 diff 请求。
    const row = container.querySelector('.proxy-table-row');
    expect(row).not.toBeNull();
    const fetchMock = fetch as ReturnType<typeof vi.fn>;
    const callsBeforeDetail = fetchMock.mock.calls.filter((call) => String(call[0]).includes('context-diff')).length;
    expect(callsBeforeDetail).toBe(0);
    await act(async () => {
      (row as HTMLTableRowElement).click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    // 默认仍在 Request tab：依旧零 diff 请求。
    let diffCalls = fetchMock.mock.calls.filter((call) => String(call[0]).includes('context-diff')).length;
    expect(diffCalls).toBe(0);
    // 切换到 Context Diff tab → 恰好一次。
    const contextTab = [...container.querySelectorAll('[role="tab"]')].find((tab) =>
      (tab.textContent ?? '').includes('上下文差异'),
    );
    expect(contextTab).not.toBeUndefined();
    await act(async () => {
      (contextTab as HTMLButtonElement).click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    diffCalls = fetchMock.mock.calls.filter((call) => String(call[0]).includes('context-diff')).length;
    expect(diffCalls).toBe(1);
    // 切回 Request 再回 Context Diff → 缓存命中，仍 1 次。
    const requestTab = [...container.querySelectorAll('[role="tab"]')].find((tab) =>
      (tab.textContent ?? '').includes('Request'),
    );
    await act(async () => {
      (requestTab as HTMLButtonElement).click();
    });
    const contextTab2 = [...container.querySelectorAll('[role="tab"]')].find((tab) =>
      (tab.textContent ?? '').includes('上下文差异'),
    );
    await act(async () => {
      (contextTab2 as HTMLButtonElement).click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    diffCalls = fetchMock.mock.calls.filter((call) => String(call[0]).includes('context-diff')).length;
    expect(diffCalls).toBe(1);
  });
});
