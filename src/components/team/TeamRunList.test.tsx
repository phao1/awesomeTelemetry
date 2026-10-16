/**
 * add-agent-team-observability §7.5 / §7.11 / §7.12 — TeamRunList 测试。
 *
 * 覆盖：
 * - 六状态（loading/empty/error+retry/success/partial/unavailable）
 * - 过滤交互（search/provider/status/topology/completeness/range）
 * - 虚拟化（useVirtualList：只渲染窗口内行）
 * - invalid/deleted run id banner
 * - 行点击选择
 * - load more
 *
 * 不 mock 被测逻辑、不放宽断言（AGENTS.md）。
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import type {
  CompletenessLevel,
  EvidenceDimension,
  ProviderKey,
  TeamRunStatus,
  TeamRunSummary,
  TeamTopologyKind,
} from '../../core/trace-types.js';
import { TeamRunList, type TeamRunListProps } from './TeamRunList.js';

// ── mock data helpers ────────────────────────────────────────

const FULL_COMPLETENESS: Record<EvidenceDimension, CompletenessLevel> = {
  topology: 'complete',
  tasks: 'complete',
  communication: 'partial',
  timing: 'complete',
  tools: 'complete',
  outputs: 'complete',
  tokens: 'complete',
  cost: 'unavailable',
  verification: 'partial',
};

function run(id: string, over: Partial<TeamRunSummary> & { title?: string } = {}): TeamRunSummary {
  return {
    id,
    provider: 'codex',
    nativeRunId: `native-${id}`,
    runIdentityConfidence: 'native',
    title: over.title ?? `run ${id}`,
    goalFingerprint: null,
    status: 'success',
    startedAt: new Date(Date.now() - 3600 * 1000).toISOString(),
    endedAt: new Date(Date.now() - 3500 * 1000).toISOString(),
    topologyKind: 'two_level',
    counts: { agents: 2, tasks: 3, communications: 5, activities: 10, rounds: 4, artifacts: 1 },
    tokenAvailable: true,
    costAvailable: false,
    costCurrency: null,
    completeness: FULL_COMPLETENESS,
    updatedAt: new Date().toISOString(),
    stamp: `stamp-${id}`,
    ...over,
  };
}

function render(node: React.JSX.Element): HTMLDivElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    createRoot(container).render(node);
  });
  return container;
}

function baseProps(over: Partial<TeamRunListProps> = {}): TeamRunListProps {
  return {
    items: [],
    selectedId: null,
    onSelect: () => undefined,
    locale: 'zh',
    hasMore: false,
    loading: false,
    error: null,
    partial: false,
    unavailable: false,
    onLoadMore: () => undefined,
    onRetry: () => undefined,
    providerFilter: [],
    statusFilter: [],
    topologyFilter: [],
    completenessFilter: [],
    q: '',
    range: 'today',
    onQChange: () => undefined,
    onRangeChange: () => undefined,
    onProviderFilterChange: () => undefined,
    onStatusFilterChange: () => undefined,
    onTopologyFilterChange: () => undefined,
    onCompletenessFilterChange: () => undefined,
    total: 0,
    invalidRunId: null,
    deletedRunId: null,
    ...over,
  };
}

afterEach(() => {
  document.body.innerHTML = '';
});

// ═══════════════════════════════════════════════════════════════════════════
// §7.11 六状态
// ═══════════════════════════════════════════════════════════════════════════

describe('TeamRunList §7.11 六状态', () => {
  it('loading 态渲染 Skeleton（无行）', () => {
    const container = render(<TeamRunList {...baseProps({ loading: true })} />);
    expect(container.querySelector('.ui-skeleton')).not.toBeNull();
    expect(container.querySelector('.team-row')).toBeNull();
  });

  it('empty 态渲染 EmptyState + 重试按钮', () => {
    const container = render(<TeamRunList {...baseProps({ loading: false, total: 0 })} />);
    const empty = container.querySelector('.ui-empty');
    expect(empty).not.toBeNull();
    expect(empty?.textContent).toContain('暂无团队运行');
    // empty 态提供 retry action
    expect(empty?.querySelector('button')).not.toBeNull();
  });

  it('error 态渲染 ErrorState + 重试回调', () => {
    const calls: number[] = [];
    const container = render(
      <TeamRunList
        {...baseProps({
          error: 'TEAM_LIST_FAILED: boom',
          onRetry: () => calls.push(1),
        })}
      />,
    );
    const err = container.querySelector('.ui-error');
    expect(err).not.toBeNull();
    expect(err?.textContent).toContain('TEAM_LIST_FAILED');
    expect(err?.textContent).toContain('boom');
    act(() => {
      (err?.querySelector('button') as HTMLButtonElement).click();
    });
    expect(calls).toEqual([1]);
  });

  it('success 态渲染行（受控 .team-row）', () => {
    const items = [run('r-1', { title: 'fix build' }), run('r-2', { title: 'refactor' })];
    const container = render(<TeamRunList {...baseProps({ items, total: 2 })} />);
    const rows = container.querySelectorAll('.team-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.querySelector('.team-row-title')?.textContent).toBe('fix build');
    expect(rows[1]!.querySelector('.team-row-title')?.textContent).toBe('refactor');
  });

  it('partial 态顶部 banner + 行仍渲染', () => {
    const items = [run('r-1')];
    const container = render(
      <TeamRunList {...baseProps({ items, partial: true, total: 1 })} />,
    );
    const banner = container.querySelector('.team-state-partial');
    expect(banner).not.toBeNull();
    expect(banner?.getAttribute('role')).toBe('status');
    expect(container.querySelectorAll('.team-row').length).toBe(1);
  });

  it('unavailable 态（items 空 + unavailable=true）渲染 unavailable EmptyState', () => {
    const container = render(
      <TeamRunList {...baseProps({ unavailable: true, total: 0 })} />,
    );
    const empty = container.querySelector('.ui-empty');
    expect(empty).not.toBeNull();
    expect(empty?.textContent).toContain('团队数据不可用');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §7.5 invalid / deleted run id banner
// ═══════════════════════════════════════════════════════════════════════════

describe('TeamRunList invalid / deleted banner', () => {
  it('invalidRunId 渲染 alert banner', () => {
    const container = render(<TeamRunList {...baseProps({ invalidRunId: 'bad-run' })} />);
    const banner = container.querySelector('.team-state-invalid');
    expect(banner).not.toBeNull();
    expect(banner?.getAttribute('role')).toBe('alert');
    expect(banner?.textContent).toContain('bad-run');
  });

  it('deletedRunId 渲染 status banner', () => {
    const container = render(<TeamRunList {...baseProps({ deletedRunId: 'gone-run' })} />);
    const banner = container.querySelector('.team-state-deleted');
    expect(banner).not.toBeNull();
    expect(banner?.getAttribute('role')).toBe('status');
    expect(banner?.textContent).toContain('gone-run');
  });

  it('null ids 不渲染 banner', () => {
    const container = render(<TeamRunList {...baseProps()} />);
    expect(container.querySelector('.team-state-invalid')).toBeNull();
    expect(container.querySelector('.team-state-deleted')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §7.5 行点击选择
// ═══════════════════════════════════════════════════════════════════════════

describe('TeamRunList 行点击选择', () => {
  it('点击行回调 onSelect(id)', () => {
    const calls: string[] = [];
    const items = [run('r-1'), run('r-2')];
    const container = render(
      <TeamRunList {...baseProps({ items, onSelect: (id) => calls.push(id), total: 2 })} />,
    );
    const rows = container.querySelectorAll('.team-row');
    act(() => (rows[1] as HTMLElement).click());
    expect(calls).toEqual(['r-2']);
  });

  it('选中行 aria-selected=true + .team-row-on 类', () => {
    const items = [run('r-1'), run('r-2')];
    const container = render(
      <TeamRunList {...baseProps({ items, selectedId: 'r-1', total: 2 })} />,
    );
    const rows = container.querySelectorAll('.team-row');
    expect(rows[0]!.getAttribute('aria-selected')).toBe('true');
    expect(rows[0]!.className).toContain('team-row-on');
    expect(rows[1]!.getAttribute('aria-selected')).toBe('false');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §7.5 过滤交互
// ═══════════════════════════════════════════════════════════════════════════

describe('TeamRunList 过滤交互', () => {
  it('搜索输入受控：输入触发 onQChange', () => {
    const calls: string[] = [];
    const container = render(
      <TeamRunList {...baseProps({ onQChange: (q) => calls.push(q) })} />,
    );
    const input = container.querySelector('input[type="search"]') as HTMLInputElement;
    act(() => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(input, 'fix');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(calls).toEqual(['fix']);
  });

  it('时间范围分段控件：4 按钮，点击回调 onRangeChange', () => {
    const calls: Array<'today' | '7d' | '30d' | 'all'> = [];
    const container = render(
      <TeamRunList {...baseProps({ onRangeChange: (r) => calls.push(r) })} />,
    );
    const buttons = Array.from(container.querySelectorAll('.session-range-btn'));
    expect(buttons).toHaveLength(4);
    expect(buttons[0]!.className).toContain('session-range-btn-on'); // today 默认
    act(() => (buttons[2] as HTMLElement).click());
    expect(calls).toEqual(['30d']);
  });

  it('provider 过滤 Popover 打开 + 9 provider 选项 + 点击切换', () => {
    const calls: ProviderKey[][] = [];
    const container = render(
      <TeamRunList {...baseProps({ onProviderFilterChange: (p) => calls.push(p) })} />,
    );
    const trigger = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Provider') || b.textContent?.includes('provider'),
    ) as HTMLButtonElement;
    expect(trigger).toBeDefined();
    act(() => trigger.click());
    const items = container.querySelectorAll('.session-filter-item');
    expect(items.length).toBe(9);
    // 点第一个 provider
    const firstCheckbox = items[0]!.querySelector('input[type="checkbox"]') as HTMLInputElement;
    act(() => firstCheckbox.click());
    expect(calls.length).toBe(1);
    expect(calls[0]!.length).toBe(1);
  });

  it('status 过滤 Popover 打开 + 7 TeamRunStatus 选项', () => {
    const calls: TeamRunStatus[][] = [];
    const container = render(
      <TeamRunList {...baseProps({ onStatusFilterChange: (s) => calls.push(s) })} />,
    );
    // status trigger 是第二个 filter button（label 含「状态」）
    const trigger = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('状态'),
    ) as HTMLButtonElement;
    expect(trigger).toBeDefined();
    act(() => trigger.click());
    const items = container.querySelectorAll('.session-filter-item');
    expect(items.length).toBe(7);
    const firstCheckbox = items[0]!.querySelector('input[type="checkbox"]') as HTMLInputElement;
    act(() => firstCheckbox.click());
    expect(calls.length).toBe(1);
  });

  it('topology 过滤 Popover 打开 + 6 TeamTopologyKind 选项', () => {
    const calls: TeamTopologyKind[][] = [];
    const container = render(
      <TeamRunList {...baseProps({ onTopologyFilterChange: (t) => calls.push(t) })} />,
    );
    const trigger = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('拓扑'),
    ) as HTMLButtonElement;
    expect(trigger).toBeDefined();
    act(() => trigger.click());
    const items = container.querySelectorAll('.session-filter-item');
    expect(items.length).toBe(6);
    const firstCheckbox = items[0]!.querySelector('input[type="checkbox"]') as HTMLInputElement;
    act(() => firstCheckbox.click());
    expect(calls.length).toBe(1);
  });

  it('completeness 过滤 Popover 打开 + 4 CompletenessLevel 选项', () => {
    const calls: CompletenessLevel[][] = [];
    const container = render(
      <TeamRunList {...baseProps({ onCompletenessFilterChange: (c) => calls.push(c) })} />,
    );
    const trigger = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('完整性'),
    ) as HTMLButtonElement;
    expect(trigger).toBeDefined();
    act(() => trigger.click());
    const items = container.querySelectorAll('.session-filter-item');
    expect(items.length).toBe(4);
    const firstCheckbox = items[0]!.querySelector('input[type="checkbox"]') as HTMLInputElement;
    act(() => firstCheckbox.click());
    expect(calls.length).toBe(1);
  });

  it('过滤徽章计数：选中 N 个时 trigger 显示 (N)', () => {
    const container = render(
      <TeamRunList {...baseProps({ providerFilter: ['codex', 'claude'] })} />,
    );
    const trigger = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Provider') || b.textContent?.includes('provider'),
    );
    expect(trigger?.textContent).toContain('(2)');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §7.5 虚拟化
// ═══════════════════════════════════════════════════════════════════════════

describe('TeamRunList 虚拟化', () => {
  it('1000 行只渲染窗口内（< 1000 个 .team-row）', () => {
    const items = Array.from({ length: 1000 }, (_, i) => run(`r-${i}`));
    const container = render(<TeamRunList {...baseProps({ items, total: 1000 })} />);
    const rows = container.querySelectorAll('.team-row');
    // jsdom 默认视口 600px / 44px ≈ 14 + overscan*2=20 → 远小于 1000
    expect(rows.length).toBeLessThan(1000);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('容器有 role=listbox + aria-label', () => {
    const items = [run('r-1')];
    const container = render(<TeamRunList {...baseProps({ items, total: 1 })} />);
    const listbox = container.querySelector('[role="listbox"]');
    expect(listbox).not.toBeNull();
    expect(listbox?.getAttribute('aria-label')).toBe('团队运行');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §7.5 load more
// ═══════════════════════════════════════════════════════════════════════════

describe('TeamRunList load more', () => {
  it('hasMore=true 时渲染 load more 按钮', () => {
    const calls: number[] = [];
    const items = [run('r-1')];
    const container = render(
      <TeamRunList
        {...baseProps({ items, hasMore: true, onLoadMore: () => calls.push(1), total: 100 })}
      />,
    );
    const btn = container.querySelector('.team-load-more') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    act(() => btn.click());
    expect(calls).toEqual([1]);
  });

  it('hasMore=false 时不渲染 load more 按钮', () => {
    const items = [run('r-1')];
    const container = render(
      <TeamRunList {...baseProps({ items, hasMore: false, total: 1 })} />,
    );
    expect(container.querySelector('.team-load-more')).toBeNull();
  });

  it('loading=true 时 load more 按钮 disabled', () => {
    const items = [run('r-1')];
    const container = render(
      <TeamRunList {...baseProps({ items, hasMore: true, loading: true, total: 100 })} />,
    );
    const btn = container.querySelector('.team-load-more') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});
