import { useLayoutEffect, useRef, useState } from 'react';

import type { Locale } from '../i18n.js';

const MAX_EXPORT_BYTES = 4 * 1024 * 1024;
const COPY = {
  en: { title: 'Local evidence export', action: 'Export evidence JSON', cancel: 'Cancel export', pending: 'Preparing evidence…',
    scope: 'Local download only; preserves observed headers without redaction. Bounded analysis and identity/link pages are included; original body files must be saved separately. Not a full archive or supported offline import format.',
    blocked: 'Availability is unknown or deletion is in progress; wait for confirmation before exporting. Deleted bodies can later be represented by a metadata-only package.',
    downloaded: 'Download requested. Check your browser; saving is not confirmed and prior downloads cannot be erased by local deletion.',
    failed: 'Export failed; retry explicitly. No upstream request was replayed.', timeout: 'Export exceeded 10 seconds. Retry explicitly; no file was downloaded.', invalid: 'The returned evidence package is invalid, mismatched or oversized; no download was created.', metadataOnly: 'Metadata-only export: analysis/body-derived content is excluded, including while deletion is unconfirmed.' },
  zh: { title: '本地证据导出', action: '导出证据 JSON', cancel: '取消导出', pending: '正在准备证据…',
    scope: '仅本地下载，保留观测到的原始 headers，不脱敏。包含有界分析及身份/关联分页；原文文件需要单独保存。这不是完整归档，也不代表支持离线导入。',
    blocked: '可用性未知或正在删除，请等待状态确认后导出；正文已删除时仍可导出仅元数据包。',
    downloaded: '已请求下载，请检查浏览器；尚未确认保存。后续本地删除不能撤销此前下载的副本。',
    failed: '导出失败，请显式重试；未重放任何上游请求。', timeout: '导出超过 10 秒，未触发下载，请显式重试。', invalid: '证据包无效、请求不匹配或超过上限，未创建下载。', metadataOnly: '仅导出元数据：不包含分析及正文派生内容，即使删除结果尚未确认。' },
} as const;

class ExportReadError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function ExportAction({ id, locale, blocked, metadataOnly }: { id: number; locale: Locale; blocked: boolean; metadataOnly: boolean }) {
  const copy = COPY[locale];
  const [pending, setPending] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const operation = useRef<{ controller: AbortController; timer: ReturnType<typeof setTimeout> } | null>(null);
  const objectUrl = useRef<string | null>(null);
  const invalidate = (): void => {
    generation.current += 1;
    if (operation.current !== null) { clearTimeout(operation.current.timer); operation.current.controller.abort(); operation.current = null; }
    if (objectUrl.current !== null) { URL.revokeObjectURL(objectUrl.current); objectUrl.current = null; }
  };
  useLayoutEffect(() => () => invalidate(), []);
  useLayoutEffect(() => {
    if (blocked) { invalidate(); setPending(false); setDownloaded(false); setError(null); }
  }, [blocked]);

  const download = async (): Promise<void> => {
    if (blocked || operation.current !== null) return;
    invalidate(); const token = generation.current;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      if (token !== generation.current) return;
      invalidate(); setPending(false); setError('EXPORT_TIMEOUT');
    }, 10_000);
    operation.current = { controller, timer };
    setPending(true); setDownloaded(false); setError(null);
    const current = (): boolean => token === generation.current && !controller.signal.aborted;
    try {
      const response = await fetch('/api/proxy/requests/' + encodeURIComponent(String(id)) + '/export' + (metadataOnly ? '?mode=metadata' : ''), { signal: controller.signal, cache: 'no-store' });
      if (!current()) return;
      if (!response.ok) {
        let code = 'EXPORT_UNAVAILABLE';
        try {
          const envelope = record(await response.json());
          const candidate = record(envelope?.error)?.code;
          if (typeof candidate === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(candidate)) code = candidate;
        } catch { code = 'EXPORT_UNAVAILABLE'; }
        throw new ExportReadError(code);
      }
      if (!(response.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) throw new ExportReadError('INVALID_EXPORT');
      const declaredBytes = Number(response.headers.get('content-length'));
      if (declaredBytes > MAX_EXPORT_BYTES) throw new ExportReadError('CAPTURE_EXPORT_LIMIT');
      const blob = await response.blob();
      if (!current()) return;
      if (blob.size > MAX_EXPORT_BYTES) throw new ExportReadError('CAPTURE_EXPORT_LIMIT');
      let value: Record<string, unknown> | null;
      try { value = record(JSON.parse(await blob.text()) as unknown); } catch { throw new ExportReadError('INVALID_EXPORT'); }
      if (!current()) return;
      if (value?.format !== 'awesome-telemetry.capture-evidence' || value.formatVersion !== 1 || record(value.request)?.id !== id
        || ((metadataOnly || value.originalDeletion != null) && value.analysis !== null)) throw new ExportReadError('INVALID_EXPORT');
      const url = URL.createObjectURL(blob); objectUrl.current = url;
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = 'capture-' + id + '.json';
      document.body.appendChild(anchor);
      try { anchor.click(); } finally { anchor.remove(); }
      setDownloaded(true);
    } catch (cause) {
      if (current()) {
        setError(cause instanceof ExportReadError ? cause.code : 'EXPORT_UNAVAILABLE');
        if (objectUrl.current !== null) { URL.revokeObjectURL(objectUrl.current); objectUrl.current = null; }
      }
    } finally {
      clearTimeout(timer);
      if (token === generation.current) { operation.current = null; setPending(false); }
    }
  };
  return <section aria-label={copy.title} aria-busy={pending}>
    <p className="hint">{copy.scope}</p>
    {metadataOnly && <p className="hint">{copy.metadataOnly}</p>}
    {blocked && <p role="status">{copy.blocked}</p>}
    {pending && <p role="status">{copy.pending}</p>}
    {downloaded && <p role="status">{copy.downloaded}</p>}
    {error !== null && <p role="alert">{error === 'EXPORT_TIMEOUT' ? copy.timeout : error === 'INVALID_EXPORT' || error === 'CAPTURE_EXPORT_LIMIT' ? copy.invalid : copy.failed} <code>{error}</code></p>}
    <button type="button" className="btn" disabled={blocked || pending} onClick={() => void download()}>{copy.action}</button>
    {pending && <button type="button" className="btn" onClick={() => { invalidate(); setPending(false); }}>{copy.cancel}</button>}
  </section>;
}

/** ID-scoped ownership prevents an old export response from reaching a newly selected call. */
export function CaptureExportControl(props: { id: number; locale: Locale; blocked: boolean; metadataOnly?: boolean }) {
  const metadataOnly = props.metadataOnly ?? false;
  return <ExportAction key={props.id + ':' + metadataOnly} {...props} metadataOnly={metadataOnly} />;
}
