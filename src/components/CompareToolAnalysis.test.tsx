import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { CompareToolAnalysis } from './CompareToolAnalysis.js';
import { makeEvent, makeResult } from './compare-test-fixtures.js';

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
});

describe('CompareToolAnalysis（建议 3）', () => {
  it('TOP 榜按调用次数降序，含横向条形、失败率、平均耗时', () => {
    const result = makeResult({
      left: {
        ...makeResult().left,
        events: [
          makeEvent({ id: 'a', tool: 'Bash', durationMs: 200, status: 'error' }),
          makeEvent({ id: 'b', tool: 'Bash', durationMs: 100 }),
          makeEvent({ id: 'c', tool: 'Read', durationMs: 50 }),
        ],
      },
      right: {
        ...makeResult().right,
        events: [
          makeEvent({ id: 'd', tool: 'Bash', durationMs: 300 }),
          makeEvent({ id: 'e', tool: 'Read', durationMs: 80, status: 'error' }),
          makeEvent({ id: 'f', tool: 'Write', durationMs: 40 }),
        ],
      },
    });
    const { html, unmount } = mount(<CompareToolAnalysis result={result} locale="zh" />);
    const rows = Array.from(document.querySelectorAll('.compare-tools tbody tr'));
    expect(rows.length).toBe(3);
    // Bash 3 次 > Read 2 次 > Write 1 次
    expect(rows[0]?.textContent).toContain('Bash');
    expect(rows[1]?.textContent).toContain('Read');
    expect(rows[2]?.textContent).toContain('Write');
    const out = html();
    expect(out).toContain('50%'); // Bash L 失败率 1/2
    expect(out).toContain('100%'); // Read R 失败率 1/1
    expect(out).toContain('平均耗时'); // 平均耗时列存在
    expect(out).toContain('0.1s'); // Bash L 平均耗时 (200+100)/2 = 150ms → fmtDur
    unmount();
  });

  it('失败原因分布子区域按动作分组列出左右错误数', () => {
    const result = makeResult({
      left: {
        ...makeResult().left,
        events: [
          makeEvent({ id: 'a', tool: 'Bash', status: 'error' }),
          makeEvent({ id: 'b', tool: 'Bash', status: 'error' }),
        ],
      },
      right: {
        ...makeResult().right,
        events: [makeEvent({ id: 'c', tool: 'Read', status: 'error' })],
      },
    });
    const { html, unmount } = mount(<CompareToolAnalysis result={result} locale="zh" />);
    expect(html()).toContain('失败原因分布');
    const rows = Array.from(document.querySelectorAll('.compare-err-dist .compare-dist-row'));
    expect(rows.length).toBe(2);
    expect(rows[0]?.textContent).toContain('Bash');
    expect(rows[0]?.textContent).toContain('2 / 0');
    expect(rows[1]?.textContent).toContain('Read');
    expect(rows[1]?.textContent).toContain('0 / 1');
    unmount();
  });

  it('无工具事件时渲染空表不崩溃', () => {
    const result = makeResult({
      left: { ...makeResult().left, events: [] },
      right: { ...makeResult().right, events: [] },
    });
    const { html, unmount } = mount(<CompareToolAnalysis result={result} locale="zh" />);
    expect(html()).toContain('ui-table');
    unmount();
  });
});
