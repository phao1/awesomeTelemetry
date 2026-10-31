import { expect, it } from 'vitest';
import { comparisonConfounded, comparisonLimitations, comparisonNumber, comparisonRow, exportTaskComparison, findingLocation, healthDifferences, healthRuleCounts, taskComparisonRows } from './task-comparison.js';
import { analyzeTaskHealth } from './task-health/report.js';
import input from './__fixtures__/task-health/g1-serial.input.json';
import type { HealthInput, HealthReport } from './task-health/types.js';
import type { TaskSummary } from './task-types.js';
const task = (id: string, provider = 'codex'): TaskSummary => ({ id, provider, origin: 'collected', provenanceKnown: true, rootSessionKey: id.slice(10), runId: null, title: id, startedAt: null, updatedAt: '2026-10-30T00:00:00.000Z', recordedStatus: 'success', memberCount: 1, eventCount: 1, loadedMemberCount: 1, metrics: { durationMs: 100, errors: 0, toolCalls: 1, toolResults: 1, toolFailures: 0, input: null, output: null, cacheRead: null, correctedTotal: 100, promptInput:100,cacheHitRate:0.3, models: [] } });
function report(id: string): HealthReport {
  const r = analyzeTaskHealth(input as HealthInput, undefined, { id, generatedAt: '2026-10-30T00:00:00.000Z' });
  // Fully observed scope fixture: unknown quality cannot be construed as passed.
  r.taskId = id; r.scope = { member: 'all', from: null, to: null }; r.running = false;
  r.coverage.members.loaded = r.coverage.members.total; r.coverage.limits = []; r.coverage.reasons = [];
  for (const key of Object.keys(r.dimensions) as Array<keyof typeof r.dimensions>) r.dimensions[key] = 'not_observed';
  r.evidence = [{ id: 'e1', memberId: id + '-main', recordIds: [id + ':event:opaque-1'], captureIds: [], title: 'read', summary: null, truncated: false, intervalMs: null, timing: 'derived' }, { id: 'e2', memberId: id + '-main', recordIds: [id + ':event:opaque-2'], captureIds: [], title: 'write', summary: null, truncated: false, intervalMs: null, timing: 'derived' }];
  r.findings = [{ ...r.findings[0]!, id: id + '-finding', rule: 'act.long_tool', evidenceIds: ['e1'] }];
  return r;
}
it('judges signed B-A and B/A without treating missing or partial samples as zero', () => {
  expect(comparisonRow('x', 'x', '', [10], [5])).toMatchObject({ verdict: 'better', delta: -5, ratio: .5 });
  expect(comparisonRow('x', 'x', '', [10], [20])).toMatchObject({ verdict: 'worse', delta: 10, ratio: 2 });
  expect(comparisonRow('x', 'x', '', [0], [0])).toMatchObject({ verdict: 'equal', ratio: null });
  expect(comparisonRow('x', 'x', '', [null], [0])).toMatchObject({ verdict: 'unavailable', delta: null });
  expect(comparisonRow('x', 'x', '', [10, null], [5, 6])).toMatchObject({ verdict: 'unavailable', reason: 'missing' });
  expect(comparisonRow('x', 'x', '', [1, 9, 2], [4])).toMatchObject({ a: { median: 2, mean: 4, min: 1, max: 9, n: 3 } });
});
it('retains single sample and confounded warnings independently of numerical direction', () => {
  const snapshot = { a: [task('collected:a')], b: [task('collected:b', 'claude')] };
  expect(comparisonConfounded(snapshot, null)).toBe(true);
  expect(comparisonLimitations('zh', true, true)).toContain('单样本，不能证明因果');
  expect(comparisonLimitations('en', true, true).join(' ')).toContain('Confounded');
});
it('requires complete compatible cache evidence and judges higher cache hit as better',()=>{
 const a=task('a'),b=task('b'),coverage={known:1,total:1,missing:[]};
 for(const t of [a,b]){t.requestId='request:'+t.id;t.metrics!.coverage={input:coverage,output:coverage,cacheRead:coverage,correctedTotal:coverage,promptInput:coverage,cacheHitRate:{...coverage},models:coverage};}
 b.metrics!.cacheHitRate=0.6;
 const row=()=>taskComparisonRows({a:[a],b:[b]},null,null,'en').find(r=>r.key==='cacheHitRate')!;
 expect(row()).toMatchObject({verdict:'better',delta:30,ratio:2});
 b.metrics!.cacheHitRate=0.1;expect(row().verdict).toBe('worse');
 b.metrics!.coverage!.cacheHitRate.known=0;expect(row().verdict).toBe('unavailable');
 expect(taskComparisonRows({a:[a],b:[b]},null,null,'en').some(r=>r.key.startsWith('cost'))).toBe(false);
});
it('matches stable rule and normalized evidence positions across different task/native IDs', () => {
  const a = report('a'), b = report('b');
  expect(a.findings[0]!.id).not.toBe(b.findings[0]!.id);
  expect(findingLocation(a, a.findings[0]!)).toBe(findingLocation(b, b.findings[0]!));
  expect(healthDifferences([a], [b]).map(d => d.status)).toEqual(['persisting']);
  b.findings[0]!.evidenceIds = ['e2'];
  expect(healthDifferences([a], [b]).map(d => d.status).sort()).toEqual(['new', 'resolved']);
});
it('does not match different rules, unknown positions, scopes, thresholds or incomplete coverage', () => {
  const a = report('a'), b = report('b'); b.findings[0]!.rule = 'act.errors';
  expect(healthDifferences([a], [b]).map(d => d.status).sort()).toEqual(['new', 'resolved']);
  b.coverage.reasons.push('missing'); expect(healthDifferences([a], [b]).every(d => d.status === 'uncertain')).toBe(true);
  b.coverage.reasons = []; b.thresholds.longToolMs++; expect(healthDifferences([a], [b]).every(d => d.status === 'uncertain')).toBe(true);
  const c = report('c'); c.findings[0]!.evidenceIds = []; a.findings[0]!.evidenceIds = [];
  expect(healthDifferences([a], [c]).some(d => d.status === 'persisting')).toBe(false);
});
it('counts distinct affected tasks per rule rather than number of repeated findings', () => {
  const a = report('a'), b = report('b'), c = report('c');
  a.findings.push({ ...a.findings[0]!, id: 'second' }); c.findings = [];
  expect(healthRuleCounts([a, b, c], 'act.long_tool')).toEqual({ count: 2, total: 3, ratio: 2 / 3 });
});
it('exports localized conclusions, metrics, health changes, group counts and limitations with inert source strings', () => {
  const a = report('a'), b = report('b'); b.findings[0]!.rule = 'act.errors';
  b.findings[0]!.recommendation.action = '<script>alert(1)</script> / <script>bad()</script>';
  const rows = [comparisonRow('duration', 'Duration', 'ms', [10], [5])], differences = healthDifferences([a], [b]);
  const html = exportTaskComparison(rows, differences, ['Single sample; cannot prove causality'], 'en', 'html', '#/compare', { a: [task('a')], b: [task('b')] });
  expect(html).toContain('Conclusions and metrics'); expect(html).toContain('Better'); expect(html).toContain('Resolved'); expect(html).toContain('New'); expect(html).toContain('1/1'); expect(html).not.toContain('<script>'); expect(html).toContain('&lt;script&gt;bad()');
  const md = exportTaskComparison(rows, null, ['限制'], 'zh', 'md', '[x](javascript:bad)');
  expect(md).toContain('变好'); expect(md).toContain('尚未读取标准报告'); expect(md).not.toContain('[x](javascript:'); expect(md).toContain('限制');
});

