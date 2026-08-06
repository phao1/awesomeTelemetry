import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { CompareKPI } from './CompareKPI.js';
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

function clickByLabel(html: () => string, label: string): void {
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
    (b) => b.getAttribute('aria-label') === label,
  );
  expect(button).toBeDefined();
  act(() => {
    button!.click();
  });
  expect(html()).toContain('compare-kpi-detail');
}

describe('CompareKPI（建议 7 drill-down）', () => {
  it('e2e 卡片点击展开速度构成明细', () => {
    const { html, unmount } = mount(<CompareKPI result={makeResult()} locale="zh" />);
    clickByLabel(html, '快 点击展开构成明细');
    expect(html()).toContain('TTFT');
    expect(html()).toContain('纯推理时间');
    unmount();
  });

  it('Token 卡片点击展开 token 构成', () => {
    const { html, unmount } = mount(<CompareKPI result={makeResult()} locale="zh" />);
    clickByLabel(html, 'Token 点击展开构成明细');
    expect(html()).toContain('token.reasoning');
    expect(html()).toContain('token.cacheWrite');
    unmount();
  });

  it('修复循环卡片展开失败分布（按动作分组）', () => {
    const result = makeResult({
      left: {
        ...makeResult().left,
        events: [
          makeEvent({ id: 'e1', tool: 'Bash', status: 'error', error: 'timeout' }),
          makeEvent({ id: 'e2', tool: 'Read', status: 'error', error: 'ENOENT' }),
        ],
      },
    });
    const { html, unmount } = mount(<CompareKPI result={result} locale="zh" />);
    clickByLabel(html, '修复循环数 点击展开构成明细');
    expect(html()).toContain('Bash');
    expect(html()).toContain('Read');
    unmount();
  });

  it('建议 7：错误率卡片展开按动作分组的错误分布', () => {
    const result = makeResult({
      left: {
        ...makeResult().left,
        events: [
          makeEvent({ id: 'e1', tool: 'Bash', status: 'error', error: 'timeout' }),
          makeEvent({ id: 'e2', tool: 'Read', status: 'error', error: 'ENOENT' }),
        ],
      },
    });
    const { html, unmount } = mount(<CompareKPI result={result} locale="zh" />);
    clickByLabel(html, '错误率 点击展开构成明细');
    expect(html()).toContain('Bash');
    expect(html()).toContain('Read');
    unmount();
  });

  it('建议 7：验证覆盖率卡片展开验证事件列表', () => {
    const result = makeResult({
      left: {
        ...makeResult().left,
        events: [
          makeEvent({ id: 'v1', phase: 'verify', title: 'vitest run' }),
          makeEvent({ id: 'v2', phase: 'implement' }),
        ],
      },
    });
    const { html, unmount } = mount(<CompareKPI result={result} locale="zh" />);
    clickByLabel(html, '验证覆盖率 点击展开构成明细');
    expect(html()).toContain('vitest run');
    unmount();
  });
});
