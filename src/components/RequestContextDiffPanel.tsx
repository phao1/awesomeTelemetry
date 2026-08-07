import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { Locale } from '../i18n.js';
import { t } from '../i18n.js';
import { api, ApiError } from '../api/client.js';
import type {
  ContextCategoryDiff,
  ContextChangeEntry,
  ContextDiffCategory,
  ContextDiffSegment,
  ContextEvidenceValue,
  ContextRequestRef,
  ProxyRequestListItem,
  RequestContextDiffResponse,
  RequestContextFormat,
} from '../core/trace-types.js';
import { Badge } from './ui/Badge.js';
import { Button } from './ui/Button.js';
import { EmptyState, ErrorState, Skeleton } from './ui/States.js';
import { Tabs } from './ui/Tabs.js';

/** design D14：缓存上限 —— 最多缓存 10 个 diff 响应，插入最旧者被逐出。 */
const CACHE_LIMIT = 10;
const BASE_FONT_PX = 13;
const FONT_MIN = 8;
const FONT_MAX = 28;

const CATEGORY_ORDER: ContextDiffCategory[] = ['system', 'messages', 'tools', 'parameters'];
const DEFAULT_CATEGORY: ContextDiffCategory = 'system';

type PanelStatus = 'loading' | 'success' | 'unavailable' | 'unsupported' | 'error';

export interface RequestContextDiffPanelProps {
  /** 目标请求（当前抽屉选中的代理请求）。 */
  targetId: number;
  /** 目标请求的 phase-1 格式分类（用于兼容基线过滤）。 */
  targetFormat: RequestContextFormat;
  locale: Locale;
  /** 已加载的代理请求列表（基线选择器优先展示兼容项）。 */
  loadedItems: ProxyRequestListItem[];
  /** 源动作：把抽屉重定向到指定请求（走现有 request-detail API）。 */
  onOpenRequest: (id: number) => void;
}

const COMPATIBLE_TONE: Record<ContextDiffCategory, 'accent' | 'success' | 'attention' | 'neutral'> = {
  system: 'accent',
  messages: 'success',
  tools: 'attention',
  parameters: 'neutral',
};

const CONFIDENCE_TONE: Record<string, 'accent' | 'success' | 'attention' | 'neutral'> = {
  exact: 'success',
  capture_group: 'attention',
  manual: 'accent',
};

const KIND_TONE: Record<ContextChangeEntry['kind'], 'success' | 'danger' | 'attention'> = {
  added: 'success',
  removed: 'danger',
  modified: 'attention',
};

/**
 * design D14 / frontend §7：懒加载的「上下文差异」tab 面板。
 * 只有首次激活 Context Diff tab 时才发起请求；组件本地 Map 缓存（≤10），
 * 不做轮询或自动重试。状态键 = `${targetId}:${baseModeOrId}`。
 */