it('preserves small nonzero measurements',()=>{expect(comparisonNumber(0.00001)).toBe('0.00001');});

it('uses human durations, signed changes, grouped counts, one-decimal percentages and a single multiplier convention',async()=>{
 const {formatComparisonValue:f,formatComparisonRatio:ratio}=await import('./task-comparison.js');
 expect(f(1203343364,'ms','zh',true)).toBe('+13.9 天');expect(f(-1203343364,'ms','en',true)).toBe('−13.9 days');
 expect(f(500,'ms','en')).toBe('500 ms');expect(f(1500,'ms','en')).toBe('1.5 s');expect(f(90000,'ms','en')).toBe('1.5 min');expect(f(5400000,'ms','en')).toBe('1.5 h');
 expect(f(1234567,'','zh')).toBe('1,234,567');expect(f(-1234,'','en',true)).toBe('−1,234');
 expect(f(17.5417,'%','en')).toBe('17.5%');expect(f(0,'%','zh')).toBe('0.0%');expect(f(1.23,'%','en',true)).toBe('+1.2 pp');
 expect(ratio(7.63019)).toBe('7.63×');expect(ratio(0.0919928)).toBe('0.09×');expect(ratio(0)).toBe('0.00×');expect(ratio(null)).toBe('—');expect(ratio(.0001)).toBe('<0.01×');
});
it('uses the same readable numbers in MD/HTML exports and retains exact precision in a separate appendix',()=>{
 const rows=[comparisonRow('duration','Duration','ms',[1000],[1203344364]),comparisonRow('rate','Rate','%',[0],[17.5417]),comparisonRow('tokens','Token','',[1000],[1234567])];
 for(const format of ['md','html'] as const){const output=exportTaskComparison(rows,null,[],'en',format,'#/compare');
 expect(output).toContain('+13.9 days');expect(output).toContain('17.5%');expect(output).toContain('1,234,567');expect(output).toContain('Exact raw values');expect(output).toContain('1203343364 ms');expect(output).toContain('17.5417');
 }
});
it('compares normalized request tokens only with complete declared provider coverage',()=>{
 const a=task('collected:a'),b=task('collected:b');a.requestId='request:a:event:p';b.requestId='request:b:event:p';
 const coverage={known:1,total:1,missing:[]};
 for(const t of [a,b])t.metrics!.coverage={input:coverage,output:coverage,cacheRead:coverage,correctedTotal:{...coverage},promptInput:coverage,cacheHitRate:coverage,models:coverage};
 b.metrics!.correctedTotal=50;
 const row=()=>taskComparisonRows({a:[a],b:[b]},null,null,'en').find(r=>r.key==='tokens')!;
 expect(row()).toMatchObject({verdict:'better',delta:-50});
 b.metrics!.coverage!.correctedTotal.known=0;expect(row().verdict).toBe('unavailable');
 b.metrics!.coverage=undefined;expect(row().verdict).toBe('unavailable');
 b.metrics!.coverage={input:coverage,output:coverage,cacheRead:coverage,correctedTotal:coverage,promptInput:coverage,cacheHitRate:coverage,models:coverage};b.provider='claude';expect(row().verdict).toBe('unavailable');
});
it('compares complete request health reports with request-relative evidence, but never mixes whole and request scopes',()=>{
 const a=report('a'),b=report('b');a.scope={member:'all',from:input.t0,to:null,request:'request:a:event:p'};b.scope={member:'all',from:input.t0,to:null,request:'request:b:event:p'};b.findings=[];
 expect(healthDifferences([a],[b]).map(d=>d.status)).toEqual(['resolved']);
 b.scope={member:'all',from:null,to:null};expect(healthDifferences([a],[b]).map(d=>d.status)).toEqual(['uncertain']);
});
