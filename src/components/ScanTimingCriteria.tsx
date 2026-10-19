import type { Locale } from '../i18n.js';
import { t } from '../i18n.js';
import type { TraceSession } from '../core/trace-types.js';

/** Presentation only: a retained session declaration is not event provenance. */
export function ScanTimingCriteria({ left, right, partial, locale, compact = false }: {
  left: TraceSession; right?: TraceSession; partial?: boolean; locale: Locale; compact?: boolean;
}): React.JSX.Element {
  const source = (session: TraceSession): string => t(
    session.durationSource === 'measured' ? 'scan.timing.measured'
      : session.durationSource === 'derived' ? 'scan.timing.derived' : 'scan.timing.unknown', locale,
  );
  const explanation = <>
    <p>{t('scan.timing.source', locale)}: L · {left.dataSource}/{left.provider}/{left.sourceAgent} · {source(left)}
      {right !== undefined && <>; R · {right.dataSource}/{right.provider}/{right.sourceAgent} · {source(right)}</>}</p>
    <p>{t('scan.timing.scope', locale)}</p>
    <p>{t('scan.timing.wallClock', locale)} {t('scan.timing.nonCausal', locale)}</p>
    <details><summary>{t('scan.timing.formulas', locale)}</summary><p>{t('scan.timing.formulaText', locale)}</p></details>
  </>;
  return <section className={`hint scan-timing-criteria ${compact ? 'scan-timing-compact' : ''}`} aria-label={t('scan.timing.title', locale)}>
    {compact ? <>
      <div className="scan-timing-summary"><strong>{t('scan.timing.title', locale)}</strong>
        <span>{left.dataSource}/{left.provider} · {source(left)}</span>
        <span>{t('scan.timing.compactScope', locale)}</span>
      </div>
      <details><summary>{t('scan.timing.details', locale)}</summary>{explanation}</details>
    </> : <><strong>{t('scan.timing.title', locale)}</strong>{explanation}</>}
    {partial === true && <p role="status">{t('scan.timing.partial', locale)}</p>}
  </section>;
}
