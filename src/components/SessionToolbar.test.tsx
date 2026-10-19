import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SystemPromptSection, SYS_PROMPT_KEY, SYS_PROMPT_PREVIEW_LIMIT, SessionToolbar } from './SessionToolbar.js';
import { makeEvent, makeSession } from './compare-test-fixtures.js';

const containers: HTMLDivElement[] = [];

function mount(node: React.ReactNode): { unmount: () => void; html: () => string } {
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
  };
}

afterEach(() => {
  while (containers.length > 0) {
    const container = containers.pop();
    if (container !== undefined) {
      container.remove();
    }
  }
  localStorage.removeItem(SYS_PROMPT_KEY);
});

const prompt = 'You are a helpful coding assistant. '.repeat(300); // ~8700 chars

describe('SessionToolbar evidence metrics (WB-003)', () => {
  it.each(['zh', 'en'] as const)('uses verify/steps and error-steps/steps, not correctness or all-event errors (%s)', locale => {
    const events = [
      makeEvent({id:'user',kind:'user_prompt',phase:'understand',status:'error'}),
      makeEvent({id:'llm',kind:'llm',phase:'plan'}),
      makeEvent({id:'check',kind:'bash',tool:'bash',phase:'verify',status:'error'}),
      makeEvent({id:'read',kind:'tool',tool:'read',phase:'understand'}),
      makeEvent({id:'meta',kind:'system',phase:'plan',status:'error'}),
    ];
    const fetcher = vi.spyOn(globalThis,'fetch');
    const {unmount}=mount(<SessionToolbar session={makeSession('s',{eventCount:events.length,costSource:'unknown',costUsd:0})} events={events} locale={locale}/>);
    try {
      const cells=document.querySelectorAll('.session-toolbar-metric');
      expect(cells[1]?.textContent).toContain(locale==='zh'?'验证活动比':'Verification activity');
      expect(cells[1]?.textContent).toContain('33%');
      expect(cells[2]?.textContent).toContain(locale==='zh'?'步骤错误比':'Step errors');
      expect(cells[2]?.textContent).toContain('33%');
      expect(cells[3]?.textContent).not.toContain('$0.000');
      const criteria=document.querySelector('.session-metric-criteria');
      expect(criteria?.textContent).toContain('1 / 3');
      expect(criteria?.textContent).toContain(locale==='zh'?'不等于正确率':'not answer accuracy');
      expect(criteria?.querySelector('details')?.open).toBe(false);
      expect(fetcher).not.toHaveBeenCalled();
    } finally {unmount();fetcher.mockRestore();}
  });

  it.each(['empty','nonstep','partial'] as const)('does not display whole-run zero ratios with %s evidence', scenario => {
    const events=scenario==='empty'?[]:scenario==='nonstep'?[makeEvent({kind:'user_prompt'}),makeEvent({kind:'system'})]:[makeEvent({id:'check',kind:'test',phase:'verify'}),makeEvent({id:'llm'})];
    const eventCount=scenario==='partial'?5:events.length;
    const {unmount}=mount(<SessionToolbar session={makeSession('s',{eventCount})} events={events} locale="en"/>);
    try {
      const cells=document.querySelectorAll('.session-toolbar-metric');
      expect(cells[1]?.querySelector('.mono')?.textContent).toBe('—');
      expect(cells[2]?.querySelector('.mono')?.textContent).toBe('—');
      expect(document.querySelector('.session-metric-criteria')?.textContent).toContain(`${events.length} / ${eventCount}`);
      expect(document.querySelector('.session-metric-criteria')?.textContent).toContain(scenario==='partial'?'Incomplete':'No execution steps');
    } finally {unmount();}
  });

  it('keeps an observed zero distinguishable from unavailable and discloses unknown statuses', () => {
    const {unmount}=mount(<SessionToolbar session={makeSession('s',{eventCount:1})} events={[makeEvent({status:'unknown'})]} locale="en"/>);
    try {
      const cells=document.querySelectorAll('.session-toolbar-metric');
      expect(cells[1]?.querySelector('.mono')?.textContent).toBe('0%');
      expect(cells[2]?.querySelector('.mono')?.textContent).toBe('0%');
      expect(document.querySelector('.session-metric-criteria')?.textContent).toContain('Unknown step statuses: 1');
    } finally {unmount();}
  });

  it('honors authoritative detail pagination even when the older session eventCount looks complete', () => {
    const {unmount}=mount(<SessionToolbar session={makeSession('s',{eventCount:1})} events={[makeEvent({kind:'test',phase:'verify'})]}
      eventTotal={7} hasMore locale="en"/>);
    try {
      expect(document.querySelectorAll('.session-toolbar-metric')[1]?.querySelector('.mono')?.textContent).toBe('—');
      expect(document.querySelector('.session-metric-criteria')?.textContent).toContain('Loaded 1 / 7');
      expect(document.querySelector('.session-metric-criteria [role="status"]')?.textContent).toContain('Incomplete');
    } finally {unmount();}
  });

  it('does not round a nonzero observed error ratio down to an apparently exact zero', () => {
    const events=Array.from({length:501},(_,index)=>makeEvent({id:`s-${index}`,status:index===0?'error':'success'}));
    const {unmount}=mount(<SessionToolbar session={makeSession('s',{eventCount:events.length})} events={events} locale="en"/>);
    try {expect(document.querySelectorAll('.session-toolbar-metric')[2]?.querySelector('.mono')?.textContent).toBe('<1%');}
    finally {unmount();}
  });
});

