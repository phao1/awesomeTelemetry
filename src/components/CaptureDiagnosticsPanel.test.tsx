import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CaptureDiagnosticsPanel } from './CaptureDiagnosticsPanel.js';
import type { CaptureComparisonResponse } from '../core/trace-types.js';

function fixture(): CaptureComparisonResponse {
  const side = (id: number): CaptureComparisonResponse['base'] => ({
    request: { id, requestId: 'req-' + id, method: 'POST', url: 'https://synthetic.test/v1/messages', hostname: 'synthetic.test',
      responseStatus: 200, contentType: 'text/event-stream', isStreaming: true, startedAt: '2026-10-16T00:00:00.000Z', completedAt: '2026-10-16T00:00:12.000Z', durationMs: 12000,
      captureMethod: 'mitm', ttnetEncrypted: false, systemPromptLen: 0, model: 'synthetic-model', inputTokens: null, outputTokens: null,
      parsedSessionId: null, parserRoute: '/v1/messages', captureGroupId: null, requestFormat: 'anthropic_messages', hasSystemPrompt: false },
    evidence: { request: { id: 'body-' + id, status: 'complete', bytes: 128, sha256: 'a'.repeat(64), error: null }, response: null,
      requestPreviewTruncated: false, responsePreviewTruncated: false,
      transport: { version: 1, state: 'completed', error: null, requestEnded: true, responseEnded: true, statusCode: 200,
        timing: { version: 1, clock: 'proxy_monotonic', responseHeadersMs: 100, firstBodyByteMs: 150, firstContentMs: 11000,
          firstContentKind: 'text', firstContentBasis: 'sse_event_dispatch', completedMs: 12000, contentTimingStatus: 'observed', serverTiming: null, serverTimingTruncated: false } } },
    originalDeletion: null, analysis: null, analysisUnavailableReason: 'analysis_unavailable',
  });
  return { base: side(1), target: side(2), generatedAt: '2026-10-16T00:00:13.000Z' };
}
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let fetcher: ReturnType<typeof vi.fn>;
const openRequest = vi.fn();
const render = async (data = fixture(), locale: 'en' | 'zh' = 'en') => act(async () => root.render(<CaptureDiagnosticsPanel data={data} locale={locale} onOpenRequest={openRequest} />));
const setThreshold = async (value: string) => act(async () => {
  const input = container.querySelector('input')!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
});
beforeEach(() => {
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); openRequest.mockClear();
  fetcher = vi.fn(() => { throw new Error('Diagnostics must not perform IO'); }); vi.stubGlobal('fetch', fetcher);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

describe('local selected-pair diagnostics', () => {
  it('uses the visible default threshold and real pure derivation, with at most five source-linked findings and no IO', async () => {
    await render(); expect(container.querySelector('input')?.value).toBe('10000');
    expect(container.querySelector('[data-effective-threshold]')?.textContent).toContain('10000 ms');
    expect(container.querySelectorAll('[data-diagnostic-finding]')).toHaveLength(5);
    expect(container.querySelectorAll('[data-diagnostic-finding="slow_network"]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-diagnostic-finding="slow_first_content"]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-diagnostic-finding="repeated_encoded_request"]')).toHaveLength(1);
    expect(container.textContent).toContain('Derived finding'); expect(container.textContent).toContain('not pure model inference');
    expect(container.textContent).toContain('does not prove headers'); expect(container.textContent).toContain('Context Diff');
    expect(container.textContent).toContain('cache'); expect(container.textContent).toContain('tool-error');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('updates the effective threshold and findings locally, preserving genuine threshold equality', async () => {
    await render(); await setThreshold('11000');
    expect(container.querySelector('[data-effective-threshold]')?.textContent).toContain('11000 ms');
    expect(container.querySelectorAll('[data-diagnostic-finding]')).toHaveLength(5);
    await setThreshold('12000'); expect(container.querySelectorAll('[data-diagnostic-finding="slow_network"]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-diagnostic-finding="slow_first_content"]')).toHaveLength(0);
    await setThreshold('3600000'); expect(container.querySelectorAll('[data-diagnostic-finding]')).toHaveLength(1);
    await setThreshold('1'); expect(container.querySelectorAll('[data-diagnostic-finding]')).toHaveLength(5);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(['', '0', '-1', '1.1', '1e3', '3600001', '9007199254740992', 'NaN'])('hides findings and declares no active threshold rather than silently using a fallback for %j', async input => {
    await render(); await setThreshold(input);
    expect(container.querySelector('input')?.getAttribute('aria-invalid')).toBe('true');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('1–3600000');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('no fallback');
    expect(container.querySelector('[data-effective-threshold]')?.textContent).toContain('none');
    expect(container.querySelectorAll('[data-diagnostic-finding]')).toHaveLength(0);
    await setThreshold('10000'); expect(container.querySelector('[role="alert"]')).toBeNull(); expect(container.querySelectorAll('[data-diagnostic-finding]')).toHaveLength(5);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(['missing', 'deleted', 'incomplete'] as const)('keeps %s request evidence unavailable instead of inferring a retry or no retry', async kind => {
    const data = fixture();
    if (kind === 'missing') data.target.evidence.request = null;
    if (kind === 'incomplete') data.target.evidence.request!.status = 'interrupted';
    if (kind === 'deleted') data.target.originalDeletion = { id: 'job', proxyId: 2, requestId: 'req-2', state: 'failed', error: 'CAPTURE_STORE_BUSY', createdAt: data.generatedAt, updatedAt: data.generatedAt, completedAt: null };
    await render(data);
    expect(container.querySelector('[data-repeat-state]')?.textContent).toContain('Unknown');
    expect(container.querySelector('[data-repeat-state]')?.textContent).toContain('missing, deleted or incomplete');
    expect(container.querySelector('[data-diagnostic-finding="repeated_encoded_request"]')).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('labels different encoded evidence without equating it with no retry', async () => {
    const data = fixture(); data.target.evidence.request!.sha256 = 'b'.repeat(64); await render(data);
    expect(container.querySelector('[data-repeat-state]')?.textContent).toContain('does not match');
    expect(container.querySelector('[data-repeat-state]')?.textContent).toContain('Retry status remains unknown');
    expect(container.querySelector('[data-diagnostic-finding="repeated_encoded_request"]')).toBeNull();
  });
  it('shows exact source paths/values and safe original-capture callbacks while escaping observed identity text', async () => {
    const data = fixture(); data.base.request.requestId = '<img src=x onerror=alert(1)>'; await render(data);
    const first = container.querySelector('[data-diagnostic-finding="slow_network"]')!;
    const details = first.querySelector('details')!; expect(details.open).toBe(false);
    act(() => { details.open = true; });
    expect(first.textContent).toContain('base.evidence.transport.timing.completedMs'); expect(first.textContent).toContain('12000');
    expect(container.textContent).toContain('a'.repeat(64)); expect(container.textContent).toContain('base.evidence.request.bytes');
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>'); expect(container.querySelector('img')).toBeNull();
    act(() => (first.querySelector('button') as HTMLButtonElement).click()); expect(openRequest).toHaveBeenLastCalledWith(1);
    const target = [...container.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Open target capture #2')!;
    act(() => target.click()); expect(openRequest).toHaveBeenLastCalledWith(2); expect(fetcher).not.toHaveBeenCalled();
  });
  it('keeps missing timing unknown, does not substitute duration, and explains absent findings', async () => {
    const data = fixture();
    for (const side of [data.base, data.target]) { side.evidence.transport = undefined; side.evidence.request = null; side.request.durationMs = 999999; }
    await render(data); expect(container.querySelectorAll('[data-diagnostic-finding]')).toHaveLength(0);
    expect(container.textContent).toContain('No supported finding'); expect(container.textContent).toContain('unknown, not zero or evidence of a fast call');
    expect(container.textContent).not.toContain('999999'); expect(fetcher).not.toHaveBeenCalled();
  });
  it('switches language without losing the active threshold or requesting evidence', async () => {
    const data = fixture(); await render(data); await setThreshold('12000'); await render(data, 'zh');
    expect(container.querySelector('input')?.value).toBe('12000'); expect(container.textContent).toContain('当前生效阈值');
    expect(container.textContent).toContain('推导提示'); expect(container.textContent).toContain('不证明');
    expect(container.querySelectorAll('[data-diagnostic-finding="slow_first_content"]')).toHaveLength(0); expect(fetcher).not.toHaveBeenCalled();
  });
});