export function RequestContextDiffPanel({
  targetId,
  targetFormat,
  locale,
  loadedItems,
  onOpenRequest,
}: RequestContextDiffPanelProps): React.JSX.Element {
  const cacheRef = useRef<Map<string, RequestContextDiffResponse>>(new Map());
  const [status, setStatus] = useState<PanelStatus>('loading');
  const [data, setData] = useState<RequestContextDiffResponse | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [baseRef, setBaseRef] = useState<{ mode: 'previous' } | { mode: 'id'; id: number }>({ mode: 'previous' });
  const [activeCategory, setActiveCategory] = useState<ContextDiffCategory>('system');
  const [fontPx, setFontPx] = useState(BASE_FONT_PX);

  const cacheKey = useMemo(
    () => `${targetId}:${baseRef.mode === 'id' ? baseRef.id : 'previous'}`,
    [targetId, baseRef],
  );

  const load = useCallback(
    async (base: { mode: 'previous' } | { mode: 'id'; id: number }): Promise<void> => {
      const key = `${targetId}:${base.mode === 'id' ? base.id : 'previous'}`;
      const cached = cacheRef.current.get(key);
      if (cached !== undefined) {
        setData(cached);
        setStatus('success');
        setBaseRef(base);
        setActiveCategory(DEFAULT_CATEGORY);
        return;
      }
      setStatus('loading');
      setErrorCode(null);
      setErrorMessage(null);
      try {
        const result = await api.contextDiff(
          targetId,
          base.mode === 'id' ? base.id : undefined,
        );
        cacheRef.current.set(key, result);
        // 逐出最旧插入（Map 保持插入顺序）。
        while (cacheRef.current.size > CACHE_LIMIT) {
          const oldest = cacheRef.current.keys().next().value;
          if (oldest !== undefined) {
            cacheRef.current.delete(oldest);
          } else {
            break;
          }
        }
        setData(result);
        setBaseRef(base);
        setActiveCategory(DEFAULT_CATEGORY);
        setStatus('success');
      } catch (err) {
        const code = err instanceof ApiError ? err.code : 'INTERNAL_ERROR';
        const message = err instanceof Error ? err.message : String(err);
        setErrorCode(code);
        setErrorMessage(message);
        if (code === 'CONTEXT_DIFF_UNAVAILABLE') {
          setStatus('unavailable');
        } else if (code === 'CONTEXT_DIFF_UNSUPPORTED') {
          setStatus('unsupported');
        } else {
          setStatus('error');
        }
      }
    },
    [targetId],
  );

  // 面板仅在 tab 激活时才挂载 → 首次激活即发起一次自动（previous）请求。
  useEffect(() => {
    void load({ mode: 'previous' });
  }, [load]);

  const retry = useCallback(() => {
    void load(baseRef);
  }, [load, baseRef]);

  const adjustFont = useCallback((delta: number): void => {
    setFontPx((prev) => Math.min(FONT_MAX, Math.max(FONT_MIN, prev + delta)));
  }, []);

  return (
    <div className="context-diff" data-testid="context-diff-panel">
      <div className="context-diff-toolbar">
        <span className="context-diff-font" role="group" aria-label="context diff font">
          <button type="button" className="btn ui-btn-sm" onClick={() => adjustFont(-2)} aria-label={t('common.fontSmall', locale)}>
            {t('common.fontSmall', locale)}
          </button>
          <button type="button" className="btn ui-btn-sm" onClick={() => adjustFont(2)} aria-label={t('common.fontLarge', locale)}>
            {t('common.fontLarge', locale)}
          </button>
          <button type="button" className="btn ui-btn-sm" onClick={() => setFontPx(BASE_FONT_PX)} aria-label={t('common.fontReset', locale)}>
            {t('common.fontReset', locale)}
          </button>
        </span>
      </div>

      <div className="context-diff-body" style={{ fontSize: fontPx }}>
        {status === 'loading' && <Skeleton variant="block" count={3} />}

        {status === 'error' && (
          <ErrorState
            code={errorCode ?? 'INTERNAL_ERROR'}
            message={errorMessage ?? '—'}
            onRetry={retry}
          />
        )}

        {status === 'unsupported' && (
          <EmptyState
            icon={<span aria-hidden="true">⚠</span>}
            title={t('proxy.contextDiff.unsupported.title', locale)}
            description={errorMessage ?? undefined}
          />
        )}

        {status === 'unavailable' && (
          <div className="context-diff-unavailable">
            <EmptyState
              icon={<span aria-hidden="true">○</span>}
              title={t('proxy.contextDiff.unavailable.title', locale)}
              description={t('proxy.contextDiff.unavailable.description', locale)}
            />
            <ContextBasePicker
              targetId={targetId}
              targetFormat={targetFormat}
              locale={locale}
              loadedItems={loadedItems}
              onSelect={(id) => void load({ mode: 'id', id })}
            />
          </div>
        )}

        {status === 'success' && data !== null && (
          <ContextDiffResult
            data={data}
            locale={locale}
            cacheKey={cacheKey}
            activeCategory={activeCategory}
            onCategoryChange={setActiveCategory}
            targetId={targetId}
            targetFormat={targetFormat}
            loadedItems={loadedItems}
            onSelectBase={(id) => void load({ mode: 'id', id })}
            onOpenRequest={onOpenRequest}
          />
        )}
      </div>
    </div>
  );
}

