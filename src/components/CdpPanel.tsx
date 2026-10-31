import { useEffect, useRef, useState } from 'react';
import type { Locale } from '../i18n.js';
import type { CdpDevCaptureDetail, CdpDevCapturePage, CdpDevStatus, CdpDevTarget } from '../core/trace-types.js';
import { ApiError } from '../api/client.js';
import { readCdpCapture, readCdpCaptures, readCdpStatus, readCdpTargets } from '../api/cdp.js';
import { Drawer } from './ui/Modal.js';
import { CaptureBodyText } from './CaptureBodyText.js';

const COPY = {
  en: { title: 'Development CDP', scope: 'Standard Electron with an already enabled loopback debugging port. Start explicitly; no application is launched. Chromium CDP cannot decrypt Trae TTNet.',
    memory: 'Responses are decoded UTF-8 text, retained only in this development server’s memory until shutdown (64 records / 8 MiB). Stop preserves them; full capacity rejects new records. No request bodies, original wire archive, model/native identity, token or network timing is inferred.',
    refresh: 'Refresh status and responses', start: 'Start CDP', stop: 'Stop CDP', port: 'Debugging port', invalid: 'Use an integer from 1 to 65535.',
    unknown: 'Unknown — refresh status first', idle: 'Stopped', running: 'Manager enabled — verify connections and traffic separately', stopping: 'Stopping', targets: 'Owned targets', connected: 'Connected targets',
    empty: 'No acquired responses in this server snapshot.', pending: 'Waiting for the local service…', cancel: 'Cancel waiting',
    uncertain: 'Command outcome is unknown. Refresh status before another command.', error: 'Local CDP request failed. Refresh to retry; a command is never retried automatically.',
    unavailable: 'Available only through npm run dev (Vite). The production server does not expose CDP.', records: 'Acquired responses', bytes: 'Decoded bytes', rejected: 'Rejected responses', issue: 'Latest issue',
    response: 'Decoded response', close: 'Close response', time: 'Body acquired at (UTC)', hint: 'Select one response to read its text. Snapshot changes appear on explicit refresh.',
  },
  zh: { title: '开发模式 CDP', scope: '适用于已开启本机调试端口的标准 Electron。需显式启动，不会启动外部应用。Chromium CDP 无法解密 Trae TTNet。',
    memory: '响应为解码后的 UTF-8 文本，仅保存在当前开发服务内存中，服务关闭即丢失（最多 64 条 / 8 MiB）。停止保留记录；满额后拒绝新记录。不推断请求正文、原始网络字节、模型或原生身份、token 和网络耗时。',
    refresh: '刷新状态与响应', start: '启动 CDP', stop: '停止 CDP', port: '调试端口', invalid: '请输入 1–65535 的整数。',
    unknown: '状态未知，请先刷新', idle: '已停止', running: '管理器已开启，请另行核对连接与流量', stopping: '正在停止', targets: '管理中的目标', connected: '已连接目标',
    empty: '当前服务快照中没有已获取的响应。', pending: '正在等待本地服务…', cancel: '取消等待',
    uncertain: '命令结果未知。请刷新状态后再操作。', error: '本地 CDP 请求失败，请刷新重试；不会自动重试命令。',
    unavailable: '仅通过 npm run dev（Vite）提供。生产服务不开放 CDP。', records: '已获取响应', bytes: '解码字节数', rejected: '拒绝的响应', issue: '最近问题',
    response: '解码响应', close: '关闭响应', time: '正文获取时间（UTC）', hint: '选择一条响应才读取文本；显式刷新查看新的快照。',
  },
} as const;

