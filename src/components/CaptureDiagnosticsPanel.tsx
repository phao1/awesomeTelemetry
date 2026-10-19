import { useId, useMemo, useState } from 'react';
import { deriveCaptureDiagnostics } from '../core/capture-diagnostics.js';
import type { CaptureDiagnosticFinding } from '../core/capture-diagnostics.js';
import type { CaptureComparisonResponse } from '../core/trace-types.js';
import type { Locale } from '../i18n.js';

interface Props {
  data: CaptureComparisonResponse;
  locale: Locale;
  onOpenRequest: (id: number) => void;
}

const COPY = {
  en: {
    title: 'Selected-pair evidence diagnostics', threshold: 'Slow threshold (ms)', effective: 'Effective threshold', none: 'none', validRange: 'Whole-number range: 1–3600000 ms; equality qualifies as slow.',
    invalid: 'Enter a safe whole number from 1–3600000 ms. Findings are hidden; no fallback threshold is applied.',
    fact: 'Observed facts', factScope: 'Only retained metadata in this selected comparison is used: proxy timing offsets and encoded original request SHA256/byte references. No original file is reread or verified here.',
    derived: 'Derived finding', findings: 'Threshold-derived observations and encoded-request candidates', sources: 'Expand exact source evidence', baseOpen: 'Open base capture', targetOpen: 'Open target capture',
    scope: 'Slow is an observed proxy offset at or above the visible threshold, not pure model inference. Missing or invalid timing remains unknown, not zero or evidence of a fast call.',
    repeatScope: 'Matching encoded-body metadata does not prove headers, credentials, decoded semantics, retries, duplicate charges or correctness are equal. These are distinct retained records, not a new billing identity.',
    same: 'Candidate: matching complete encoded request SHA256 and bytes at the same endpoint/protocol.',
    different: 'Encoded request evidence does not match. Retry status remains unknown; different bodies do not prove there was no retry.',
    unavailable: 'Unknown: matching encoded request evidence is unavailable when refs are missing, deleted or incomplete, or endpoint/protocol evidence is insufficient.',
    empty: 'No supported finding at this threshold. This does not prove the call was fast, unique, successful or correct.',
    suggestion: 'Suggestion', review: 'Recheck the existing Context Diff for context growth, and Protocol Analysis for cache usage and tool-error source links. Open either original capture to inspect its own evidence; this panel does not fetch or optimize anything automatically.',
    slow_network: 'Slow observed network end', slow_first_content: 'Slow observed first meaningful content', repeated_encoded_request: 'Repeated encoded request candidate',
    networkAdvice: 'Inspect network/transport status and native timing before attributing the delay to a model or tool.',
    contentAdvice: 'Check the recorded SSE/JSON basis and content kind; first-content delay is not a sampled first token.',
    repeatAdvice: 'Inspect Context Diff and the original records, including differing headers, before deciding whether this is a repeated task or retry.',
  },
  zh: {
    title: '选定组合的证据诊断', threshold: '慢调用阈值（ms）', effective: '当前生效阈值', none: '无', validRange: '有效范围：1–3600000 ms 的整数；达到阈值即视为较慢。',
    invalid: '请输入 1–3600000 ms 的安全整数。诊断提示已隐藏，不会静默应用默认阈值。',
    fact: '观测事实', factScope: '仅使用当前选定组合中保留的元数据：代理时序偏移、编码请求原文的 SHA256 与字节数引用；此处不重新读取或验证原文文件。',
    derived: '推导提示', findings: '阈值推导观测与编码请求重复候选', sources: '展开精确来源证据', baseOpen: '打开基线抓包', targetOpen: '打开目标抓包',
    scope: '慢仅表示代理观测偏移达到当前可见阈值，不是模型纯推理耗时。缺失或无效时序仍未知，不补零，也不证明调用很快。',
    repeatScope: '编码正文元数据相同，不证明 headers、凭据、解码后语义、重试、重复费用或正确率相同；两条记录保持独立，不产生新的计费身份。',
    same: '候选：同一端点及协议下，完整编码请求原文的 SHA256 与字节数相同。',
    different: '编码请求证据不匹配。是否重试仍未知；正文不同不证明没有重试。',
    unavailable: '未知：引用缺失、已删除、不完整或端点及协议证据不足，不能建立编码请求重复候选。',
    empty: '当前阈值下没有可支持的提示，不证明调用很快、唯一、成功或正确。',
    suggestion: '建议', review: '请通过已有上下文差异检查上下文增长，并在协议分析中复核缓存 usage 与工具错误来源链接。可打开任一原抓包检查各自证据；本面板不会自动读取或优化。',
    slow_network: '网络结束观测偏移较慢', slow_first_content: '首有效内容观测偏移较慢', repeated_encoded_request: '编码请求重复候选',
    networkAdvice: '先检查网络终态与原生时序，不直接将延迟归因于模型或工具。',
    contentAdvice: '核对记录的 SSE/JSON 口径及内容类别；首内容延迟不是真实首 token 采样。',
    repeatAdvice: '先检查上下文差异及两份原始记录（包括可能不同的 headers），再判断是否属于重复任务或重试。',
  },
};

