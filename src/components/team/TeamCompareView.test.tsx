/**
 * add-agent-team-observability §9.1–9.9 —
 * TeamCompareView 测试。
 *
 * 覆盖：
 * - §9.1 左右选择器：受控、可搜索、同 id 禁用比较 + 提示
 * - §9.2 basis 横幅：match / 8 个 material 字段 / reasons / userDeclared
 * - §9.3 unmatched/unknown 不暗示结构等价（hint 文案出现）
 * - §9.4 五维指标区：speed/accuracy/stability/cost/collaboration 顺序 + 列齐全
 * - §9.5 确定性 strengths/weaknesses/tradeoffs/caveats 直接渲染
 * - §9.6 禁用 winner/score：DOM 中无 winner/score/排序 文案；no-verdict note 出现
 * - §9.7 六状态：loading/empty/error/success/partial/unavailable
 * - §9.8 a11y：table caption、aria-label、role=status/alert、数值 aria-label
 * - §9.9 双语：zh/en 切换关键文案
 *
 * 不 mock 被测逻辑、不放宽断言（AGENTS.md）。
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import type {
  CompletenessLevel,
  TeamComparison,
  TeamComparisonBasis,
  TeamComparisonDimension,
  TeamComparisonMetricRow,
  TeamMetricDimension,
  TeamMetricDirection,
  TeamMetricValue,
  TeamRunSummary,
  ProviderKey,
  TeamRunStatus,
  TeamTopologyKind,
  EvidenceConfidence,
  EvidenceDimension,
} from '../../core/trace-types.js';
import { TeamCompareView, type TeamCompareViewProps, type CompareState } from './TeamCompareView.js';

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

function makeRun(id: string, title: string = `run ${id}`): TeamRunSummary {
  return {
    id,
    provider: 'codex' as ProviderKey,
    nativeRunId: `native-${id}`,
    runIdentityConfidence: 'native' as EvidenceConfidence,
    title,
    goalFingerprint: null,
    status: 'success' as TeamRunStatus,
    startedAt: new Date(Date.now() - 3600 * 1000).toISOString(),
    endedAt: new Date(Date.now() - 3500 * 1000).toISOString(),
    topologyKind: 'two_level' as TeamTopologyKind,
    counts: { agents: 2, tasks: 2, communications: 1, activities: 4, rounds: 2, artifacts: 1 },
    tokenAvailable: true,
    costAvailable: false,
    costCurrency: null,
    completeness: FULL_COMPLETENESS,
    updatedAt: new Date().toISOString(),
    stamp: `stamp-${id}`,
  };
}

function makeMetricValue(value: number | null, over: Partial<TeamMetricValue> = {}): TeamMetricValue {
  return {
    value,
    available: value !== null,
    complete: value !== null,
    criteria: 'measured',
    evidenceIds: value !== null ? ['e-1'] : [],
    numerator: null,
    denominator: null,
    ...over,
  };
}

function makeRow(
  metricId: string,
  dimension: TeamMetricDimension,
  leftVal: number | null,
  rightVal: number | null,
  over: Partial<TeamComparisonMetricRow> = {},
): TeamComparisonMetricRow {
  const left = makeMetricValue(leftVal);
  const right = makeMetricValue(rightVal);
  let delta: number | null = null;
  if (leftVal !== null && rightVal !== null) {
    delta = rightVal - leftVal;
  }
  let relativeDelta: number | null = null;
  if (delta !== null && leftVal !== null && Number.isFinite(leftVal) && leftVal !== 0) {
    relativeDelta = delta / leftVal;
  }
  const completeness: CompletenessLevel =
    leftVal === null && rightVal === null ? 'unavailable' : leftVal !== null && rightVal !== null ? 'complete' : 'partial';
  const direction: TeamMetricDirection = over.direction ?? 'descriptive';
  const material = over.material ?? (relativeDelta !== null ? Math.abs(relativeDelta) >= 0.1 : false);
  return {
    metricId,
    dimension,
    criteria: 'measured',
    direction,
    left,
    right,
    delta,
    relativeDelta,
    material,
    completeness,
    evidenceIds: left.evidenceIds,
    ...over,
  };
}

function makeBasis(over: Partial<TeamComparisonBasis> = {}): TeamComparisonBasis {
  return {
    match: 'matched',
    goalMatch: true,
    criteriaMatch: true,
    projectMatch: true,
    revisionMatch: true,
    environmentMatch: true,
    modelMatch: true,
    templateMatch: true,
    completenessDelta: false,
    userDeclared: false,
    reasons: [],
    ...over,
  };
}

function makeDimension(dim: TeamMetricDimension, rows: TeamComparisonMetricRow[]): TeamComparisonDimension {
  return { dimension: dim, rows };
}

function makeComparison(over: Partial<TeamComparison> = {}): TeamComparison {
  const speedRows = [
    makeRow('wallClockMs', 'speed', 1000, 800, { direction: 'lower_better' }),
  ];
  const accuracyRows = [
    makeRow('taskCompletion', 'accuracy', 0.8, 0.9, { direction: 'higher_better' }),
  ];
  const stabilityRows = [
    makeRow('failures', 'stability', 2, 1, { direction: 'lower_better' }),
  ];
  const costRows = [
    makeRow('totalCostUsd', 'cost', 0.5, 0.7, { direction: 'lower_better' }),
    makeRow('totalInputTokens', 'cost', 1000, 2000, { direction: 'descriptive' }),
  ];
  const collabRows = [
    makeRow('directRatio', 'collaboration', null, null, { direction: 'descriptive' }),
  ];
  return {
    leftRunId: 'r-left',
    rightRunId: 'r-right',
    basis: makeBasis(),
    dimensions: [
      makeDimension('speed', speedRows),
      makeDimension('accuracy', accuracyRows),
      makeDimension('stability', stabilityRows),
      makeDimension('cost', costRows),
      makeDimension('collaboration', collabRows),
    ],
    strengths: ['右运行 wall-clock 减少 20%'],
    weaknesses: ['右运行失败次数增加 40%'],
    tradeoffs: ['更快但工具错误更多'],
    caveats: ['协作维度不可用'],
    generatedAt: new Date().toISOString(),
    ...over,
  };
}

function render(node: React.JSX.Element): HTMLDivElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  act(() => { createRoot(container).render(node); });
  return container;
}

function baseProps(over: Partial<TeamCompareViewProps> = {}): TeamCompareViewProps {
  return {
    locale: 'zh',
    runs: [makeRun('r-left', '左运行'), makeRun('r-right', '右运行'), makeRun('r-other', '其他运行')],
    leftRunId: null,
    rightRunId: null,
    manualBasis: false,
    comparison: null,
    state: 'empty' as CompareState,
    error: null,
    onLeftRunIdChange: () => undefined,
    onRightRunIdChange: () => undefined,
    onManualBasisToggle: () => undefined,
    onRunCompare: () => undefined,
    ...over,
  };
}

/** 在 React 受控 input 上设置 value 并触发 input 事件。 */
function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