function Workspace({ locale }: { locale: Locale }) {
  const c = COPY[locale], [port, setPort] = useState('9222');
  const [status, setStatus] = useState<CdpDevStatus | null>(null), [targets, setTargets] = useState<CdpDevTarget[]>([]);
  const [page, setPage] = useState<CdpDevCapturePage | null>(null), [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<CdpDevCaptureDetail | null>(null);
  const [pending, setPending] = useState(false), [error, setError] = useState<string | null>(null), [uncertain, setUncertain] = useState(false);
  const active = useRef<{ controller: AbortController; timer: ReturnType<typeof setTimeout>; mutation: boolean } | null>(null);
  const generation = useRef(0);
  const invalidate = () => { generation.current++; if (active.current) { clearTimeout(active.current.timer); active.current.controller.abort(); active.current = null; } };
  useEffect(() => () => invalidate(), []);
  const cancel = () => {
    if (active.current?.mutation) { setUncertain(true); setStatus(null); }
    invalidate(); setPending(false);
  };
  const run = <T,>(read: (signal: AbortSignal) => Promise<T>, success: (value: T) => void, mutation = false) => {
    if (active.current) return;
    invalidate(); const epoch = generation.current, controller = new AbortController();
    setPending(true); setError(null);
    const timer = setTimeout(() => {
      if (epoch !== generation.current) return;
      invalidate(); setPending(false); setError('CDP_TIMEOUT');
      if (mutation) { setUncertain(true); setStatus(null); }
    }, mutation ? 12000 : 5000);
    active.current = { controller, timer, mutation };
    void read(controller.signal).then(value => { if (epoch === generation.current) success(value); }).catch((cause: unknown) => {
      if (epoch !== generation.current) return;
      setError(cause instanceof ApiError ? cause.code : 'CDP_UNAVAILABLE');
      if (mutation) { setUncertain(true); setStatus(null); }
    }).finally(() => { clearTimeout(timer); if (epoch === generation.current) { active.current = null; setPending(false); } });
  };
  const refresh = () => {
    setStatus(null); setPage(null); setTargets([]); setDetail(null); setSelected(null);
    run(signal => Promise.all([readCdpStatus(signal), readCdpTargets(signal), readCdpCaptures(signal)]), ([nextStatus, nextTargets, nextPage]) => {
      setStatus(nextStatus); setTargets(nextTargets); setPage(nextPage); setUncertain(false);
    });
  };
  const command = (action: 'start' | 'stop') => run(signal => readCdpStatus(signal, action, Number(port)), next => { setStatus(next); setUncertain(false); }, true);
  const select = (id: number) => { setSelected(id); setDetail(null); run(signal => readCdpCapture(id, signal), setDetail); };
  const closeDetail = () => { cancel(); setSelected(null); setDetail(null); setError(null); };
  const validPort = /^[1-9]\d*$/.test(port) && Number.isSafeInteger(Number(port)) && Number(port) <= 65535;
  return <section aria-label={c.title}>
    <p className="hint">{c.scope}</p><p className="hint">{c.memory}</p>
    <div className="capture-toolbar">
      <label>{c.port}<input className="ui-input capture-port" inputMode="numeric" value={port} disabled={pending || status?.state === 'running'} onChange={event => setPort(event.target.value)} aria-invalid={!validPort} /></label>
      <button type="button" className="btn" disabled={pending || status?.state !== 'idle' || uncertain || !validPort} onClick={() => command('start')}>{c.start}</button>
      <button type="button" className="btn" disabled={pending || !status || status.state === 'idle' || uncertain} onClick={() => command('stop')}>{c.stop}</button>
      <button type="button" className="btn" disabled={pending} onClick={refresh}>{c.refresh}</button>
      {pending && <button type="button" className="btn" onClick={cancel}>{c.cancel}</button>}
    </div>
    {!validPort && <p role="alert">{c.invalid}</p>}
    <p role="status">{status ? c[status.state] : c.unknown}</p>
    {pending && <p role="status">{c.pending}</p>}{uncertain && <p role="status">{c.uncertain}</p>}
    {error && <p role="alert"><code>{error}</code> · {error === 'ROUTE_NOT_FOUND' ? c.unavailable : c.error}</p>}
    {status && <p>{c.targets}: {status.targetCount} · {c.connected}: {status.connectedTargetCount}</p>}
    {targets.map(target => <p key={target.id} className="mono">{target.title} · {target.id} · {target.url}</p>)}
    {page && <><p>{c.records}: {page.items.length} · {c.bytes}: {page.totalBytes} · {c.rejected}: {page.rejectedCount} · {c.issue}: {page.lastIssue ?? '—'}</p>
      <p className="hint">{c.hint}</p>{page.items.length === 0 && <p>{c.empty}</p>}
      {page.items.map(item => <div key={item.id} className="capture-toolbar"><button type="button" className="btn mono" disabled={pending} onClick={() => select(item.id)}>#{item.id} · {item.url}</button><span>{item.bodyBytes} B · {item.capturedAt}</span></div>)}
    </>}
    <Drawer open={selected !== null} title={c.response + ' #' + selected} onClose={closeDetail} width={700}>
      <button type="button" className="btn" onClick={closeDetail}>{c.close}</button>
      {pending && <p role="status">{c.pending}</p>}
      {error && <p role="alert">{c.error} <code>{error}</code><button type="button" className="btn" disabled={pending} onClick={() => selected !== null && select(selected)}>{c.refresh}</button></p>}
      {detail && <><p className="mono">{detail.url}</p><p>{c.time}: {detail.capturedAt} · {c.bytes}: {detail.bodyBytes}</p>
        <CaptureBodyText key={detail.id} value={detail.body} locale={locale} /></>}
    </Drawer>
  </section>;
}

export function CdpPanel({ locale }: { locale: Locale }) {
  const [open, setOpen] = useState(false);
  return <details className="capture-run" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>{COPY[locale].title}</summary>{open && <Workspace locale={locale} />}
  </details>;
}
