import { useCallback, useEffect, useRef, useState } from 'react';
import type { Locale } from '../i18n.js';
import type { TelemetryImportResult, TelemetryStatus } from '../core/telemetry-types.js';
import { fetchJson } from '../api/client.js';
import { useTaskRead } from './task/task-data.js';

export function TelemetryIntakePanel({ locale, file = false }: { locale: Locale; file?: boolean }): React.JSX.Element {
  const zh = locale === 'zh', owner = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [token, setToken] = useState<string | null>(null);
  const [requireToken, setRequireToken] = useState(true), [result, setResult] = useState<TelemetryImportResult | null>(null), [copied, setCopied] = useState(false);
  const read = useCallback((signal: AbortSignal) => fetchJson<TelemetryStatus>('/telemetry', { signal }), []);
  const status = useTaskRead(file ? null : 'telemetry', read, 10000);
  useEffect(() => () => { owner.current?.abort(); owner.current = null; }, []);
  const action = async (run: (signal: AbortSignal) => Promise<void>) => {
    if (owner.current) return;
    const controller = new AbortController(); owner.current = controller; setBusy(true); setError(null); setCopied(false);
    const timeout = setTimeout(() => controller.abort(), 45000);
    try { await run(controller.signal); }
    catch (cause) { if (owner.current === controller) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { clearTimeout(timeout); if (owner.current === controller) { owner.current = null; setBusy(false); if (!file) status.retry(); } }
  };
  const toggle = () => action(async signal => {
    const next = await fetchJson<TelemetryStatus & { token?: string }>('/telemetry', { method: 'PUT', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: !status.value?.enabled, requireToken: status.value?.enabled ? status.value.requireToken : requireToken }) });
    if (!signal.aborted) setToken(next.token ?? null);
  });
  if (file) return <section className="task-monitor-card"><div><h3>{zh ? 'OTLP / Langfuse / LangSmith 文件' : 'OTLP / Langfuse / LangSmith files'}</h3>
    <p>{zh ? '自动识别 JSON / JSONL；仅在本机分析历史数据。保存脱敏、有界预览，不执行 Agent。TraceLog 原文件请使用下方入口。' : 'Auto-detect JSON / JSONL; local historical analysis with redacted bounded previews. Use the control below for TraceLog originals.'}</p>
    <label>{zh ? '选择遥测导出文件' : 'Choose telemetry export'} <input type="file" accept=".json,.jsonl,.ndjson" disabled={busy} onChange={e => {
      const selected = e.target.files?.[0]; e.target.value = ''; if (!selected) return;
      if (selected.size > 8 * 1024 * 1024) { setError(zh ? '文件超过 8 MiB 上限' : 'File exceeds 8 MiB limit'); return; }
      setResult(null); void action(async signal => { const uploaded = await fetchJson<TelemetryImportResult>('/telemetry/import', { method: 'POST', signal, headers: { 'content-type': /\.(jsonl|ndjson)$/i.test(selected.name) ? 'application/x-ndjson' : 'application/json' }, body: selected }); if (!signal.aborted) setResult(uploaded); });
    }} /></label>
    {busy && <p role="status">{zh ? '正在校验并导入…' : 'Validating and importing…'}</p>}{result && <p role="status">{result.format} · {result.spanCount} spans · {result.taskIds.length} {zh ? '个任务；请在“导入任务”查看。' : 'tasks; open Imported tasks to inspect.'}</p>}{error && <p role="alert">{error}</p>}
  </div></section>;
  return <section><p>{zh ? '默认关闭，仅接受回环请求，数据留在本机。需要客户端自身的 OTel instrumentation 和支持 http/json 的 exporter；环境变量不会自动安装 SDK。' : 'Default off, loopback only, data stays local. Your client needs OTel instrumentation and an exporter supporting http/json; environment variables do not install an SDK.'}</p>
    {(status.error || error) && <p role="alert">{error ?? status.error}</p>}
    {status.value && <><p role="status">{status.value.enabled ? zh ? '接收已启用' : 'Receiver enabled' : zh ? '接收已停用' : 'Receiver disabled'}</p><p><code>{status.value.endpoint}</code></p>
      <label><input type="checkbox" checked={status.value.enabled ? status.value.requireToken : requireToken} disabled={busy || status.value.enabled} onChange={e => setRequireToken(e.target.checked)} />{zh ? '启用 Bearer token（启用时生成；仅显示一次）' : 'Require Bearer token (generated on enable, displayed once)'}</label>
      <div className="task-channel-actions"><button type="button" className="btn" disabled={busy} onClick={() => void toggle()}>{busy ? '…' : status.value.enabled ? zh ? '停用' : 'Disable' : zh ? '启用' : 'Enable'}</button><button type="button" className="btn" disabled={busy} onClick={status.retry}>{zh ? '刷新统计' : 'Refresh statistics'}</button></div>
      {token && <div><label>{zh ? '一次性 token' : 'One-time token'}<input readOnly value={token} autoComplete="off" spellCheck={false} /></label><button type="button" className="btn" onClick={() => void navigator.clipboard.writeText(token).then(() => setCopied(true)).catch(() => setError(zh ? '复制失败，请手动复制 token。' : 'Copy failed; select and copy the token.'))}>{copied ? zh ? '已复制' : 'Copied' : zh ? '复制 token' : 'Copy token'}</button></div>}
      <p>{zh ? '本次运行接收统计' : 'Accepted since process start'}: {status.value.spanCount} spans · {status.value.traceCount} traces · {status.value.rejectedCount} {zh ? '次拒绝' : 'rejections'}</p>
      {Object.entries(status.value.reasons).map(([reason, count]) => <p key={reason}><code>{reason}</code>: {count}</p>)}
      <p>{zh ? '最近接收' : 'Last received'}: {status.value.lastReceivedAt ?? '—'}</p>
      <pre className="mono">{`OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=${status.value.endpoint}\nOTEL_EXPORTER_OTLP_PROTOCOL=http/json\nOTEL_EXPORTER_OTLP_HEADERS=Authorization=Bearer <token>`}</pre>
      <p>{zh ? '不支持 protobuf；停用后再启用会重新生成 token。重启后不会自动开启采集。' : 'Protobuf is unsupported. Disable and enable to rotate the token. Collection remains off after restart.'}</p>
    </>}<button type="button" className="btn" onClick={status.retry}>{zh ? '读取实际状态' : 'Read current status'}</button>
  </section>;
}