function ContextDiffResult({
  data,
  locale,
  cacheKey,
  activeCategory,
  onCategoryChange,
  targetId,
  targetFormat,
  loadedItems,
  onSelectBase,
  onOpenRequest,
}: {
  data: RequestContextDiffResponse;
  locale: Locale;
  cacheKey: string;
  activeCategory: ContextDiffCategory;
  onCategoryChange: (category: ContextDiffCategory) => void;
  targetId: number;
  targetFormat: RequestContextFormat;
  loadedItems: ProxyRequestListItem[];
  onSelectBase: (id: number) => void;
  onOpenRequest: (id: number) => void;
}): React.JSX.Element {
  return (
    <div className="context-diff-result" data-cache-key={cacheKey}>
      <ContextDiffSummary data={data} locale={locale} />
      <div className="context-source-actions" data-testid="context-source-actions">
        <Button variant="ghost" size="sm" onClick={() => onOpenRequest(data.base.id)}>
          {t('proxy.contextDiff.source.base', locale)} #{data.base.id}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onOpenRequest(data.target.id)}>
          {t('proxy.contextDiff.source.target', locale)} #{data.target.id}
        </Button>
      </div>
      <ContextBasePicker
        targetId={targetId}
        targetFormat={targetFormat}
        locale={locale}
        loadedItems={loadedItems}
        onSelect={onSelectBase}
        showManual={false}
      />
      <ContextDiffCategoryTabs
        categories={data.categories}
        active={activeCategory}
        locale={locale}
        onChange={onCategoryChange}
      />
      <ContextChangeList
        data={data}
        category={activeCategory}
        locale={locale}
      />
    </div>
  );
}

