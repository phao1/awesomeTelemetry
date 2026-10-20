import { useCallback, useEffect, useRef, useState } from 'react';
import type { Locale } from '../i18n.js';
import type { FridaCapture } from '../core/trace-types.js';
import { fetchFridaCapture } from '../api/frida-captures.js';
import { ApiError } from '../api/client.js';
import { Drawer } from './ui/Modal.js';
import '../styles/components/frida-captures.css';

function preview(value: string): string {
  let bytes = 0, result = '';
  for (const char of value) { const size = new TextEncoder().encode(char).length; if (bytes + size > 65536) break; bytes += size; result += char; }
  return result;
}
interface Owner { controller: AbortController; timer: ReturnType<typeof setTimeout> }
export function FridaCaptureInspector({ id, locale, onClose }: { id: number; locale: Locale; onClose: () => void }): React.JSX.Element {
  const [capture, setCapture] = useState<FridaCapture | null>(null), [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true), [expanded, setExpanded] = useState(false), [font, setFont] = useState(12), [width, setWidth] = useState(620);
  const owner = useRef<Owner | null>(null);
  const cancel = useCallback(() => { if (owner.current) { clearTimeout(owner.current.timer); owner.current.controller.abort(); owner.current = null; } }, []);
  const read = useCallback(async () => {
    cancel(); setCapture(null); setError(null); setLoading(true); setExpanded(false);
    const controller = new AbortController();
    const current: Owner = { controller, timer: setTimeout(() => { if (owner.current !== current) return; cancel(); setLoading(false); setError('FRIDA_READ_TIMEOUT'); }, 5000) };
    owner.current = current;
    try { const value = await fetchFridaCapture(id, controller.signal); if (owner.current === current) setCapture(value); }
    catch (failure) { if (owner.current === current) setError(failure instanceof ApiError ? failure.code : failure instanceof Error && failure.message === 'FRIDA_RESPONSE_INVALID' ? failure.message : 'FRIDA_READ_FAILED'); }
    finally { if (owner.current === current) { cancel(); setLoading(false); } }
  }, [id, cancel]);
  useEffect(() => { void read(); return cancel; }, [read, cancel]);
  const zh = locale === 'zh', current = capture?.id === id ? capture : null;
  const text = current === null ? '' : expanded ? current.jsonData : preview(current.jsonData);
  return <Drawer open title={(zh ? 'Frida 捕获 #' : 'Frida capture #') + id} onClose={onClose} width={width} className="frida-capture-inspector">
    <p className="hint">{zh ? '已保存的观测原文；不证明工具执行、Trae 版本兼容或完整真机捕获。' : 'Saved observation text; not proof of tool execution, Trae compatibility or complete device capture.'}</p>
    <label className="frida-capture-width">{zh ? '宽度' : 'Width'}<input type="range" aria-label={zh ? '详情宽度' : 'Inspector width'} min={320} max={1000} value={width} onChange={event => setWidth(Number(event.target.value))}/></label>
    {loading && <div role="status">{zh ? '读取中…' : 'Loading…'} <button type="button" className="btn" onClick={() => { cancel(); setLoading(false); setError('FRIDA_READ_CANCELLED'); }}>{zh ? '取消读取' : 'Cancel read'}</button></div>}
    {error && <div role="alert"><code>{error}</code><p>{zh ? '本次读取未完成，可显式重试。' : 'This read did not complete. Retry explicitly.'}</p></div>}
    {!loading && <button type="button" className="btn" onClick={() => void read()}>{zh ? '重试 / 刷新' : 'Retry / refresh'}</button>}
    {current && <><dl className="frida-capture-meta"><dt>PID</dt><dd>{current.pid}</dd><dt>{zh ? '时间' : 'Time'}</dt><dd>{current.capturedAt}</dd><dt>{zh ? '模型' : 'Model'}</dt><dd>{current.model ?? '—'}</dd><dt>{zh ? '原生会话' : 'Native session'}</dt><dd>{current.sessionId ?? '—'}</dd><dt>{zh ? '本地捕获批次' : 'Local capture run'}</dt><dd>{current.captureSessionId ?? '—'}</dd><dt>{zh ? '类型' : 'Type'}</dt><dd>{current.captureType}</dd><dt>{zh ? '消息数' : 'Message count'}</dt><dd>{current.messageCount ?? '—'}</dd></dl>
      <div className="frida-capture-toolbar"><button type="button" className="btn" aria-label={zh ? '减小字体' : 'Smaller text'} disabled={font <= 8} onClick={() => setFont(value => Math.max(8, value - 1))}>A−</button><button type="button" className="btn" aria-label={zh ? '增大字体' : 'Larger text'} disabled={font >= 28} onClick={() => setFont(value => Math.min(28, value + 1))}>A+</button><button type="button" className="btn" aria-label={zh ? '重置字体' : 'Reset text'} onClick={() => setFont(12)}>R</button><span>{font}px</span></div>
      <p className="hint">{zh ? 'JSON 原文；初始最多显示 64 KiB。未知值保留为空。' : 'Original JSON; initially at most 64 KiB. Unknown values remain null.'}</p>
      <pre className="frida-capture-json" style={{ fontSize: font }}>{text}</pre>
      {!expanded && text.length < current.jsonData.length && <button type="button" className="btn" onClick={() => setExpanded(true)}>{zh ? '展开已保存的完整 JSON' : 'Expand full retained JSON'}</button>}
    </>}
  </Drawer>;
}
