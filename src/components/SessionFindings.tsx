import { useState } from 'react';

import type { Locale } from '../i18n.js';
import { t } from '../i18n.js';
import type { Finding, FindingsResult, FindingSeverity } from '../core/session-findings.js';
import { IconChevronDown, IconChevronRight } from './icons/index.js';
import { formatFindingDetail, formatFindingTitle } from './findings-text.js';

export interface SessionFindingsProps {
  result: FindingsResult;
  locale: Locale;
  /** 点击 Finding → 定位到对应事件 / 阶段（由 App 实现）。 */
  onActivate: (finding: Finding) => void;
}

const VISIBLE_COUNT = 4;

const SEVERITY_TONE: Record<FindingSeverity, string> = {
  critical: 'var(--danger-fg)',
  warning: 'var(--attention-fg)',
  notice: 'var(--accent-fg)',
  info: 'var(--neutral-fg)',
};

/** ui-design-v2 §3.1 【新增·L1】会话诊断卡：结论先行，可点击定位。 */
export function SessionFindings({ result, locale, onActivate }: SessionFindingsProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  if (collapsed) {
    return (
      <section className="findings-card findings-collapsed" aria-label={t('findings.title', locale)}>
        <button
          type="button"
          className="findings-header"
          onClick={() => setCollapsed(false)}
        >
          <span className="findings-title">
            <IconChevronRight size={12} />
            {t('findings.title', locale)}
          </span>
          <span className="findings-count mono">
            {result.findings.length > 0 ? `${result.findings.length}` : '✓'}
          </span>
        </button>
      </section>
    );
  }

  const shown = expanded ? result.findings : result.findings.slice(0, VISIBLE_COUNT);
  const isEmpty = result.findings.length === 0;

  return (
    <section className="findings-card" aria-label={t('findings.title', locale)}>
      <div className="findings-header">
        <span className="findings-title">{t('findings.title', locale)}</span>
        {isEmpty ? (
          <span className="findings-passed mono">✓ {result.passed}/{result.totalChecks}</span>
        ) : (
          <span className="findings-count mono">{result.findings.length}</span>
        )}
        <span className="spacer" />
        <button
          type="button"
          className="ui-btn-sm btn"
          onClick={() => setCollapsed(true)}
        >
          {t('findings.hideAll', locale)}
        </button>
      </div>

      {isEmpty ? (
        <div className="findings-empty">
          <span className="findings-empty-icon" aria-hidden="true">✓</span>
          <div>
            <p className="findings-empty-title">{t('findings.emptyTitle', locale)}</p>
            <p className="findings-empty-detail">
              {t('findings.emptyDetail', locale).replace('{n}', String(result.passed))}
            </p>
          </div>
        </div>
      ) : (
        <ul className="findings-list">
          {shown.map((finding) => (
            <li key={finding.id}>
              {finding.evidence.eventIds.length === 0 && finding.evidence.phase === undefined ? (
                <div className="finding-row finding-row-static" title={t('findings.notActionable', locale)}>
                  <span
                    className="finding-dot"
                    style={{ background: SEVERITY_TONE[finding.severity] }}
                    aria-hidden="true"
                  />
                  <span className="finding-body">
                    <span className="finding-title">{formatFindingTitle(finding, locale)}</span>
                    <span className="finding-detail">{formatFindingDetail(finding, locale)}</span>
                  </span>
                </div>
              ) : (
                <button
                  type="button"
                  className="finding-row"
                  onClick={() => onActivate(finding)}
                >
                  <span
                    className="finding-dot"
                    style={{ background: SEVERITY_TONE[finding.severity] }}
                    aria-hidden="true"
                  />
                  <span className="finding-body">
                    <span className="finding-title">{formatFindingTitle(finding, locale)}</span>
                    <span className="finding-detail">{formatFindingDetail(finding, locale)}</span>
                  </span>
                  <IconChevronRight size={12} className="finding-arrow" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {!isEmpty && result.findings.length > VISIBLE_COUNT && (
        <button
          type="button"
          className="findings-more"
          onClick={() => setExpanded((prev) => !prev)}
        >
          {expanded
            ? t('findings.hideAll', locale)
            : t('findings.viewAll', locale).replace('{n}', String(result.findings.length))}
          {expanded ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
        </button>
      )}
    </section>
  );
}
