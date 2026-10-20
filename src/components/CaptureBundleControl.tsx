import { useLayoutEffect, useRef, useState } from 'react';
import type { Locale } from '../i18n.js';
import { CAPTURE_BUNDLE_MAX_FILE_BYTES, CAPTURE_BUNDLE_MAX_PLAN_BYTES } from '../core/capture-bundle.js';
import type { CaptureBundlePlan } from '../core/capture-bundle.js';

const COPY = {
  en: { title: 'Original evidence bundle', scope: 'Prepare one local capture archive with retained headers and encoded request/response files. Headers and originals may contain credentials. No upload or replay. Identity/link pages are bounded and complete Agent/native history is not implied.',
    prefix: 'A retained original can be only a captured prefix. Check capture statuses, manifest hashes and receipt.json after extracting; a missing receipt or incomplete download is not valid evidence.',
    prepare: 'Prepare original bundle', metadata: 'Prepare metadata bundle', waiting: 'Preparing file manifest…', cancel: 'Cancel preparation', cancelled: 'Preparation cancelled.',
    blocked: 'Capture availability is being checked; preparation is unavailable.', failed: 'Preparation failed. Retry explicitly; no download started.', timeout: 'Preparation exceeded 5 seconds. Retry explicitly.',
    download: 'Download tar bundle', mode: 'Bundle mode', originals: 'Retained originals', metadataMode: 'Metadata only — original files excluded', bytes: 'Original bytes', omitted: 'Coverage and omissions',
    ready: 'Manifest ready. The download rechecks source revision. Browser downloads own streaming, progress and cancellation; large originals are not buffered in JavaScript.',
    requested: 'Download requested. Saving is unconfirmed; inspect browser downloads. If the source changed or an error is shown, prepare again. Prior downloaded bytes cannot be revoked by local deletion.',
  },
  zh: { title: '原始证据包', scope: '准备单次采集的本地归档，包含已保留 headers 和编码后的请求/响应文件。headers 与原文可能含凭据。不上传、不重放；身份/关联为有界分页，不代表完整 Agent 或原生日志历史。',
    prefix: '已保留原文可能只是采集前缀。解包后请核对采集状态、manifest 摘要和 receipt.json；缺少回执或下载不完整时不能作为完整证据包。',
    prepare: '准备原文证据包', metadata: '准备元数据证据包', waiting: '正在准备文件清单…', cancel: '取消准备', cancelled: '已取消准备。',
    blocked: '正在核对采集可用性，暂不能准备。', failed: '准备失败，请显式重试；未开始下载。', timeout: '准备超过 5 秒，请显式重试。',
    download: '下载 tar 证据包', mode: '证据包模式', originals: '已保留原文', metadataMode: '仅元数据，不含原文文件', bytes: '原文字节数', omitted: '覆盖范围与遗漏',
    ready: '清单已准备。下载时会重新核对来源版本。由浏览器管理流式下载、进度与取消，大原文不会整份读入页面 JavaScript。',
    requested: '已请求下载，尚未确认保存，请检查浏览器下载。如果提示来源已变或出错，请重新准备。本地删除不能撤销已经下载的字节。',
  },
} as const;
class PlanReadError extends Error {}
async function readPlan(id: number, metadataOnly: boolean, signal: AbortSignal): Promise<CaptureBundlePlan> {
  const response = await fetch(`/api/proxy/requests/${id}/bundle/manifest?mode=${metadataOnly ? 'metadata' : 'originals'}`, { signal, cache: 'no-store', headers: { accept: 'application/json' } });
  if (!response.body || !(response.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) throw new PlanReadError('CAPTURE_BUNDLE_INVALID');
  const reader = response.body.getReader(), chunks: Uint8Array<ArrayBuffer>[] = []; let length = 0;
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    for (;;) {
      signal.throwIfAborted(); const next = await reader.read(); signal.throwIfAborted(); if (next.done) break;
      length += next.value.byteLength;
      if (length > CAPTURE_BUNDLE_MAX_PLAN_BYTES) { await reader.cancel(); throw new PlanReadError('CAPTURE_EXPORT_LIMIT'); }
      chunks.push(new Uint8Array(next.value));
    }
  } finally { signal.removeEventListener('abort', abort); reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let plan: CaptureBundlePlan;
  try { plan = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as CaptureBundlePlan; } catch { throw new PlanReadError('CAPTURE_BUNDLE_INVALID'); }
  if (!response.ok) {
    const code = (plan as unknown as { error?: { code?: unknown } })?.error?.code;
    throw new PlanReadError(typeof code === 'string' && /^[A-Z_]{1,64}$/.test(code) ? code : 'CAPTURE_BUNDLE_UNAVAILABLE');
  }
  const paths = ['evidence.json', 'README.txt', ...(metadataOnly ? [] : ['originals/request.body', 'originals/response.body'])];
  if (!plan || plan.format !== 'awesome-telemetry.capture-bundle' || plan.formatVersion !== 1 || plan.proxyId !== id || typeof plan.requestId !== 'string' ||
    plan.mode !== (metadataOnly ? 'metadata' : 'originals') || !/^[0-9a-f]{64}$/.test(plan.revision) || typeof plan.generatedAt !== 'string' ||
    !Number.isFinite(Date.parse(plan.generatedAt)) || new Date(plan.generatedAt).toISOString() !== plan.generatedAt ||
    !Array.isArray(plan.files) || plan.files.length < 2 || plan.files.length > 4 || new Set(plan.files.map(file => file?.path)).size !== plan.files.length ||
    plan.files.some(file => !file || !paths.includes(file.path) || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || file.bytes > CAPTURE_BUNDLE_MAX_FILE_BYTES || !/^[0-9a-f]{64}$/.test(file.sha256)) ||
    !['evidence.json', 'README.txt'].every(path => plan.files.some(file => file.path === path)) ||
    !Number.isSafeInteger(plan.originalBytes) || plan.originalBytes !== plan.files.filter(file => file.path.startsWith('originals/')).reduce((sum, file) => sum + file.bytes, 0) ||
    !Array.isArray(plan.omissions) || plan.omissions.length > 30 || plan.omissions.some(value => typeof value !== 'string' || !/^[a-z0-9_:]{1,256}$/.test(value))) throw new PlanReadError('CAPTURE_BUNDLE_INVALID');
  signal.throwIfAborted(); return plan;
}

function BundleAction({ id, locale, blocked, metadataOnly }: { id: number; locale: Locale; blocked: boolean; metadataOnly: boolean }) {
  const c = COPY[locale], [plan, setPlan] = useState<CaptureBundlePlan | null>(null), [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null), [cancelled, setCancelled] = useState(false), [requested, setRequested] = useState(false);
  const generation = useRef(0), operation = useRef<{ controller: AbortController; timer: ReturnType<typeof setTimeout> } | null>(null);
  const invalidate = () => { generation.current++; if (operation.current) { clearTimeout(operation.current.timer); operation.current.controller.abort(); operation.current = null; } };
  useLayoutEffect(() => () => invalidate(), []);
  useLayoutEffect(() => { if (blocked) { invalidate(); setPlan(null); setPending(false); setRequested(false); } }, [blocked]);
  const prepare = async () => {
    if (blocked || operation.current) return;
    invalidate(); const owned = generation.current, controller = new AbortController();
    setPlan(null); setPending(true); setError(null); setCancelled(false); setRequested(false);
    const timer = setTimeout(() => { if (owned !== generation.current) return; invalidate(); setPending(false); setError('BUNDLE_TIMEOUT'); }, 5000);
    operation.current = { controller, timer };
    try { const result = await readPlan(id, metadataOnly, controller.signal); if (owned === generation.current) setPlan(result); }
    catch (cause) { if (owned === generation.current) setError(cause instanceof PlanReadError ? cause.message : 'CAPTURE_BUNDLE_UNAVAILABLE'); }
    finally { clearTimeout(timer); if (owned === generation.current) { operation.current = null; setPending(false); } }
  };
  return <details className="capture-run"><summary>{c.title}</summary><section aria-label={c.title}>
    <p className="hint">{c.scope}</p><p className="hint">{c.prefix}</p><p>{c.mode}: {metadataOnly ? c.metadataMode : c.originals}</p>
    {blocked && <p role="status">{c.blocked}</p>}
    <button type="button" className="btn" disabled={blocked || pending} onClick={() => void prepare()}>{metadataOnly ? c.metadata : c.prepare}</button>
    {pending && <><p role="status">{c.waiting}</p><button type="button" className="btn" onClick={() => { invalidate(); setPending(false); setCancelled(true); }}>{c.cancel}</button></>}
    {cancelled && <p role="status">{c.cancelled}</p>}
    {error && <p role="alert">{error === 'BUNDLE_TIMEOUT' ? c.timeout : c.failed} <code>{error}</code></p>}
    {!blocked && plan && <><p>{c.bytes}: {plan.originalBytes.toLocaleString()}</p>
      <ul>{plan.files.map(file => <li key={file.path}><code>{file.path}</code> · {file.bytes.toLocaleString()} B · <code>{file.sha256}</code></li>)}</ul>
      <details><summary>{c.omitted}</summary><ul>{plan.omissions.map(reason => <li key={reason}><code>{reason}</code></li>)}</ul></details>
      <p className="hint">{c.ready}</p><a className="btn" download={`capture-${id}.tar`} href={`/api/proxy/requests/${id}/bundle?${new URLSearchParams({ mode: plan.mode, at: plan.generatedAt, revision: plan.revision })}`} onClick={() => setRequested(true)}>{c.download}</a>
    </>}{requested && <p role="status">{c.requested}</p>}
  </section></details>;
}
export function CaptureBundleControl(props: { id: number; locale: Locale; blocked: boolean; metadataOnly?: boolean; invalidateKey?: number }) {
  return <BundleAction key={props.id + ':' + Boolean(props.metadataOnly) + ':' + (props.invalidateKey ?? 0)} {...props} metadataOnly={props.metadataOnly ?? false} />;
}
