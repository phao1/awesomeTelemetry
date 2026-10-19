import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SessionDetailResponse, TraceEventSlim } from '../core/trace-types.js';
import { SessionVisuals } from './SessionVisuals.js';
import { makeEvent, makeResult, makeSession } from './compare-test-fixtures.js';

const containers: HTMLDivElement[] = [];

function mount(node: React.ReactNode): { unmount: () => void; html: () => string } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  containers.push(container);
  const root = createRoot(container);
  act(() => {
    root.render(node);
  });
  return { unmount: () => root.unmount(), html: () => container.innerHTML };
}

afterEach(() => {
  while (containers.length > 0) {
    containers.pop()?.remove();
  }
});

function detailWith(events: TraceEventSlim[], totalDurationMs = 5000): SessionDetailResponse {
  return {
    ...makeResult().left,
    session: makeSession('s1', { totalDurationMs, eventCount:events.length }),
    events,
    eventTotal: events.length,
    mode: 'slim',
  } as SessionDetailResponse;
}

describe('REQ-121 SessionVisuals（Heatmap + Radar）', () => {
  it.each(['zh','en'] as const)('WB-003: exposes a log profile and original figures, not capability or context-length scores (%s)',locale=>{
    const events=[makeEvent({id:'one',tokens:makeSession('s').tokenUsage})];
    const detail=detailWith(events);detail.session.eventCount=events.length;detail.session.durationSource='derived';
    const fetcher=vi.spyOn(globalThis,'fetch');
    const {unmount}=mount(<SessionVisuals detail={detail} locale={locale}/>);
    try {
      const radar=document.querySelector('.session-radar')!;
      expect(radar.querySelector('h4')?.textContent).toContain(locale==='zh'?'日志概况':'Log profile');
      expect(radar.querySelector('h4')?.textContent).not.toMatch(/能力|Capability/);
      expect(radar.textContent).toContain(locale==='zh'?'累计 Token':'Total tokens');
      expect(radar.textContent).toContain(locale==='zh'?'非能力或质量评分':'not capability or quality scores');
      const originals=radar.querySelector('.session-radar-originals');
      expect(originals?.textContent).toContain('210');
      expect(originals?.textContent).toContain(locale==='zh'?'原始值':'Original values');
      expect(fetcher).not.toHaveBeenCalled();
    } finally {unmount();fetcher.mockRestore();}
  });

  it('WB-003: partial pages cannot produce token-per-event, tool-share or error-score axes',()=>{
    const detail=detailWith([makeEvent({tokens:makeSession('s').tokenUsage})]);
    detail.hasMore=true;detail.eventTotal=10;detail.session.eventCount=1;detail.session.durationSource='derived';
    const {unmount}=mount(<SessionVisuals detail={detail} locale="en"/>);
    try {
      const labels=Array.from(document.querySelectorAll('.session-radar svg text')).map(e=>e.textContent);
      expect(labels).not.toContain('Inverse tokens/event');
      expect(labels).not.toContain('Tool event share');
      expect(labels).not.toContain('1 − error event share');
      expect(document.querySelector('.session-radar')?.textContent).toContain('Loaded 1 / 10');
    } finally {unmount();}
  });

  it('WB-003: unknown step statuses do not form a full no-error score',()=>{
    const detail=detailWith([makeEvent({status:'unknown'})]);detail.session.eventCount=1;
    const {unmount}=mount(<SessionVisuals detail={detail} locale="en"/>);
    try {
      expect(Array.from(document.querySelectorAll('.session-radar svg text')).map(e=>e.textContent)).not.toContain('1 − error event share');
      expect(document.querySelector('.session-radar [role="status"]')?.textContent).toContain('unknown statuses');
    } finally {unmount();}
  });
  it('omits unknown timing axes instead of plotting fabricated zero scores', () => {
    const { unmount } = mount(<SessionVisuals detail={detailWith([makeEvent({ id: 'unknown', tokens: null })])} locale="en" />);
    const radar = document.querySelector('.session-radar')!;
    expect(radar.querySelectorAll('line')).toHaveLength(6);
    expect(radar.querySelectorAll('text')).toHaveLength(6);
    expect(radar.querySelector('[role="status"]')).not.toBeNull();
    unmount();
  });

  it('omits partial-event timing scores even with a known session declaration', () => {
    const detail = detailWith([makeEvent({ id: 'a', tokens: makeSession('s').tokenUsage })]);
    detail.session.durationSource = 'measured'; detail.hasMore = true;
    const { unmount } = mount(<SessionVisuals detail={detail} locale="zh" />);
    expect(document.querySelector('.session-radar')!.querySelectorAll('line')).toHaveLength(3);
    const labels=Array.from(document.querySelectorAll('.session-radar svg text')).map(e=>e.textContent);
    expect(labels).toEqual(['墙钟反向刻度','累计 Token','会话时长']);
    unmount();
  });

  it('渲染热力图与 8 轴雷达图两个区块', () => {
    const events = [
      makeEvent({ id: 'a', kind: 'user_prompt', startedAt: '2026-08-01T00:00:00.000Z' }),
      makeEvent({ id: 'b', tokens: makeSession('s').tokenUsage, startedAt: '2026-08-01T00:01:00.000Z' }),
      makeEvent({ id: 'c', startedAt: '2026-08-01T00:02:00.000Z' }),
    ];
    const detail = detailWith(events); detail.session.durationSource = 'measured'; detail.session.eventCount = events.length;
    const { unmount } = mount(<SessionVisuals detail={detail} locale="zh" />);
    const heatmap = document.querySelector('.session-heatmap');
    const radar = document.querySelector('.session-radar');
    expect(heatmap).not.toBeNull();
    expect(radar).not.toBeNull();
    // 短会话 → 1 分钟桶，3 个桶
    expect(heatmap!.querySelectorAll('rect').length).toBe(3);
    expect(heatmap!.textContent).toContain('1 分钟/桶');
    // 8 轴：8 条轴线 + 8 个轴标签
    expect(radar!.querySelectorAll('line').length).toBe(8);
    expect(radar!.querySelectorAll('text').length).toBe(8);
    expect(radar!.textContent).toContain('TTFT');
    unmount();
  });

  it('长会话（60 分钟）桶大小提升到 2 分钟', () => {
    const events = [
      makeEvent({ id: 'a', startedAt: '2026-08-01T00:00:00.000Z', durationMs: 0 }),
      makeEvent({ id: 'z', startedAt: '2026-08-01T00:59:00.000Z', durationMs: 0 }),
    ];
    const { unmount } = mount(
      <SessionVisuals detail={detailWith(events, 60 * 60_000)} locale="zh" />,
    );
    const heatmap = document.querySelector('.session-heatmap')!;
    expect(heatmap.textContent).toContain('2 分钟/桶');
    expect(heatmap.querySelectorAll('rect').length).toBe(30);
    unmount();
  });

  it('无事件时整块不渲染', () => {
    const { unmount } = mount(<SessionVisuals detail={detailWith([])} locale="zh" />);
    expect(document.querySelector('.session-visuals')).toBeNull();
    unmount();
  });

  it('颜色全部走 token 变量，不出现字面量 hex', () => {
    const events = [makeEvent({ id: 'a' })];
    const { html, unmount } = mount(<SessionVisuals detail={detailWith(events)} locale="en" />);
    expect(html()).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
    expect(html()).toContain('var(--accent-emphasis)');
    unmount();
  });
});
