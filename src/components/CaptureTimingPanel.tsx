import type { CaptureNetworkTiming } from '../core/trace-types.js';
import type { Locale } from '../i18n.js';

export function CaptureTimingPanel({ timing, locale }: { timing?: CaptureNetworkTiming; locale: Locale }): React.JSX.Element {
  const zh = locale === 'zh';
  const statuses: Record<CaptureNetworkTiming['contentTimingStatus'], string> = zh ? {
    observed: '已观测', no_content: '未观测到有效内容', not_collected: '未采集此时序', unsupported_encoding: '当前编码不支持首内容时序',
    preview_limit: '到达时序预览上限', decode_error: '时序解码不完整',
  } : {
    observed: 'Observed', no_content: 'No meaningful content observed', not_collected: 'Timing not collected', unsupported_encoding: 'Content timing unavailable for this encoding',
    preview_limit: 'Timing preview limit reached', decode_error: 'Timing decoding incomplete',
  };
  const milliseconds = (value: number | null | undefined): string => value === undefined || value === null ? '—' : `${value} ms`;
  return <section aria-label={zh ? '代理观测时序' : 'Proxy-observed timing'}>
    <h3>{zh ? '代理观测时序' : 'Proxy-observed timing'}</h3>
    <p className="hint">{zh ? '同一本地单调时钟的请求起点偏移，不包含落盘或解析排队；响应头、首字节、首内容、结束不是同一个指标，也不是模型纯推理时间。' : 'Offsets from one local monotonic request clock, excluding persistence/processing queues. Headers, first byte, first content and end are distinct, not pure model inference time.'}</p>
    {timing === undefined ? <p role="status">{zh ? '此记录没有采集时序证据；旧记录未知，不能用总耗时或零补齐。' : 'No capture timing evidence for this record. Legacy timing is unknown, not the total duration or zero.'}</p> : <>
      <dl className="meta">
        <div><dt>{zh ? '响应头' : 'Response headers'}</dt><dd>{milliseconds(timing.responseHeadersMs)}</dd></div>
        <div><dt>{zh ? '首响应字节' : 'First response byte'}</dt><dd>{milliseconds(timing.firstBodyByteMs)}</dd></div>
        <div><dt>{zh ? '首有效内容' : 'First meaningful content'}</dt><dd>{milliseconds(timing.firstContentMs)}</dd></div>
        <div><dt>{zh ? '网络结束' : 'Network end'}</dt><dd>{milliseconds(timing.completedMs)}</dd></div>
      </dl>
      <p role="status">{statuses[timing.contentTimingStatus]} · {timing.firstContentKind ?? '—'}</p>
      {timing.firstContentBasis === 'sse_event_dispatch' && <p className="hint">{zh ? '口径：首个有效 SSE 内容帧派发时的到达时间；心跳、空 delta、usage 和结束标记不算内容，不是真实 token 采样。' : 'Basis: arrival completing the first meaningful SSE event dispatch. Heartbeats, empty deltas, usage and terminal markers are excluded; this is not token sampling.'}</p>}
      {timing.firstContentBasis === 'json_document_complete' && <p className="hint">{zh ? '口径：完整 JSON 文档可解析时刻，不是流式首 token；不能和 SSE 首内容直接算速度倍数。' : 'Basis: complete JSON document availability, not streaming first token. Do not form a speed ratio against SSE first content.'}</p>}
      <h4>{zh ? '供应商 Server-Timing 原值' : 'Observed vendor Server-Timing'}</h4>
      <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{timing.serverTiming ?? '—'}</pre>
      {timing.serverTimingTruncated && <p role="status">{zh ? '此处为有界头部投影，完整原值请查看 Headers。' : 'Bounded header projection; inspect Headers for the full observed value.'}</p>}
      <p className="hint">{zh ? '不猜测供应商单位或时钟含义。原生 Agent span / 相邻日志推导时长请查看原始会话，不能与代理时钟混算。' : 'Vendor units/clock semantics are not assumed. Inspect native sessions for Agent spans or log-derived durations; do not mix clock domains.'}</p>
    </>}
  </section>;
}
