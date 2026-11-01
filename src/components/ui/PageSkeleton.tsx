import { useUiTranslate } from './Locale.js';
import { type Locale } from '../../i18n.js';
export interface PageSkeletonProps {
  locale?: Locale;
  variant?: 'cards' | 'table';
  rows?: number;
  /** For a lazy panel/dialog already inside a page or card. */
  compact?: boolean;
}
/** Page-shaped loading state; no business data or layout-affecting requests. */
export function PageSkeleton({ locale, variant = 'cards', rows = 6, compact = false }: PageSkeletonProps): React.JSX.Element {
  const ta=useUiTranslate(locale);
  const label = locale ? locale === 'zh' ? '正在加载页面' : 'Loading page' : ta('a11y.loading');
  return <div className={`ui-page-skeleton ${compact ? 'ui-page-skeleton-compact' : ''}`} role="status" aria-live="polite" aria-label={label} aria-busy="true">
    <div aria-hidden="true">
      <div className="ui-skeleton ui-page-skeleton-title" />
      {variant === 'cards' && <div className="ui-page-skeleton-cards">{Array.from({ length: compact ? 2 : 3 }, (_, i) => <div className="ui-card" key={i}><div className="ui-skeleton ui-skeleton-text" /><div className="ui-skeleton ui-skeleton-row" /></div>)}</div>}
      <div className="ui-card ui-page-skeleton-table"><div className="ui-skeleton ui-skeleton-text" />{Array.from({ length: Math.max(1, rows) }, (_, i) => <div className="ui-table-skeleton-row" key={i}><span className="ui-skeleton ui-skeleton-text" /><span className="ui-skeleton ui-skeleton-text" /><span className="ui-skeleton ui-skeleton-text" /></div>)}</div>
    </div>
  </div>;
}
