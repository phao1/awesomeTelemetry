import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { CaptureBodyText } from './CaptureBodyText.js';

it('bounds UTF-8 preview without splitting emoji, expands only retained text and applies text-only font controls', () => {
  const container = document.createElement('div');document.body.appendChild(container);const root = createRoot(container);
  const text = '字😀'.repeat(20_000) + '<script>INERT_SOURCE</script>';
  try {
    act(() => root.render(<CaptureBodyText value={text} locale="en" />));
    const pre = container.querySelector('pre')!;
    expect(new TextEncoder().encode(pre.textContent!).length).toBeLessThanOrEqual(65536);
    expect(pre.textContent).not.toContain('\ufffd');expect(pre.textContent).not.toContain('INERT_SOURCE');
    const button = (label: string) => [...container.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === label)!;
    act(() => button('Expand retained field').click());expect(pre.textContent).toBe(text);expect(container.querySelector('script')).toBeNull();
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Increase body text"]')!.click());expect(pre.style.fontSize).toBe('15px');
    act(() => button('R').click());expect(pre.style.fontSize).toBe('14px');
    act(() => root.render(<CaptureBodyText value="changed-field" locale="zh" />));expect(pre.textContent).toBe('changed-field');
  } finally { act(() => root.unmount());container.remove(); }
});

it('does not confuse a missing preview with a retained empty field', () => {
  const container = document.createElement('div');document.body.appendChild(container);const root = createRoot(container);
  try {
    act(() => root.render(<CaptureBodyText value={null} locale="en" />));expect(container.textContent).toContain('No retained readable preview');
    act(() => root.render(<CaptureBodyText value="" locale="en" />));expect(container.textContent).toContain('retained readable field is empty');expect(container.textContent).not.toContain('No retained readable preview');
  } finally { act(() => root.unmount());container.remove(); }
});
