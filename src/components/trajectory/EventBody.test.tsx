import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { EventBody, readableContent } from './EventBody.js';

describe('event body reading', () => {
  it('unwraps real Codex text blocks and command result envelopes without losing exit evidence', () => {
    const native = JSON.stringify([{ type: 'input_text', text: 'Script completed\nOutput:' }, { type: 'input_text', text: JSON.stringify({ exit_code: 1, wall_time_seconds: 4.5, output: 'first\nError: missing file' }) }]);
    expect(readableContent(native)).toBe('Script completed\nOutput:\n\nexit_code: 1 · wall_time_seconds: 4.5\nfirst\nError: missing file');
  });
  it('renders prose headings, emphasis and fenced code safely; source remains unchanged', () => {
    const text = '## Result\n**Failed** on `a.ts`\n```sh\nrm <script>\n```';
    const html = renderToStaticMarkup(<EventBody text={text} prose />);
    expect(html).toContain('<h4>Result</h4>');
    expect(html).toContain('<strong>Failed</strong>');
    expect(html).toContain('<code>a.ts</code>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(text).toContain('## Result');
  });
  it('keeps malformed and oversized output intact', () => {
    expect(readableContent('{bad')).toBe('{bad');
    const large = JSON.stringify({ output: 'x'.repeat(100001), exit_code: 1 });
    expect(readableContent(large)).toBe(large);
    expect(readableContent(JSON.stringify([{ type: 'image', image_url: 'private' }]))).toBe('[image]');
  });
});