describe('SystemPromptSection（REQ-103）', () => {
  it.each(['zh', 'en'] as const)('active toolbar keeps legacy TTFT value and exposes timing basis without IO (%s)', (locale) => {
    const fetcher = vi.spyOn(globalThis, 'fetch');
    const { html, unmount } = mount(<SessionToolbar session={makeSession('s', { durationSource: 'measured', eventCount: 3 })}
      events={[makeEvent({ kind: 'user_prompt', actor: 'user' }), makeEvent({ id: 'llm', startedAt: '2026-08-01T00:00:00.120Z' })]}
      locale={locale} />);
    try {
      expect(document.querySelector('.session-toolbar-metric')?.textContent).toContain('TTFT');
      expect(document.querySelector('.session-toolbar-metric')?.textContent).toContain('120ms');
      expect(html()).toContain('durationSource');
      expect(html()).toContain('pureInferenceMs');
      expect(document.querySelector('.scan-timing-criteria [role="status"]')).not.toBeNull();
      expect(html()).toContain(locale === 'zh' ? '不证明逐事件实测' : 'not per-event measurement proof');
      expect(fetcher).not.toHaveBeenCalled();
    } finally { unmount(); fetcher.mockRestore(); }
  });
  it('systemPrompt === null 时整个区域不渲染', () => {
    const { html, unmount } = mount(
      <SystemPromptSection session={makeSession('s1', { systemPrompt: null })} locale="zh" />,
    );
    expect(html()).not.toContain('sys-prompt');
    unmount();
  });

  it('折叠态显示字符数与估算 token；点击展开显示正文', () => {
    const session = makeSession('s1', { systemPrompt: prompt });
    const { html, unmount } = mount(<SystemPromptSection session={session} locale="zh" />);
    expect(html()).toContain(`${prompt.length.toLocaleString()} 字符`);
    expect(html()).toContain(`~${Math.ceil(prompt.length / 4).toLocaleString()} tokens`);
    const toggle = document.querySelector('.sys-prompt-toggle') as HTMLDivElement;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    act(() => {
      toggle.click();
    });
    expect(html()).toContain('sys-prompt-text');
    unmount();
  });

  it('超 5000 字符截断 + Show more 显示全文', () => {
    const session = makeSession('s1', { systemPrompt: prompt });
    const { html, unmount } = mount(<SystemPromptSection session={session} locale="zh" />);
    const toggle = document.querySelector('.sys-prompt-toggle') as HTMLDivElement;
    act(() => {
      toggle.click();
    });
    const pre = document.querySelector<HTMLPreElement>('.sys-prompt-text');
    expect(pre?.textContent?.length).toBe(SYS_PROMPT_PREVIEW_LIMIT);
    expect(html()).toContain(`显示更多（${(prompt.length - SYS_PROMPT_PREVIEW_LIMIT).toLocaleString()} 字符）`);
    const more = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('显示更多'));
    expect(more).toBeDefined();
    act(() => {
      more!.click();
    });
    expect(document.querySelector<HTMLPreElement>('.sys-prompt-text')?.textContent?.length).toBe(prompt.length);
    unmount();
  });

  it('折叠状态持久化到 awesome-telemetry.sysPromptExpanded', () => {
    localStorage.setItem(SYS_PROMPT_KEY, '1');
    const session = makeSession('s1', { systemPrompt: 'short prompt' });
    const { html, unmount } = mount(<SystemPromptSection session={session} locale="zh" />);
    expect(document.querySelector('.sys-prompt-toggle')?.getAttribute('aria-expanded')).toBe('true');
    expect(html()).toContain('short prompt');
    const toggle = document.querySelector('.sys-prompt-toggle') as HTMLDivElement;
    act(() => {
      toggle.click();
    });
    expect(localStorage.getItem(SYS_PROMPT_KEY)).toBe('0');
    unmount();
  });

  it('键盘 Enter/Space 可切换（role="button" + tabIndex）', () => {
    const session = makeSession('s1', { systemPrompt: 'short prompt' });
    const { unmount } = mount(<SystemPromptSection session={session} locale="zh" />);
    const toggle = document.querySelector('.sys-prompt-toggle') as HTMLDivElement;
    expect(toggle.getAttribute('role')).toBe('button');
    expect(toggle.getAttribute('tabindex')).toBe('0');
    act(() => {
      toggle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    unmount();
  });

  it('SessionToolbar 组合渲染时系统 Prompt 区在其下方', () => {
    const session = makeSession('s1', { systemPrompt: 'short prompt' });
    const { html, unmount } = mount(
      <SessionToolbar
        session={session}
        events={[makeEvent({ id: 'e1', kind: 'llm' })]}
        locale="zh"
      />,
    );
    expect(html()).toContain('session-toolbar');
    expect(html()).toContain('sys-prompt');
    unmount();
  });

  it('6.15：渲染返回按钮（onBack）', () => {
    const session = makeSession('s1');
    const onBack = vi.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);
    act(() => {
      createRoot(container).render(
        <SessionToolbar
          session={session}
          events={[]}
          locale="zh"
          onBack={onBack}
        />,
      );
    });
    const back = Array.from(container.querySelectorAll('button')).find((b) =>
      b.getAttribute('aria-label')?.includes('返回'),
    ) as HTMLButtonElement;
    expect(back).toBeDefined();
    act(() => back.click());
    expect(onBack).toHaveBeenCalledTimes(1);
    container.remove();
  });
});
