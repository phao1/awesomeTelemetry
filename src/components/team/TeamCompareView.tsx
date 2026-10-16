/**
 * add-agent-team-observability §9.1–9.9 —
 * TeamCompareView：两 run 比较视图（独立组件，被 TeamShell compare panel 复用）。
 *
 * 与 TeamShell 内联的 ComparePanel 不同，本组件是 §9 全部子任务的独立交付：
 * - §9.1 左右 run 选择器（受控，可搜索；不发请求，由父组件触发比较）
 * - §9.2 持久 basis 横幅（match + 8 个 material 字段 + reasons + userDeclared）
 * - §9.3 不暗示结构等价（basis unmatched/unknown 时显式提示）
 * - §9.4 五维指标区（speed/accuracy/stability/cost/collaboration，每维一表）
 *   列：metricId / raw left / raw right / Δ / % / direction / material /
 *        completeness / criteria / evidence
 * - §9.5 确定性 strengths/weaknesses/tradeoffs/caveats（直接渲染服务端结果）
 * - §9.6 禁用 winner / overall score / infinity / unknown-as-zero；
 *        unmatched/unknown 不出 verdict
 * - §9.7 六状态：loading/empty/error+retry/success/partial/unavailable
 * - §9.8 a11y：table caption/aria-label、数值 aria-label、role=status/alert
 * - §9.9 双语 + 无障碍
 *
 * **无新 runtime dependency**：纯 React + 既有 ui/* + tokens.css。
 *
 * **i18n**：复用 `src/i18n.ts` 已有 `team.compare*` / `team.metricDimension.*` /
 * `team.compareMatch.*` 键。本组件需要的新键（basisField/direction/completeness/
 * evidence/material/sameId 提示等）不在 i18n.ts 现有键集合内，而任务约束禁止修改
 * i18n.ts（不在 target_files 内）。故在此定义局部双语文字映射 `CT`，覆盖 zh/en，
 * 满足 AGENTS.md「All strings land in both locales」与无 color-only meaning。
 */

import { useCallback, useMemo, useState } from 'react';

import type { Locale, I18nKey } from '../../i18n.js';
import { t } from '../../i18n.js';
import type {
  CompletenessLevel,

  TeamComparison,
  TeamComparisonBasis,
  TeamComparisonDimension,
  TeamComparisonMetricRow,
  TeamMetricDimension,
  TeamMetricDirection,
  TeamRunSummary,
} from '../../core/trace-types.js';
import { EmptyState, ErrorState, Skeleton } from '../ui/States.js';

// ── 局部双语文字映射（不修改 i18n.ts，见文件头注释） ─────────

const CT = {
  /** basis 8 个 material 字段标签（design D10）。 */
  basisField: {
    goal: { zh: '目标', en: 'Goal' },
    criteria: { zh: '验收标准', en: 'Acceptance criteria' },
    project: { zh: '项目', en: 'Project' },
    revision: { zh: '起始版本', en: 'Starting revision' },
    environment: { zh: '环境', en: 'Environment' },
    model: { zh: '模型', en: 'Model' },
    template: { zh: '模板/角色', en: 'Template/Role' },
    completeness: { zh: '完整性', en: 'Completeness' },
  } as const,
  /** basis 字段三态标签（true/false/null）。 */
  fieldState: {
    yes: { zh: '一致', en: 'match' },
    no: { zh: '不同', en: 'differ' },
    unknown: { zh: '未知', en: 'unknown' },
  } as const,
  direction: {
    higher_better: { zh: '越高越好', en: 'higher is better' },
    lower_better: { zh: '越低越好', en: 'lower is better' },
    descriptive: { zh: '描述性', en: 'descriptive' },
  } as Record<TeamMetricDirection, { zh: string; en: string }>,
  completeness: {
    complete: { zh: '完整', en: 'complete' },
    partial: { zh: '部分', en: 'partial' },
    unavailable: { zh: '不可用', en: 'unavailable' },
    conflicted: { zh: '冲突', en: 'conflicted' },
  } as Record<CompletenessLevel, { zh: string; en: string }>,
  material: { zh: '重要', en: 'material' },
  notMaterial: { zh: '次要', en: 'not material' },
  evidence: { zh: '证据', en: 'Evidence' },
  criteria: { zh: '口径', en: 'Criteria' },
  directionLabel: { zh: '方向', en: 'Direction' },
  completenessLabel: { zh: '完整性', en: 'Completeness' },
  materialLabel: { zh: '重要性', en: 'Materiality' },
  rawLeft: { zh: '左值', en: 'Left' },
  rawRight: { zh: '右值', en: 'Right' },
  delta: { zh: '差值 Δ', en: 'Delta Δ' },
  relativeDelta: { zh: '相对变化 %', en: 'Relative Δ %' },
  metric: { zh: '指标', en: 'Metric' },
  basisFieldsLabel: { zh: '基准字段', en: 'Basis fields' },
  basisReasonsLabel: { zh: '基准原因', en: 'Basis reasons' },
  userDeclaredBadge: { zh: '用户声明基准', en: 'User-declared basis' },
  unmatchedHint: {
    zh: '基准不匹配：差异已保留，仅做描述性比较，不输出归一化结论',
    en: 'Basis unmatched: differences preserved; descriptive comparison only, no normalized verdict',
  },
  unknownHint: {
    zh: '基准未知：证据不足以判定，所有结论均含 caveat',
    en: 'Basis unknown: evidence insufficient to decide; all conclusions carry caveats',
  },
  noVerdict: {
    zh: '本比较不输出总体评分或赢家',
    en: 'This comparison emits no overall score or winner',
  },
  evidenceCount: { zh: '{n} 条证据', en: '{n} evidence' },
  searchPlaceholder: { zh: '搜索 run id / 标题', en: 'Search run id / title' },
  searchAria: { zh: '搜索团队运行', en: 'Search team runs' },
  runsAvailable: { zh: '可选运行', en: 'Available runs' },
  noRuns: { zh: '无可用运行', en: 'No runs available' },
  partialBanner: {
    zh: '部分维度不可用，结论仅适用于已观测维度',
    en: 'Some dimensions unavailable; conclusions apply only to observed dimensions',
  },
} as const;

