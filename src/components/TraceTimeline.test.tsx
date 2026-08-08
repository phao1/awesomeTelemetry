import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import type { TraceEventSlim, TracePhase } from '../core/trace-types.js';
import { TraceTimeline } from './TraceTimeline.js';

function makeEvents(count: number): TraceEventSlim[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `e${i}`,
    sessionId: 's1',
    sequence: i + 1,
    turnKey: null,
    kind: 'llm',
    phase: 'implement',
    title: `event ${i}`,
    startedAt: '2026-08-01T00:00:00.000Z',
    durationMs: 100,
    status: 'success',
    actor: 'assistant',
    tool: null,
    tokens: null,
    error: null,
    hasInput: false,
    hasOutput: false,
    hasRaw: false,
  }));
}

function makePhaseEvents(): TraceEventSlim[] {
  const phases: TracePhase[] = ['understand', 'plan', 'implement', 'debug', 'verify', 'report'];
  const base = Date.parse('2026-08-01T00:00:00.000Z');
  return phases.flatMap((phase, p) =>
    [0, 1].map((j) => ({
      id: `${phase}-${j}`,
      sessionId: 's1',
      sequence: p * 2 + j + 1,
      turnKey: null,
      kind: 'llm',
      phase,
      title: `${phase} ${j}`,
      startedAt: new Date(base + p * 60_000).toISOString(),
      durationMs: 1000,
      status: 'success',
      actor: 'assistant',
      tool: null,
      tokens: null,
      error: null,
      hasInput: j === 0,
      hasOutput: j === 1,
      hasRaw: false,
    })),
  );
}

const containers: HTMLDivElement[] = [];

afterEach(() => {
  while (containers.length > 0) {
    const container = containers.pop();
    if (container !== undefined) {
      container.remove();
    }
  }
});

describe('REQ-006 虚拟滚动', () => {
  it('9,590 events 只挂载视口窗口，DOM 节点 < 500', async () => {
    const events = makeEvents(9590);
    const container = document.createElement('div');
    document.body.appendChild(container);
    containers.push(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        <TraceTimeline
          events={events}
          total={9590}
          hasMore={false}
          onLoadMore={() => {}}
          onSelectEvent={() => {}}
          selectedEventId={null}
          locale="zh"
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });

    const gantt = container.querySelector('.gantt');
    expect(gantt).not.toBeNull();
    const nodes = gantt?.querySelectorAll('*').length ?? 0;
    expect(nodes).toBeLessThan(500);
    const rows = gantt?.querySelectorAll('.gantt-row').length ?? 0;
    expect(rows).toBeGreaterThan(0);
    expect(rows).toBeLessThan(100);
    root.unmount();
  });

  it('接近末尾触发 onLoadMore（分页衔接）', async () => {
    let loadMoreCalls = 0;
    const events = makeEvents(10);
    const container = document.createElement('div');
    document.body.appendChild(container);
    containers.push(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        <TraceTimeline
          events={events}
          total={3000}
          hasMore
          onLoadMore={() => {
            loadMoreCalls += 1;
          }}
          onSelectEvent={() => {}}
          selectedEventId={null}
          locale="zh"
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(loadMoreCalls).toBeGreaterThan(0);
    root.unmount();
  });
});

describe('fix-session-detail-display：甘特双模式 + 可点击阶段轴 + io 徽标', () => {
  it('工具栏提供时间/序列双模式切换，点击回调 onLayoutModeChange', () => {
    const calls: Array<'time' | 'sequence'> = [];
    const container = document.createElement('div');
    document.body.appendChild(container);
    containers.push(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        <TraceTimeline
          events={makeEvents(3)}
          total={3}
          hasMore={false}
          onLoadMore={() => undefined}
          onSelectEvent={() => undefined}
          selectedEventId={null}
          locale="zh"
          layoutMode="time"
          onLayoutModeChange={(m) => calls.push(m)}
        />,
      );
    });
    const chips = Array.from(container.querySelectorAll('.timeline-mode .timeline-chip'));
    expect(chips).toHaveLength(2);
    act(() => (chips[1] as HTMLElement).click());
    expect(calls).toEqual(['sequence']);
    root.unmount();
  });

  it('序列模式：等宽排布 + 序号轴；时间模式按 duration 比例', () => {
    const events = makeEvents(4);
    const container = document.createElement('div');
    document.body.appendChild(container);
    containers.push(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        <TraceTimeline
          events={events}
          total={4}
          hasMore={false}
          onLoadMore={() => undefined}
          onSelectEvent={() => undefined}
          selectedEventId={null}
          locale="zh"
          layoutMode="sequence"
        />,
      );
    });
    const bars = Array.from(container.querySelectorAll('.timeline-bar'));
    expect(bars).toHaveLength(4);
    expect((bars[0] as HTMLElement).style.width).toBe('25%');
    expect((bars[1] as HTMLElement).style.left).toBe('25%');
    const ticks = Array.from(container.querySelectorAll('.timeline-axis-tick'));
    expect(ticks).toHaveLength(5);
    expect(ticks[0]!.textContent).toContain('#1');
    expect(container.querySelector('.timeline-axis')?.className).toContain('timeline-axis-seq');
    root.unmount();

    const timeContainer = document.createElement('div');
    document.body.appendChild(timeContainer);
    containers.push(timeContainer);
    const timeRoot = createRoot(timeContainer);
    act(() => {
      timeRoot.render(
        <TraceTimeline
          events={events}
          total={4}
          hasMore={false}
          onLoadMore={() => undefined}
          onSelectEvent={() => undefined}
          selectedEventId={null}
          locale="zh"
          layoutMode="time"
        />,
      );
    });
    // 同一起点、duration 相同 → 时间模式下四行 bar 都占满时间轴
    const timeBars = Array.from(timeContainer.querySelectorAll('.timeline-bar'));
    expect((timeBars[0] as HTMLElement).style.width).toBe('100%');
    timeRoot.unmount();
  });

  it('点击阶段轴片段：选中并回调该阶段第一个事件（右侧详情入口）', () => {
    const selected: TraceEventSlim[] = [];
    const container = document.createElement('div');
    document.body.appendChild(container);
    containers.push(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        <TraceTimeline
          events={makePhaseEvents()}
          total={12}
          hasMore={false}
          onLoadMore={() => undefined}
          onSelectEvent={(e) => selected.push(e)}
          selectedEventId={null}
          locale="zh"
          layoutMode="time"
        />,
      );
    });
    const segments = Array.from(container.querySelectorAll('.timeline-phase-seg'));
    expect(segments.length).toBe(6);
    const debugSeg = segments.find((s) => s.getAttribute('data-phase') === 'debug');
    expect(debugSeg).toBeDefined();
    act(() => (debugSeg as HTMLElement).click());
    expect(selected).toHaveLength(1);
    expect(selected[0]!.phase).toBe('debug');
    expect(selected[0]!.id).toBe('debug-0');
    root.unmount();
  });

  it('事件行 hasInput/hasOutput 渲染 in/out 徽标', () => {
    const events = makeEvents(1).map((e) => ({ ...e, hasInput: true, hasOutput: true }));
    const container = document.createElement('div');
    document.body.appendChild(container);
    containers.push(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        <TraceTimeline
          events={events}
          total={1}
          hasMore={false}
          onLoadMore={() => undefined}
          onSelectEvent={() => undefined}
          selectedEventId={null}
          locale="zh"
        />,
      );
    });
    expect(container.querySelector('.io-badge-in')).not.toBeNull();
    expect(container.querySelector('.io-badge-out')).not.toBeNull();
    root.unmount();
  });
});
