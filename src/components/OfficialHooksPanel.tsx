import { useCallback, useEffect, useRef, useState } from 'react';
import type { Locale } from '../i18n.js';
import type { ClaudeHookConfigureResult, ClaudeHookDetail, ClaudeHookPage, ClaudeHookSummary } from '../core/claude-hooks.js';
import { CLAUDE_HOOK_EVENTS } from '../core/claude-hooks.js';
import { Drawer } from './ui/Modal.js';
import { CaptureBodyText } from './CaptureBodyText.js';

const COPY = {
  en: { title: 'Official Claude hooks', scope: 'Receive observations from manually configured Claude Code HTTP hooks. Disabled by default. Settings are never installed automatically.',
    meaning: 'Counts describe deliveries, including duplicates. PreToolUse does not prove execution or permission. Receipt gaps are not tool duration; subagent hooks do not prove a separate session or spawn.',
    ack: 'I understand that hook payloads are saved unchanged and may include prompts, tool inputs and results.', enable: 'Enable and generate settings', rotate: 'Rotate token and generate settings', disable: 'Disable receiver',
    settings: 'Settings fragment with secret', merge: 'Merge this fragment with your existing Claude settings manually; preserve your other hooks and permissions. Check HTTP hook support in your installed version. The secret is shown only after this command; rotate it to generate a new fragment.',
    enabled: 'Receiver enabled', disabled: 'Receiver disabled', unknown: 'Receiver status unknown', observations: 'Saved deliveries', refresh: 'Refresh metadata', apply: 'Apply exact filters', session: 'Native session ID', tool: 'Native tool use ID', agent: 'Native agent ID', scopeLabel: 'Agent scope', all: 'All agents', root: 'Root (no agent ID)', exact: 'Exact agent ID', invalid: 'A tool filter requires a session and an explicit root or agent scope. IDs must be at most 512 characters.',
    pause: 'Pause automatic metadata refresh', stale: 'Saved-event hint received; metadata may be stale.', empty: 'No retained deliveries match this snapshot.', pending: 'Waiting for the local service…', cancel: 'Cancel waiting', uncertain: 'Command result unknown. Refresh metadata before another command; the command will not be retried automatically.', error: 'Hook request failed. Refresh or explicitly retry the selected detail.',
    next: 'Next page', first: 'First page', raw: 'Inspect payload', close: 'Close payload', retry: 'Retry selected payload', scopeTool: 'Show this exact tool scope', open: 'Open retained native session', duration: 'Native reported duration (ms)', received: 'Received (UTC)', bytes: 'Original bytes', unresolved: 'Native session unresolved', ambiguous: 'Native session ambiguous', manifest_incomplete: 'Native identity manifest incomplete', unique: 'Exact unique retained native identity',
  },
  zh: { title: '官方 Claude hooks', scope: '接收手工配置的 Claude Code HTTP hook 观测。默认关闭，不会自动安装配置。',
    meaning: '计数表示收到的投递，包含重复投递。PreToolUse 不证明执行或权限通过；接收间隔不是工具耗时，子 Agent hook 不证明独立会话或实际派生。',
    ack: '我理解 hook 载荷将按原样保存，可能包含提示词、工具输入和结果。', enable: '启用并生成配置', rotate: '轮换令牌并生成配置', disable: '停用接收器',
    settings: '含密钥的配置片段', merge: '请手工合并到现有 Claude 配置，保留其他 hooks 和权限，并核对已安装版本是否支持 HTTP hooks。密钥只在本次命令后显示；需要新片段时轮换令牌。',
    enabled: '接收器已启用', disabled: '接收器已停用', unknown: '接收器状态未知', observations: '已保存投递', refresh: '刷新元数据', apply: '应用精确筛选', session: '原生会话 ID', tool: '原生工具调用 ID', agent: '原生 Agent ID', scopeLabel: 'Agent 范围', all: '所有 Agent', root: '根范围（无 Agent ID）', exact: '精确 Agent ID', invalid: '工具筛选需要会话及明确的根范围或 Agent 范围；ID 最长 512 字符。',
    pause: '暂停自动刷新元数据', stale: '收到新保存提示，元数据可能已过期。', empty: '当前快照没有匹配的已保存投递。', pending: '正在等待本地服务…', cancel: '取消等待', uncertain: '命令结果未知。请先刷新元数据再操作，不会自动重试命令。', error: 'Hook 请求失败，请刷新或显式重试选中的详情。',
    next: '下一页', first: '第一页', raw: '查看载荷', close: '关闭载荷', retry: '重试选中载荷', scopeTool: '查看此工具精确范围', open: '打开保留的原生会话', duration: '原生报告耗时（毫秒）', received: '接收时间（UTC）', bytes: '原始字节数', unresolved: '原生会话未解析', ambiguous: '原生会话存在歧义', manifest_incomplete: '原生身份清单不完整', unique: '保留身份精确且唯一匹配',
  },
} as const;
const BASE = '/api/hooks/claude';
async function read<T>(path: string, signal: AbortSignal, body?: unknown): Promise<T> {
  const response = await fetch(BASE + path, { signal, cache: 'no-store', ...(body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
  const value: unknown = await response.json();
  if (!response.ok) {
    const code = (value as { error?: { code?: unknown } })?.error?.code;
    throw new Error(typeof code === 'string' && /^[A-Z_]{1,64}$/.test(code) ? code : 'HOOK_UNAVAILABLE');
  }
  return value as T;
}
function summary(v: ClaudeHookSummary): boolean {
  return !!v && Number.isSafeInteger(v.id) && v.id > 0 && (CLAUDE_HOOK_EVENTS as readonly string[]).includes(v.eventName) && typeof v.nativeSessionId === 'string' &&
    ['agentId','agentType','toolUseId','toolName','nativeSessionKey'].every(key => v[key as keyof ClaudeHookSummary] === null || typeof v[key as keyof ClaudeHookSummary] === 'string') &&
    ['unique','ambiguous','unresolved','manifest_incomplete'].includes(v.nativeSessionState) && (v.nativeSessionState === 'unique' ? !!v.nativeSessionKey : v.nativeSessionKey === null) &&
    typeof v.receivedAt === 'string' && Number.isSafeInteger(v.payloadBytes) && v.payloadBytes >= 0 && v.payloadBytes <= 262144 &&
    (v.nativeDurationMs === null || typeof v.nativeDurationMs === 'number' && Number.isFinite(v.nativeDurationMs) && v.nativeDurationMs >= 0);
}
function pageValid(v: ClaudeHookPage): boolean {
  return !!v?.status && typeof v.status.enabled === 'boolean' && Number.isSafeInteger(v.status.revision) && v.status.revision >= 0 && Number.isSafeInteger(v.status.receivedCount) && v.status.receivedCount >= 0 &&
    (v.status.lastReceivedAt === null || typeof v.status.lastReceivedAt === 'string') && Array.isArray(v.items) && v.items.length <= 50 && v.items.every(summary) && typeof v.hasMore === 'boolean' &&
    (v.hasMore ? Number.isSafeInteger(v.nextCursor) && v.nextCursor === v.items.at(-1)?.id : v.nextCursor === null);
}
function Workspace({ locale, latestId, onOpenSession }: { locale: Locale; latestId: number; onOpenSession?: (key: string) => void }) {
  const c = COPY[locale];
  const [page, setPage] = useState<ClaudeHookPage | null>(null), [settings, setSettings] = useState<string | null>(null), [ack, setAck] = useState(false);
  const [pending, setPending] = useState(false), [error, setError] = useState<string | null>(null), [uncertain, setUncertain] = useState(false);
  const [session, setSession] = useState(''), [tool, setTool] = useState(''), [agent, setAgent] = useState(''), [scope, setScope] = useState('all'), [query, setQuery] = useState('');
  const [selected, setSelected] = useState<number | null>(null), [detail, setDetail] = useState<ClaudeHookDetail | null>(null), [paused, setPaused] = useState(false), [seenHint, setSeenHint] = useState(0);
  const active = useRef<{ controller: AbortController; timer: ReturnType<typeof setTimeout>; mutation: boolean } | null>(null), generation = useRef(0), lastRead = useRef(0), hint = useRef(latestId);
  hint.current = latestId;
  const invalidate = useCallback(() => { generation.current++; if (active.current) { clearTimeout(active.current.timer); active.current.controller.abort(); active.current = null; } }, []);
  const run = useCallback(<T,>(action: (signal: AbortSignal) => Promise<T>, success: (value: T) => void, mutation = false) => {
    if (active.current) return;
    const epoch = ++generation.current, controller = new AbortController(); setPending(true); setError(null);
    const timer = setTimeout(() => {
      if (epoch !== generation.current) return;
      invalidate(); setPending(false); setError('HOOK_TIMEOUT');
      if (mutation) { setUncertain(true); setSettings(null); setPage(null); }
    }, mutation ? 10000 : 5000);
    active.current = { controller, timer, mutation };
    void action(controller.signal).then(value => { if (epoch === generation.current) success(value); }).catch((cause: unknown) => {
      if (epoch !== generation.current) return;
      setError(cause instanceof Error && /^[A-Z_]{1,64}$/.test(cause.message) ? cause.message : 'HOOK_UNAVAILABLE');
      if (mutation) { setUncertain(true); setSettings(null); setPage(null); }
    }).finally(() => { clearTimeout(timer); if (epoch === generation.current) { active.current = null; setPending(false); } });
  }, [invalidate]);
  const refresh = useCallback((filter = '', cursor: number | null = null) => {
    if (active.current) return;
    setSettings(null); setSelected(null); setDetail(null); setPage(null); lastRead.current = Date.now(); const observed = hint.current;
    const params = new URLSearchParams(filter); if (cursor !== null) params.set('cursor', String(cursor));
    run(signal => read<ClaudeHookPage>('/events?' + params, signal).then(value => { if (!pageValid(value)) throw new Error('HOOK_UNAVAILABLE'); return value; }), value => { setPage(value); setUncertain(false); setSeenHint(observed); setQuery(filter); });
  }, [run]);
  useEffect(() => { refresh(); return invalidate; }, [refresh, invalidate]);
  const stale = latestId > 0 && latestId !== seenHint;
  useEffect(() => {
    if (!stale || paused || pending || error || uncertain || selected !== null) return;
    const timer = setTimeout(() => refresh(query), Math.max(0, 5000 - (Date.now() - lastRead.current)));
    return () => clearTimeout(timer);
  }, [stale, latestId, paused, pending, error, uncertain, selected, query, refresh]);
  const cancel = () => { if (active.current?.mutation) { setUncertain(true); setSettings(null); setPage(null); } invalidate(); setPending(false); setPaused(true); };
  const configure = (enabled: boolean) => {
    if (!page || uncertain) return;
    setSettings(null);
    run(signal => read<ClaudeHookConfigureResult>('/configure', signal, { expectedRevision: page.status.revision, enabled, ...(enabled ? { confirmRaw: ack } : {}) }).then(value => {
      if (!pageValid({ ...page, status: value.status }) || value.status.enabled !== enabled || value.status.revision !== page.status.revision + 1 || enabled && !value.settings || !enabled && value.settings !== null) throw new Error('HOOK_UNAVAILABLE');
      return value;
    }), value => { setPage(previous => previous ? { ...previous, status: value.status } : previous); setSettings(value.settings ? JSON.stringify(value.settings, null, 2) : null); setAck(false); }, true);
  };
  const select = (id: number) => {
    setSettings(null); setSelected(id); setDetail(null);
    run(signal => read<ClaudeHookDetail>('/events/' + id, signal).then(value => {
      if (!summary(value) || value.id !== id || typeof value.rawJson !== 'string' || !/^[0-9a-f]{64}$/.test(value.sha256)) throw new Error('HOOK_UNAVAILABLE'); return value;
    }), setDetail);
  };
  const close = () => { cancel(); setSelected(null); setDetail(null); setError(null); };
  const valid = [session, tool, agent].every(value => value.length <= 512) && (!tool || !!session && scope !== 'all') && (scope === 'all' || !!session) && (scope !== 'id' || !!agent);
  const filters = () => { const params = new URLSearchParams(); if (session) params.set('sessionId', session); if (tool) params.set('toolUseId', tool); if (scope !== 'all') params.set('agentId', scope === 'root' ? '' : agent); return params.toString(); };
  const exactTool = (item: ClaudeHookSummary) => {
    setSession(item.nativeSessionId); setTool(item.toolUseId!); setAgent(item.agentId ?? ''); setScope(item.agentId === null ? 'root' : 'id');
    refresh(new URLSearchParams({ sessionId: item.nativeSessionId, toolUseId: item.toolUseId!, agentId: item.agentId ?? '' }).toString());
  };
  return <section aria-label={c.title}>
    <p className="hint">{c.scope}</p><p className="hint">{c.meaning}</p>
    <p role="status">{page ? page.status.enabled ? c.enabled : c.disabled : c.unknown}{page && <> · {c.observations}: {page.status.receivedCount} · {page.status.lastReceivedAt ?? '—'}</>}</p>
    <label><input type="checkbox" checked={ack} onChange={event => setAck(event.target.checked)} disabled={pending} />{c.ack}</label>
    <div className="capture-toolbar">
      <button type="button" className="btn" disabled={pending || !page || uncertain || !ack} onClick={() => configure(true)}>{page?.status.enabled ? c.rotate : c.enable}</button>
      <button type="button" className="btn" disabled={pending || !page?.status.enabled || uncertain} onClick={() => configure(false)}>{c.disable}</button>
      <button type="button" className="btn" disabled={pending} onClick={() => refresh(query)}>{c.refresh}</button>
      {pending && <button type="button" className="btn" onClick={cancel}>{c.cancel}</button>}
    </div>
    {settings && <><p className="hint">{c.merge}</p><textarea className="ui-input" aria-label={c.settings} readOnly value={settings} rows={12} spellCheck={false} /></>}
    {uncertain && <p role="status">{c.uncertain}</p>}{pending && <p role="status">{c.pending}</p>}
    {error && <p role="alert">{c.error} <code>{error}</code></p>}
    <form className="capture-toolbar" onSubmit={event => { event.preventDefault(); if (valid) refresh(filters()); }}>
      <label>{c.session}<input className="ui-input" value={session} onChange={event => setSession(event.target.value)} disabled={pending} /></label>
      <label>{c.tool}<input className="ui-input" value={tool} onChange={event => setTool(event.target.value)} disabled={pending} /></label>
      <label>{c.scopeLabel}<select className="ui-input" value={scope} onChange={event => setScope(event.target.value)} disabled={pending}><option value="all">{c.all}</option><option value="root">{c.root}</option><option value="id">{c.exact}</option></select></label>
      <label>{c.agent}<input className="ui-input" value={agent} onChange={event => setAgent(event.target.value)} disabled={pending || scope !== 'id'} /></label>
      <button className="btn" type="submit" disabled={!valid || pending}>{c.apply}</button>
    </form>
    {!valid && <p role="alert">{c.invalid}</p>}
    <label><input type="checkbox" checked={paused} onChange={event => setPaused(event.target.checked)} />{c.pause}</label>
    {stale && <p role="status">{c.stale}</p>}
    {page?.items.length === 0 && <p>{c.empty}</p>}
    {page?.items.map(item => <article key={item.id} className="capture-run">
      <p className="mono">#{item.id} · {item.eventName} · {item.nativeSessionId} · {item.agentId ?? c.root} · {item.toolName ?? '—'} · {item.toolUseId ?? '—'}</p>
      <p>{c.received}: {item.receivedAt} · {c.bytes}: {item.payloadBytes} · {c.duration}: {item.nativeDurationMs ?? '—'}</p>
      <div className="capture-toolbar"><span className="hint">{c[item.nativeSessionState]}</span>
        {item.nativeSessionKey && onOpenSession && <button type="button" className="btn" onClick={() => onOpenSession(item.nativeSessionKey!)}>{c.open}</button>}
        <button type="button" className="btn" disabled={pending} onClick={() => select(item.id)}>{c.raw} #{item.id}</button>
        {item.toolUseId && <button type="button" className="btn" disabled={pending} onClick={() => exactTool(item)}>{c.scopeTool} #{item.id}</button>}
      </div>
    </article>)}
    {page && <div className="capture-toolbar"><button type="button" className="btn" disabled={pending} onClick={() => refresh(query)}>{c.first}</button><button type="button" className="btn" disabled={pending || !page.hasMore} onClick={() => refresh(query, page.nextCursor)}>{c.next}</button></div>}
    <Drawer open={selected !== null} title={c.raw + ' #' + selected} onClose={close} width={760}>
      <button type="button" className="btn" onClick={close}>{c.close}</button>
      {pending && <p role="status">{c.pending}</p>}
      {error && <p role="alert">{c.error} <code>{error}</code><button type="button" className="btn" disabled={pending} onClick={() => selected !== null && select(selected)}>{c.retry}</button></p>}
      {detail && <><p className="mono">SHA256 {detail.sha256}</p><CaptureBodyText key={detail.id} value={detail.rawJson} locale={locale} /></>}
    </Drawer>
  </section>;
}
export function OfficialHooksPanel({ locale, latestId = 0, onOpenSession }: { locale: Locale; latestId?: number; onOpenSession?: (key: string) => void }) {
  const [open, setOpen] = useState(false);
  return <details className="capture-run" onToggle={event => setOpen(event.currentTarget.open)}><summary>{COPY[locale].title}</summary>{open && <Workspace locale={locale} latestId={latestId} onOpenSession={onOpenSession} />}</details>;
}
