import { useEffect, useRef, useState } from 'react';
import { fetchJson } from '../../api/client.js';
import type { FoldingProject, FoldingRuleDecision, FoldingProviderStatus } from '../../core/agent-folding-types.js';
import { redactFoldingReview } from '../../core/agent-folding-review.js';
import type { FoldingReviewPack, FoldingReviewPreview, FoldingReviewResult } from '../../core/agent-folding-review.js';
import { architectureApi, downloadArchitecture } from './architecture-client.js';
export function ArchitectureReview({ project, decision }: { project: FoldingProject; decision: FoldingRuleDecision }) {
  const [pack, setPack] = useState<FoldingReviewPack>(() => ({ boundaryId: decision.agentId, proposed: decision.action,
    evidence: decision.evidenceIds.slice(0, 20).map(id => { const evidence = project.evidence.find(e => e.id === id); return { id, text: redactFoldingReview(JSON.stringify({ sourceKind: evidence?.kind ?? 'unknown', complete: evidence?.complete ?? false, excerpt: evidence?.excerpt ?? null, rules: decision.reasons, sampleCount: decision.sampleCount, counterEvidence: decision.counterEvidence }).slice(0, 2000)) }; }) }));
  const [preview, setPreview] = useState<FoldingReviewPreview | null>(null), [result, setResult] = useState<FoldingReviewResult | null>(null), [status, setStatus] = useState<FoldingProviderStatus | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const owner = useRef<AbortController | null>(null), version = useRef(0);
  useEffect(() => { const controller = new AbortController(); void fetchJson<FoldingProviderStatus>('/agent-folding/status', { signal: controller.signal }).then(setStatus).catch(() => {}); return () => { controller.abort(); owner.current?.abort(); version.current++; }; }, []);
  const change = (next: FoldingReviewPack) => { version.current++; owner.current?.abort(); setBusy(false); setPack(next); setPreview(null); setResult(null); };
  const run = async (send: boolean) => {
    if (send && !preview) return;
    const current = ++version.current, controller = new AbortController(); owner.current?.abort(); owner.current = controller; setBusy(true); setError('');
    const timer = setTimeout(() => controller.abort(), 35000);
    try { if (send) { const value = await architectureApi.review(preview!, controller.signal); if (current === version.current) setResult(value); }
      else { const value = await architectureApi.preview(pack, controller.signal); if (current === version.current) { setPreview(value); setPack(value.pack); } }
    } catch { if (current === version.current) setError('复核未完成：请检查配置或重新预览。请求没有自动重试。'); }
    finally { clearTimeout(timer); if (current === version.current) setBusy(false); }
  };
  return <details className="architecture-review"><summary>AI 复核与迁移草稿（手动）</summary><p>模型：{status?.model ?? '未配置'}。只发送下方预览的证据；自动脱敏可能不完整，请删减敏感信息。复核会消耗模型用量，不执行工具或修改 Agent。</p>
    {pack.evidence.map(e => <label key={e.id}><code>{e.id}</code><textarea aria-label={`复核证据 ${e.id}`} maxLength={2000} rows={4} value={e.text} onChange={event => change({ ...pack, evidence: pack.evidence.map(value => value.id === e.id ? { ...value, text: redactFoldingReview(event.target.value) } : value) })} /><button className="btn" disabled={busy} onClick={() => change({ ...pack, evidence: pack.evidence.filter(value => value.id !== e.id) })}>移除此证据</button></label>)}
    {!pack.evidence.length && <p>没有可引用证据，不能请求复核。</p>}
    <div className="architecture-toolbar"><button className="btn" disabled={busy || !pack.evidence.length} onClick={() => void run(false)}>预览最终证据（不调用模型）</button><button className="btn" disabled={busy || !preview || !status?.anthropicConfigured || !status.modelConfigured} onClick={() => void run(true)}>发送所示证据并生成草稿</button>{busy && <button className="btn" onClick={() => { version.current++; owner.current?.abort(); setBusy(false); setError('已取消；若模型已接收请求，可能仍计费用量。'); }}>取消</button>}</div>
    {preview && <details open><summary>最终发送内容</summary><pre>{JSON.stringify(preview.pack, null, 2)}</pre></details>}{error && <p role="alert">{error}</p>}
    {result && <section><p>本次复核用量（独立于任务）：{result.model} · 输入 {result.usage.inputTokens} / 输出 {result.usage.outputTokens} Token</p>{result.rejection && <p role="alert">{result.rejection}</p>}{result.review && <><p>模型建议，尚未经人工验证；引用只核对 ID，不证明结论正确。</p>{result.review.claims.map((claim, i) => <p key={i}>{claim.text} · {claim.evidenceIds.join(', ')}</p>)}{(['skill', 'tool', 'returnStructure'] as const).map(key => <details key={key}><summary>{key} 草稿</summary><pre>{result.review![key].text}</pre><p>{result.review![key].evidenceIds.join(', ')}</p><button className="btn" onClick={() => downloadArchitecture(`review-${key}.txt`, result.review![key].text)}>下载草稿</button></details>)}</>}</section>}
  </details>;
}
