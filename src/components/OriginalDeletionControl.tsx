import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { api, ApiError } from '../api/client.js';
import type { OriginalDeletionJob } from '../core/trace-types.js';
import { t, type Locale } from '../i18n.js';

interface Props {
  id: number;
  requestId: string;
  locale: Locale;
  monitorStopped: boolean;
  supported: boolean;
  onAvailability: (value: 'loading' | 'available' | 'blocked' | 'unknown') => void;
}

/** Metadata-only selected-request control; never auto-polls or deletes on mount. */
export function OriginalDeletionControl({ id, requestId, locale, monitorStopped, supported, onAvailability }: Props): React.JSX.Element {
  const [job, setJob] = useState<OriginalDeletionJob | null>(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false), [acknowledged, setAcknowledged] = useState(false);
  const generation = useRef(0), blocked = useRef(false), submitting = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null), checkbox = useRef<HTMLInputElement | null>(null), refresh = useRef<HTMLButtonElement | null>(null);
  const confirmationId = useId();
  const check = useCallback((value: OriginalDeletionJob | null): void => {
    if (value !== null && (typeof value.id !== 'string' || value.id.length === 0 || value.proxyId !== id || value.requestId !== requestId || !['pending','failed','complete'].includes(value.state))) {
      throw new ApiError('INVALID_DELETION_STATUS', 'Unexpected deletion status');
    }
    if (value !== null) blocked.current = true;
    setJob(value); onAvailability(blocked.current ? 'blocked' : 'available');
  }, [id, requestId, onAvailability]);
  const load = useCallback(async (): Promise<void> => {
    if (submitting.current) return;
    controller.current?.abort(); const operation = new AbortController(); controller.current = operation;
    const token = ++generation.current; setLoading(true); setError(null);
    if (!blocked.current) onAvailability('loading');
    const timeout = setTimeout(() => operation.abort(), 5000);
    try { const value = await api.originalDeletion(id, operation.signal); if (operation.signal.aborted) throw new ApiError('STATUS_TIMEOUT', 'Deletion status timed out'); if (token === generation.current) check(value); }
    catch (cause) { if (token === generation.current) {
      setError(cause instanceof ApiError ? cause.code : 'STATUS_UNAVAILABLE');
      onAvailability(blocked.current ? 'blocked' : 'unknown');
    } }
    finally { clearTimeout(timeout); if (token === generation.current) setLoading(false); }
  }, [id, onAvailability, check]);
  useEffect(() => { void load(); return () => { generation.current += 1; controller.current?.abort(); }; }, [load]);
  useEffect(() => { if (confirming) checkbox.current?.focus(); }, [confirming]);
  useEffect(() => { if (!busy && blocked.current) refresh.current?.focus(); }, [busy]);
  const cancel = () => { setConfirming(false); setAcknowledged(false); (trigger.current?.disabled ? refresh.current : trigger.current)?.focus(); };
  const submit = async (): Promise<void> => {
    if (submitting.current || loading || error !== null || job?.state === 'complete' || !acknowledged || !monitorStopped || (!supported && job === null)) return;
    submitting.current = true; blocked.current = true; onAvailability('blocked');
    setBusy(true); setConfirming(false); setAcknowledged(false); setError(null);
    const token = ++generation.current, operation = new AbortController(); controller.current = operation;
    const timeout = setTimeout(() => operation.abort(), 15_000);
    try { const value = await api.deleteOriginals(id, requestId, operation.signal); if (operation.signal.aborted || value === null) throw new ApiError('RESULT_UNCERTAIN', 'Deletion result is unconfirmed'); if (token === generation.current) check(value); }
    catch (cause) { if (token === generation.current) setError(cause instanceof ApiError ? cause.code : 'RESULT_UNCERTAIN'); }
    finally { clearTimeout(timeout); submitting.current = false; if (token === generation.current) setBusy(false); }
  };
  const disabled = loading || busy || error !== null || !monitorStopped || (!supported && job === null) || job?.state === 'complete';
  return <section className="original-deletion-control" aria-label={t('proxy.deletion.title', locale)} aria-busy={loading || busy}>
    <div role="status" aria-live="polite">
      {loading ? t('proxy.deletion.loading', locale) : busy ? t('proxy.deletion.working', locale) : error !== null ? t('proxy.deletion.uncertain', locale) : job !== null ? t(`proxy.deletion.${job.state}`, locale) : t('proxy.deletion.available', locale)}
      {job?.error !== null && job?.error !== undefined && <code> — {job.error}</code>}
    </div>
    {error !== null && <p role="alert">{t(error === 'PROXY_MAINTENANCE' ? 'proxy.deletion.stopFirst' : 'proxy.deletion.error', locale)} <code>{error}</code></p>}
    {!monitorStopped && <p className="hint">{t('proxy.deletion.stopFirst', locale)}</p>}
    {!loading && !supported && job === null && <p className="hint">{t('proxy.deletion.unsupported', locale)}</p>}
    <div className="inspector-actions">
      <button ref={trigger} className="btn ui-btn-danger" type="button" disabled={disabled} aria-expanded={confirming} aria-controls={confirmationId}
        onClick={() => { setAcknowledged(false); setConfirming(true); }}>{t(job === null ? 'proxy.deletion.delete' : 'proxy.deletion.retry', locale)}</button>
      <button ref={refresh} className="btn" type="button" disabled={loading || busy} onClick={() => void load()}>{t('proxy.deletion.refresh', locale)}</button>
    </div>
    {confirming && <div id={confirmationId} role="group" aria-label={t('proxy.deletion.confirmTitle', locale)} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); cancel(); } }}>
      <p>{t('proxy.deletion.scope', locale)}</p>
      <p className="mono" style={{ overflowWrap: 'anywhere' }}>{requestId}</p>
      <label><input ref={checkbox} type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} /> {t('proxy.deletion.acknowledge', locale)}</label>
      <div className="inspector-actions">
        <button className="btn ui-btn-danger" type="button" disabled={!acknowledged || disabled} onClick={() => void submit()}>{t('proxy.deletion.confirm', locale)}</button>
        <button className="btn" type="button" onClick={cancel}>{t('common.close', locale)}</button>
      </div>
    </div>}
  </section>;
}
