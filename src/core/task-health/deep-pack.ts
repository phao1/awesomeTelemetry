import { redactHealthText } from './render.js';
import type { DeepHealthFragment, DeepHealthPack, DeepHealthReport, HealthFinding, HealthInput, HealthMetric, HealthReport } from './types.js';

/** Compact preview projection authorized by the P4 budget correction.
 * Keep finding identity so necessity.findingId remains verifiable. */
export interface BudgetDeepHealthPack extends Omit<DeepHealthPack, 'metrics' | 'findings'> {
  metrics: Pick<HealthMetric, 'key' | 'value' | 'unit' | 'timing' | 'layer' | 'stat' | 'facets' | 'samples'>[];
  findings: Pick<HealthFinding, 'id' | 'rule' | 'dimension' | 'facts' | 'evidenceIds'>[];
}
export const DEEP_PACK_BYTES = 48 * 1024;
export const DEEP_OUTPUT_TOKENS = 4096;
export const canonicalHealthJson = (value: unknown): string => JSON.stringify(value, (_key, v: unknown) => v !== null && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
export interface DeepSelection { recordId: string; role: DeepHealthFragment['role'] }
/** Select by exact opaque IDs across the retained scope, never an opened page. */
export function selectDeepRecords(report: HealthReport, input: HealthInput): DeepSelection[] {
  const selected: DeepSelection[] = [], records = input.records;
  const add = (recordId: string | undefined, role: DeepSelection['role']) => { if (recordId && !selected.some(x => x.recordId === recordId && x.role === role)) selected.push({ recordId, role }); };
  add(records.find(r => r.event?.kind === 'user_prompt')?.recordId, 'goal');
  const abnormal = new Set(report.findings.flatMap(f => f.evidenceIds.slice(0, 5)).flatMap(id => report.evidence.find(e => e.id === id)?.recordIds.slice(0, 1) ?? []));
  for (const recordId of abnormal) add(recordId, 'finding');
  const used = new Set<string>();
  for (const recordId of abnormal) {
    const index = records.findIndex(r => r.recordId === recordId);
    if (index < 0) continue;
    // Adjacent means the nearest retained record in the same member.
    for (let distance = 1; distance < records.length; distance++) {
      const next = [records[index - distance], records[index + distance]].find(r => r && r.memberId === records[index]!.memberId && !abnormal.has(r.recordId) && !used.has(r.recordId) && r.event?.status === 'success');
      if (next) { used.add(next.recordId); add(next.recordId, 'normal'); break; }
    }
  }
  add(records.findLast(r => r.event?.actor === 'assistant' && (r.event.kind === 'llm' || r.event.kind === 'message'))?.recordId, 'final');
  const verification = report.spans.findLast(s => s.kind === 'tool' && (s.toolClass === 'test' || s.toolClass === 'lint/typecheck'));
  add(verification?.recordId ? records.find(r => r.recordId === verification.recordId)?.relatedRecordIds.at(-1) ?? verification.recordId : undefined, 'verification');
  return selected;
}
export function buildDeepHealthPack(report: HealthReport, fragments: DeepHealthFragment[], input?: HealthInput): BudgetDeepHealthPack {
  const limitations = [...report.limitations];
  const records = new Map(input?.records.map(r => [r.recordId, r]) ?? []);
  const bounded = fragments.map((f, i) => { const max = f.role === 'goal' ? 2000 : 1500, tail = f.role === 'final' || f.role === 'verification'; return { ...f, id: `fragment:${i + 1}`, text: tail ? f.text.slice(-max) : f.text.slice(0, max), truncated: f.truncated || f.text.length > max }; });
  for (const role of ['goal', 'final', 'verification'] as const) if (!bounded.some(f => f.role === role)) limitations.push(`${role}_unavailable`);
  if (bounded.filter(f => f.role === 'normal').length < bounded.filter(f => f.role === 'finding').length) limitations.push('normal_samples_shortage');
  if (report.rounds.length > 150) limitations.push('rounds_limit');
  const referenced = new Set(report.findings.flatMap(f => f.evidenceIds.slice(0, 5)));
  const nullKeys = [...new Set(report.metrics.filter(m => m.value === null).map(m => m.key))];
  limitations.push('facts_compacted', 'evidence_projection_compacted');
  if (nullKeys.length) limitations.push('null_metrics: ' + nullKeys.join(', '));
  const pack: BudgetDeepHealthPack = { version: 1, reportId: report.id, revision: report.revision, scope: structuredClone(report.scope), metrics: report.metrics.filter(m => m.value !== null).map(({ key, value, unit, timing, layer, stat, facets, samples }) => ({ key, value, unit, timing, layer, stat, facets: structuredClone(facets), samples })), findings: report.findings.map(({ id, rule, dimension, facts, evidenceIds }) => ({ id, rule, dimension, facts: structuredClone(facts), evidenceIds: evidenceIds.slice(0, 5) })), evidence: report.evidence.filter(e => referenced.has(e.id)).map(e => ({ ...structuredClone(e), title: e.title.slice(0, 200), recordIds: e.recordIds.slice(0, 1), captureIds: [], intervalMs: null, summary: null, truncated: true })),
    rounds: retainRounds(report.rounds, 150, findingRoundIds(report, input)).map(r => { const spans = report.spans.filter(s => s.roundId === r.id); return { id: r.id, index: r.index, memberId: r.memberId, startMs: r.readyMs, endMs: r.endMs, tools: spans.filter(s => s.kind === 'tool').map(s => ({ name: (s.recordId && records.get(s.recordId)?.event?.tool) || s.toolClass || 'other', title: s.title, status: s.status })), tokens: spans.find(s => s.kind === 'model' && s.tokens)?.tokens ?? null, reasoning: r.reasoning }; }), fragments: bounded, limitations };
  return pack;
}
/** Pin exact round identities from spans/native metadata; never parse record IDs. */
export function findingRoundIds(report: HealthReport, input?: HealthInput): string[] {
  const evidence = new Set(report.findings.flatMap(f => f.evidenceIds.slice(0, 5)));
  const records = new Set(report.evidence.filter(e => evidence.has(e.id)).flatMap(e => e.recordIds));
  return [...new Set([...report.spans.flatMap(s => s.recordId && records.has(s.recordId) && s.roundId ? [s.roundId] : []), ...(input?.records.flatMap(r => records.has(r.recordId) && r.event?.turnKey ? [r.event.turnKey] : []) ?? [])])];
}
function retainRounds<T extends { id: string }>(rounds: T[], limit: number, required: readonly string[]): T[] {
  if (rounds.length <= limit) return rounds;
  const pinned = new Set(required), chosen = new Set([0, rounds.length - 1]);
  rounds.forEach((r, i) => { if (pinned.has(r.id)) chosen.add(i); });
  // Deterministic even sampling, preserving source order, endpoints and pins.
  for (let i = 1; i < limit && chosen.size < limit; i++) chosen.add(Math.round(i * (rounds.length - 1) / (limit - 1)));
  for (let i = 0; i < rounds.length && chosen.size < limit; i++) chosen.add(i);
  return rounds.filter((_, i) => chosen.has(i));
}
export function fitDeepHealthPack(source: BudgetDeepHealthPack, requiredRounds: readonly string[] = []): BudgetDeepHealthPack {
  const pack = structuredClone(source);
  const fits = () => new TextEncoder().encode(canonicalHealthJson(pack)).length <= DEEP_PACK_BYTES;
  const note = (value: string) => { if (!pack.limitations.includes(value)) pack.limitations.push(value); };
  if (fits()) return pack;
  for (const limit of [60, 30]) {
    pack.rounds = retainRounds(pack.rounds, limit, requiredRounds); note(`budget_rounds_${limit}`);
    if (fits()) return pack;
  }
  for (const limit of [pack.findings.length, 1]) {
    let count = 0;
    pack.fragments = pack.fragments.filter(f => f.role !== 'normal' || count++ < limit); note(`budget_normal_samples_${limit}`);
    if (fits()) return pack;
  }
  for (const limit of [800, 400]) {
    pack.fragments = pack.fragments.map(f => f.role === 'goal' ? f : { ...f, text: f.role === 'final' || f.role === 'verification' ? f.text.slice(-limit) : f.text.slice(0, limit), truncated: f.truncated || f.text.length > limit });
    note(`budget_excerpts_${limit}`);
    if (fits()) return pack;
  }
  // Last resort: target + all compact facts + one bounded excerpt per finding.
  const chosen = new Set<string>();
  for (const finding of pack.findings) {
    const recordIds = new Set(pack.evidence.filter(e => finding.evidenceIds.includes(e.id)).flatMap(e => e.recordIds));
    const fragment = pack.fragments.find(f => f.role === 'finding' && recordIds.has(f.recordId));
    if (fragment) chosen.add(fragment.id);
  }
  pack.fragments = pack.fragments.filter(f => f.role === 'goal' || chosen.has(f.id));
  pack.rounds = [];
  note('budget_minimum_pack');
  note('budget_normal_final_verification_and_rounds_omitted');
  if (!fits()) throw new Error('HEALTH_SIZE_LIMIT');
  return pack;
}
type Sections = Pick<DeepHealthReport, 'valueMoments' | 'necessity' | 'causes' | 'experiments' | 'rejected' | 'status'>;
const fields = { valueMoments: ['kind', 'recordId', 'reason', 'counterEvidence', 'evidenceIds'], necessity: ['findingId', 'verdict', 'alternative', 'evidenceIds'], causes: ['hypothesis', 'support', 'against', 'evidenceIds'], experiments: ['variable', 'primaryMetric', 'qualityGate', 'fixedTask', 'expectedInterval', 'evidenceIds'] } as const;
/** Numeric claims are allowed only from numeric facts, with explicit unit conversions.
 * Unknown word forms are conservatively excluded rather than inferred. */
function unsupportedNumber(text: string, pack: BudgetDeepHealthPack): string | null {
  const values = new Set<number>(), byUnit = new Map<string, Set<number>>();
  const put = (n: number, unit: string) => { values.add(n); const set = byUnit.get(unit) ?? new Set<number>(); set.add(n); byUnit.set(unit, set); };
  for (const m of pack.metrics) for (const v of [m.value]) if (v !== null) {
    put(v, m.unit);
    if (m.unit === 'ms') { put(v / 1000, 's'); put(v / 60000, 'min'); put(v / 3600000, 'h'); }
  }
  const milliseconds = (v: number) => { put(v, 'ms'); put(v / 1000, 's'); put(v / 60000, 'min'); put(v / 3600000, 'h'); };
  const msFacts: Record<string, string[]> = { 'act.long_tool': ['durationMs'], 'perceived.long_gap': ['gap'], 'model.slow_first_output': ['delay'] };
  for (const f of pack.findings) for (const [key, v] of Object.entries(f.facts)) if (typeof v === 'number') {
    values.add(v);
    if (msFacts[f.rule]?.includes(key)) milliseconds(v);
  }
  // Only coefficients immediately following an explicit conversion operator are exempt.
  text = text.replace(/(?:除以|÷|\/)\s*(?:3600000|60000|1000)(?![\d.eE])/g, ' ');
  text = text.replace(/十分|万一|千万|一旦|一直|一些|一般|一致|一起|一定|一样|统一|唯一|进一步|之一|百分比/g, ' ');
  const words: Record<string, number> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, hundred: 100, thousand: 1000 };
  const units: Record<string, string> = { ms: 'ms', milliseconds: 'ms', millisecond: 'ms', '毫秒': 'ms', s: 's', seconds: 's', second: 's', '秒': 's', min: 'min', minutes: 'min', minute: 'min', '分钟': 'min', h: 'h', hours: 'h', hour: 'h', '小时': 'h', '%': 'pct', '％': 'pct', percent: 'pct', tokens: 'tokens', token: 'tokens', chars: 'chars', characters: 'chars', trials: 'count', calls: 'count', rounds: 'count', times: 'count', '次': 'count', '轮': 'count', '个': 'count' };
  const word = /\b(?:eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|million|billion|dozen|half|twice|double|triple)\b/i.exec(text);
  const invalidTokens: { index: number; token: string }[] = word ? [{ index: word.index, token: word[0] }] : [];
  // Unrecognized Chinese compounds are excluded rather than guessed.
  // A lone 一 is common prose (同一、逐一、一段); it counts only before a measure word.
  const chinese = /[零〇二两三四五六七八九十百千万亿]+(?:个|次|轮|秒|分钟|小时|倍|成|%|％)?|一(?:个|次|轮|秒|分钟|小时|倍|成|%|％)/.exec(text);
  if (chinese) invalidTokens.push({ index: chinese.index, token: chinese[0] });
  const pattern = /(\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|hundred|thousand)\b|[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?)(?:\s*(milliseconds?|ms|seconds?|s\b|minutes?|min\b|hours?|h\b|tokens?|chars|characters|percent|trials|calls|rounds|times|毫秒|分钟|小时|秒|次|轮|个|%|％))?/gi;
  for (const match of text.matchAll(pattern)) {
    const n = words[match[1]!.toLowerCase()] ?? Number(match[1]), unit = match[2] && units[match[2].toLowerCase()];
    if (unit ? !byUnit.get(unit)?.has(n) : !values.has(n)) invalidTokens.push({ index: match.index, token: match[1]! });
  }
  return invalidTokens.sort((a, b) => a.index - b.index)[0]?.token ?? null;
}
export function validateDeepHealthOutput(raw: unknown, pack: BudgetDeepHealthPack, redact: (text: string) => string = redactHealthText): Sections {
  const result: Sections = { valueMoments: [], necessity: [], causes: [], experiments: [], rejected: [], status: 'rejected' };
  const invalid = () => ({ ...result, rejected: [{ section: 'report', index: null, reason: 'Invalid model output schema.' }] });
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).sort().join() !== Object.keys(fields).sort().join()) return invalid();
  const value = raw as Record<keyof typeof fields, unknown>;
  // Validate the entire shape before accepting any item.
  for (const section of Object.keys(fields) as (keyof typeof fields)[]) {
    const items = value[section];
    if (!Array.isArray(items) || items.length > (section === 'causes' ? 5 : 150)) return invalid();
    for (const item of items) {
      if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).sort().join() !== [...fields[section]].sort().join()) return invalid();
      const v = item as Record<string, unknown>;
      if (fields[section].some(k => k === 'evidenceIds' ? !Array.isArray(v[k]) || !(v[k] as unknown[]).length || (v[k] as unknown[]).some(id => typeof id !== 'string' || !id) : typeof v[k] !== 'string' || !(v[k] as string).trim())) return invalid();
      if (section === 'valueMoments' && !['ttfmp', 'ttv'].includes(String(v.kind)) || section === 'necessity' && !['necessary', 'likely_waste', 'unknown'].includes(String(v.verdict))) return invalid();
    }
  }
  const ids = new Set([...pack.fragments.map(f => f.id), ...pack.evidence.map(e => e.id)]), records = new Set([...pack.fragments.map(f => f.recordId), ...pack.evidence.flatMap(e => e.recordIds)]);
  for (const section of Object.keys(fields) as (keyof typeof fields)[]) {
    (value[section] as Record<string, unknown>[]).forEach((item, index) => {
      const inlineRefs = Object.values(item).filter((v): v is string => typeof v === 'string').flatMap(v => [...v.matchAll(/\[\[([^\]]+)\]\]/g)].map(m => m[1]!));
      const foreign = inlineRefs.some(id => !ids.has(id)) || (item.evidenceIds as string[]).some(id => !ids.has(id)) || section === 'valueMoments' && !records.has(String(item.recordId)) || section === 'necessity' && !pack.findings.some(f => f.id === item.findingId);
      const text = fields[section].filter(k => !['evidenceIds', 'recordId', 'findingId', 'kind', 'verdict'].includes(k)).map(k => item[k]).join(' ').replace(/\[\[[^\]]+\]\]/g, '');
      const token = unsupportedNumber(text, pack);
      const firstText = fields[section].find(k => !['evidenceIds', 'recordId', 'findingId', 'kind', 'verdict'].includes(k))!;
      const excerpt = redact(String(item[firstText])).replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, '[private key redacted]').slice(0, 160);
      if (foreign || token !== null) result.rejected.push({ section, index, reason: foreign ? 'Reference outside evidence pack.' : 'Numeric claim outside fact table; not adopted.', token: foreign ? null : token, excerpt });
      else (result[section] as unknown[]).push(structuredClone(item));
    });
  }
  const count = result.valueMoments.length + result.necessity.length + result.causes.length + result.experiments.length;
  result.status = count ? result.rejected.length ? 'partial' : 'accepted' : 'rejected';
  return result;
}
