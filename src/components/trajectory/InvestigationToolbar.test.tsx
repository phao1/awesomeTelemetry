import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InvestigationToolbar } from './InvestigationToolbar.js';
import { makeMessage, makeModel } from './investigation-test-fixtures.js';

const mounted: Array<{ root: ReturnType<typeof createRoot>; host: HTMLDivElement }> = [];
afterEach(() => { act(() => { for (const {root,host} of mounted.splice(0)) { root.unmount(); host.remove(); } }); vi.unstubAllGlobals(); });
function mount(model = makeModel([makeMessage()])) {
  const inspect = vi.fn(); const focus = vi.fn(); const agents = vi.fn();
  function Harness() {
    const [selected, select] = useState<string | null>(null);
    return <InvestigationToolbar model={model} locale="zh" selectedEventId={selected}
      onInspect={id => { inspect(id); select(id); }} agentsOpen={false} onToggleAgents={agents} focused={false} onToggleFocus={focus} />;
  }
  const host = document.createElement('div'); document.body.appendChild(host);
  const root = createRoot(host); mounted.push({root,host}); act(() => root.render(<Harness />));
  return { host, inspect, focus, agents };
}
function type(host: HTMLElement, value: string) {
  const input = host.querySelector('input')!;
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', {bubbles:true})); });
}
function button(host: HTMLElement, text: string): HTMLButtonElement {
  return Array.from(host.querySelectorAll('button')).find(node => node.textContent?.includes(text))!;
}

describe('WB-002 loaded-operation investigation', () => {
  it('searches title, tool and opaque ID without fetching bodies or exposing a second index', () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const {host,inspect} = mount(makeModel([makeMessage('opaque-keep', 1),makeMessage('other', 2, {title:'Run verification',tool:'Bash'})]));
    expect(host.querySelector('.investigation-search-results')).toBeNull();
    type(host, 'opaque-keep');
    expect(host.querySelectorAll('.investigation-result')).toHaveLength(1);
    act(() => (host.querySelector('.investigation-result') as HTMLButtonElement).click());
    expect(inspect).toHaveBeenCalledExactlyOnceWith('opaque-keep');
    expect(host.querySelector('.investigation-search-results')).toBeNull();
    expect((host.querySelector('input') as HTMLInputElement).value).toBe('opaque-keep');
    type(host, 'Bash'); expect(host.querySelector('.investigation-result')?.textContent).toContain('Run verification');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('caps results at20 while accurately reporting loaded matches', () => {
    const {host} = mount(makeModel(Array.from({length:101},(_,i)=>makeMessage(`match-${i}`,i+1))));
    type(host,'match-');
    expect(host.querySelectorAll('.investigation-result')).toHaveLength(20);
    expect(host.querySelector('[role="status"]')?.textContent).toContain('101 条匹配');
  });
  it('cycles directly through explicit error records and can filter their metadata', () => {
    const {host,inspect} = mount(makeModel([makeMessage('ok'),makeMessage('failed',2,{status:'error'}),makeMessage('error-summary',3,{error:'Read failed'})]));
    act(() => button(host,'下一条错误').click()); act(() => button(host,'下一条错误').click()); act(() => button(host,'下一条错误').click());
    expect(inspect.mock.calls).toEqual([['failed'],['error-summary'],['failed']]);
    act(() => button(host,'错误线索').click());
    expect(host.querySelectorAll('.investigation-result')).toHaveLength(2);
  });
  it('labels the longest retained interval without claiming measured model latency', () => {
    const {host,inspect} = mount(makeModel([makeMessage('short'),makeMessage('gap',2,{durationMs:9000})]));
    expect(button(host,'最长记录区间').textContent).toContain('9.0s');
    expect(host.textContent).toContain('不等于模型实际延迟');
    act(() => button(host,'最长记录区间').click()); expect(inspect).toHaveBeenCalledExactlyOnceWith('gap');
  });
  it('keeps incomplete scope and empty loaded results explicit', () => {
    const {host} = mount(makeModel([makeMessage()],false));
    expect(host.textContent).toContain('还有 7 条事件未加载'); type(host,'not-retained');
    expect(host.textContent).toContain('已加载操作中没有匹配项');
    expect(button(host,'下一条错误').disabled).toBe(true);
  });
  it('exposes reading focus and agent context without opening analysis', () => {
    const {host,focus,agents} = mount();
    act(() => button(host,'专注阅读').click());
    act(() => button(host,'Agent').click());
    expect(focus).toHaveBeenCalledTimes(1); expect(agents).toHaveBeenCalledTimes(1);
  });
});