/** No IO or new parsing: all findings refer to the existing explicitly loaded pair. */
export function CaptureDiagnosticsPanel({ data, locale, onOpenRequest }: Props): React.JSX.Element {
  const copy = COPY[locale];
  const [input, setInput] = useState('10000');
  const errorId = useId();
  const parsed = /^[1-9]\d*$/.test(input) ? Number(input) : NaN;
  const threshold = Number.isSafeInteger(parsed) && parsed <= 3600000 ? parsed : null;
  const model = useMemo(() => threshold === null ? null : deriveCaptureDiagnostics(data, threshold), [data, threshold]);
  const advice = (finding: CaptureDiagnosticFinding): string => finding.code === 'slow_network' ? copy.networkAdvice : finding.code === 'slow_first_content' ? copy.contentAdvice : copy.repeatAdvice;
  return <section aria-label={copy.title}>
    <h3>{copy.title}</h3>
    <label>{copy.threshold} <input type="text" inputMode="numeric" value={input} aria-invalid={threshold === null} aria-describedby={threshold === null ? errorId : undefined} onChange={event => setInput(event.target.value)} /></label>
    <p className="hint">{copy.validRange}</p>
    <p role="status" data-effective-threshold>{copy.effective}: {model === null ? copy.none : `${model.thresholdMs} ms`}</p>
    {threshold === null && <p id={errorId} role="alert">{copy.invalid}</p>}
    <h4>{copy.fact}</h4><p className="hint">{copy.factScope}</p><p className="hint">{copy.scope}</p><p className="hint">{copy.repeatScope}</p>
    {model !== null && <>
      <p role="status" data-repeat-state>{model.repeat === 'same_encoded_request' ? copy.same : model.repeat === 'different_encoded_request' ? copy.different : copy.unavailable}</p>
      <h4>{copy.findings}</h4>
      {model.findings.length === 0 ? <p role="status">{copy.empty}</p> : <ol>{model.findings.slice(0, 5).map((finding, index) => <li key={`${finding.code}:${index}`} data-diagnostic-finding={finding.code}>
        <p>{copy.derived}: {copy[finding.code]}</p>
        <details><summary>{copy.sources}</summary><ul>{finding.evidence.map((evidence, evidenceIndex) => <li key={`${evidence.side}:${evidence.path}:${evidenceIndex}`} style={{ overflowWrap: 'anywhere' }}>
          <code>{evidence.path}</code> = <code>{evidence.value}</code>
          <p className="mono">{data[evidence.side].request.requestId}</p>
          <button className="btn" type="button" onClick={() => onOpenRequest(evidence.requestId)}>{evidence.side === 'base' ? copy.baseOpen : copy.targetOpen} #{evidence.requestId}</button>
        </li>)}</ul></details>
        <p className="hint">{copy.suggestion}: {advice(finding)}</p>
      </li>)}</ol>}
    </>}
    <p className="hint">{copy.suggestion}: {copy.review}</p>
  </section>;
}