/** design D14 §7.4/7.5：配对置信度/警告 + 身份 + 增长 + token + 指标 + 类别计数。 */
function ContextDiffSummary({
  data,
  locale,
}: {
  data: RequestContextDiffResponse;
  locale: Locale;
}): React.JSX.Element {
  const confidenceLabel = t(`proxy.contextDiff.confidence.${data.pairing.confidence}`, locale);
  const tokenDelta = data.growth.inputTokenDelta;
  return (
    <div className="context-diff-summary">
      <div className="context-diff-confidence">
        <span className="context-diff-label">{t('proxy.contextDiff.confidenceLabel', locale)}</span>
        <Badge tone={CONFIDENCE_TONE[data.pairing.confidence] ?? 'neutral'}>{confidenceLabel}</Badge>
        <span className="context-diff-reason">{data.pairing.reason}</span>
      </div>
      {data.pairing.warnings.length > 0 && (
        <ul className="context-diff-warnings" aria-label={t('proxy.contextDiff.warnings', locale)}>
          {data.pairing.warnings.map((warning, index) => (
            <li key={index}>⚠ {warning}</li>
          ))}
        </ul>
      )}

      <div className="context-diff-identity">
        <RequestRefView label={t('proxy.contextDiff.baseLabel', locale)} refValue={data.base} />
        <span className="context-diff-arrow" aria-hidden="true">→</span>
        <RequestRefView label={t('proxy.contextDiff.targetLabel', locale)} refValue={data.target} />
      </div>

      <div className="context-diff-growth">
        <span className="context-diff-label">{t('proxy.contextDiff.growth', locale)}</span>
        <dl className="meta context-diff-growth-grid">
          <dt>{t('proxy.contextDiff.baseChars', locale)}</dt>
          <dd className="mono">{fmtNum(data.growth.baseChars)}</dd>
          <dt>{t('proxy.contextDiff.targetChars', locale)}</dt>
          <dd className="mono">{fmtNum(data.growth.targetChars)}</dd>
          <dt>{t('proxy.contextDiff.deltaChars', locale)}</dt>
          <dd className="mono">{fmtSigned(data.growth.deltaChars)}</dd>
          <dt>{t('proxy.contextDiff.messageDelta', locale)}</dt>
          <dd className="mono">{fmtSigned(data.growth.messageDelta)}</dd>
          <dt>{t('proxy.contextDiff.toolDelta', locale)}</dt>
          <dd className="mono">{fmtSigned(data.growth.toolDelta)}</dd>
          <dt>{t('proxy.contextDiff.inputTokenDelta', locale)}</dt>
          <dd className="mono">
            {tokenDelta === null ? (
              '—'
            ) : (
              fmtSigned(tokenDelta)
            )}
          </dd>
        </dl>
        <span className="context-diff-token-reason mono">
          {tokenDelta === null ? t(`proxy.contextDiff.tokenReason.${data.growth.inputTokenDeltaReason}`, locale) : ''}
        </span>
      </div>

      {data.indicators.length > 0 && (
        <div className="context-diff-indicators">
          <span className="context-diff-label">{t('proxy.contextDiff.indicators', locale)}</span>
          <ul>
            {data.indicators.map((indicator, index) => (
              <li key={index} className={`context-indicator context-indicator-${indicator.severity}`}>
                <Badge tone={indicator.severity === 'warning' ? 'attention' : 'neutral'}>
                  {indicator.classification === 'suspected_compaction'
                    ? t('proxy.contextDiff.indicator.suspected_compaction', locale)
                    : t('proxy.contextDiff.indicator.observation', locale)}
                </Badge>
                <span>{indicator.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.noChange && (
        <div className="context-diff-nochange">
          <Badge tone="done">{t('proxy.contextDiff.noChange', locale)}</Badge>
        </div>
      )}
    </div>
  );
}

function RequestRefView({
  label,
  refValue,
}: {
  label: string;
  refValue: ContextRequestRef;
}): React.JSX.Element {
  return (
    <div className="context-request-ref">
      <span className="context-diff-label">{label}</span>
      <span className="mono">#{refValue.id}</span>
      <span className="context-request-ref-host">{refValue.hostname}</span>
      <span className="mono context-request-ref-meta">
        {refValue.model ?? '—'} · {refValue.requestFormat}
      </span>
      {refValue.parsedSessionId !== null && (
        <span className="mono context-request-ref-meta">session {refValue.parsedSessionId}</span>
      )}
      {refValue.captureGroupId !== null && (
        <span className="mono context-request-ref-meta" title="capture group, not an agent session">
          group {refValue.captureGroupId.slice(0, 8)}
        </span>
      )}
      <span className="mono context-request-ref-meta">
        {new Date(refValue.startedAt).toLocaleString()}
      </span>
      <span className="mono context-request-ref-meta">{fmtBytes(refValue.bodyBytes)}</span>
    </div>
  );
}

function ContextDiffCategoryTabs({
  categories,
  active,
  locale,
  onChange,
}: {
  categories: ContextCategoryDiff[];
  active: ContextDiffCategory;
  locale: Locale;
  onChange: (category: ContextDiffCategory) => void;
}): React.JSX.Element {
  const byCategory = useMemo(() => new Map(categories.map((category) => [category.category, category])), [categories]);
  return (
    <Tabs
      variant="pill"
      activeId={active}
      onChange={(id) => onChange(id as ContextDiffCategory)}
      items={CATEGORY_ORDER.map((category) => {
        const diff = byCategory.get(category);
        const count = diff === undefined ? 0 : diff.added + diff.removed + diff.modified;
        return {
          id: category,
          label: (
            <span className="context-category-tab">
              <Badge tone={COMPATIBLE_TONE[category]}>
                {t(`proxy.contextDiff.category.${category}`, locale)}
              </Badge>
              <span className="context-category-count mono">{count}</span>
            </span>
          ),
        };
      })}
    />
  );
}

function ContextChangeList({
  data,
  category,
  locale,
}: {
  data: RequestContextDiffResponse;
  category: ContextDiffCategory;
  locale: Locale;
}): React.JSX.Element {
  const diff = data.categories.find((entry) => entry.category === category);
  if (diff === undefined) {
    return <EmptyState icon={<span aria-hidden="true" />} title={t('proxy.contextDiff.noChange', locale)} />;
  }
  const total = diff.added + diff.removed + diff.modified;
  return (
    <div className="context-change-list" data-category={category}>
      <div className="context-category-counts">
        <Badge tone="success">+ {diff.added}</Badge>
        <Badge tone="danger">− {diff.removed}</Badge>
        <Badge tone="attention">± {diff.modified}</Badge>
        <Badge tone="neutral">{t('proxy.contextDiff.unchanged', locale)} {diff.unchanged}</Badge>
      </div>
      {!diff.completeness.complete && (
        <span className="context-partial mono">
          {t('proxy.contextDiff.partial', locale)}
          {diff.completeness.omittedCount > 0 ? ` · ${t('proxy.contextDiff.omitted', locale).replace('{n}', String(diff.completeness.omittedCount))}` : ''}
        </span>
      )}
      {total === 0 && diff.unchanged === 0 && diff.completeness.complete && (
        <EmptyState icon={<span aria-hidden="true" />} title={t('proxy.contextDiff.noChange', locale)} />
      )}
      {diff.entries.map((entry) => (
        <ContextChangeRow key={entry.identity} entry={entry} locale={locale} />
      ))}
    </div>
  );
}

function ContextChangeRow({
  entry,
  locale,
}: {
  entry: ContextChangeEntry;
  locale: Locale;
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const kindLabel = t(`proxy.contextDiff.kind.${entry.kind}`, locale);
  return (
    <div className="context-change-row">
      <button
        type="button"
        className="context-change-row-head"
        aria-expanded={expanded}
        onClick={() => setExpanded((prev) => !prev)}
      >
        <Badge tone={KIND_TONE[entry.kind]}>{kindLabel}</Badge>
        <span className="context-change-identity mono">{entry.identity}</span>
        <span className="context-change-label">{entry.label}</span>
        <span className="context-change-chevron" aria-hidden="true">{expanded ? '▾' : '▸'}</span>
      </button>
      {expanded && (
        <div className="context-change-detail">
          {entry.changedPaths.length > 0 && (
            <div className="context-change-paths">
              <span className="context-diff-label">{t('proxy.contextDiff.paths', locale)}</span>
              <ul className="mono">
                {entry.changedPaths.map((path, index) => (
                  <li key={index}>{path}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="context-evidence-pair">
            {entry.before !== null && (
              <ContextEvidenceView label={t('proxy.contextDiff.before', locale)} value={entry.before} locale={locale} />
            )}
            {entry.after !== null && (
              <ContextEvidenceView label={t('proxy.contextDiff.after', locale)} value={entry.after} locale={locale} />
            )}
          </div>
          {entry.segments !== null && entry.segments.length > 0 && (
            <ContextInlineSegments segments={entry.segments} locale={locale} />
          )}
          {entry.truncatedReason !== null && (
            <span className="context-truncate mono">
              {t('proxy.contextDiff.evidence.truncated', locale)} · {t(`proxy.contextDiff.truncatedReason.${entry.truncatedReason}`, locale)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function ContextEvidenceView({
  label,
  value,
  locale,
}: {
  label: string;
  value: ContextEvidenceValue;
  locale: Locale;
}): React.JSX.Element {
  return (
    <div className="context-evidence">
      <span className="context-diff-label">{label}</span>
      <span className="mono context-evidence-type">{value.jsonType}</span>
      {value.excerptStart !== '' && (
        <pre className="mono context-excerpt">{value.excerptStart}</pre>
      )}
      {value.truncated && value.excerptEnd !== '' && (
        <pre className="mono context-excerpt context-excerpt-end">{value.excerptEnd}</pre>
      )}
      <span className="mono context-evidence-meta">
        {t('proxy.contextDiff.evidence.length', locale)} {value.charLength} · {t('proxy.contextDiff.evidence.sha256', locale)} {value.sha256.slice(0, 12)}
        {value.truncated ? ` · ${t('proxy.contextDiff.evidence.truncated', locale)}` : ''}
      </span>
    </div>
  );
}

function ContextInlineSegments({
  segments,
  locale,
}: {
  segments: ContextDiffSegment[];
  locale: Locale;
}): React.JSX.Element {
  void locale;
  return (
    <div className="context-inline-segments mono" aria-label="inline diff">
      {segments.map((segment, index) => (
        <span key={index} className={`context-seg context-seg-${segment.kind}`}>
          {segment.kind === 'added' ? '+' : segment.kind === 'removed' ? '−' : ''}
          {segment.text}
        </span>
      ))}
    </div>
  );
}

/** design D14 §7.7：自动配对不可用 / 用户改基线时的基线选择器。 */
function ContextBasePicker({
  targetId,
  targetFormat,
  locale,
  loadedItems,
  onSelect,
  showManual = true,
}: {
  targetId: number;
  targetFormat: RequestContextFormat;
  locale: Locale;
  loadedItems: ProxyRequestListItem[];
  onSelect: (id: number) => void;
  showManual?: boolean;
}): React.JSX.Element {
  const compatible = useMemo(
    () => loadedItems.filter((item) => item.requestFormat === targetFormat && item.id !== targetId),
    [loadedItems, targetFormat, targetId],
  );
  const [idInput, setIdInput] = useState('');

  const submitId = (): void => {
    const parsed = Number(idInput.trim());
    if (Number.isInteger(parsed) && parsed > 0 && parsed !== targetId) {
      onSelect(parsed);
      setIdInput('');
    }
  };

  return (
    <div className="context-base-picker" data-testid="context-base-picker">
      {showManual && (
        <span className="context-diff-label">{t('proxy.contextDiff.basePicker.title', locale)}</span>
      )}
      <p className="hint context-base-picker-hint">{t('proxy.contextDiff.basePicker.hint', locale)}</p>
      {compatible.length === 0 ? (
        <p className="context-base-empty mono">{t('proxy.contextDiff.picker.empty', locale)}</p>
      ) : (
        <ul className="context-base-list">
          {compatible.slice(0, 20).map((item) => (
            <li key={item.id}>
              <button type="button" className="context-base-item" onClick={() => onSelect(item.id)}>
                <span className="mono">#{item.id}</span>
                <span className="context-base-item-model">{item.model ?? '—'}</span>
                <span className="mono">{t('proxy.contextDiff.picker.format', locale)} {item.requestFormat}</span>
                <span className="mono">{t('proxy.contextDiff.picker.time', locale)} {new Date(item.startedAt).toLocaleString()}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="context-base-id-entry">
        <input
          className="ui-input ui-btn-sm"
          inputMode="numeric"
          placeholder={t('proxy.contextDiff.basePicker.placeholder', locale)}
          value={idInput}
          onChange={(event) => setIdInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              submitId();
            }
          }}
          aria-label={t('proxy.contextDiff.basePicker.placeholder', locale)}
        />
        <button type="button" className="btn ui-btn-sm" onClick={submitId}>
          {t('proxy.contextDiff.basePicker.submit', locale)}
        </button>
      </div>
    </div>
  );
}

function fmtNum(value: number): string {
  return value.toLocaleString();
}

function fmtSigned(value: number): string {
  return value > 0 ? `+${value.toLocaleString()}` : value.toLocaleString();
}

function fmtBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
