import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client.js';
import type { MonitorAgent, MonitorCapabilityReport, MonitorTransportCapability, ProviderKey } from '../core/trace-types.js';
import type { Locale } from '../i18n.js';

const copy = {
  en: {
    title: 'Monitoring capability matrix', refresh: 'Refresh capabilities', retry: 'Retry', loading: 'Loading implementation capabilities…',
    error: 'Capability information could not be read. Retry only this local metadata read; no Agent was launched.',
    timeout: 'Local metadata read exceeded 5 seconds. Retry when the local server is available.',
    empty: 'No capability evidence returned. Do not infer support from this empty result.',
    meaning: 'Implementation and controlled-test evidence, not installed Agent/version certification. Nine scanners do not mean nine network integrations. Native tool execution and child-Agent coverage depend on retained source evidence.',
    scope: 'New terminal child and descendants inheriting its proxy environment only. Existing processes/daemons and remote Agents are not adopted; system proxy and OS trust are unchanged.',
    listener: 'Shared listener; not a process/project traffic filter. Other local clients can use the same port. Traffic arrival does not prove Agent identity, HTTPS trust or a complete chain.',
    action: 'Configure opens a new blank recipe form only. Saving, starting the listener, terminal launch and checking connection stay explicit; it never changes a saved recipe here.',
    host: 'Current server platform', generated: 'Manifest generated', platform: 'Controlled tests on', noPlatform: 'No tested platform recorded',
    evidence: 'A controlled test on darwin does not certify the current platform or any installed Agent. No automatic transport downgrade or TLS bypass.',
    agents: 'Agent sources and process recipes', agent: 'Agent', scanner: 'Native scanner', version: 'Installed version', verification: 'Actual Agent coverage', recipe: 'Connection recipe',
    implemented: 'Implemented scanner', unknown: 'Unknown; not an installation check', unverified: 'Actual Agent unverified', noRecipe: 'No process recipe; scanner retained', configure: 'Configure',
    transports: 'Transport implementation evidence', transport: 'Transport / semantics', level: 'Evidence level', details: 'Boundary',
    levels: { controlled_test: 'Controlled local test', unsupported: 'Unsupported', unverified: 'Unverified', dev_only: 'Dev-only', experimental: 'Experimental' },
  },
  zh: {
    title: '监控能力矩阵', refresh: '刷新能力矩阵', retry: '重试', loading: '正在读取实现能力…',
    error: '能力信息读取失败。只重试本地元数据读取，不会启动 Agent。', timeout: '本地元数据读取超过 5 秒，请确认本地服务可用后重试。',
    empty: '没有返回能力依据，不能据此推断支持情况。',
    meaning: '这是实现范围和受控测试依据，不是已安装 Agent／版本认证。9 种扫描器不等于 9 种网络接入；原生工具执行及子 Agent 覆盖取决于实际保留的来源依据。',
    scope: '仅显式新启动的终端子进程及继承代理环境的后代。不接管已有进程／Daemon 或远端 Agent，不修改系统代理或系统信任。',
    listener: '共享监听器，不按进程／项目筛选流量；其他本地客户端也可使用同一端口。有流量不证明 Agent 身份、HTTPS 信任或完整执行链路。',
    action: '配置操作只进入新的空白配方表单；保存、开启监听、终端启动和接入诊断仍需显式操作，这里不会修改已保存配方。',
    host: '当前服务端平台', generated: '清单生成时间', platform: '受控测试平台', noPlatform: '没有已测试平台记录',
    evidence: 'darwin 的受控测试不能认证当前平台或已安装 Agent；不会自动降级传输或绕过 TLS 校验。',
    agents: 'Agent 来源与进程配方', agent: 'Agent', scanner: '原生扫描', version: '已安装版本', verification: '真实 Agent 覆盖', recipe: '接入配方',
    implemented: '扫描器已实现', unknown: '未知，不代表未安装', unverified: '真实 Agent 未验证', noRecipe: '暂无进程配方，保留扫描', configure: '配置',
    transports: '传输实现依据', transport: '传输／语义', level: '依据级别', details: '边界',
    levels: { controlled_test: '受控本地测试', unsupported: '不支持', unverified: '未验证', dev_only: '仅开发模式', experimental: '实验性' },
  },
} as const;
const names: Record<ProviderKey, string> = { claude: 'Claude Code', codex: 'Codex', opencode: 'OpenCode', codearts: 'CodeArts', codeagent: 'CodeAgent', codeagent2: 'CodeAgent2', trae: 'Trae', qoder: 'Qoder', workbuddy: 'WorkBuddy' };
const transportCopy: Record<Locale, Record<MonitorTransportCapability, { title: string; detail: string }>> = {
  en: {
    http1_json_sse: { title: 'HTTP/1.1 · JSON / SSE', detail: 'Controlled origin → MITM → originals / worker / metadata. Chat, Responses and Messages; not a real Agent session.' },
    https_connect: { title: 'HTTPS CONNECT', detail: 'Controlled local HTTPS with the actual proxy CA trusted. Public CA availability is not target runtime or OS trust.' },
    compressed_semantics: { title: 'gzip / br / deflate semantics', detail: 'Bounded worker / on-demand semantic decoding after capture; originals and forwarding keep encoded bytes. Not live compressed preview support.' },
    live_identity_sse: { title: 'Live SSE preview · identity only', detail: 'Bounded 100ms merged preview, not token counting. Compressed streams are not shown as live-decoded support; final saved evidence remains separate.' },
    agent_websocket: { title: 'Agent WebSocket / WSS', detail: 'Controlled connection capture: bidirectional application-message archives and bounded transcripts. Not wire frames, per-response accounting or actual Agent certification. Close/Stop saves the connection.' },
    http2_grpc: { title: 'HTTP/2 / gRPC', detail: 'No accepted implementation/platform evidence. Do not force-disable a client transport to claim compatibility.' },
    mtls_pinning: { title: 'mTLS / certificate pinning', detail: 'Not verified; child CA settings do not bypass pinning or establish mTLS support.' },
    electron_cdp: { title: 'Standard Electron CDP', detail: 'Dev-only routes, not production capture certification. Chromium Network does not decrypt Trae TTNet.' },
    trae_cn_frida: { title: 'Windows Trae CN / Frida', detail: 'Experimental target-specific memory capture; no accepted Windows target/version evidence. Not equivalent to Trae CLI proxying.' },
  },
  zh: {
    http1_json_sse: { title: 'HTTP/1.1 · JSON / SSE', detail: '受控上游 → MITM → 原文／worker／元数据。支持 Chat、Responses、Messages 协议依据，不等于真实 Agent 会话验收。' },
    https_connect: { title: 'HTTPS CONNECT', detail: '受控本地 HTTPS 信任实际代理 CA 的测试。公共 CA 可用不证明目标运行时或系统已经信任。' },
    compressed_semantics: { title: 'gzip / br / deflate 语义', detail: '采集后由有界 worker／按需分析解码；原文与转发保留编码字节，不表示支持压缩流实时预览。' },
    live_identity_sse: { title: '实时 SSE 预览 · 仅 identity', detail: '100ms 合并的有界预览，不是 token 计数；压缩流不能标成已支持实时解码，最终落盘依据保持独立。' },
    agent_websocket: { title: 'Agent WebSocket / WSS', detail: '受控连接采集：双向应用消息归档和有界文本预览。不是网络帧、逐响应计费或真实 Agent 认证；关闭连接或停止监控后保存。' },
    http2_grpc: { title: 'HTTP/2 / gRPC', detail: '尚无已验收的实现／平台依据，不能强制关闭客户端传输来宣称兼容。' },
    mtls_pinning: { title: 'mTLS／证书固定', detail: '尚未验证；子进程 CA 设置不能绕过证书固定，也不证明支持 mTLS。' },
    electron_cdp: { title: '标准 Electron CDP', detail: '仅开发模式路由，不是生产采集认证；Chromium Network 不能解密 Trae TTNet。' },
    trae_cn_frida: { title: 'Windows Trae CN / Frida', detail: '实验性目标版本内存采集，尚无 Windows 真机／版本验收；与 Trae CLI 反向代理不同。' },
  },
};
interface Props { locale: Locale; onConfigure: (agent: MonitorAgent) => void }

