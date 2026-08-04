import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';

import { Badge } from './Badge.js';
import { Button, IconButton } from './Button.js';
import { IconSearch } from '../icons/index.js';
import { BarMeter, Kbd, MetricCard, Sparkline } from './Misc.js';
import { EmptyState, ErrorState, Skeleton } from './States.js';
import { Table } from './Table.js';
import { Tabs } from './Tabs.js';

function render(node: React.JSX.Element): HTMLDivElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    createRoot(container).render(node);
  });
  return container;
}

describe('REQ-005 基础组件（展示类）', () => {
  it('Button：variant/size 类名，loading 禁用', () => {
    const container = render(<Button variant="primary" size="sm">go</Button>);
    const btn = container.querySelector('button')!;
    expect(btn.className).toContain('ui-btn-primary');
    expect(btn.className).toContain('ui-btn-sm');
    expect(btn.textContent).toBe('go');

    const loading = render(<Button loading>go</Button>);
    expect((loading.querySelector('button') as HTMLButtonElement).disabled).toBe(true);
    expect(loading.querySelector('.ui-spinner')).not.toBeNull();
  });

  it('IconButton：必填 label → aria-label + 命中区 ≥ 24px', () => {
    const container = render(<IconButton label="搜索" icon={<IconSearch />} />);
    const btn = container.querySelector('button')!;
    expect(btn.getAttribute('aria-label')).toBe('搜索');
    expect(btn.className).toContain('ui-icon-btn');
    // 命中区由 --control-height-md(28px)/--space-6(24px) 保证，类名即契约
    expect(btn.className).toContain('ui-btn-md');
  });

  it('Badge：tone 类名', () => {
    const container = render(<Badge tone="success" variant="solid">OK</Badge>);
    expect(container.querySelector('.ui-badge-success.ui-badge-solid')).not.toBeNull();
  });

  it('Tabs：role=tablist + aria-selected + onChange', () => {
    const calls: string[] = [];
    const container = render(
      <Tabs
        items={[
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
        ]}
        activeId="a"
        onChange={(id) => calls.push(id)}
      />,
    );
    expect(container.querySelector('[role="tablist"]')).not.toBeNull();
    const tabs = container.querySelectorAll('[role="tab"]');
    expect(tabs).toHaveLength(2);
    expect(tabs[0]!.getAttribute('aria-selected')).toBe('true');
    act(() => (tabs[1] as HTMLButtonElement).click());
    expect(calls).toEqual(['b']);
  });

  it('Table：排序按钮触发 onSort', () => {
    const calls: string[] = [];
    const container = render(
      <Table
        columns={[
          { key: 'name', label: 'Name', sortable: true, render: (r: { name: string }) => r.name },
        ]}
        rows={[{ name: 'x' }]}
        rowKey={(r) => r.name}
        sort={{ key: 'name', direction: 'asc' }}
        onSort={(key) => calls.push(key)}
      />,
    );
    const btn = container.querySelector('.ui-table-sort') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    act(() => btn.click());
    expect(calls).toEqual(['name']);
  });

  it('Kbd / MetricCard / BarMeter / Sparkline 渲染', () => {
    const kbd = render(<Kbd>⌘K</Kbd>);
    expect(kbd.querySelector('kbd')?.textContent).toBe('⌘K');
    const card = render(<MetricCard icon={<IconSearch />} label="速度" value="1.2" unit="s" />);
    expect(card.querySelector('.ui-metric-card-value')?.textContent).toContain('1.2');
    const meter = render(<BarMeter value={5} max={10} tone="success" />);
    expect((meter.querySelector('.ui-bar-meter-fill') as HTMLElement).style.width).toBe('50%');
    const spark = render(<Sparkline points={[1, 3, 2, 5]} />);
    expect(spark.querySelector('polyline')).not.toBeNull();
  });

  it('Skeleton / EmptyState / ErrorState 渲染', () => {
    const skeleton = render(<Skeleton variant="row" count={3} />);
    expect(skeleton.querySelectorAll('.ui-skeleton-row')).toHaveLength(3);
    const empty = render(<EmptyState icon={<IconSearch />} title="无数据" description="换个过滤条件" />);
    expect(empty.querySelector('.ui-empty-title')?.textContent).toBe('无数据');
    const error = render(<ErrorState code="SESSION_NOT_FOUND" message="不存在" />);
    expect(error.querySelector('.ui-error-code')?.textContent).toBe('SESSION_NOT_FOUND');
  });
});
