import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import type { CaptureNetworkTiming } from '../core/trace-types.js';
import { CaptureTimingPanel } from './CaptureTimingPanel.js';

const timing: CaptureNetworkTiming = { version: 1, clock: 'proxy_monotonic', responseHeadersMs: 100, firstBodyByteMs: 150, firstContentMs: 800,
  firstContentKind: 'reasoning', firstContentBasis: 'sse_event_dispatch', completedMs: 2000, contentTimingStatus: 'observed', serverTiming: '<img src=x onerror=alert(1)>;dur=12', serverTimingTruncated: false };
function render(value: CaptureNetworkTiming | undefined, locale: 'zh' | 'en' = 'zh'): { text: string; images: number } {
  const container = document.createElement('div'); const root = createRoot(container);
  act(() => root.render(<CaptureTimingPanel timing={value} locale={locale} />));
  const result = { text: container.textContent!, images: container.querySelectorAll('img').length };
  act(() => root.unmount()); return result;
}
describe('capture timing evidence', () => {
  it('separates headers, first byte/content and end; vendor content is inert text', () => {
    const result = render(timing);
    for (const text of ['100 ms', '150 ms', '800 ms', '2000 ms', 'SSE', 'reasoning', timing.serverTiming!]) expect(result.text).toContain(text);
    expect(result.images).toBe(0);
  });
  it('keeps legacy missing timing and genuine zero distinct', () => {
    expect(render(undefined).text).toContain('旧记录未知');
    const result = render({ ...timing, firstContentMs: 0, responseHeadersMs: 0 });
    expect(result.text).toContain('0 ms'); expect(result.text).not.toContain('旧记录未知');
  });
  it('labels JSON document completion and encoded/unavailable content without substituting end', () => {
    const json = render({ ...timing, firstContentBasis: 'json_document_complete' }, 'en');
    expect(json.text).toContain('not streaming first token');
    const encoded = render({ ...timing, firstContentMs: null, firstContentKind: null, firstContentBasis: null, contentTimingStatus: 'unsupported_encoding', serverTimingTruncated: true });
    expect(encoded.text).toContain('当前编码不支持'); expect(encoded.text).toContain('完整原值请查看 Headers');
    expect(encoded.text.match(/2000 ms/g)).toHaveLength(1);
  });
});
