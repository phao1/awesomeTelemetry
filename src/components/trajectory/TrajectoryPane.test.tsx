import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  SessionAnnotations,
  SessionAnnotationsUpdate,
  SessionDetailResponse,
  SessionIndexEntry,
  SessionMergeGroupInfo,
  TraceEventSlim,
  TraceSession,
  TurnKeySource,
  TurnModel,
} from '../../core/trace-types.js';
import { eventDetailCache } from '../../cache/caches.js';
import { TrajectoryPane } from './TrajectoryPane.js';
import { segmentationCriteriaKey } from './TrajectoryStatBar.js';

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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  eventDetailCache.clear();
  while (containers.length > 0) {
    const container = containers.pop();
    if (container !== undefined) {
      container.remove();
    }
  }
});

function session(over: Partial<TraceSession> = {}): TraceSession {
  return {
    id: 's1',
    provider: 'codex',
    sourceAgent: 'Codex',
    title: 'fix build',
    startedAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:01:00.000Z',
    status: 'success',
    cwd: '/tmp',
    messageCount: 2,
    eventCount: 2,
    tokenUsage: { input: 10, output: 5, reasoning: 0, cacheRead: 0, cacheWrite: 0, netInput: 10, total: 15 },
    costUsd: 0.01,
    systemPrompt: null,
    dataSource: 'scan',
    sourcePath: '/tmp/s1.jsonl',
    totalDurationMs: 1000,
    isSubagent: false,
    ...over,
  };
}

function event(id: string, sequence: number, kind: TraceEventSlim['kind'], over: Partial<TraceEventSlim> = {}): TraceEventSlim {
  return {
    id,
    sessionId: 's1',
    sequence,
    turnKey: null,
    kind,
    phase: 'implement',
    title: `${kind} ${id}`,
    startedAt: `2026-08-01T00:00:${String(sequence).padStart(2, '0')}.000Z`,
    durationMs: 100,
    status: 'success',
    actor: 'assistant',
    tool: kind === 'tool' ? 'Bash' : null,
    tokens: null,
    error: null,
    hasInput: false,
    hasOutput: false,
    hasRaw: false,
    ...over,
  };
}

function detail(events: TraceEventSlim[], over: Partial<SessionDetailResponse> = {}): SessionDetailResponse {
  return {
    session: session(),
    events,
    mode: 'slim',
    eventTotal: events.length,
    eventOffset: 0,
    eventLimit: 2000,
    hasMore: false,
    pending: false,
    ...over,
  };
}

function renderPane(
  d: SessionDetailResponse,
  over: {
    fetchAnnotations?: (key: string) => Promise<SessionAnnotations>;
    saveAnnotations?: (key: string, update: SessionAnnotationsUpdate) => Promise<SessionAnnotations>;
    fetchGroups?: () => Promise<{ groups: SessionMergeGroupInfo[] }>;
    fetchMembers?: (keys: string[]) => Promise<{ items: SessionIndexEntry[] }>;
    onSelectedTurnChange?: (index: number | null) => void;
  } = {},
): { unmount: () => void; html: () => string } {
  const Harness = (): React.JSX.Element => {
    const [turn, setTurn] = useState<number | null>(null);
    const change = over.onSelectedTurnChange ?? setTurn;
    return (
      <TrajectoryPane
        locale="zh"
        sessionKey={d.session.id}
        detail={d}
        ribbonMode="time"
        onRibbonModeChange={() => undefined}
        selectedTurn={turn}
        onSelectedTurnChange={(index) => {
          setTurn(index);
          change(index);
        }}
        onSelectAgent={() => undefined}
        railCollapsed={false}
        onToggleRailCollapse={() => undefined}
        fetchAnnotations={over.fetchAnnotations ?? (async () => ({ sessionKey: 's1', tags: [], note: null, updatedAt: null }))}
        saveAnnotations={over.saveAnnotations}
        fetchGroups={over.fetchGroups ?? (async () => ({ groups: [] }))}
        fetchMembers={over.fetchMembers}
      />
    );
  };
  return mount(<Harness />);
}

