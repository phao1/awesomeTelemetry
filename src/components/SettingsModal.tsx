import { useEffect, useState } from 'react';

import type { Locale } from '../i18n.js';
import { t } from '../i18n.js';
import type { LocalSessionConfig } from '../core/trace-types.js';
import { api } from '../api/client.js';
import { ErrorState, Skeleton } from './ui/States.js';
import {
  isDesensitizationEnabled,
  setDesensitizationEnabled,
} from './inspector-text.js';

export interface SettingsModalProps {
  locale: Locale;
  onClose: () => void;
  load?: () => Promise<unknown>;
  save?: (config: unknown) => Promise<unknown>;
}

/** REQ-008：provider 配置设置。 */
export function SettingsModal({ locale, onClose, load = () => api.configProviders(), save = (c) => api.saveConfigProviders(c) }: SettingsModalProps) {
  const [config, setConfig] = useState<LocalSessionConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [desensitize, setDesensitize] = useState(isDesensitizationEnabled());

  useEffect(() => {
    void load()
      .then((loaded) => setConfig(loaded as LocalSessionConfig))
      .catch((err: unknown) => {
        // REQ-022：失败不得永久停在「加载中」
        console.error('[settings] 配置加载失败:', err);
        setError(err instanceof Error ? err.message : String(err));
      });
  }, [load]);

  const toggle = (key: string): void => {
    setConfig((prev) =>
      prev === null
        ? prev
        : {
            ...prev,
            providers: {
              ...prev.providers,
              [key]: { ...prev.providers[key as keyof typeof prev.providers], enabled: !prev.providers[key as keyof typeof prev.providers].enabled },
            },
          },
    );
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h3>{t('settings.title', locale)}</h3>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.close', locale)}
          </button>
        </header>
        <div className="modal-body">
          <h4>{t('settings.security', locale)}</h4>
          <label className="settings-row">
            <input
              type="checkbox"
              checked={desensitize}
              onChange={(e) => {
                setDesensitize(e.target.checked);
                setDesensitizationEnabled(e.target.checked);
              }}
            />
            <span>{t('settings.desensitize', locale)}</span>
            <span className="hint">{t('settings.desensitizeHint', locale)}</span>
          </label>
          <h4>{t('settings.providers', locale)}</h4>
          {error !== null && (
            <ErrorState
              code="CONFIG_LOAD_FAILED"
              message={error}
              onRetry={() => {
                setError(null);
                setConfig(null);
                void load()
                  .then((loaded) => setConfig(loaded as LocalSessionConfig))
                  .catch((err: unknown) => {
                    console.error('[settings] 重试失败:', err);
                    setError(err instanceof Error ? err.message : String(err));
                  });
              }}
            />
          )}
          {error === null && config === null && <Skeleton variant="row" count={5} />}
          {config !== null &&
            Object.entries(config.providers).map(([key, provider]) => (
              <label key={key} className="settings-row">
                <input type="checkbox" checked={provider.enabled} onChange={() => toggle(key)} />
                <span>{key}</span>
                <span className="hint">{provider.path}</span>
              </label>
            ))}
          <button
            type="button"
            className="btn"
            disabled={config === null || saving}
            onClick={() => {
              if (config === null) {
                return;
              }
              setSaving(true);
              void save(config).finally(() => setSaving(false));
            }}
          >
            {t('settings.save', locale)}
          </button>
        </div>
      </div>
    </div>
  );
}
