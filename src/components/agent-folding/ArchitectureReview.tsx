import { Disclosure } from '../ui/PageControls.js';
import { Button } from '../ui/Button.js';
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
  return <Disclosure className="architecture-review" title={<>AI 复核与迁移草稿（手动）</>}><p>模型：{status?.model ?? '未配置'}。只发送下方预览的证据；自动脱敏可能不完整，请删减敏感信息。复核会消耗模型用量，不执行工具或修改 Agent。</p>
    {pack.evidence.map(e => <label key={e.id}><code>{e.id}</code><textarea aria-label={`复核证据 ${e.id}`} maxLength={2000} rows={4} value={e.text} onChange={event => change({ ...pack, evidence: pack.evidence.map(value => value.id === e.id ? { ...value, text: redactFoldingReview(event.target.value) } : value) })} /><Button  disabled={busy} onClick={() => change({ ...pack, evidence: pack.evidence.filter(value => value.id !== e.id) })}>移除此证据</Button></label>)}
    {!pack.evidence.length && <p>没有可引用证据，不能请求复核。</p>}
    <div className="architecture-toolbar"><Button  disabled={busy || !pack.evidence.length} onClick={() => void run(false)}>预览最终证据（不调用模型）</Button><Button  disabled={busy || !preview || !status?.anthropicConfigured || !status.modelConfigured} onClick={() => void run(true)}>发送所示证据并生成草稿</Button>{busy && <Button  onClick={() => { version.current++; owner.current?.abort(); setBusy(false); setError('已取消；若模型已接收请求，可能仍产生 Token 用量。'); }}>取消</Button>}</div>
    {preview && <Disclosure open title={<>最终发送内容</>}><pre>{JSON.stringify(preview.pack, null, 2)}</pre></Disclosure>}{error && <p role="alert">{error}</p>}
    {result && <section><p>本次复核用量（独立于任务）：{result.model} · 输入 {result.usage.inputTokens} / 输出 {result.usage.outputTokens} Token</p>{result.rejection && <p role="alert">{result.rejection}</p>}{result.review && <><p>模型建议，尚未经人工验证；引用只核对 ID，不证明结论正确。</p>{result.review.claims.map((claim, i) => <p key={i}>{claim.text} · {claim.evidenceIds.join(', ')}</p>)}{(['skill', 'tool', 'returnStructure'] as const).map(key => <Disclosure key={key} title={<>{key} 草稿</>}><pre>{result.review![key].text}</pre><p>{result.review![key].evidenceIds.join(', ')}</p><Button  onClick={() => downloadArchitecture(`review-${key}.txt`, result.review![key].text)}>下载草稿</Button></Disclosure>)}</>}</section>}
  </Disclosure>;
}