/** Mount only from an explicit capability entry; no process/config/network probes. */
export function MonitorCapabilitiesPanel({ locale, onConfigure }: Props): React.JSX.Element {
  const labels = copy[locale];
  const [report, setReport] = useState<MonitorCapabilityReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ code: string; message: string; timeout: boolean } | null>(null);
  const generation = useRef(0), controller = useRef<AbortController | null>(null), timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = useCallback(() => {
    generation.current += 1; controller.current?.abort(); controller.current = null;
    if (timer.current !== null) clearTimeout(timer.current); timer.current = null;
  }, []);
  const load = useCallback(async (): Promise<void> => {
    cancel(); const token = generation.current, owned = new AbortController(); controller.current = owned;
    setReport(null); setError(null); setBusy(true);
    timer.current = setTimeout(() => {
      if (generation.current !== token) return;
      cancel(); setBusy(false); setError({ code: 'MONITOR_CAPABILITIES_TIMEOUT', message: '', timeout: true });
    }, 5000);
    try {
      const value = await api.monitorCapabilities(owned.signal);
      if (generation.current !== token || owned.signal.aborted) return;
      setReport(value);
    } catch (cause: unknown) {
      if (generation.current === token && !owned.signal.aborted) setError({ code: cause instanceof ApiError ? cause.code : 'MONITOR_CAPABILITIES_READ_FAILED', message: cause instanceof Error ? cause.message : String(cause), timeout: false });
    } finally { if (generation.current === token) { cancel(); setBusy(false); } }
  }, [cancel]);
  useEffect(() => { void load(); return cancel; }, [load, cancel]);
  return <section aria-label={labels.title}>
    <h3>{labels.title}</h3><p className="hint">{labels.meaning}</p><p className="hint">{labels.scope}</p>
    <p className="hint">{labels.listener}</p><p className="hint">{labels.action}</p>
    <button className="btn" type="button" disabled={busy} onClick={() => void load()}>{labels.refresh}</button>
    {busy && <p role="status" aria-live="polite">{labels.loading}</p>}
    {error !== null && <div role="alert"><code>{error.code}</code><p>{error.timeout ? labels.timeout : labels.error}</p>
      {error.message !== '' && <p>{error.message}</p>}
      <button className="btn" type="button" onClick={() => void load()}>{labels.retry}</button></div>}
    {report !== null && <>
      <p>{labels.host}: <code>{report.platform}</code> · {labels.generated}: <time dateTime={report.generatedAt}>{report.generatedAt}</time></p>
      <p className="hint">{labels.evidence}</p>
      {report.agents.length === 0 && report.transports.length === 0 ? <p role="status">{labels.empty}</p> : <>
        <h4>{labels.agents}</h4><div style={{ overflowX: 'auto' }}><table className="data-table">
          <thead><tr><th scope="col">{labels.agent}</th><th scope="col">{labels.scanner}</th><th scope="col">{labels.version}</th><th scope="col">{labels.verification}</th><th scope="col">{labels.recipe}</th></tr></thead>
          <tbody>{report.agents.map(agent => {
            const recipe = agent.processRecipe;
            return <tr key={agent.provider} data-capability-agent={agent.provider}>
            <th scope="row">{names[agent.provider]}</th><td>{labels.implemented}</td><td>{labels.unknown}</td><td>{labels.unverified}</td>
            <td>{recipe === null ? labels.noRecipe : <button className="btn" type="button" data-configure-agent={recipe} onClick={() => onConfigure(recipe)}>{labels.configure} {recipe}</button>}</td>
          </tr>;
          })}</tbody></table></div>
        <h4>{labels.transports}</h4><div style={{ overflowX: 'auto' }}><table className="data-table">
          <thead><tr><th scope="col">{labels.transport}</th><th scope="col">{labels.level}</th><th scope="col">{labels.platform}</th><th scope="col">{labels.details}</th></tr></thead>
          <tbody>{report.transports.map(transport => <tr key={transport.id} data-capability-transport={transport.id}>
            <th scope="row">{transportCopy[locale][transport.id].title}</th><td>{labels.levels[transport.level]}</td><td>{transport.testedPlatforms.length === 0 ? labels.noPlatform : transport.testedPlatforms.join(', ')}</td><td>{transport.id === 'agent_websocket' && transport.level === 'unsupported'
              ? locale === 'en' ? 'No model WebSocket/WSS capture in this server manifest. Upgrade before relying on connection archives.' : '此服务清单不支持模型 WebSocket/WSS 采集；请先更新服务，再使用连接归档。'
              : transportCopy[locale][transport.id].detail}</td>
          </tr>)}</tbody></table></div>
      </>}
    </>}
  </section>;
}
