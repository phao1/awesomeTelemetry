import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SessionIndexEntry } from '../core/trace-types.js';
import { CompareBoard } from './CompareBoard.js';
import { makeDetail, makeEvent, makeResult } from './compare-test-fixtures.js';

const containers: HTMLDivElement[] = [];

function mount(node: React.ReactNode): { unmount: () => void; html: () => string; render: (node:React.ReactNode)=>void } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  containers.push(container);
  const root = createRoot(container);
  act(() => {
    root.render(node);
  });
  return {
    unmount: () => {
      root.unmount();
    },
    html: () => container.innerHTML,
    render: node => act(()=>root.render(node)),
  };
}

afterEach(() => {
  vi.restoreAllMocks(); vi.useRealTimers();
  while (containers.length > 0) {
    const container = containers.pop();
    if (container !== undefined) {
      container.remove();
    }
  }
});

const baseProps = {
  sessions: [] as SessionIndexEntry[],
  locale: 'zh' as const,
  leftKey: '',
  rightKey: '',
  onLeftChange: () => undefined,
  onRightChange: () => undefined,
};

describe('CompareBoard 壳（REQ-019 / 可用性）', () => {
  it('WB-003: detail table uses readable labels, complete step ratios and no winner badges for partial activity',async()=>{
    const left=makeDetail('left',[
      makeEvent({id:'prompt',kind:'user_prompt'}),makeEvent({id:'verify',phase:'verify'}),makeEvent({id:'step',status:'unknown'}),
    ]);
    const result=makeResult({left,right:{...makeResult().right,hasMore:true,eventTotal:50}});
    const view=mount(<CompareBoard {...baseProps} locale="en" leftKey="left" rightKey="right" loadCompare={async()=>result}/>);
    try {
      await act(async()=>{for(let i=0;i<5;i++)await Promise.resolve();});
      act(()=>document.querySelector<HTMLButtonElement>('#compare-metrics > button')!.click());
      const rows=[...document.querySelectorAll('.cmp-detail-table tbody tr')];
      const verification=rows.find(row=>row.querySelector('td')?.textContent==='Verification activity / steps')!;
      expect(verification).toBeDefined();expect(verification.querySelectorAll('td')[1]?.textContent).toBe('50.0%');
      expect(verification.querySelectorAll('td')[2]?.textContent).toBe('—');
      const errors=rows.find(row=>row.querySelector('td')?.textContent==='Error steps / steps')!;
      expect(errors.querySelectorAll('td')[1]?.textContent).toBe('—');
      expect(document.querySelector('.cmp-detail-table .compare-delta-badge')).toBeNull();
      const all=document.querySelector<HTMLButtonElement>('.compare-table-wrap .compare-fold');
      if(all)act(()=>all.click());
      expect(document.querySelector('[data-compare-metric="token.cacheWrite"]')).not.toBeNull();
      expect(view.html()).toContain('Cache write');
    } finally {act(()=>view.unmount());}
  });
  it('WB-002: KPI evidence forwards the exact retained right run/event without another comparison read', async () => {
    const onOpenRun=vi.fn();
    const result=makeResult({right:makeDetail('right',[makeEvent({id:'opaque-right-error',status:'error',title:'Inspect right error'})])});
    const load=vi.fn(async()=>result);
    const view=mount(<CompareBoard {...baseProps} locale="en" leftKey="left" rightKey="right" loadCompare={load} onOpenRun={onOpenRun}/>);
    try {
      await act(async()=>{for(let i=0;i<5;i++)await Promise.resolve();});
      const failures=[...document.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.getAttribute('aria-label')==='Failures click to expand breakdown')!;
      expect(failures).toBeDefined();act(()=>failures.click());
      const link=document.querySelector<HTMLButtonElement>('[data-evidence-session="right"][data-evidence-event="opaque-right-error"]')!;
      expect(link).not.toBeNull();act(()=>link.click());
      expect(onOpenRun).toHaveBeenCalledExactlyOnceWith('right','opaque-right-error');expect(load).toHaveBeenCalledTimes(1);
    } finally {act(()=>view.unmount());}
  });
  it('WB-003: locale/parent rerenders do not refetch; cancellation leaves an explicit retry state',async()=>{
    const signals:AbortSignal[]=[];
    const load=vi.fn((_l:string,_r:string,signal?:AbortSignal)=>{if(signal)signals.push(signal);return new Promise<ReturnType<typeof makeResult>>(()=>undefined);});
    const view=mount(<CompareBoard {...baseProps} leftKey="left" rightKey="right" loadCompare={load}/>);
    try {
      view.render(<CompareBoard {...baseProps} locale="en" leftKey="left" rightKey="right" sessions={[]} loadCompare={(l,r,s)=>load(l,r,s)}/>);
      expect(load).toHaveBeenCalledTimes(1);
      const cancel=Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(b=>b.textContent==='Cancel read')!;
      act(()=>cancel.click());expect(signals[0]?.aborted).toBe(true);expect(view.html()).toContain('COMPARE_CANCELLED');
      await act(async()=>{for(let i=0;i<5;i++)await Promise.resolve();});expect(load).toHaveBeenCalledTimes(1);
      act(()=>document.querySelector<HTMLButtonElement>('.ui-error button')!.click());expect(load).toHaveBeenCalledTimes(2);
    } finally {act(()=>view.unmount());expect(signals.at(-1)?.aborted).toBe(true);}
  });

  it('WB-003: explicit reload removes the previous pair conclusions while a fresh read is pending',async()=>{
    const load=vi.fn().mockResolvedValueOnce(makeResult()).mockReturnValue(new Promise(()=>undefined));
    const view=mount(<CompareBoard {...baseProps} leftKey="left" rightKey="right" loadCompare={load}/>);
    try {
      await act(async()=>{for(let i=0;i<5;i++)await Promise.resolve();});expect(view.html()).toContain('compare-hero');
      act(()=>document.querySelector<HTMLButtonElement>('.compare-bar > button')!.click());
      expect(load).toHaveBeenCalledTimes(2);expect(view.html()).not.toContain('compare-hero');expect(view.html()).not.toContain('compare-verdict');
    } finally {act(()=>view.unmount());}
  });

  it('WB-003: picker focuses search, distinguishes no matches and preserves a filtered-out selected ID',()=>{
    const row:SessionIndexEntry={id:'scope-1',provider:'codearts',sourceAgent:'CodeArts',title:'SYNTHETIC_LONG_TITLE',startedAt:'2026-10-17T00:00:00.000Z',updatedAt:'2026-10-17T00:01:00.000Z',status:'success',cwd:null,eventCount:7,messageCount:3,tokenTotal:10,costUsd:0,dataSource:'scan',sourcePath:'/tmp/synthetic.json',detailLoaded:true,mergeGroupId:null,hasSystemPrompt:false,tags:[]};
    const select=vi.fn();const view=mount(<CompareBoard {...baseProps} locale="en" sessions={[row]} leftKey="selected-outside-scope" onLeftChange={select}/>);
    try {
      const trigger=document.querySelector<HTMLButtonElement>('.compare-picker')!;
      expect(trigger.textContent).toContain('selected-outside-scope');
      act(()=>trigger.click());const input=document.querySelector<HTMLInputElement>('[aria-label="L Search loaded runs, provider or ID"]')!;
      expect(document.activeElement).toBe(input);
      act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'SYNTHETIC_NO_MATCH');input.dispatchEvent(new Event('input',{bubbles:true}));});
      expect(view.html()).toContain('No matching loaded run');
      act(()=>document.querySelector<HTMLButtonElement>('.ui-input-clear button')!.click());expect(document.activeElement).toBe(input);
      act(()=>document.querySelector<HTMLButtonElement>('.compare-picker-item')!.click());expect(select).toHaveBeenCalledExactlyOnceWith('scope-1');
      expect(document.activeElement).toBe(trigger);
      act(()=>trigger.click());expect(document.querySelector<HTMLInputElement>('[aria-label="L Search loaded runs, provider or ID"]')?.value).toBe('');
    } finally {act(()=>view.unmount());}
  });
  it('WB-003: a failed pair read never retries itself; explicit retry owns a single new request',async()=>{
    const failure=vi.spyOn(console,'error').mockImplementation(()=>undefined);
    let rejectFirst!:(error:Error)=>void;
    const first=new Promise<ReturnType<typeof makeResult>>((_,reject)=>{rejectFirst=reject;});
    const load=vi.fn().mockReturnValueOnce(first).mockReturnValue(new Promise(()=>undefined));
    const view=mount(<CompareBoard {...baseProps} leftKey="left" rightKey="right" loadCompare={load}/>);
    try {
      expect(load).toHaveBeenCalledTimes(1);
      await act(async()=>{rejectFirst(new Error('SYNTHETIC_COMPARISON_FAILURE'));for(let i=0;i<10;i++)await Promise.resolve();});
      expect(load).toHaveBeenCalledTimes(1);
      expect(view.html()).toContain('SYNTHETIC_COMPARISON_FAILURE');
      const retry=document.querySelector<HTMLButtonElement>('.ui-error button')!;
      act(()=>retry.click());expect(load).toHaveBeenCalledTimes(2);
    } finally {act(()=>view.unmount());failure.mockRestore();}
  });

  it('WB-003: switching pair aborts old ownership and late results cannot replace the new selection',async()=>{
    let resolveFirst!:(value:ReturnType<typeof makeResult>)=>void;
    const first=new Promise<ReturnType<typeof makeResult>>(resolve=>{resolveFirst=resolve;});
    const calls:AbortSignal[]=[];
    const load=vi.fn((_l:string,_r:string,signal?:AbortSignal)=>{if(signal)calls.push(signal);return calls.length===1?first:new Promise<ReturnType<typeof makeResult>>(()=>undefined);});
    const view=mount(<CompareBoard {...baseProps} leftKey="left" rightKey="right" loadCompare={load}/>);
    try {
      view.render(<CompareBoard {...baseProps} leftKey="new-left" rightKey="new-right" loadCompare={load}/>);
      expect(load).toHaveBeenCalledTimes(2);
      expect(calls[0]?.aborted).toBe(true);
      await act(async()=>{resolveFirst(makeResult());for(let i=0;i<5;i++)await Promise.resolve();});
      expect(view.html()).not.toContain('compare-hero');
    } finally {act(()=>view.unmount());}
  });

  it('WB-003: a stalled read times out once, aborts, and never restores a late result',async()=>{
    vi.useFakeTimers();
    let resolve!:(value:ReturnType<typeof makeResult>)=>void;
    let signal:AbortSignal|undefined;
    const load=vi.fn((_l:string,_r:string,requestSignal?:AbortSignal)=>{signal=requestSignal;return new Promise<ReturnType<typeof makeResult>>(done=>{resolve=done;});});
    const view=mount(<CompareBoard {...baseProps} locale="en" leftKey="left" rightKey="right" loadCompare={load}/>);
    try {
      await act(async()=>{await vi.advanceTimersByTimeAsync(5000);});
      expect(signal?.aborted).toBe(true);expect(load).toHaveBeenCalledTimes(1);
      expect(view.html()).toContain('COMPARE_TIMEOUT');
      await act(async()=>{resolve(makeResult());await Promise.resolve();});
      expect(view.html()).not.toContain('compare-hero');
    } finally {act(()=>view.unmount());vi.useRealTimers();}
  });

  it('WB-003: the same run on both sides has an actionable selection state, not an automatic request',()=>{
    const load=vi.fn(()=>new Promise<ReturnType<typeof makeResult>>(()=>undefined));
    const view=mount(<CompareBoard {...baseProps} locale="en" leftKey="left" rightKey="left" loadCompare={load}/>);
    try {expect(load).not.toHaveBeenCalled();expect(view.html()).toContain('Choose two different runs');}
    finally {act(()=>view.unmount());}
  });
  it('keeps missing and unknown-basis detail timings visible without zero, ranked advantages or equality', async () => {
    const result = makeResult(); result.speed.left.ttftMs = null; result.speed.left.tps = NaN; result.speed.left.tpotMs = -1;
    const { html, unmount } = mount(<CompareBoard sessions={[]} locale="en" leftKey="left" rightKey="right"
      onLeftChange={() => undefined} onRightChange={() => undefined} loadCompare={async () => result} />);
    await act(async () => { for (let i = 0; i < 20 && document.querySelector('#compare-metrics button') === null; i += 1) await new Promise(resolve => setTimeout(resolve, 10)); });
    act(() => (document.querySelector('#compare-metrics button') as HTMLButtonElement).click());
    const rows = [...document.querySelectorAll('.cmp-detail-table tbody tr')];
    for (const label of ['TTFT', 'TPS', 'TPOT']) {
      const row = rows.find(row => row.querySelector('td')?.textContent === label)!;
      expect(row).toBeDefined(); expect(row.querySelectorAll('td')[1]!.textContent).toBe('—');
      expect(row.querySelector('[data-scan-timing-reason]')!.textContent).toContain('Not comparable');
      expect(row.querySelector('.compare-delta-badge')).toBeNull();
    }
    expect(html()).not.toContain('NaN'); unmount();
  });
  it('会话列表加载中显示骨架，不误显示「暂无数据」', () => {
    const { html, unmount } = mount(
      <CompareBoard {...baseProps} sessionsLoading={true} />,
    );
    expect(html()).toContain('ui-skeleton');
    expect(html()).not.toContain('选择两个会话');
    unmount();
  });

  it('空状态带「选择左侧会话」按钮，点击直接打开左侧选择器（REQ-019）', () => {
    const { html, unmount } = mount(<CompareBoard {...baseProps} />);
    expect(html()).toContain('选择左侧会话');
    const picker = document.querySelectorAll('.compare-picker')[0] as HTMLButtonElement;
    expect(picker.getAttribute('aria-expanded')).toBe('false');
    const button = Array.from(document.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('选择左侧会话'),
    ) as HTMLButtonElement;
    act(() => button.click());
    expect((document.querySelectorAll('.compare-picker')[0] as HTMLButtonElement).getAttribute('aria-expanded')).toBe('true');
    unmount();
  });

  it('加载后区块带编号标题（4–10，REQ-105 顺序）', async () => {
    const result = makeResult();
    const { html, unmount } = mount(
      <CompareBoard
        sessions={[]}
        locale="zh"
        leftKey="left"
        rightKey="right"
        onLeftChange={() => undefined}
        onRightChange={() => undefined}
        loadCompare={async () => result}
      />,
    );
    await act(async () => {
      for (let i = 0; i < 20; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        if (document.querySelector('.compare-speed') !== null) {
          break;
        }
      }
    });
    const out = html();
    expect(out).toContain('4. 速度指标');
    expect(out).toContain('5. 可视化图表');
    expect(out).toContain('7. 时间构成与阶段');
    expect(out).toContain('10. 详细指标表');
    unmount();
  });

  it('Hero Header 渲染渐变 + provider 标识 + Verdict 比率摘要（REQ-104）', async () => {
    const result = makeResult();
    const { html, unmount } = mount(
      <CompareBoard
        sessions={[]}
        locale="zh"
        leftKey="left"
        rightKey="right"
        onLeftChange={() => undefined}
        onRightChange={() => undefined}
        loadCompare={async () => result}
      />,
    );
    await act(async () => {
      for (let i = 0; i < 20; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        if (document.querySelector('.compare-hero') !== null) {
          break;
        }
      }
    });
    const out = html();
    expect(out).toContain('compare-hero');
    expect(out).toContain('linear-gradient(135deg, var(--provider-codex-subtle) 0%, var(--provider-codex-subtle) 100%)');
    expect(out).toContain('会话墙钟观测比 1.7×');
    expect(out).not.toContain('快 1.7×');
    unmount();
  });

  it('section 顺序：Hero → Verdict → KPI → Speed → Charts → Dims → Time&Phase（REQ-105）', async () => {
    const result = makeResult();
    const { unmount } = mount(
      <CompareBoard
        sessions={[]}
        locale="zh"
        leftKey="left"
        rightKey="right"
        onLeftChange={() => undefined}
        onRightChange={() => undefined}
        loadCompare={async () => result}
      />,
    );
    await act(async () => {
      for (let i = 0; i < 20; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        if (document.querySelector('.compare-charts') !== null) {
          break;
        }
      }
    });
    const ids = Array.from(document.querySelectorAll<HTMLElement>('[id^="compare-"]'))
      .map((el) => el.id)
      .filter((id) =>
        ['compare-hero', 'compare-verdict', 'compare-kpi', 'compare-speed', 'compare-charts', 'compare-dims', 'compare-time-phase', 'compare-tools', 'compare-timelines', 'compare-metrics'].includes(id),
      );
    expect(ids).toEqual([
      'compare-hero',
      'compare-verdict',
      'compare-kpi',
      'compare-speed',
      'compare-charts',
      'compare-dims',
      'compare-time-phase',
      'compare-tools',
      'compare-timelines',
      'compare-metrics',
    ]);
    unmount();
  });
});
