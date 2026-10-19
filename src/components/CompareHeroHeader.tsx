import type { Locale } from '../i18n.js';
import { t } from '../i18n.js';
import type { ProviderKey } from '../core/trace-types.js';
import { PROVIDER_KEYS } from '../core/trace-types.js';
import type { CompareResult } from './compare-types.js';
import { ProviderBadge } from './ui/Badge.js';
import { computeVerdict } from './CompareVerdict.js';

/** G-UI-3：provider key 不在已知 9 个时回退 --accent-subtle。 */
const KNOWN_PROVIDERS = new Set<string>(PROVIDER_KEYS);

function providerSubtle(provider: string): string {
  return KNOWN_PROVIDERS.has(provider)
    ? `var(--provider-${provider}-subtle)`
    : 'var(--accent-subtle)';
}

/**
 * REQ-104：Compare Hero Header —— 双方 provider 色渐变 + 会话标识 +
 * Verdict 结论的关键比率摘要。颜色 MUST 取 token（G-UI-3 回退）。
 */
export function CompareHeroHeader({
  result,
  locale,
}: {
  result: CompareResult;
  locale: Locale;
}): React.JSX.Element {
  const left = result.left.session;
  const right = result.right.session;
  const verdict = computeVerdict(result, locale);

  const summaryParts: string[] = [];
  const fastDim = verdict.dims.find((d) => d.key === 'fast');
  if (fastDim?.winner === 'unavailable') summaryParts.push(t('scan.timing.notComparable', locale));
  else if (fastDim !== undefined && fastDim.winner !== 'tie' && verdict.summary.fastRatio !== null) {
    summaryParts.push(
      t('scan.timing.wallClockRatio', locale).replace('{ratio}', verdict.summary.fastRatio.toFixed(1)),
    );
  }
  const frugalDim = verdict.dims.find((d) => d.key === 'frugal');
  if (frugalDim !== undefined && frugalDim.winner !== 'tie') {
    summaryParts.push(
      t('compare.hero.summary.tokenValues', locale).replace('{left}',left.tokenUsage.total.toLocaleString()).replace('{right}',right.tokenUsage.total.toLocaleString()),
    );
  }
  const qualityDim = verdict.dims.find((d) => d.key === 'quality');
  if (qualityDim !== undefined && verdict.summary.leftCoveragePct !== null && verdict.summary.rightCoveragePct !== null && verdict.summary.leftCoveragePct!==verdict.summary.rightCoveragePct) {
    summaryParts.push(
      t('compare.hero.summary.quality', locale)
        .replace('{left}', `${verdict.summary.leftCoveragePct.toFixed(0)}%`)
        .replace('{right}', `${verdict.summary.rightCoveragePct.toFixed(0)}%`),
    );
  }
  if (summaryParts.length === 0) {
    summaryParts.push(t('compare.observed.noWinner', locale));
  }

  const side = (
    provider: ProviderKey,
    agentName: string,
    title: string,
    align: 'left' | 'right',
  ): React.JSX.Element => (
    <div className={`compare-hero-side ${align === 'right' ? 'compare-hero-side-r' : ''}`}>
      <span className="compare-hero-badge">
        <ProviderBadge provider={provider} locale={locale} />
        <span className="compare-hero-agent">{agentName}</span>
      </span>
      <span className="compare-hero-title" title={title}>{title}</span>
    </div>
  );

  return (
    <section
      className="compare-hero"
      id="compare-hero"
      aria-label={t('compare.hero.title', locale)}
      style={{
        background: `linear-gradient(135deg, ${providerSubtle(left.provider)} 0%, ${providerSubtle(right.provider)} 100%)`,
      }}
    >
      {side(left.provider, left.sourceAgent, left.title || left.id, 'left')}
      <div className="compare-hero-summary" aria-label={t('compare.hero.summary', locale)}>
        {summaryParts.join(' · ')}
        <p className="hint">{t('scan.timing.nonCausal', locale)}</p>
      </div>
      {side(right.provider, right.sourceAgent, right.title || right.id, 'right')}
    </section>
  );
}
