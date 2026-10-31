import { Fragment, useCallback, useEffect, useId, useRef, useState } from 'react';
import { api, ApiError } from '../api/client.js';
import type { CaptureMetadataCapacity, CaptureStorageStatus, ProxyRuntimeStatus } from '../core/trace-types.js';
import { t, type I18nKey, type Locale } from '../i18n.js';

type Snapshot<T> = { state: 'loading' } | { state: 'value'; value: T } | { state: 'error'; code: string };
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
function metadata(value: CaptureMetadataCapacity | null): CaptureMetadataCapacity {
  if (value === null || ![value.combinedLimitBytes, value.walLimitBytes, value.combinedAdmissionBytes, value.walAdmissionBytes].every(item => integer(item) && item > 0) ||
    value.combinedAdmissionBytes >= value.combinedLimitBytes || value.walAdmissionBytes >= value.walLimitBytes ||
    typeof value.checkedAt !== 'string' || !value.checkedAt.endsWith('Z') || !Number.isFinite(Date.parse(value.checkedAt))) throw new ApiError('INVALID_METADATA_CAPACITY', 'Invalid capacity snapshot');
  if (value.state === 'unavailable') {
    if (value.databaseBytes !== null || value.walBytes !== null || value.reason !== 'stat_error') throw new ApiError('INVALID_METADATA_CAPACITY', 'Invalid unknown capacity');
  } else {
    if (!integer(value.databaseBytes) || !integer(value.walBytes) || !Number.isSafeInteger(value.databaseBytes + value.walBytes)) throw new ApiError('INVALID_METADATA_CAPACITY', 'Invalid capacity sizes');
    const reason = value.databaseBytes + value.walBytes >= value.combinedAdmissionBytes ? 'database_limit' : value.walBytes >= value.walAdmissionBytes ? 'wal_limit' : null;
    if (value.reason !== reason || value.state !== (reason === null ? 'ready' : 'limited')) throw new ApiError('INVALID_METADATA_CAPACITY', 'Inconsistent capacity status');
  }
  return value;
}
function originals(value: CaptureStorageStatus | null): CaptureStorageStatus {
  if (value === null || ![value.quotaBytes, value.maxBodyBytes, value.maxPendingBytes].every(item => integer(item) && item > 0) ||
    ![value.usedBytes, value.pendingBytes, value.activeBodies].every(integer) || value.exhausted !== (value.usedBytes >= value.quotaBytes)) {
    throw new ApiError('INVALID_ORIGINAL_STORAGE', 'Invalid original quota');
  }
  return value;
}
function runtimeKey(status: ProxyRuntimeStatus | null): string {
  const d = status?.diagnostics;
  return JSON.stringify([status?.running, status?.starting, status?.port, status?.requestCount, d?.runId, d?.phase, d?.cleanupPending,
    d?.observedRequests, d?.activeRequests, d?.pendingWrites, d?.persistedRequests, d?.interruptedRequests, d?.captureErrors, d?.lastRequestAt, d?.lastError]);
}

