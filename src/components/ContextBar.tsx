import type { ReactNode } from 'react';

import type { Locale } from '../i18n.js';
import { t } from '../i18n.js';

export interface ContextAnchor {
  id: string;
  label: string;
}

export interface ContextBarProps {
  visible: boolean;
  anchors: ContextAnchor[];
  activeId: string;
  locale: Locale;
  onCollapseAll: () => void;
  onExpandAll: () => void;
  summary?: ReactNode;
}

/** ui-design-v2 §2.1：滚动上下文条 —— 摘要 + 区块锚点 + 折叠/展开全部。 */
export function ContextBar({
  visible,
  anchors,
  activeId,
  locale,
  onCollapseAll,
  onExpandAll,
  summary,
}: ContextBarProps): React.JSX.Element {
  if (!visible) {
    return <div className="contextbar contextbar-hidden" aria-hidden="true" />;
  }
  return (
    <div className="contextbar" role="navigation" aria-label={t('compare.dims', locale)}>
      {summary !== undefined && <span className="contextbar-summary">{summary}</span>}
      <div className="contextbar-anchors">
        {anchors.map((anchor) => (
          <button
            key={anchor.id}
            type="button"
            className={`contextbar-anchor ${anchor.id === activeId ? 'contextbar-anchor-on' : ''}`}
            onClick={() => document.getElementById(anchor.id)?.scrollIntoView({ behavior: 'smooth' })}
          >
            {anchor.label}
          </button>
        ))}
      </div>
      <span className="spacer" />
      <button type="button" className="ui-btn-sm btn" onClick={onCollapseAll}>
        {t('contextbar.collapseAll', locale)}
      </button>
      <button type="button" className="ui-btn-sm btn" onClick={onExpandAll}>
        {t('contextbar.expandAll', locale)}
      </button>
    </div>
  );
}
