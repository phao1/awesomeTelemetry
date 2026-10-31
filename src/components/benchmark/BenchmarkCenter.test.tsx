import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BenchmarkCenter } from './BenchmarkCenter.js';
import { parseHash, serializeHash } from '../../hash-router.js';
import { demoBenchmarkReport } from '../../core/benchmark-demo.js';
let host: HTMLDivElement, root: Root;
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); vi.stubGlobal('fetch', vi.fn()); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const button = (label: string) => [...host.querySelectorAll('button')].find(b => b.textContent === label)!;
it('opens empty without executing or fetching and routes directly', () => {
  act(() => root.render(<BenchmarkCenter locale="zh"/>));
  expect(host.textContent).toContain('从一份可重复实验开始'); expect(fetch).not.toHaveBeenCalled();
  expect(parseHash(serializeHash({ view: 'benchmark' }))?.view).toBe('benchmark');
});
it('shows synthetic scope, all metrics, repeated statistics and exact evidence selection', () => {
  act(() => root.render(<BenchmarkCenter locale="zh"/>)); act(() => button('查看合成示例').click());
  expect(host.textContent).toContain('不代表 Qoder 或码道的真实表现');
  expect(host.textContent).toContain('平均圈复杂度'); expect(host.textContent).toContain('缓存写入 Token');
  expect(host.textContent).toContain('3/3'); expect(host.textContent).toContain('6/6');
  act(() => button('codearts-1').click());
  expect(host.textContent).toContain('观察到工具错误'); expect(host.textContent).toContain('模型首 Token 偏慢');
  const locate = [...host.querySelectorAll('li')].find(x => x.textContent?.includes('观察到工具错误'))!.querySelector('button')!;
  act(() => locate.click());
  expect(host.querySelector('aside')!.textContent).toContain('test-1');
  expect(host.querySelector('aside')!.textContent).toContain('未提供原始会话定位'); expect(fetch).not.toHaveBeenCalled();
});
it('keeps loaded report and selected evidence across locale changes without IO', () => {
  act(() => root.render(<BenchmarkCenter locale="zh"/>)); act(() => button('查看合成示例').click());
  act(() => root.render(<BenchmarkCenter locale="en"/>));
  expect(host.textContent).toContain('SYNTHETIC'); expect(host.textContent).toContain('Full metric comparison'); expect(fetch).not.toHaveBeenCalled();
});
it('rejects invalid manifest download visibly', () => {
  act(() => root.render(<BenchmarkCenter locale="en"/>));
  const field = host.querySelector('textarea')!;
  act(() => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, '{}'); field.dispatchEvent(new Event('input', { bubbles: true })); });
  act(() => button('Validate and download manifest').click());
  expect(host.querySelector('[role=alert]')!.textContent).toContain('Invalid manifest');
});
it('imports a local validated report with a real FileReader and no network', async () => {
  act(() => root.render(<BenchmarkCenter locale="en"/>));
  const input = host.querySelector('input[type=file]')!;
  const report = demoBenchmarkReport(); report.manifest.name = 'Imported local trial';
  Object.defineProperty(input, 'files', { configurable: true, value: [new File([JSON.stringify(report)], 'report.json', { type: 'application/json' })] });
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); await new Promise(resolve => setTimeout(resolve, 40)); });
  expect(host.textContent).toContain('Imported local trial'); expect(host.querySelector('[role=alert]')).toBeNull(); expect(fetch).not.toHaveBeenCalled();
});
it('rejects a malformed report visibly instead of treating it as empty success', async () => {
  act(() => root.render(<BenchmarkCenter locale="en"/>));
  const input = host.querySelector('input[type=file]')!;
  Object.defineProperty(input, 'files', { configurable: true, value: [new File(['{"version":999}'], 'bad.json')] });
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); await new Promise(resolve => setTimeout(resolve, 40)); });
  expect(host.querySelector('[role=alert]')!.textContent).toContain('Invalid report');
  expect(host.textContent).toContain('Start with a reproducible experiment');
});
it('exports every report field as JSON and reimports the same file without network', async () => {
  let emitted: Blob | undefined, filename = '';
  const revoked = vi.fn();
  vi.stubGlobal('URL', class extends URL {
    static override createObjectURL(blob: Blob) { emitted = blob; return 'blob:benchmark-export'; }
    static override revokeObjectURL = revoked;
  });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { filename = this.download; });
  try {
    act(() => root.render(<BenchmarkCenter locale="en"/>));
    act(() => button('View synthetic example').click());
    act(() => button('Export report').click());
    expect(filename).toBe('benchmark-report.json'); expect(emitted!.type).toBe('application/json');
    const text = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsText(emitted!);
    });
    expect(JSON.parse(text)).toEqual(demoBenchmarkReport());
    act(() => root.render(<BenchmarkCenter key="reimport" locale="en"/>));
    expect(host.textContent).toContain('Start with a reproducible experiment');
    const input = host.querySelector('input[type=file]')!;
    Object.defineProperty(input, 'files', { configurable: true, value: [new File([emitted!], filename)] });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); await new Promise(resolve => setTimeout(resolve, 40)); });
    expect(host.textContent).toContain('6/6'); expect(host.querySelector('[role=alert]')).toBeNull(); expect(fetch).not.toHaveBeenCalled();
  } finally {
    await new Promise(resolve => setTimeout(resolve, 1100));
    click.mockRestore();
  }
  expect(revoked).toHaveBeenCalledExactlyOnceWith('blob:benchmark-export');
});
it('runs the configured three-repeat example only on click and loads the returned report', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: async () => JSON.stringify(demoBenchmarkReport()) })));
  act(() => root.render(<BenchmarkCenter locale="en"/>)); expect(fetch).not.toHaveBeenCalled();
  expect(host.querySelector<HTMLSelectElement>('.benchmark-setup select')!.value).toBe('3');
  await act(async () => { button('Run example benchmark (6 trials)').click(); for (let i = 0; i < 8; i++) await Promise.resolve(); });
  expect(fetch).toHaveBeenCalledTimes(1);
  const [path, init] = vi.mocked(fetch).mock.calls[0]!;
  expect(path).toBe('/api/benchmarks/demo'); expect(JSON.parse(String(init!.body))).toMatchObject({ repetitions: 3, variants: [{ product: 'Qoder GUI' }, { product: 'CodeArts GUI' }] });
  expect(host.textContent).toContain('Completed 6 example runs.'); expect(host.textContent).toContain('Full metric comparison');
});
it('cancels example ownership and never accepts a late completed response', async () => {
  let finish: ((response: Response) => void) | undefined;
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
  act(() => root.render(<BenchmarkCenter locale="en"/>)); act(() => button('Run example benchmark (6 trials)').click());
  act(() => button('Cancel').click());
  expect(host.querySelector('[role=alert]')!.textContent).toContain('requested cancellation');
  await act(async () => { finish!({ ok: true, text: async () => JSON.stringify(demoBenchmarkReport()) } as Response); for (let i = 0; i < 8; i++) await Promise.resolve(); });
  expect(host.textContent).not.toContain('Full metric comparison');
});
