import { formatCostUsd } from '../core/pricing.js';
import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';

import type { Locale } from '../i18n.js';
import { t } from '../i18n.js';
import type { TraceEvent, TraceEventSlim, TraceSession } from '../core/trace-types.js';
import { computeSpeedMetrics } from '../core/speed-metrics.js';
import { DropdownMenu } from './ui/Overlay.js';
import { ProviderBadge, StatusBadge } from './ui/Badge.js';
import { IconAccuracy, IconChevronDown, IconChevronRight, IconCost, IconKebab, IconSpeed, IconStability, IconSuccess } from './icons/index.js';

export interface SessionToolbarProps {
  session: TraceSession;
  events: TraceEventSlim[];
  locale: Locale;
  onRescan?: () => void;
  onDelete?: () => void;
  onCopyId?: () => void;
  onExport?: () => void;
  onPromptContext?: () => void;
}

function fmtMs(ms: number | null): string {
  return ms === null ? '—' : ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms.toFixed(0)}ms`;
}

/** REQ-103 / G-UI-5：系统 Prompt 展开区持久化 key（新前缀，禁止老前缀）。 */
export const SYS_PROMPT_KEY = 'awesome-telemetry.sysPromptExpanded';

/** 展开态正文截断阈值（REQ-103）。 */
export const SYS_PROMPT_PREVIEW_LIMIT = 5000;

function readExpanded(): boolean {
  try {
    return localStorage.getItem(SYS_PROMPT_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * REQ-103：L0 系统 Prompt 展开区（SessionToolbar 下方）。
 * - systemPrompt === null 时整个区域不渲染（不显示空状态）
 * - 折叠/展开状态持久化到 awesome-telemetry.sysPromptExpanded
 * - role="button" + tabIndex + Enter/Space 可切换；复制 2 秒 IconSuccess 反馈
 */
export function SystemPromptSection({
  session,
  locale,
}: {
  session: TraceSession;
  locale: Locale;
}): React.JSX.Element | null {
  const [expanded, setExpanded] = useState(readExpanded);
  const [showAll, setShowAll] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(SYS_PROMPT_KEY, expanded ? '1' : '0');
    } catch {
      // 隐私模式等场景 localStorage 不可写：状态仅在本次会话生效
      return;
    }
  }, [expanded]);

  const prompt = session.systemPrompt;
  if (prompt === null) {
    return null;
  }

  const charCount = prompt.length;
  const tokenEstimate = Math.ceil(charCount / 4);
  const truncated = charCount > SYS_PROMPT_PREVIEW_LIMIT;
  const shown = truncated && !showAll ? prompt.slice(0, SYS_PROMPT_PREVIEW_LIMIT) : prompt;

  const toggle = (): void => setExpanded((prev) => !prev);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle();
    }
  };
  const copy = (): void => {
    void navigator.clipboard
      ?.writeText(prompt)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      })
      .catch((err: unknown) => {
        console.error('[sys-prompt] 复制失败:', err);
      });
  };

  return (
    <section className="sys-prompt">
      <div
        className="sys-prompt-toggle"
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-label={t('session.sysPrompt', locale)}
        onClick={toggle}
        onKeyDown={onKeyDown}
      >
        <span className="sys-prompt-chevron" aria-hidden="true">
          {expanded ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
        </span>
        <span className="sys-prompt-title">{t('session.sysPrompt', locale)}</span>
        <span className="mono sys-prompt-meta">
          {charCount.toLocaleString()} {t('session.sysPrompt.chars', locale)} ·{' '}
          {t('session.sysPrompt.tokens', locale).replace('{n}', tokenEstimate.toLocaleString())}
        </span>
        <span className="spacer" />
        <button
          type="button"
          className="ui-icon-btn ui-btn-sm"
          aria-label={t('session.sysPrompt.copy', locale)}
          title={t('session.sysPrompt.copy', locale)}
          onClick={(e) => {
            e.stopPropagation();
            copy();
          }}
        >
          {copied ? <IconSuccess size={12} /> : <span aria-hidden="true">📋</span>}
        </button>
      </div>
      {expanded && (
        <div className="sys-prompt-body">
          <pre className="mono sys-prompt-text">{shown}</pre>
          {truncated && (
            <button
              type="button"
              className="sys-prompt-more"
              onClick={() => setShowAll((prev) => !prev)}
            >
              {showAll
                ? t('session.sysPrompt.collapse', locale)
                : t('session.sysPrompt.showMore', locale).replace(
                    '{n}',
                    (charCount - SYS_PROMPT_PREVIEW_LIMIT).toLocaleString(),
                  )}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * 页面 IA 重构（fix-session-detail-display delta）：粘性会话工具条——
 * provider + 标题 + 状态 + 可复制 ID + 四维紧凑指标 + 操作菜单。
 * null 指标显示 —（加 title 说明），不得用 0 冒充。
 */
export function SessionToolbar({
  session,
  events,
  locale,
  onRescan,
  onDelete,
  onCopyId,
  onExport,
  onPromptContext,
}: SessionToolbarProps): React.JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  const metrics = useMemo(() => {
    const total = events.length || 1;
    const errorEvents = events.filter((e) => e.status === 'error').length;
    const testEvents = events.filter((e) => e.kind === 'test').length;
    const debugEvents = events.filter((e) => e.phase === 'debug').length;
    const speed = computeSpeedMetrics({
      session,
      events: events as TraceEvent[],
      tokenSemantics: { cacheRead: 'incremental', reasoning: 'incremental' },
    });
    const tokensPerStep = total > 0 ? session.tokenUsage.total / total : 0;
    return {
      speed,
      verification: total > 0 ? testEvents / total : null,
      errorRate: total > 0 ? errorEvents / total : null,
      debugRate: total > 0 ? debugEvents / total : null,
      tokensPerStep,
      hasData: total > 1,
    };
  }, [session, events]);

  const pct = (v: number | null): string => (v === null ? '—' : `${(v * 100).toFixed(0)}%`);

  return (
    <>
      <header className="session-toolbar">
        <div className="session-toolbar-main">
          <ProviderBadge provider={session.provider} locale={locale} />
          <h2 className="session-toolbar-title" title={session.title || session.id}>
            {session.title || session.id}
          </h2>
          <StatusBadge status={session.status} locale={locale} />
          <button
            type="button"
            className="session-toolbar-id mono"
            onClick={onCopyId}
            title={`${session.id} — ${t('session.copyId', locale)}`}
          >
            {session.id}
          </button>
        </div>
        <div className="session-toolbar-metrics">
          <div className="session-toolbar-metric" title={metrics.hasData ? t('metric.speed', locale) : t('session.insufficientData', locale)}>
            <span className="session-toolbar-metric-label">
              <IconSpeed size={12} /> {t('metric.speed', locale)}
            </span>
            <span className="mono">{fmtMs(metrics.speed.ttftMs)}</span>
          </div>
          <div className="session-toolbar-metric">
            <span className="session-toolbar-metric-label">
              <IconAccuracy size={12} /> {t('metric.accuracy', locale)}
            </span>
            <span className="mono">{pct(metrics.verification)}</span>
          </div>
          <div className="session-toolbar-metric">
            <span className="session-toolbar-metric-label">
              <IconStability size={12} /> {t('metric.stability', locale)}
            </span>
            <span className="mono">{pct(metrics.errorRate)}</span>
          </div>
          <div className="session-toolbar-metric">
            <span className="session-toolbar-metric-label">
              <IconCost size={12} /> {t('metric.cost', locale)}
            </span>
            <span className="mono">
              {session.tokenUsage.total.toLocaleString()} tok · {formatCostUsd(session.costUsd, session.costSource)}
            </span>
          </div>
        </div>
        <button type="button" className="btn session-toolbar-prompt" onClick={onPromptContext}>
          {t('prompt.open', locale)}
        </button>
        <DropdownMenu
          open={menuOpen}
          onOpenChange={setMenuOpen}
          trigger={(props) => (
            <button type="button" className="ui-icon-btn" aria-label="session menu" {...props}>
              <IconKebab size={16} />
            </button>
          )}
          items={[
            { id: 'rescan', label: t('session.rescan', locale), onSelect: onRescan },
            { id: 'copy', label: t('session.copyId', locale), onSelect: onCopyId },
            { id: 'export', label: t('session.exportReport', locale), onSelect: onExport },
            { id: 'delete', label: t('session.delete', locale), onSelect: onDelete },
          ]}
        />
      </header>
      <SystemPromptSection session={session} locale={locale} />
    </>
  );
}
