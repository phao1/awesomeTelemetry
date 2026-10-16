import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FridaView } from './FridaView.js';
import { ProxyView } from './ProxyView.js';
import type { ProxyProtocolAnalysis, ProxyRequestListItem, ProxyMonitorDiagnostics } from '../core/trace-types.js';

function render(node: React.JSX.Element): HTMLDivElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    createRoot(container).render(node);
  });
  return container;
}

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

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('REQ-020/021 代理与 Frida 视图', () => {
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
      items: Array.from({ length: 55 }, (_, index) => ({ phase: 'response', kind: 'tool_call', id: 'tool-' + index, callId: 'call-' + index, name: 'shell-' + index, content: '<img src=x onerror=alert(1)>', index, choiceIndex: 0, complete: true, sourcePath: 'events[' + index + ']' })),
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
