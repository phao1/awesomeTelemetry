import type { RsiBankQuestion } from '../bank.js';
import type { RsiOutcome } from '../../../src/core/rsi-types.js';

export interface TestVerdict { outcome: RsiOutcome; observedTests: number; reason: string | null }
export function testArgv(q: RsiBankQuestion): string[] {
  if (q.report === 'node-test-events') return ['node', '--test', '--test-reporter=/opt/rsi/node.mjs', '--', ...q.testTargets];
  if (q.report === 'unittest-json') return ['python3', '-I', '/opt/rsi/unittest.py', ...q.testTargets];
  return ['node', '/opt/rsi/go.mjs', ...q.testTargets];
}
export function parseReport(report: string, code: number | null, q: Pick<RsiBankQuestion, 'report' | 'expectedTests'>): TestVerdict {
  const infra = (n = 0): TestVerdict => ({ outcome: 'infra_error', observedTests: n, reason: 'invalid_test_report' });
  try {
    // Bounded process output, report parsing does not read or split a JSONL file.
    const rows: Record<string, unknown>[] = report.trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>);
    if (q.report === 'go-test-json') {
      const tests = new Map<string, string>(), started = new Set<string>();
      let failed = false, packageResults = 0;
      for (const row of rows) {
        if (typeof row.Package !== 'string' || typeof row.Action !== 'string') return infra();
        if (typeof row.Test === 'string') {
          const key = `${row.Package}:${row.Test}`;
          if (row.Action === 'run') { if (started.has(key)) return infra(); started.add(key); }
          else if (['pass', 'fail', 'skip'].includes(row.Action)) {
            if (!started.has(key) || tests.has(key)) return infra(); tests.set(key, row.Action);
          }
        } else if (row.Action === 'pass' || row.Action === 'fail') { packageResults++; failed ||= row.Action === 'fail'; }
      }
      if (!packageResults || tests.size !== q.expectedTests || started.size !== tests.size || [...tests.values()].includes('skip')) return infra(tests.size);
      const pass = code === 0 && !failed && [...tests.values()].every(v => v === 'pass');
      return { outcome: pass ? 'pass' : 'fail', observedTests: tests.size, reason: pass ? null : 'test_failed' };
    }
    if (rows.length !== 1) return infra();
    const r = rows[0]!;
    if (r.infrastructure === true) return infra();
    if (r.reporter !== (q.report === 'node-test-events' ? 'rsi-node-v1' : 'rsi-unittest-v1')) return infra();
    const keys = ['tests', 'passed', 'failed', 'skipped', 'cancelled', 'todo'] as const;
    if (keys.some(k => !Number.isSafeInteger(r[k]) || (r[k] as number) < 0)) return infra();
    const n = r.tests as number;
    if (n !== q.expectedTests || r.skipped !== 0 || r.cancelled !== 0 || r.todo !== 0 || (r.passed as number) + (r.failed as number) !== n) return infra(n);
    return { outcome: r.failed === 0 && code === 0 ? 'pass' : 'fail', observedTests: n, reason: r.failed === 0 && code === 0 ? null : 'test_failed' };
  } catch { return infra(); }
}