/** Explicit bounded snapshots only. No polling, body reads or new deletion intent. */
export function CaptureCapacityPanel({ locale, runtimeStatus = null }: { locale: Locale; runtimeStatus?: ProxyRuntimeStatus | null }): React.JSX.Element {
  const [capacity, setCapacity] = useState<Snapshot<CaptureMetadataCapacity>>({ state: 'loading' });
  const [storage, setStorage] = useState<Snapshot<CaptureStorageStatus>>({ state: 'loading' });
  const [busy, setBusy] = useState(false), [snapshotKey, setSnapshotKey] = useState<string | null>(null);
  const generation = useRef(0), pending = useRef(false), abort = useRef<AbortController | null>(null), timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshButton = useRef<HTMLButtonElement | null>(null), returnFocus = useRef(false);
  const key = runtimeKey(runtimeStatus), latestKey = useRef(key); latestKey.current = key;
  const id = useId();
  const refresh = useCallback(async (): Promise<void> => {
    if (pending.current) return;
    pending.current = true; abort.current?.abort(); if (timer.current !== null) clearTimeout(timer.current);
    const operation = new AbortController(), token = ++generation.current; abort.current = operation;
    setCapacity({ state: 'loading' }); setStorage({ state: 'loading' }); setBusy(true); setSnapshotKey(latestKey.current);
    timer.current = setTimeout(() => {
      if (token !== generation.current) return;
      generation.current += 1; operation.abort(); pending.current = false; setBusy(false);
      setCapacity(previous => previous.state === 'loading' ? { state: 'error', code: 'CAPACITY_TIMEOUT' } : previous);
      setStorage(previous => previous.state === 'loading' ? { state: 'error', code: 'CAPACITY_TIMEOUT' } : previous);
    }, 5000);
    const load = async <T,>(request: Promise<T>, validate: (value: T) => T, set: (value: Snapshot<T>) => void): Promise<void> => {
      try {
        const value = validate(await request);
        if (token === generation.current && !operation.signal.aborted) set({ state: 'value', value });
      } catch (error) {
        if (token !== generation.current) return;
        const code = error instanceof ApiError && /^[A-Z0-9_]{1,64}$/.test(error.code) ? error.code : 'CAPACITY_UNAVAILABLE';
        set({ state: 'error', code });
      }
    };
    await Promise.allSettled([load(api.proxyCapacity(operation.signal), metadata, setCapacity), load(api.proxyStorage(operation.signal), originals, setStorage)]);
    if (token === generation.current) { if (timer.current !== null) clearTimeout(timer.current); pending.current = false; setBusy(false); }
  }, []);
  useEffect(() => { void refresh(); return () => { generation.current += 1; pending.current = false; abort.current?.abort(); if (timer.current !== null) clearTimeout(timer.current); }; }, [refresh]);
  useEffect(() => {
    if (busy || !returnFocus.current) return;
    returnFocus.current = false;
    if (document.activeElement === document.body || document.activeElement === refreshButton.current) refreshButton.current?.focus();
  }, [busy, capacity, storage]);
  const bytes = (value: number | null): string => value === null ? '—' : value.toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US') + ' B';
  const fields = (values: ReadonlyArray<readonly [I18nKey, number | null]>): React.JSX.Element => <dl className="capture-capacity-grid">{values.map(([label, value]) => <Fragment key={label}><dt>{t(label, locale)}</dt><dd className="mono">{label === 'proxy.capacity.active' ? value : bytes(value)}</dd></Fragment>)}</dl>;
  const state = <T,>(value: Snapshot<T>): React.JSX.Element | null => value.state === 'loading' ? <p role="status">{t('proxy.capacity.loading', locale)}</p> : value.state === 'error' ? <p role="alert">{t('proxy.capacity.error', locale)} <code>{value.code}</code></p> : null;
  const error = runtimeStatus?.diagnostics?.lastError;
  return <div className="capture-capacity-panel" aria-busy={busy}>
    <p className="hint">{t('proxy.capacity.snapshot', locale)}</p>
    <button ref={refreshButton} type="button" className="btn" disabled={busy} onClick={() => { returnFocus.current = document.activeElement === refreshButton.current; void refresh(); }}>{t('proxy.capacity.refresh', locale)}</button>
    {snapshotKey !== null && snapshotKey !== key && <p role="status">{t('proxy.capacity.stale', locale)}</p>}
    {(runtimeStatus?.running || runtimeStatus?.starting || runtimeStatus?.diagnostics?.pendingWrites) ? <p className="hint">{t('proxy.capacity.runtimeActive', locale)}</p> : null}
    <section aria-labelledby={id + '-originals'}>
      <h3 id={id + '-originals'}>{t('proxy.capacity.originals', locale)}</h3>
      {state(storage)}
      {storage.state === 'value' && <>
        <p role="status">{t(storage.value.exhausted ? 'proxy.capacity.quotaFull' : 'proxy.capacity.quotaReady', locale)}</p>
        {fields([['proxy.capacity.used', storage.value.usedBytes], ['proxy.capacity.quota', storage.value.quotaBytes], ['proxy.capacity.remaining', Math.max(0, storage.value.quotaBytes - storage.value.usedBytes)],
          ['proxy.capacity.pending', storage.value.pendingBytes], ['proxy.capacity.active', storage.value.activeBodies], ['proxy.capacity.maxBody', storage.value.maxBodyBytes], ['proxy.capacity.maxPending', storage.value.maxPendingBytes]])}
        {storage.value.exhausted && <p>{t('proxy.capacity.quotaGuide', locale)}</p>}
      </>}
      <p className="hint">{t('proxy.capacity.pendingDeletion', locale)}</p>
    </section>
    <section aria-labelledby={id + '-metadata'}>
      <h3 id={id + '-metadata'}>{t('proxy.capacity.metadata', locale)}</h3>
      {state(capacity)}
      {capacity.state === 'value' && <>
        <p role="status">{t(capacity.value.state === 'ready' ? 'proxy.capacity.metadataReady' : capacity.value.state === 'limited' ? 'proxy.capacity.metadataLimited' : 'proxy.capacity.metadataUnavailable', locale)}</p>
        {fields([['proxy.capacity.db', capacity.value.databaseBytes], ['proxy.capacity.wal', capacity.value.walBytes], ['proxy.capacity.combined', capacity.value.databaseBytes === null || capacity.value.walBytes === null ? null : capacity.value.databaseBytes + capacity.value.walBytes],
          ['proxy.capacity.combinedAdmission', capacity.value.combinedAdmissionBytes], ['proxy.capacity.walAdmission', capacity.value.walAdmissionBytes], ['proxy.capacity.combinedLimit', capacity.value.combinedLimitBytes], ['proxy.capacity.walLimit', capacity.value.walLimitBytes]])}
        <p className="hint">{t('proxy.capacity.checkedAt', locale)}: <time dateTime={capacity.value.checkedAt}>{capacity.value.checkedAt}</time></p>
        {capacity.value.reason !== null && <p>{t(capacity.value.reason === 'wal_limit' ? 'proxy.capacity.walGuide' : capacity.value.reason === 'database_limit' ? 'proxy.capacity.dbGuide' : 'proxy.capacity.unknownGuide', locale)}</p>}
      </>}
    </section>
    {(error === 'CAPTURE_METADATA_SQLITE_FULL' || error === 'CAPTURE_METADATA_QUEUE_FULL' || error === 'CAPTURE_METADATA_UNAVAILABLE' || error === 'CAPTURE_METADATA_LIMIT') && <p role="alert">{t('proxy.capacity.lastError', locale)}: <code>{error}</code> — {t(error === 'CAPTURE_METADATA_SQLITE_FULL' ? 'proxy.capacity.sqliteFull' : error === 'CAPTURE_METADATA_QUEUE_FULL' ? 'proxy.capacity.queueFull' : error === 'CAPTURE_METADATA_UNAVAILABLE' ? 'proxy.capacity.unknownGuide' : 'proxy.capacity.pressureGuide', locale)}</p>}
  </div>;
}
