import { useCallback, useEffect, useState } from 'react';

import type { SessionPromptContext } from '../core/trace-types.js';
import type { Locale } from '../i18n.js';
import { t } from '../i18n.js';
import { api, ApiError } from '../api/client.js';
import { Badge } from './ui/Badge.js';
import { Modal } from './ui/Modal.js';
import { EmptyState, ErrorState, Skeleton } from './ui/States.js';

export interface PromptContextModalProps {
  sessionKey: string;
  locale: Locale;
  onClose: () => void;
  load?: (key: string) => Promise<SessionPromptContext>;
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'success'; value: SessionPromptContext }
  | { kind: 'empty' }
  | { kind: 'error'; code: string; message: string };

const DEFAULT_LOAD = (key: string): Promise<SessionPromptContext> => api.promptContext(key);

function fmtNumber(value: number | null, suffix = ''): string {
  return value === null ? '—' : `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}${suffix}`;
}

/** show-trae-prompt-context：按显式动作加载，完整性/来源先于正文展示。 */
export function PromptContextModal({
  sessionKey,
  locale,
  onClose,
  load = DEFAULT_LOAD,
}: PromptContextModalProps): React.JSX.Element {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    setState({ kind: 'loading' });
    setAttempt((value) => value + 1);
  }, []);

  useEffect(() => {
    let active = true;
    setState({ kind: 'loading' });
    void load(sessionKey)
      .then((value) => {
        if (active) setState({ kind: 'success', value });
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (error instanceof ApiError && error.code === 'PROMPT_CONTEXT_NOT_FOUND') {
          setState({ kind: 'empty' });
          return;
        }
        console.error('[prompt-context] 加载失败:', error);
        setState({
          kind: 'error',
          code: error instanceof ApiError ? error.code : 'INTERNAL_ERROR',
          message: error instanceof Error ? error.message : String(error),
        });
      });
    return () => {
      active = false;
    };
  }, [attempt, load, sessionKey]);

  return (
    <Modal title={t('prompt.title', locale)} onClose={onClose} size="lg">
      {state.kind === 'loading' && <Skeleton variant="block" count={3} />}
      {state.kind === 'empty' && (
        <EmptyState
          icon={<span aria-hidden="true">∅</span>}
          title={t('prompt.empty', locale)}
          description={t('prompt.emptyHint', locale)}
        />
      )}
      {state.kind === 'error' && (
        <ErrorState code={state.code} message={state.message} onRetry={retry} />
      )}
      {state.kind === 'success' && (
        <div className="prompt-context">
          <section className="prompt-context-provenance" aria-label={t('prompt.provenance', locale)}>
            <div>
              <Badge tone="attention">{t('prompt.dynamicOnly', locale)}</Badge>{' '}
              <Badge tone="neutral">{state.value.source}</Badge>{' '}
              <Badge tone="success">{t('prompt.desensitized', locale)}</Badge>
            </div>
            <p>{t('prompt.fullUnavailable', locale)}</p>
            <span className="mono">{new Date(state.value.capturedAt).toLocaleString()}</span>
          </section>

          <section>
            <h3>{t('prompt.analysis', locale)}</h3>
            <div className="prompt-context-stats">
              <div><span>{t('prompt.sections', locale)}</span><strong>{state.value.analysis.sectionCount}</strong></div>
              <div><span>{t('prompt.estimatedTokens', locale)}</span><strong>{fmtNumber(state.value.analysis.estimatedTokens)}</strong></div>
              <div><span>{t('prompt.contextWindow', locale)}</span><strong>{fmtNumber(state.value.analysis.contextWindowPercent, '%')}</strong></div>
              <div><span>{t('prompt.duplicates', locale)}</span><strong>{state.value.analysis.duplicateSectionCount}</strong></div>
            </div>
          </section>

          <section>
            <h3>{t('prompt.modelConfig', locale)}</h3>
            <dl className="prompt-context-model">
              <dt>model</dt><dd className="mono">{state.value.modelConfig.modelName ?? '—'}</dd>
              <dt>config</dt><dd className="mono">{state.value.modelConfig.configName ?? '—'}</dd>
              <dt>prompt max</dt><dd className="mono">{fmtNumber(state.value.modelConfig.promptMaxTokens)}</dd>
              <dt>output max</dt><dd className="mono">{fmtNumber(state.value.modelConfig.maxOutputTokens)}</dd>
              <dt>max turns</dt><dd className="mono">{fmtNumber(state.value.modelConfig.maxTurns)}</dd>
              <dt>agent</dt><dd className="mono">{state.value.modelConfig.agentName ?? state.value.modelConfig.agentType ?? '—'}</dd>
              <dt>locale</dt><dd className="mono">{state.value.modelConfig.locale ?? '—'}</dd>
            </dl>
            {state.value.modelConfig.enabledFeatures.length > 0 && (
              <details className="prompt-context-features">
                <summary>{t('prompt.enabledFeatures', locale)} · {state.value.modelConfig.enabledFeatures.length}</summary>
                <code>{state.value.modelConfig.enabledFeatures.join('\n')}</code>
              </details>
            )}
          </section>

          <section>
            <h3>{t('prompt.dynamicSections', locale)}</h3>
            <div className="prompt-context-sections">
              {state.value.dynamicSections.map((section, index) => (
                <details key={section.id} open={index === 0}>
                  <summary>
                    <span>{index + 1}. {section.title}</span>
                    <span className="prompt-context-section-meta mono">
                      {section.estimatedTokens} tok
                      {section.duplicateOf !== null ? ` · ${t('prompt.duplicateOf', locale)} ${section.duplicateOf}` : ''}
                    </span>
                  </summary>
                  <pre>{section.content}</pre>
                </details>
              ))}
            </div>
          </section>
        </div>
      )}
    </Modal>
  );
}
