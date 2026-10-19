import { useMemo } from 'react';

import type { ProxyProtocolAnalysis } from '../core/trace-types.js';
import { deriveProxyInsights } from '../core/proxy-insights.js';
import type { Locale } from '../i18n.js';
import { t } from '../i18n.js';

export function ProxyInsights({ analysis, locale, onInspect }: {
  analysis: ProxyProtocolAnalysis; locale: Locale; onInspect: (key: string) => void;
}) {
  const insights = useMemo(() => deriveProxyInsights(analysis), [analysis]);
  const evidence = (key: string, path: string) => <button className="btn" type="button" onClick={() => onInspect(key)} aria-label={t('proxy.insights.inspect', locale) + ': ' + path}><code>{path}</code></button>;
  return (
    <section aria-label={t('proxy.insights.title', locale)}>
      <h3>{t('proxy.insights.title', locale)}</h3>
      <p className="hint">{t('proxy.insights.scope', locale)}</p>
      {!analysis.completeness.complete && <p role="status">{t('proxy.insights.partial', locale)}: {analysis.completeness.reasons.join(', ')}</p>}
      <h4>{t('proxy.insights.cache', locale)}</h4>
      <p><strong>{insights.cache.ratio === null ? '—' : (insights.cache.ratio * 100).toFixed(1) + '%'}</strong> · {insights.cache.readTokens ?? '—'} / {insights.cache.inputTokens ?? '—'} · {t('proxy.insights.derived', locale)}</p>
      {analysis.usage.accounting !== 'unknown' && <p className="hint">{t(analysis.usage.accounting === 'anthropic_additive_input' ? 'proxy.insights.anthropicBasis' : 'proxy.insights.openaiBasis', locale)}</p>}
      {insights.cache.reason !== 'known' && <p className="hint">{t(`proxy.insights.cache.${insights.cache.reason}`, locale)}</p>}
      {evidence('usage', 'analysis.usage.snapshots')}
      <h4>{t('proxy.insights.sizes', locale)}</h4>
      <p className="hint">{t('proxy.insights.sizeLimit', locale)}</p>
      {insights.sizes.length === 0 ? <p>{t('proxy.insights.emptySizes', locale)}</p> : (
        <ol>{insights.sizes.slice(0, 5).map(item => <li key={item.evidenceKey}>{t(`proxy.insights.kind.${item.kind}`, locale)} · {item.chars.toLocaleString(locale)} {t('proxy.insights.chars', locale)} · {evidence(item.evidenceKey, item.sourcePath)}</li>)}</ol>
      )}
      <p className="hint">{t('proxy.insights.sizeAdvice', locale)}</p>
      <h4>{t('proxy.insights.errors', locale)}</h4>
      <p className="hint">{t('proxy.insights.errorLimit', locale)}</p>
      {analysis.errors.length === 0 && insights.toolResultSignals.length === 0 && <p>{t('proxy.insights.emptyErrors', locale)}</p>}
      <ul>{analysis.errors.slice(0, 5).map((error, index) => <li key={'error-' + index}>{t('proxy.insights.observed', locale)} · {error.code ?? '—'} · {error.message} · {evidence('error-' + index, error.sourcePath)}</li>)}
        {insights.toolResultSignals.slice(0, 5).map(signal => <li key={signal.evidenceKey}>{t('proxy.insights.toolSignal', locale)} · <code>{signal.signal}</code> · {evidence(signal.evidenceKey, signal.sourcePath)}</li>)}</ul>
      <p className="hint">{t('proxy.insights.errorAdvice', locale)}</p>
      <p>{t('proxy.insights.proposals', locale)}: {insights.proposalCount} · {t('proxy.insights.proposalLimit', locale)}</p>
    </section>
  );
}