/** 触发 focus 事件以打开 listbox。 */
function focusInput(input: HTMLInputElement): void {
  input.focus();
  input.dispatchEvent(new Event('focusin', { bubbles: true }));
}

afterEach(() => { document.body.innerHTML = ''; });

// ═══════════════════════════════════════════════════════════════════════════
// §9.1 左右选择器
// ═══════════════════════════════════════════════════════════════════════════

describe('§9.1 左右 run 选择器', () => {
  it('渲染两个受控 input（left/right）+ manual basis + run 按钮', () => {
    const c = render(<TeamCompareView {...baseProps()} />);
    const inputs = c.querySelectorAll('input[type="text"]');
    expect(inputs).toHaveLength(2);
    const checkbox = c.querySelector('input[type="checkbox"]');
    expect(checkbox).not.toBeNull();
    const btn = c.querySelector('button.team-compare-view-run-btn');
    expect(btn).not.toBeNull();
  });

  it('input 受控：value 来自 props.leftRunId / rightRunId', () => {
    const c = render(
      <TeamCompareView
        {...baseProps({ leftRunId: 'r-left', rightRunId: 'r-right' })}
      />,
    );
    const inputs = c.querySelectorAll('input[type="text"]');
    expect((inputs[0] as HTMLInputElement).value).toBe('r-left');
    expect((inputs[1] as HTMLInputElement).value).toBe('r-right');
  });

  it('onChange 回调触发 onLeftRunIdChange / onRightRunIdChange', () => {
    let leftChanged: string | null = null;
    let rightChanged: string | null = null;
    const c = render(
      <TeamCompareView
        {...baseProps({
          onLeftRunIdChange: (id) => { leftChanged = id; },
          onRightRunIdChange: (id) => { rightChanged = id; },
        })}
      />,
    );
    const inputs = c.querySelectorAll('input[type="text"]');
    act(() => setInputValue(inputs[0] as HTMLInputElement, 'abc'));
    expect(leftChanged).toBe('abc');
    act(() => setInputValue(inputs[1] as HTMLInputElement, 'xyz'));
    expect(rightChanged).toBe('xyz');
  });

  it('空字符串 → null（清空）', () => {
    let leftChanged: string | null = 'initial';
    const c = render(
      <TeamCompareView
        {...baseProps({
          leftRunId: 'r-left',
          onLeftRunIdChange: (id) => { leftChanged = id; },
        })}
      />,
    );
    const inputs = c.querySelectorAll('input[type="text"]');
    act(() => setInputValue(inputs[0] as HTMLInputElement, ''));
    expect(leftChanged).toBeNull();
  });

  it('可搜索下拉：focus 时显示 listbox + option', () => {
    const c = render(<TeamCompareView {...baseProps()} />);
    const input = c.querySelector('input[type="text"]') as HTMLInputElement;
    act(() => focusInput(input));
    const listbox = c.querySelector('.team-compare-view-listbox');
    expect(listbox).not.toBeNull();
    const options = c.querySelectorAll('.team-compare-view-option');
    expect(options.length).toBe(3);
  });

  it('选择器本身不发请求（无 fetch / 无 onRunCompare 触发）', () => {
    let compareCalls = 0;
    const c = render(
      <TeamCompareView
        {...baseProps({ onRunCompare: () => { compareCalls += 1; } })}
      />,
    );
    const inputs = c.querySelectorAll('input[type="text"]');
    act(() => setInputValue(inputs[0] as HTMLInputElement, 'r-left'));
    expect(compareCalls).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §9.1 同 id 禁用比较
// ═══════════════════════════════════════════════════════════════════════════

describe('§9.1 同 id 禁用比较', () => {
  it('left === right → 按钮禁用 + same-id 提示', () => {
    const c = render(
      <TeamCompareView
        {...baseProps({ leftRunId: 'r-same', rightRunId: 'r-same' })}
      />,
    );
    const btn = c.querySelector('button.team-compare-view-run-btn') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    const sameIdNote = c.querySelector('.team-compare-view-same-id');
    expect(sameIdNote).not.toBeNull();
    expect(sameIdNote!.getAttribute('role')).toBe('alert');
    expect(sameIdNote!.textContent).toContain('不能相同');
  });

  it('left !== right → 按钮启用 + 无 same-id 提示', () => {
    const c = render(
      <TeamCompareView
        {...baseProps({ leftRunId: 'r-a', rightRunId: 'r-b' })}
      />,
    );
    const btn = c.querySelector('button.team-compare-view-run-btn') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    expect(c.querySelector('.team-compare-view-same-id')).toBeNull();
  });

  it('left 或 right 为 null → 按钮禁用', () => {
    const c1 = render(
      <TeamCompareView
        {...baseProps({ leftRunId: null, rightRunId: 'r-b' })}
      />,
    );
    const btn1 = c1.querySelector('button.team-compare-view-run-btn') as HTMLButtonElement;
    expect(btn1.disabled).toBe(true);

    const c2 = render(
      <TeamCompareView
        {...baseProps({ leftRunId: 'r-a', rightRunId: null })}
      />,
    );
    const btn2 = c2.querySelector('button.team-compare-view-run-btn') as HTMLButtonElement;
    expect(btn2.disabled).toBe(true);
  });

  it('en locale：same-id 提示为英文', () => {
    const c = render(
      <TeamCompareView
        {...baseProps({
          locale: 'en',
          leftRunId: 'r-same',
          rightRunId: 'r-same',
        })}
      />,
    );
    const sameIdNote = c.querySelector('.team-compare-view-same-id');
    expect(sameIdNote!.textContent).toContain('must differ');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §9.2 basis 横幅
// ═══════════════════════════════════════════════════════════════════════════

describe('§9.2 basis 横幅', () => {
  it('渲染 match 标签 + 8 个 material 字段', () => {
    const comparison = makeComparison();
    const c = render(
      <TeamCompareView
        {...baseProps({
          comparison,
          state: 'success',
          leftRunId: 'r-left',
          rightRunId: 'r-right',
        })}
      />,
    );
    const basis = c.querySelector('.team-compare-view-basis');
    expect(basis).not.toBeNull();
    const matchLabel = c.querySelector('.team-compare-view-basis-match');
    expect(matchLabel!.textContent).toBe('匹配');
    const fields = c.querySelectorAll('.team-compare-view-basis-field');
    expect(fields).toHaveLength(8);
  });

  it('basis.match=partially_matched → partially_matched class', () => {
    const comparison = makeComparison({ basis: makeBasis({ match: 'partially_matched' }) });
    const c = render(
      <TeamCompareView
        {...baseProps({ comparison, state: 'success' })}
      />,
    );
    const basis = c.querySelector('.team-compare-view-basis');
    expect(basis!.classList.contains('team-compare-view-basis-partially_matched')).toBe(true);
  });

  it('basis.match=unmatched → unmatched class + unmatched hint', () => {
    const comparison = makeComparison({ basis: makeBasis({ match: 'unmatched' }) });
    const c = render(
      <TeamCompareView
        {...baseProps({ comparison, state: 'success' })}
      />,
    );
    const basis = c.querySelector('.team-compare-view-basis');
    expect(basis!.classList.contains('team-compare-view-basis-unmatched')).toBe(true);
    const hint = c.querySelector('.team-compare-view-basis-hint-unmatched');
    expect(hint).not.toBeNull();
    expect(hint!.getAttribute('role')).toBe('status');
  });

  it('basis.match=unknown → unknown class + unknown hint', () => {
    const comparison = makeComparison({ basis: makeBasis({ match: 'unknown' }) });
    const c = render(
      <TeamCompareView
        {...baseProps({ comparison, state: 'success' })}
      />,
    );
    const basis = c.querySelector('.team-compare-view-basis');
    expect(basis!.classList.contains('team-compare-view-basis-unknown')).toBe(true);
    const hint = c.querySelector('.team-compare-view-basis-hint-unknown');
    expect(hint).not.toBeNull();
  });

  it('userDeclared=true → 显示 manual badge', () => {
    const comparison = makeComparison({ basis: makeBasis({ userDeclared: true }) });
    const c = render(
      <TeamCompareView
        {...baseProps({ comparison, state: 'success' })}
      />,
    );
    const badge = c.querySelector('.team-compare-view-basis-manual');
    expect(badge).not.toBeNull();
    expect(badge!.getAttribute('role')).toBe('note');
  });

  it('userDeclared=false → 不显示 manual badge', () => {
    const comparison = makeComparison({ basis: makeBasis({ userDeclared: false }) });
    const c = render(
      <TeamCompareView
        {...baseProps({ comparison, state: 'success' })}
      />,
    );
    expect(c.querySelector('.team-compare-view-basis-manual')).toBeNull();
  });

  it('reasons 非空 → 渲染 reasons 列表', () => {
    const comparison = makeComparison({
      basis: makeBasis({ reasons: ['目标不同', '模型不同'] }),
    });
    const c = render(
      <TeamCompareView
        {...baseProps({ comparison, state: 'success' })}
      />,
    );
    const reasons = c.querySelectorAll('.team-compare-view-basis-reasons li');
    expect(reasons).toHaveLength(2);
    expect(reasons[0]!.textContent).toBe('目标不同');
  });

  it('字段三态：true=一致 / false=不同 / null=未知', () => {
    const comparison = makeComparison({
      basis: makeBasis({
        goalMatch: true,
        projectMatch: false,
        modelMatch: null,
      }),
    });
    const c = render(
      <TeamCompareView
        {...baseProps({ comparison, state: 'success' })}
      />,
    );
    const yesField = c.querySelector('.team-compare-view-basis-field-yes .team-compare-view-basis-field-state');
    const noField = c.querySelector('.team-compare-view-basis-field-no .team-compare-view-basis-field-state');
    const unknownField = c.querySelector('.team-compare-view-basis-field-unknown .team-compare-view-basis-field-state');
    expect(yesField!.textContent).toBe('一致');
    expect(noField!.textContent).toBe('不同');
    expect(unknownField!.textContent).toBe('未知');
  });

  it('en locale：字段三态英文', () => {
    const comparison = makeComparison({
      basis: makeBasis({ goalMatch: true, projectMatch: false, modelMatch: null }),
    });
    const c = render(
      <TeamCompareView
        {...baseProps({ locale: 'en', comparison, state: 'success' })}
      />,
    );
    const yesField = c.querySelector('.team-compare-view-basis-field-yes .team-compare-view-basis-field-state');
    const noField = c.querySelector('.team-compare-view-basis-field-no .team-compare-view-basis-field-state');
    const unknownField = c.querySelector('.team-compare-view-basis-field-unknown .team-compare-view-basis-field-state');
    expect(yesField!.textContent).toBe('match');
    expect(noField!.textContent).toBe('differ');
    expect(unknownField!.textContent).toBe('unknown');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §9.4 五维指标区
// ═══════════════════════════════════════════════════════════════════════════

describe('§9.4 五维指标区', () => {
  it('keeps Team Token rows but removes monetary values, distributions and generated verdicts without changing evidence',()=>{
    const comparison=makeComparison({dimensions:[makeDimension('cost',[makeRow('totalCostUsd','cost',456789.1234,987654.5678),makeRow('costGini','cost',0.1,0.5),makeRow('totalInputTokens','cost',12345,23456)])],strengths:['totalCostUsd decreased 20%','wallClockMs decreased 10%'],weaknesses:['费用增加 30%'],tradeoffs:['更快但更贵'],caveats:['cost dimension unavailable in at least one run','timing is partial']});
    const c=render(<TeamCompareView {...baseProps({comparison,state:'success',locale:'en'})}/>);
    expect(c.textContent).toContain('totalInputTokens');expect(c.textContent).toContain('12345');expect(c.textContent).toContain('23456');
    expect(c.textContent).not.toContain('totalCostUsd');expect(c.textContent).not.toContain('costGini');expect(c.textContent).not.toContain('456789.1234');expect(c.textContent).not.toContain('费用增加');expect(c.textContent).not.toContain('更贵');expect(c.textContent).not.toContain('cost dimension');
    expect(c.textContent).toContain('wallClockMs decreased 10%');expect(c.textContent).toContain('timing is partial');expect(comparison.dimensions[0]?.rows).toHaveLength(3);
  });
  it('渲染 5 个 dimension table，顺序 speed/accuracy/stability/cost/collaboration', () => {
    const comparison = makeComparison();
    const c = render(
      <TeamCompareView
        {...baseProps({ comparison, state: 'success' })}
      />,
    );
    const dims = c.querySelectorAll('.team-compare-view-dimension');
    expect(dims).toHaveLength(5);
    const titles = Array.from(dims).map((d) => d.querySelector('.team-compare-view-dimension-title')!.textContent);
    expect(titles).toEqual(['速度', '准确性', '稳定性', 'Token 用量', '协作']);
  });

  it('每个 table 有 caption（a11y）', () => {
    const comparison = makeComparison();
    const c = render(
      <TeamCompareView
        {...baseProps({ comparison, state: 'success' })}
      />,
    );
    const captions = c.querySelectorAll('.team-compare-view-table caption');
    expect(captions).toHaveLength(5);
    for (const cap of captions) {
      expect(cap.classList.contains('team-compare-view-table-caption')).toBe(true);
    }
  });

  it('表头 10 列：metric/left/right/Δ/%/direction/material/completeness/criteria/evidence', () => {
    const comparison = makeComparison();
    const c = render(
      <TeamCompareView
        {...baseProps({ comparison, state: 'success' })}
      />,
    );
    const firstTable = c.querySelector('.team-compare-view-table')!;
    const headers = firstTable.querySelectorAll('thead th[scope="col"]');
    expect(headers).toHaveLength(10);
    const headerTexts = Array.from(headers).map((h) => h.textContent);
    expect(headerTexts).toContain('指标');
    expect(headerTexts).toContain('左值');
    expect(headerTexts).toContain('右值');
    expect(headerTexts).toContain('差值 Δ');
    expect(headerTexts).toContain('相对变化 %');
    expect(headerTexts).toContain('方向');
    expect(headerTexts).toContain('重要性');
    expect(headerTexts).toContain('完整性');
    expect(headerTexts).toContain('口径');
    expect(headerTexts).toContain('证据');
  });

  it('行渲染 raw left/right + delta + relativeDelta', () => {
    const comparison = makeComparison();
    const c = render(
      <TeamCompareView
        {...baseProps({ comparison, state: 'success' })}
      />,
    );
    const firstRow = c.querySelector('.team-compare-view-table tbody tr')!;
    const cells = firstRow.querySelectorAll('td');
    // cells[0]=left, [1]=right, [2]=delta, [3]=relativeDelta, ...
    expect(cells[0]!.textContent).toBe('1000');
    expect(cells[1]!.textContent).toBe('800');
    expect(cells[2]!.textContent).toBe('-200');
    expect(cells[3]!.textContent).toBe('-20.0%');
  });

  it('null 值渲染为 —（不冒充 0）', () => {
    const comparison = makeComparison({
      dimensions: [
        makeDimension('collaboration', [
          makeRow('directRatio', 'collaboration', null, null, { direction: 'descriptive' }),
        ]),
        makeDimension('speed', []),
        makeDimension('accuracy', []),
        makeDimension('stability', []),
        makeDimension('cost', []),
      ],
    });
    const c = render(
      <TeamCompareView
        {...baseProps({ comparison, state: 'success' })}
      />,
    );
    const firstRow = c.querySelector('.team-compare-view-table tbody tr')!;
    const cells = firstRow.querySelectorAll('td');
    expect(cells[0]!.textContent).toBe('—');
    expect(cells[1]!.textContent).toBe('—');
    expect(cells[2]!.textContent).toBe('—');
    expect(cells[3]!.textContent).toBe('—');
  });

  it('material 行有 team-compare-view-row-material class', () => {
    const comparison = makeComparison({
      dimensions: [
        makeDimension('speed', [
          makeRow('wallClockMs', 'speed', 1000, 500, { direction: 'lower_better', material: true }),
        ]),
        makeDimension('accuracy', []),
        makeDimension('stability', []),
        makeDimension('cost', []),
        makeDimension('collaboration', []),
      ],
    });
    const c = render(
      <TeamCompareView
        {...baseProps({ comparison, state: 'success' })}
      />,
    );
    const row = c.querySelector('.team-compare-view-table tbody tr')!;
    expect(row.classList.contains('team-compare-view-row-material')).toBe(true);
  });

  it('direction tag 渲染 + class', () => {
    const comparison = makeComparison();
    const c = render(
      <TeamCompareView
        {...baseProps({ comparison, state: 'success' })}
      />,
    );
    const dirTag = c.querySelector('.team-compare-view-direction-tag')!;
    expect(dirTag.classList.contains('team-compare-view-direction-lower_better')).toBe(true);
    expect(dirTag.textContent).toBe('越低越好');
  });

  it('completeness tag 渲染 + class', () => {
    const comparison = makeComparison();
    const c = render(
      <TeamCompareView
        {...baseProps({ comparison, state: 'success' })}
      />,
    );
    const compTags = c.querySelectorAll('.team-compare-view-completeness-tag');
    expect(compTags.length).toBeGreaterThan(0);
    const firstTag = compTags[0]!;
    // wallClockMs left=1000 right=800 → complete
    expect(firstTag.classList.contains('team-compare-view-completeness-complete')).toBe(true);
  });

  it('evidence 计数渲染', () => {
    const comparison = makeComparison();
    const c = render(
      <TeamCompareView
        {...baseProps({ comparison, state: 'success' })}
      />,
    );
    const evidenceCells = c.querySelectorAll('.team-compare-view-evidence');
    expect(evidenceCells.length).toBeGreaterThan(0);
    // wallClockMs 有 1 条证据
    expect(evidenceCells[0]!.textContent).toContain('1');
    expect(evidenceCells[0]!.textContent).toContain('证据');
  });

  it('en locale：维度标题英文', () => {
    const comparison = makeComparison();
    const c = render(
      <TeamCompareView
        {...baseProps({ locale: 'en', comparison, state: 'success' })}
      />,
    );
    const dims = c.querySelectorAll('.team-compare-view-dimension-title');
    const titles = Array.from(dims).map((d) => d.textContent);
    expect(titles).toEqual(['Speed', 'Accuracy', 'Stability', 'Token usage', 'Collaboration']);
  });

  it('数值单元格有 aria-label 描述语义', () => {
    const comparison = makeComparison();
    const c = render(
      <TeamCompareView
        {...baseProps({ comparison, state: 'success' })}
      />,
    );
    const firstRow = c.querySelector('.team-compare-view-table tbody tr')!;
    const cells = firstRow.querySelectorAll('td.mono');
    expect(cells.length).toBeGreaterThanOrEqual(4);
    expect(cells[0]!.getAttribute('aria-label')).toContain('左值');
    expect(cells[1]!.getAttribute('aria-label')).toContain('右值');
    expect(cells[2]!.getAttribute('aria-label')).toContain('差值');
    expect(cells[3]!.getAttribute('aria-label')).toContain('相对变化');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §9.5 确定性 strengths/weaknesses/tradeoffs/caveats
// ═══════════════════════════════════════════════════════════════════════════

describe('§9.5 确定性 verdicts', () => {
  it('matched basis → 渲染 strengths/weaknesses/tradeoffs/caveats', () => {
    const comparison = makeComparison();
    const c = render(
      <TeamCompareView
        {...baseProps({ comparison, state: 'success' })}
      />,
    );
    const strengths = c.querySelectorAll('.team-compare-view-strengths li');
    expect(strengths).toHaveLength(1);
    expect(strengths[0]!.textContent).toBe('右运行 wall-clock 减少 20%');
    const weaknesses = c.querySelectorAll('.team-compare-view-weaknesses li');
    expect(weaknesses).toHaveLength(1);
    const tradeoffs = c.querySelectorAll('.team-compare-view-tradeoffs li');
    expect(tradeoffs).toHaveLength(1);
    const caveats = c.querySelectorAll('.team-compare-view-caveats li');
    expect(caveats).toHaveLength(1);
  });

  it('partially_matched basis → 仍渲染 verdicts', () => {
    const comparison = makeComparison({ basis: makeBasis({ match: 'partially_matched' }) });
    const c = render(
      <TeamCompareView
        {...baseProps({ comparison, state: 'success' })}
      />,
    );
    expect(c.querySelector('.team-compare-view-strengths')).not.toBeNull();
    expect(c.querySelector('.team-compare-view-weaknesses')).not.toBeNull();
  });

  it('unmatched basis → 不渲染 verdicts（§9.6）', () => {
    const comparison = makeComparison({ basis: makeBasis({ match: 'unmatched' }) });
    const c = render(
      <TeamCompareView
        {...baseProps({ comparison, state: 'success' })}
      />,
    );
    expect(c.querySelector('.team-compare-view-strengths')).toBeNull();
    expect(c.querySelector('.team-compare-view-weaknesses')).toBeNull();
    expect(c.querySelector('.team-compare-view-tradeoffs')).toBeNull();
    expect(c.querySelector('.team-compare-view-caveats')).toBeNull();
  });

  it('unknown basis → 不渲染 verdicts（§9.6）', () => {
    const comparison = makeComparison({ basis: makeBasis({ match: 'unknown' }) });
    const c = render(
      <TeamCompareView
        {...baseProps({ comparison, state: 'success' })}
      />,
    );
    expect(c.querySelector('.team-compare-view-strengths')).toBeNull();
    expect(c.querySelector('.team-compare-view-weaknesses')).toBeNull();
  });

  it('空 strengths → 不渲染 strengths section', () => {
    const comparison = makeComparison({ strengths: [] });
    const c = render(
      <TeamCompareView
        {...baseProps({ comparison, state: 'success' })}
      />,
    );
    expect(c.querySelector('.team-compare-view-strengths')).toBeNull();
  });

  it('verdict 文案直接来自服务端响应（前端不独立写 verdict）', () => {
    const comparison = makeComparison({
      strengths: ['服务端给的句子 A'],
      weaknesses: ['服务端给的句子 B'],
    });
    const c = render(
      <TeamCompareView
        {...baseProps({ comparison, state: 'success' })}
      />,
    );
    expect(c.querySelector('.team-compare-view-strengths li')!.textContent).toBe('服务端给的句子 A');
    expect(c.querySelector('.team-compare-view-weaknesses li')!.textContent).toBe('服务端给的句子 B');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §9.6 禁用 winner/score
// ═══════════════════════════════════════════════════════════════════════════

describe('§9.6 禁用 winner/score', () => {
  it('DOM 中无 "winner:" / "赢家是" / "总体评分:" / "overall score:" 等结论性文案', () => {
    const comparison = makeComparison();
    const c = render(
      <TeamCompareView
        {...baseProps({ comparison, state: 'success' })}
      />,
    );
    const text = c.textContent ?? '';
    // 不出现「赢家是 X」「winner: X」这类把某个 run 标为赢家的结论
    expect(text).not.toMatch(/赢家是|winner:\s|winner\s+is\s/i);
    // 不出现「总体评分: 0.8」「overall score: 0.8」这类总评分
    expect(text).not.toMatch(/总体评分[：:]\s*\d|overall\s+score[：:]\s*\d/i);
  });

  it('显示 no-verdict note（无赢家/无评分声明）', () => {
    const comparison = makeComparison();
    const c = render(
      <TeamCompareView
        {...baseProps({ comparison, state: 'success' })}
      />,
    );
    const note = c.querySelector('.team-compare-view-no-verdict');
    expect(note).not.toBeNull();
    expect(note!.getAttribute('role')).toBe('note');
    expect(note!.textContent).toContain('不输出总体评分或赢家');
  });

  it('en locale：no-verdict note 英文', () => {
    const comparison = makeComparison();
    const c = render(
      <TeamCompareView
        {...baseProps({ locale: 'en', comparison, state: 'success' })}
      />,
    );
    const note = c.querySelector('.team-compare-view-no-verdict');
    expect(note!.textContent).toContain('no overall score or winner');
  });

  it('不排序 run（左/右顺序固定，无"赢家在前"等逻辑）', () => {
    const comparison = makeComparison({ leftRunId: 'r-left', rightRunId: 'r-right' });
    const c = render(
      <TeamCompareView
        {...baseProps({ comparison, state: 'success', leftRunId: 'r-left', rightRunId: 'r-right' })}
      />,
    );
    // 输入框顺序：left 在前，right 在后
    const inputs = c.querySelectorAll('input[type="text"]');
    expect((inputs[0] as HTMLInputElement).value).toBe('r-left');
    expect((inputs[1] as HTMLInputElement).value).toBe('r-right');
  });

  it('不显示 infinity / unknown-as-zero：null → —', () => {
    const comparison = makeComparison({
      dimensions: [
        makeDimension('cost', [
          makeRow('totalInputTokens', 'cost', null, null, { direction: 'descriptive' }),
        ]),
        makeDimension('speed', []),
        makeDimension('accuracy', []),
        makeDimension('stability', []),
        makeDimension('collaboration', []),
      ],
    });
    const c = render(
      <TeamCompareView
        {...baseProps({ comparison, state: 'success' })}
      />,
    );
    const firstRow = c.querySelector('.team-compare-view-table tbody tr')!;
    const cells = firstRow.querySelectorAll('td.mono');
    expect(cells[0]!.textContent).toBe('—');
    expect(cells[1]!.textContent).toBe('—');
    expect(cells[2]!.textContent).toBe('—');
    expect(cells[3]!.textContent).toBe('—');
    // 不出现 Infinity / ∞
    const rowText = firstRow.textContent ?? '';
    expect(rowText).not.toContain('Infinity');
    expect(rowText).not.toContain('∞');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §9.7 六状态
// ═══════════════════════════════════════════════════════════════════════════

describe('§9.7 六状态', () => {
  it('loading → skeleton + role=status', () => {
    const c = render(
      <TeamCompareView
        {...baseProps({ state: 'loading' })}
      />,
    );
    const loading = c.querySelector('.team-compare-view-loading');
    expect(loading).not.toBeNull();
    expect(loading!.getAttribute('role')).toBe('status');
  });

  it('empty → empty state + empty hint', () => {
    const c = render(
      <TeamCompareView
        {...baseProps({ state: 'empty' })}
      />,
    );
    const text = c.textContent ?? '';
    expect(text).toContain('未运行对比');
  });

  it('error → error state + retry', () => {
    let retried = false;
    const c = render(
      <TeamCompareView
        {...baseProps({
          state: 'error',
          error: '网络失败',
          onRunCompare: () => { retried = true; },
        })}
      />,
    );
    const err = c.querySelector('.ui-error');
    expect(err).not.toBeNull();
    expect(err?.textContent).toContain('网络失败');
    // ErrorState 渲染 retry 按钮（在 .ui-error 内）
    const retryBtn = err?.querySelector('button') as HTMLButtonElement;
    expect(retryBtn).not.toBeNull();
    act(() => retryBtn.click());
    expect(retried).toBe(true);
  });

  it('success → 渲染 comparison result', () => {
    const comparison = makeComparison();
    const c = render(
      <TeamCompareView
        {...baseProps({ comparison, state: 'success' })}
      />,
    );
    expect(c.querySelector('.team-compare-view-result')).not.toBeNull();
    expect(c.querySelector('.team-compare-view-basis')).not.toBeNull();
  });

  it('partial → partial banner + result', () => {
    const comparison = makeComparison();
    const c = render(
      <TeamCompareView
        {...baseProps({ comparison, state: 'partial' })}
      />,
    );
    const banner = c.querySelector('.team-compare-view-partial-banner');
    expect(banner).not.toBeNull();
    expect(banner!.getAttribute('role')).toBe('status');
    expect(banner!.textContent).toContain('部分维度不可用');
    expect(c.querySelector('.team-compare-view-result')).not.toBeNull();
  });

  it('unavailable → unavailable hint', () => {
    const c = render(
      <TeamCompareView
        {...baseProps({ state: 'unavailable' })}
      />,
    );
    const text = c.textContent ?? '';
    expect(text).toContain('对比数据不可用');
  });

  it('partial + comparison=null → 无 partial banner（无内容可标 partial）', () => {
    const c = render(
      <TeamCompareView
        {...baseProps({ comparison: null, state: 'partial' })}
      />,
    );
    expect(c.querySelector('.team-compare-view-partial-banner')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §9.8 a11y
// ═══════════════════════════════════════════════════════════════════════════

describe('§9.8 a11y', () => {
  it('根容器有 aria-label', () => {
    const c = render(<TeamCompareView {...baseProps()} />);
    const root = c.querySelector('.team-compare-view');
    expect(root!.getAttribute('aria-label')).toBe('团队对比');
  });

  it('每个 table 有 caption（screen reader 可读）', () => {
    const comparison = makeComparison();
    const c = render(
      <TeamCompareView
        {...baseProps({ comparison, state: 'success' })}
      />,
    );
    const tables = c.querySelectorAll('table');
    expect(tables).toHaveLength(5);
    for (const table of tables) {
      const caption = table.querySelector('caption');
      expect(caption).not.toBeNull();
      expect(caption!.textContent!.length).toBeGreaterThan(0);
    }
  });

  it('每个 dimension section 有 aria-labelledby 指向标题', () => {
    const comparison = makeComparison();
    const c = render(
      <TeamCompareView
        {...baseProps({ comparison, state: 'success' })}
      />,
    );
    const sections = c.querySelectorAll('.team-compare-view-dimension');
    for (const sec of sections) {
      const labelledBy = sec.getAttribute('aria-labelledby');
      expect(labelledBy).not.toBeNull();
      const title = sec.querySelector(`#${labelledBy}`);
      expect(title).not.toBeNull();
    }
  });

  it('basis section 有 aria-labelledby', () => {
    const comparison = makeComparison();
    const c = render(
      <TeamCompareView
        {...baseProps({ comparison, state: 'success' })}
      />,
    );
    const basis = c.querySelector('.team-compare-view-basis');
    const labelledBy = basis!.getAttribute('aria-labelledby');
    expect(labelledBy).not.toBeNull();
    const title = c.querySelector(`#${labelledBy}`);
    expect(title).not.toBeNull();
  });

  it('same-id 提示 role=alert', () => {
    const c = render(
      <TeamCompareView
        {...baseProps({ leftRunId: 'x', rightRunId: 'x' })}
      />,
    );
    const note = c.querySelector('.team-compare-view-same-id');
    expect(note!.getAttribute('role')).toBe('alert');
  });

  it('loading role=status aria-live=polite', () => {
    const c = render(
      <TeamCompareView
        {...baseProps({ state: 'loading' })}
      />,
    );
    const loading = c.querySelector('.team-compare-view-loading');
    expect(loading!.getAttribute('role')).toBe('status');
    expect(loading!.getAttribute('aria-live')).toBe('polite');
  });

  it('basis fields role=list + listitem', () => {
    const comparison = makeComparison();
    const c = render(
      <TeamCompareView
        {...baseProps({ comparison, state: 'success' })}
      />,
    );
    const fields = c.querySelector('.team-compare-view-basis-fields');
    expect(fields!.getAttribute('role')).toBe('list');
    const items = c.querySelectorAll('.team-compare-view-basis-field');
    for (const item of items) {
      expect(item.getAttribute('role')).toBe('listitem');
    }
  });

  it('RunSelector input 有 aria-autocomplete / aria-controls', () => {
    const c = render(<TeamCompareView {...baseProps()} />);
    const input = c.querySelector('input[type="text"]')!;
    expect(input.getAttribute('aria-autocomplete')).toBe('list');
    expect(input.getAttribute('aria-controls')).not.toBeNull();
  });

  it('listbox role=listbox + option role=option + aria-selected', () => {
    const c = render(<TeamCompareView {...baseProps()} />);
    const input = c.querySelector('input[type="text"]') as HTMLInputElement;
    act(() => focusInput(input));
    const listbox = c.querySelector('.team-compare-view-listbox');
    expect(listbox).not.toBeNull();
    expect(listbox!.getAttribute('role')).toBe('listbox');
    const options = c.querySelectorAll('.team-compare-view-option');
    for (const opt of options) {
      expect(opt.getAttribute('role')).toBe('option');
      expect(opt.hasAttribute('aria-selected')).toBe(true);
    }
  });

  it('数值单元格 aria-label 包含语义（非纯数字）', () => {
    const comparison = makeComparison();
    const c = render(
      <TeamCompareView
        {...baseProps({ comparison, state: 'success' })}
      />,
    );
    const firstRow = c.querySelector('.team-compare-view-table tbody tr')!;
    const leftCell = firstRow.querySelector('td.mono')!;
    const ariaLabel = leftCell.getAttribute('aria-label');
    expect(ariaLabel).not.toBeNull();
    expect(ariaLabel!).toContain('左值');
    expect(ariaLabel!).toContain('1000');
  });

  it('manual basis checkbox 关联 label', () => {
    const c = render(<TeamCompareView {...baseProps()} />);
    const label = c.querySelector('.team-compare-view-manual');
    expect(label).not.toBeNull();
    const checkbox = label!.querySelector('input[type="checkbox"]');
    expect(checkbox).not.toBeNull();
  });

  it('manual basis toggle 触发回调', () => {
    let toggled = false;
    const c = render(
      <TeamCompareView
        {...baseProps({ onManualBasisToggle: () => { toggled = true; } })}
      />,
    );
    const checkbox = c.querySelector('.team-compare-view-manual input[type="checkbox"]')!;
    act(() => {
      checkbox.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(toggled).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §9.9 双语
// ═══════════════════════════════════════════════════════════════════════════

describe('§9.9 双语', () => {
  it('zh：选择器标签 / 按钮 / basis match 中文', () => {
    const comparison = makeComparison();
    const c = render(
      <TeamCompareView
        {...baseProps({ comparison, state: 'success' })}
      />,
    );
    const labels = c.querySelectorAll('.team-compare-view-label');
    expect(labels[0]!.textContent).toBe('左运行');
    expect(labels[1]!.textContent).toBe('右运行');
    const btn = c.querySelector('.team-compare-view-run-btn');
    expect(btn!.textContent).toBe('运行对比');
    const match = c.querySelector('.team-compare-view-basis-match');
    expect(match!.textContent).toBe('匹配');
  });

  it('en：选择器标签 / 按钮 / basis match 英文', () => {
    const comparison = makeComparison();
    const c = render(
      <TeamCompareView
        {...baseProps({ locale: 'en', comparison, state: 'success' })}
      />,
    );
    const labels = c.querySelectorAll('.team-compare-view-label');
    expect(labels[0]!.textContent).toBe('Left run');
    expect(labels[1]!.textContent).toBe('Right run');
    const btn = c.querySelector('.team-compare-view-run-btn');
    expect(btn!.textContent).toBe('Run compare');
    const match = c.querySelector('.team-compare-view-basis-match');
    expect(match!.textContent).toBe('Matched');
  });

  it('zh：direction/completeness/material 中文', () => {
    const comparison = makeComparison();
    const c = render(
      <TeamCompareView
        {...baseProps({ comparison, state: 'success' })}
      />,
    );
    const text = c.textContent ?? '';
    expect(text).toContain('越低越好');
    expect(text).toContain('越高越好');
    expect(text).toContain('完整');
  });

  it('en：direction/completeness/material 英文', () => {
    const comparison = makeComparison();
    const c = render(
      <TeamCompareView
        {...baseProps({ locale: 'en', comparison, state: 'success' })}
      />,
    );
    const text = c.textContent ?? '';
    expect(text).toContain('lower is better');
    expect(text).toContain('higher is better');
    expect(text).toContain('complete');
  });

  it('zh：partial banner 中文', () => {
    const comparison = makeComparison();
    const c = render(
      <TeamCompareView
        {...baseProps({ comparison, state: 'partial' })}
      />,
    );
    const banner = c.querySelector('.team-compare-view-partial-banner');
    expect(banner!.textContent).toContain('部分维度不可用');
  });

  it('en：partial banner 英文', () => {
    const comparison = makeComparison();
    const c = render(
      <TeamCompareView
        {...baseProps({ locale: 'en', comparison, state: 'partial' })}
      />,
    );
    const banner = c.querySelector('.team-compare-view-partial-banner');
    expect(banner!.textContent).toContain('Some dimensions unavailable');
  });

  it('zh：unmatched hint 中文', () => {
    const comparison = makeComparison({ basis: makeBasis({ match: 'unmatched' }) });
    const c = render(
      <TeamCompareView
        {...baseProps({ comparison, state: 'success' })}
      />,
    );
    const hint = c.querySelector('.team-compare-view-basis-hint-unmatched');
    expect(hint!.textContent).toContain('基准不匹配');
  });

  it('en：unmatched hint 英文', () => {
    const comparison = makeComparison({ basis: makeBasis({ match: 'unmatched' }) });
    const c = render(
      <TeamCompareView
        {...baseProps({ locale: 'en', comparison, state: 'success' })}
      />,
    );
    const hint = c.querySelector('.team-compare-view-basis-hint-unmatched');
    expect(hint!.textContent).toContain('Basis unmatched');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §9.1 RunSelector 交互
// ═══════════════════════════════════════════════════════════════════════════

describe('§9.1 RunSelector 交互', () => {
  it('搜索过滤：输入 "left" 只显示匹配的 option', () => {
    const c = render(<TeamCompareView {...baseProps()} />);
    const input = c.querySelector('input[type="text"]') as HTMLInputElement;
    act(() => {
      setInputValue(input, 'left');
      focusInput(input);
    });
    const options = c.querySelectorAll('.team-compare-view-option');
    expect(options).toHaveLength(1);
    expect(options[0]!.querySelector('.team-compare-view-option-id')!.textContent).toBe('r-left');
  });

  it('点击 option → onChange 回调触发 + listbox 关闭', () => {
    let picked: string | null = null;
    const c = render(
      <TeamCompareView
        {...baseProps({ onLeftRunIdChange: (id) => { picked = id; } })}
      />,
    );
    const input = c.querySelector('input[type="text"]') as HTMLInputElement;
    act(() => focusInput(input));
    const option = c.querySelector('.team-compare-view-option')!;
    act(() => {
      option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(picked).toBe('r-left');
  });

  it('runs 为空 → 显示 no-runs 提示', () => {
    const c = render(
      <TeamCompareView
        {...baseProps({ runs: [] })}
      />,
    );
    const input = c.querySelector('input[type="text"]') as HTMLInputElement;
    act(() => focusInput(input));
    const noRuns = c.querySelector('.team-compare-view-no-runs');
    expect(noRuns).not.toBeNull();
    expect(noRuns!.getAttribute('role')).toBe('status');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §9.4 维度顺序容错
// ═══════════════════════════════════════════════════════════════════════════

describe('§9.4 维度顺序容错', () => {
  it('服务端返回乱序维度 → 按固定顺序重排', () => {
    const comparison = makeComparison({
      dimensions: [
        makeDimension('collaboration', []),
        makeDimension('cost', []),
        makeDimension('stability', []),
        makeDimension('accuracy', []),
        makeDimension('speed', []),
      ],
    });
    const c = render(
      <TeamCompareView
        {...baseProps({ comparison, state: 'success' })}
      />,
    );
    const titles = Array.from(c.querySelectorAll('.team-compare-view-dimension-title')).map((e) => e.textContent);
    expect(titles).toEqual(['速度', '准确性', '稳定性', 'Token 用量', '协作']);
  });

  it('服务端缺一个维度 → 只渲染返回的（不伪造）', () => {
    const comparison = makeComparison({
      dimensions: [
        makeDimension('speed', []),
        makeDimension('accuracy', []),
        makeDimension('stability', []),
        makeDimension('cost', []),
        // 缺 collaboration
      ],
    });
    const c = render(
      <TeamCompareView
        {...baseProps({ comparison, state: 'success' })}
      />,
    );
    const dims = c.querySelectorAll('.team-compare-view-dimension');
    expect(dims).toHaveLength(4);
  });
});