describe('TrajectoryPane（D2 / D16）', () => {
  it('打开：1 次 annotations；单 agent 无批量拉取；回合行渲染（llm_boundary）', async () => {
    const fetchAnnotations = vi.fn(async () => ({ sessionKey: 's1', tags: [], note: null, updatedAt: null }));
    const fetchGroups = vi.fn(async () => ({ groups: [] }));
    const fetchMembers = vi.fn(async () => ({ items: [] }));
    const d = detail([event('e1', 1, 'llm'), event('e2', 2, 'llm')]);
    const { html, unmount } = renderPane(d, { fetchAnnotations, fetchGroups, fetchMembers });
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchAnnotations).toHaveBeenCalledTimes(1);
    expect(fetchGroups).toHaveBeenCalledTimes(1);
    expect(fetchMembers).not.toHaveBeenCalled();
    expect(document.querySelectorAll('.turn-row').length).toBe(2);
    // llm_boundary 口径行
    expect(html()).toContain('回合按模型推理事件推断');
    unmount();
  });

  it('多成员组：agent 面板恰好一次批量 keys 拉取（AGENTS.md #6）', async () => {
    const fetchGroups = vi.fn(async () => ({
      groups: [{ id: 'g1', primaryKey: 'main-1', title: 'g', sourceAgent: 'CodeArts', mergedKeys: ['main-1', 'sub-1'], reason: 'config' }],
    }));
    const fetchMembers = vi.fn(async (keys: string[]) => ({
      items: keys.map((id) => ({
        id,
        provider: 'codearts' as const,
        sourceAgent: 'CodeArts',
        title: `member ${id}`,
        startedAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:01:00.000Z',
        status: 'success' as const,
        cwd: '/tmp',
        eventCount: 1,
        messageCount: 1,
        tokenTotal: 1,
        costUsd: 0,
        dataSource: 'scan' as const,
        sourcePath: `/tmp/${id}`,
        detailLoaded: true,
        mergeGroupId: null,
        hasSystemPrompt: false,
        tags: [],
      })),
    }));
    const d = detail([event('e1', 1, 'llm')], {
      session: session({ id: 'main-1', provider: 'codearts', sourceAgent: 'CodeArts' }),
    });
    const { unmount } = renderPane(d, { fetchGroups, fetchMembers });
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchMembers).toHaveBeenCalledTimes(1);
    expect(fetchMembers).toHaveBeenCalledWith(['main-1', 'sub-1']);
    expect(document.querySelectorAll('.agent-node').length).toBe(2);
    unmount();
  });

  it('色带模式切换零请求（D16）', async () => {
    const fetchAnnotations = vi.fn(async () => ({ sessionKey: 's1', tags: [], note: null, updatedAt: null }));
    const d = detail([event('e1', 1, 'llm')]);
    const { unmount } = renderPane(d, { fetchAnnotations });
    await act(async () => {
      await Promise.resolve();
    });
    const before = fetchAnnotations.mock.calls.length;
    act(() => {
      const tokenChip = Array.from(document.querySelectorAll('.trajectory-statbar button')).find(
        (b) => b.textContent === 'Token',
      ) as HTMLButtonElement;
      tokenChip.click();
    });
    expect(fetchAnnotations.mock.calls.length).toBe(before);
    unmount();
  });

  it('回合展开/折叠零请求（D16）；hash turn 回调', async () => {
    const fetchAnnotations = vi.fn(async () => ({ sessionKey: 's1', tags: [], note: null, updatedAt: null }));
    const onSelectedTurnChange = vi.fn();
    const d = detail([event('e1', 1, 'llm'), event('e2', 2, 'llm')]);
    const { unmount } = renderPane(d, { fetchAnnotations, onSelectedTurnChange });
    await act(async () => {
      await Promise.resolve();
    });
    const before = fetchAnnotations.mock.calls.length;
    act(() => {
      (document.querySelector('.turn-row') as HTMLButtonElement).click();
    });
    expect(onSelectedTurnChange).toHaveBeenCalledWith(1);
    expect(fetchAnnotations.mock.calls.length).toBe(before);
    expect(document.querySelector('.turn-card')).not.toBeNull();
    unmount();
  });

  it('200 回合：列表虚拟化，节点数稳定（D20）', async () => {
    const events = Array.from({ length: 200 }, (_, i) => event(`e${i}`, i + 1, 'llm'));
    const d = detail(events, { eventTotal: 200 });
    const { unmount } = renderPane(d);
    await act(async () => {
      await Promise.resolve();
    });
    const mounted = document.querySelectorAll('.turn-row').length;
    expect(mounted).toBeLessThan(200);
    const scrollEl = document.querySelector('.turn-list-scroll') as HTMLDivElement;
    act(() => {
      scrollEl.scrollTop = 44 * 100;
      scrollEl.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    expect(document.querySelectorAll('.turn-row').length).toBeLessThan(200);
    unmount();
  });
});

describe('segmentationCriteriaKey（D3 / D17）', () => {
  const base = (segmentationSource: TurnModel['segmentationSource']): TurnModel => ({
    turns: [],
    segmentationSource,
    complete: true,
    omittedEventCount: 0,
  });

  it('turn_key + native_boundary → 无口径行', () => {
    expect(segmentationCriteriaKey(base('turn_key'), 'native_boundary')).toBeNull();
  });

  it('turn_key + 其余 provenance → turn_key 行（命名 provenance）', () => {
    expect(segmentationCriteriaKey(base('turn_key'), 'stream_structure')).toBe('trajectory.criteria.turnKey');
    expect(segmentationCriteriaKey(base('turn_key'), 'message_identity')).toBe('trajectory.criteria.turnKey');
    expect(segmentationCriteriaKey(base('turn_key'), 'unavailable')).toBe('trajectory.criteria.turnKey');
  });

  it('其余三种 segmentation → 各自口径行', () => {
    expect(segmentationCriteriaKey(base('llm_boundary'), 'unavailable')).toBe('trajectory.criteria.llmBoundary');
    expect(segmentationCriteriaKey(base('user_prompt_boundary'), 'unavailable')).toBe('trajectory.criteria.userPromptBoundary');
    expect(segmentationCriteriaKey(base('sequence_fallback'), 'unavailable')).toBe('trajectory.criteria.sequenceFallback');
  });
});

describe('turnKeySourceForProvider（D3 镜像 adapters 声明）', () => {
  it('codex=stream_structure；claude/codearts=message_identity；qoder=unavailable', async () => {
    const { turnKeySourceForProvider } = await import('../../core/turn-model.js');
    expect(turnKeySourceForProvider('codex')).toBe<TurnKeySource>('stream_structure');
    expect(turnKeySourceForProvider('claude')).toBe<TurnKeySource>('message_identity');
    expect(turnKeySourceForProvider('codearts')).toBe<TurnKeySource>('message_identity');
    expect(turnKeySourceForProvider('qoder')).toBe<TurnKeySource>('unavailable');
    expect(turnKeySourceForProvider('workbuddy')).toBe<TurnKeySource>('unavailable');
  });
});