function ct(entry: { zh: string; en: string }, locale: Locale): string {
  return locale === 'zh' ? entry.zh : entry.en;
}

/** 把局部字符串里的 `{n}` 替换为数值（仅一处占位）。 */
function ctN(entry: { zh: string; en: string }, locale: Locale, n: number): string {
  return ct(entry, locale).replace('{n}', String(n));
}

// ── §9.7 六状态 ──────────────────────────────────────────────

export type CompareState =
  | 'loading'
  | 'empty'
  | 'error'
  | 'success'
  | 'partial'
  | 'unavailable';

// ── §9.1 左右 run 选择器 ─────────────────────────────────────

/**
 * 单个 run 选择器：受控 input + 可选搜索下拉（复用 App-owned run list）。
 *
 * **§9.1 关键约束**：选择器本身**不发请求**（run list 由父组件传入）；
 * 同 id 时由父组件禁用比较按钮，本组件仅显示 inline 提示。
 */
function RunSelector({
  side,
  runId,
  runs,
  locale,
  onChange,
}: {
  side: 'left' | 'right';
  runId: string | null;
  runs: TeamRunSummary[];
  locale: Locale;
  onChange: (id: string | null) => void;
}): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const sideLabel = side === 'left' ? t('team.compareLeft', locale) : t('team.compareRight', locale);
  const placeholder = t('team.compareRunIdPlaceholder', locale);

  const filtered = useMemo(() => {
    if (query === '') return runs;
    const q = query.toLowerCase();
    return runs.filter(
      (r) => r.id.toLowerCase().includes(q) || r.title.toLowerCase().includes(q),
    );
  }, [runs, query]);

  const handleInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = e.target.value;
      onChange(v === '' ? null : v);
      setQuery(v);
      setOpen(true);
    },
    [onChange],
  );

  const handlePick = useCallback(
    (id: string) => {
      onChange(id);
      setQuery('');
      setOpen(false);
    },
    [onChange],
  );

  const inputId = `team-compare-${side}-input`;
  const listboxId = `team-compare-${side}-listbox`;

  return (
    <div className="team-compare-view-selector">
      <label className="team-compare-view-label" htmlFor={inputId}>
        {sideLabel}
      </label>
      <input
        id={inputId}
        type="text"
        className="ui-input ui-btn-md team-compare-view-input"
        value={runId ?? ''}
        onChange={handleInput}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          // 延迟关闭以允许点击选项
          setTimeout(() => setOpen(false), 120);
        }}
        placeholder={placeholder}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listboxId}
      />
      {open && filtered.length > 0 && (
        <ul
          id={listboxId}
          className="team-compare-view-listbox"
          role="listbox"
          aria-label={ct(CT.runsAvailable, locale)}
        >
          {filtered.map((r) => (
            <li
              key={r.id}
              role="option"
              aria-selected={r.id === runId}
              className={`team-compare-view-option ${r.id === runId ? 'team-compare-view-option-on' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault();
                handlePick(r.id);
              }}
            >
              <span className="team-compare-view-option-id mono">{r.id}</span>
              <span className="team-compare-view-option-title">{r.title}</span>
            </li>
          ))}
        </ul>
      )}
      {open && filtered.length === 0 && (
        <div className="team-compare-view-no-runs" role="status">
          {ct(CT.noRuns, locale)}
        </div>
      )}
    </div>
  );
}

// ── §9.2 basis 横幅 ──────────────────────────────────────────

/** basis 字段三态 → 文字 + token class。null = 未知。 */
function basisFieldState(value: boolean | null): { key: 'yes' | 'no' | 'unknown' } {
  if (value === null) return { key: 'unknown' };
  return value ? { key: 'yes' } : { key: 'no' };
}

function BasisFieldChip({
  field,
  value,
  locale,
}: {
  field: keyof typeof CT.basisField;
  value: boolean | null;
  locale: Locale;
}): React.JSX.Element {
  const { key } = basisFieldState(value);
  const fieldLabel = ct(CT.basisField[field], locale);
  const stateLabel = ct(CT.fieldState[key], locale);
  return (
    <span
      className={`team-compare-view-basis-field team-compare-view-basis-field-${key}`}
      role="listitem"
    >
      <span className="team-compare-view-basis-field-name">{fieldLabel}</span>
      <span className="team-compare-view-basis-field-state">{stateLabel}</span>
    </span>
  );
}

function BasisBanner({
  basis,
  locale,
}: {
  basis: TeamComparisonBasis;
  locale: Locale;
}): React.JSX.Element {
  const matchLabel = t(`team.compareMatch.${basis.match}` as I18nKey, locale);
  const showUnmatchedHint = basis.match === 'unmatched';
  const showUnknownHint = basis.match === 'unknown';

  return (
    <section
      className={`team-compare-view-basis team-compare-view-basis-${basis.match}`}
      aria-labelledby="team-compare-view-basis-title"
    >
      <div className="team-compare-view-basis-head">
        <h3 id="team-compare-view-basis-title" className="team-compare-view-basis-match">
          {matchLabel}
        </h3>
        {basis.userDeclared && (
          <span className="team-compare-view-basis-manual" role="note">
            {ct(CT.userDeclaredBadge, locale)}
          </span>
        )}
      </div>
      <div
        className="team-compare-view-basis-fields"
        role="list"
        aria-label={ct(CT.basisFieldsLabel, locale)}
      >
        <BasisFieldChip field="goal" value={basis.goalMatch} locale={locale} />
        <BasisFieldChip field="criteria" value={basis.criteriaMatch} locale={locale} />
        <BasisFieldChip field="project" value={basis.projectMatch} locale={locale} />
        <BasisFieldChip field="revision" value={basis.revisionMatch} locale={locale} />
        <BasisFieldChip field="environment" value={basis.environmentMatch} locale={locale} />
        <BasisFieldChip field="model" value={basis.modelMatch} locale={locale} />
        <BasisFieldChip field="template" value={basis.templateMatch} locale={locale} />
        <BasisFieldChip field="completeness" value={basis.completenessDelta} locale={locale} />
      </div>
      {basis.reasons.length > 0 && (
        <ul
          className="team-compare-view-basis-reasons"
          aria-label={ct(CT.basisReasonsLabel, locale)}
        >
          {basis.reasons.map((reason, idx) => (
            <li key={idx}>{reason}</li>
          ))}
        </ul>
      )}
      {showUnmatchedHint && (
        <p className="team-compare-view-basis-hint team-compare-view-basis-hint-unmatched" role="status">
          {ct(CT.unmatchedHint, locale)}
        </p>
      )}
      {showUnknownHint && (
        <p className="team-compare-view-basis-hint team-compare-view-basis-hint-unknown" role="status">
          {ct(CT.unknownHint, locale)}
        </p>
      )}
    </section>
  );
}

// ── §9.4 五维指标区 ──────────────────────────────────────────

/** 数值格式化：null → '—'，否则保留原始精度（不四舍五入到 0）。 */
function formatNumber(value: number | null): string {
  if (value === null) return '—';
  if (!Number.isFinite(value)) return '—';
  return String(value);
}

/** 相对 delta 格式化：null → '—'，否则百分比。 */
function formatRelative(value: number | null): string {
  if (value === null) return '—';
  if (!Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(1)}%`;
}

function MetricRow({
  row,
  locale,
}: {
  row: TeamComparisonMetricRow;
  locale: Locale;
}): React.JSX.Element {
  const directionLabel = ct(CT.direction[row.direction], locale);
  const completenessLabel = ct(CT.completeness[row.completeness], locale);
  const materialLabel = row.material ? ct(CT.material, locale) : ct(CT.notMaterial, locale);
  const leftStr = formatNumber(row.left.value);
  const rightStr = formatNumber(row.right.value);
  const deltaStr = formatNumber(row.delta);
  const relStr = formatRelative(row.relativeDelta);
  const evidenceStr = row.evidenceIds.length === 0 ? '—' : ctN(CT.evidenceCount, locale, row.evidenceIds.length);

  // 数值 aria-label：描述语义，避免屏幕阅读器读出 "—" 时丢失含义
  const leftAria = `${ct(CT.rawLeft, locale)} ${leftStr}`;
  const rightAria = `${ct(CT.rawRight, locale)} ${rightStr}`;
  const deltaAria = `${ct(CT.delta, locale)} ${deltaStr}`;
  const relAria = `${ct(CT.relativeDelta, locale)} ${relStr}`;

  return (
    <tr
      className={
        row.material
          ? 'team-compare-view-row team-compare-view-row-material'
          : 'team-compare-view-row'
      }
    >
      <th scope="row" className="team-compare-view-metric-id">
        {row.metricId}
      </th>
      <td className="team-compare-view-cell mono" aria-label={leftAria}>
        {leftStr}
      </td>
      <td className="team-compare-view-cell mono" aria-label={rightAria}>
        {rightStr}
      </td>
      <td className="team-compare-view-cell mono" aria-label={deltaAria}>
        {deltaStr}
      </td>
      <td className="team-compare-view-cell mono" aria-label={relAria}>
        {relStr}
      </td>
      <td className="team-compare-view-cell team-compare-view-direction">
        <span className={`team-compare-view-direction-tag team-compare-view-direction-${row.direction}`}>
          {directionLabel}
        </span>
      </td>
      <td className="team-compare-view-cell team-compare-view-material">
        <span
          className={
            row.material
              ? 'team-compare-view-material-tag team-compare-view-material-yes'
              : 'team-compare-view-material-tag team-compare-view-material-no'
          }
          aria-label={materialLabel}
        >
          {materialLabel}
        </span>
      </td>
      <td className="team-compare-view-cell team-compare-view-completeness">
        <span className={`team-compare-view-completeness-tag team-compare-view-completeness-${row.completeness}`}>
          {completenessLabel}
        </span>
      </td>
      <td className="team-compare-view-cell team-compare-view-criteria">
        {row.criteria === '' ? '—' : row.criteria}
      </td>
      <td className="team-compare-view-cell team-compare-view-evidence">
        {evidenceStr}
      </td>
    </tr>
  );
}

function DimensionTable({
  dim,
  locale,
}: {
  dim: TeamComparisonDimension;
  locale: Locale;
}): React.JSX.Element {
  const dimLabel = t(`team.metricDimension.${dim.dimension}` as I18nKey, locale);
  const captionId = `team-compare-view-dim-caption-${dim.dimension}`;
  return (
    <section
      className="team-compare-view-dimension"
      aria-labelledby={captionId}
    >
      <h4 id={captionId} className="team-compare-view-dimension-title">
        {dimLabel}
      </h4>
      <table className="team-compare-view-table">
        <caption className="team-compare-view-table-caption">
          {dimLabel}
        </caption>
        <thead>
          <tr>
            <th scope="col">{ct(CT.metric, locale)}</th>
            <th scope="col">{ct(CT.rawLeft, locale)}</th>
            <th scope="col">{ct(CT.rawRight, locale)}</th>
            <th scope="col">{ct(CT.delta, locale)}</th>
            <th scope="col">{ct(CT.relativeDelta, locale)}</th>
            <th scope="col">{ct(CT.directionLabel, locale)}</th>
            <th scope="col">{ct(CT.materialLabel, locale)}</th>
            <th scope="col">{ct(CT.completenessLabel, locale)}</th>
            <th scope="col">{ct(CT.criteria, locale)}</th>
            <th scope="col">{ct(CT.evidence, locale)}</th>
          </tr>
        </thead>
        <tbody>
          {dim.rows.map((row) => (
            <MetricRow key={row.metricId} row={row} locale={locale} />
          ))}
        </tbody>
      </table>
    </section>
  );
}

// ── §9.5 确定性 strengths/weaknesses/tradeoffs/caveats ────────

function VerdictList({
  kind,
  items,
  locale,
}: {
  kind: 'strengths' | 'weaknesses' | 'tradeoffs' | 'caveats';
  items: string[];
  locale: Locale;
}): React.JSX.Element | null {
  if (items.length === 0) return null;
  const titleKey = `team.compare${kind[0]!.toUpperCase()}${kind.slice(1)}` as I18nKey;
  const title = t(titleKey, locale);
  return (
    <section className={`team-compare-view-${kind}`} aria-labelledby={`team-compare-view-${kind}-title`}>
      <h4 id={`team-compare-view-${kind}-title`} className="team-compare-view-verdict-title">
        {title}
      </h4>
      <ul className="team-compare-view-verdict-list">
        {items.map((item, idx) => (
          <li key={idx} className="team-compare-view-verdict-item">
            {item}
          </li>
        ))}
      </ul>
    </section>
  );
}

// ── §9.6 no-winner/no-score 提示 ─────────────────────────────

function NoVerdictNote({ locale }: { locale: Locale }): React.JSX.Element {
  return (
    <p className="team-compare-view-no-verdict" role="note">
      {ct(CT.noVerdict, locale)}
    </p>
  );
}

// ── §9.7 状态包装 ────────────────────────────────────────────

function StateWrapper({
  state,
  error,
  locale,
  onRetry,
  emptyTitle,
  emptyHint,
  unavailableHint,
  partialBanner,
  children,
}: {
  state: CompareState;
  error: string | null;
  locale: Locale;
  onRetry: () => void;
  emptyTitle: string;
  emptyHint: string;
  unavailableHint: string;
  partialBanner: string | null;
  children: React.ReactNode;
}): React.JSX.Element {
  if (state === 'loading') {
    return (
      <div className="team-compare-view-loading" role="status" aria-live="polite">
        <Skeleton variant="row" count={6} />
      </div>
    );
  }
  if (state === 'error') {
    return (
      <ErrorState
        code="TEAM_COMPARE_FAILED"
        message={error ?? ''}
        onRetry={onRetry}
      />
    );
  }
  if (state === 'unavailable') {
    return (
      <EmptyState
        icon={<span aria-hidden="true" />}
        title={t('team.compareEmpty', locale)}
        description={unavailableHint}
      />
    );
  }
  if (state === 'empty') {
    return (
      <EmptyState
        icon={<span aria-hidden="true" />}
        title={emptyTitle}
        description={emptyHint}
      />
    );
  }
  return (
    <>
      {state === 'partial' && partialBanner !== null && (
        <div className="team-compare-view-partial-banner" role="status">
          {partialBanner}
        </div>
      )}
      {children}
    </>
  );
}

// ── TeamCompareViewProps ─────────────────────────────────────

export interface TeamCompareViewProps {
  locale: Locale;
  /** App-owned team run list（§9.1 复用，禁止本组件再发请求）。 */
  runs: TeamRunSummary[];
  /** 当前左 run id（受控）。 */
  leftRunId: string | null;
  /** 当前右 run id（受控）。 */
  rightRunId: string | null;
  /** 用户声明基准（manual basis）。 */
  manualBasis: boolean;
  /** 比较结果（来自父组件触发 teamApi.compare 后传入）。 */
  comparison: TeamComparison | null;
  /** 比较状态。 */
  state: CompareState;
  /** 错误信息（state === 'error' 时展示）。 */
  error: string | null;
  /** 左 run id 变更回调。 */
  onLeftRunIdChange: (id: string | null) => void;
  /** 右 run id 变更回调。 */
  onRightRunIdChange: (id: string | null) => void;
  /** manualBasis 切换回调。 */
  onManualBasisToggle: () => void;
  /** 触发比较（由父组件执行 teamApi.compare）。 */
  onRunCompare: () => void;
}

// ── TeamCompareView ──────────────────────────────────────────

export function TeamCompareView({
  locale,
  runs,
  leftRunId,
  rightRunId,
  manualBasis,
  comparison,
  state,
  error,
  onLeftRunIdChange,
  onRightRunIdChange,
  onManualBasisToggle,
  onRunCompare,
}: TeamCompareViewProps): React.JSX.Element {
  // §9.1 同 id 禁用比较
  const sameId = leftRunId !== null && rightRunId !== null && leftRunId === rightRunId;
  const canCompare = leftRunId !== null && rightRunId !== null && leftRunId !== '' && rightRunId !== '' && !sameId;

  // §9.7 partial banner：当任一维度行 unavailable 时显示
  const partialBanner = useMemo(() => {
    if (state !== 'partial' || comparison === null) return null;
    return ct(CT.partialBanner, locale);
  }, [state, comparison, locale]);

  // 维度顺序固定（speed/accuracy/stability/cost/collaboration）
  const orderedDimensions = useMemo<TeamComparisonDimension[]>(() => {
    if (comparison === null) return [];
    const order: readonly TeamMetricDimension[] = [
      'speed', 'accuracy', 'stability', 'cost', 'collaboration',
    ];
    const byDim = new Map(comparison.dimensions.map((d) => [d.dimension, d]));
    const out: TeamComparisonDimension[] = [];
    for (const dim of order) {
      const d = byDim.get(dim);
      if (d !== undefined) out.push(d);
    }
    // 容错：若服务端返回了未知维度，追加在末尾（不丢数据）
    for (const d of comparison.dimensions) {
      if (!order.includes(d.dimension)) out.push(d);
    }
    return out;
  }, [comparison]);

  // §9.5 verdict 仅在 basis matched/partially_matched 时展示
  // unmatched/unknown 时服务端可能仍返回 strengths/weaknesses（描述性），
  // 但 §9.6 要求「unmatched/unknown 不出 verdict」——故此处按 basis 过滤。
  const showVerdicts = comparison !== null && (comparison.basis.match === 'matched' || comparison.basis.match === 'partially_matched');

  return (
    <div
      className="team-compare-view"
      aria-label={t('team.compareLabel', locale)}
    >
      {/* §9.1 左右选择器 + manual basis + run button */}
      <div className="team-compare-view-selectors">
        <RunSelector
          side="left"
          runId={leftRunId}
          runs={runs}
          locale={locale}
          onChange={onLeftRunIdChange}
        />
        <RunSelector
          side="right"
          runId={rightRunId}
          runs={runs}
          locale={locale}
          onChange={onRightRunIdChange}
        />
        <label className="team-compare-view-manual">
          <input
            type="checkbox"
            checked={manualBasis}
            onChange={onManualBasisToggle}
          />
          {t('team.compareManualBasis', locale)}
        </label>
        <button
          type="button"
          className="btn team-compare-view-run-btn"
          onClick={onRunCompare}
          disabled={!canCompare}
          aria-disabled={!canCompare}
        >
          {t('team.compareRun', locale)}
        </button>
      </div>
      {sameId && (
        <p className="team-compare-view-same-id" role="alert">
          {t('team.compareSameId', locale)}
        </p>
      )}

      {/* §9.7 六状态包装 */}
      <StateWrapper
        state={state}
        error={error}
        locale={locale}
        onRetry={onRunCompare}
        emptyTitle={t('team.compareEmpty', locale)}
        emptyHint={t('team.compareEmptyHint', locale)}
        unavailableHint={t('team.compareUnavailableHint', locale)}
        partialBanner={partialBanner}
      >
        {comparison !== null && (
          <div className="team-compare-view-result">
            {/* §9.2 basis 横幅 */}
            <BasisBanner basis={comparison.basis} locale={locale} />

            {/* §9.4 五维指标区 */}
            <div className="team-compare-view-dimensions">
              {orderedDimensions.map((dim) => (
                <DimensionTable key={dim.dimension} dim={dim} locale={locale} />
              ))}
            </div>

            {/* §9.5 确定性 strengths/weaknesses/tradeoffs/caveats */}
            {showVerdicts && (
              <div className="team-compare-view-verdicts">
                <VerdictList kind="strengths" items={comparison.strengths} locale={locale} />
                <VerdictList kind="weaknesses" items={comparison.weaknesses} locale={locale} />
                <VerdictList kind="tradeoffs" items={comparison.tradeoffs} locale={locale} />
                <VerdictList kind="caveats" items={comparison.caveats} locale={locale} />
              </div>
            )}

            {/* §9.6 no winner / no score 提示 */}
            <NoVerdictNote locale={locale} />
          </div>
        )}
      </StateWrapper>
    </div>
  );
}
