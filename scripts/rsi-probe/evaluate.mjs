// This trusted entrypoint and sealed tests live outside the patched workspace.

export function judge(events, exitCode, expected = 5) {
  const completed = events.filter(e => ['test:pass', 'test:fail'].includes(e.type) && e.data?.nesting === 0);
  const summary = events.filter(e => e.type === 'test:summary' && e.data?.file === undefined).at(-1)?.data;
  // Require exact inventory and summary; forged text/exit(0)/skip/todo cannot pass.
  if (!summary || completed.length !== expected || summary.tests !== expected || summary.cancelled !== 0
      || summary.skipped !== 0 || summary.todo !== 0) {
    return { verdict: 'infra_error', reason: 'report_inventory_mismatch', observedTests: completed.length, expectedTests: expected };
  }
  const pass = completed.every(e => e.type === 'test:pass' && !e.data.skip && !e.data.todo)
    && summary.passed === expected && summary.failed === 0 && exitCode === 0;
  return { verdict: pass ? 'pass' : 'fail', reason: pass ? null : 'test_failure', observedTests: completed.length, expectedTests: expected };
}

export default async function* reporter(source) {
  for await (const event of source) {
    // Strip test names, diagnostics, stdout and code; report only trusted event counters.
    if (['test:pass', 'test:fail'].includes(event.type)) {
      yield `${JSON.stringify({ type: event.type, data: { nesting: event.data.nesting,
        skip: Boolean(event.data.skip), todo: Boolean(event.data.todo) } })}\n`;
    }
    if (event.type === 'test:summary') {
      const { tests, passed, failed, cancelled, skipped, todo } = event.data.counts;
      const { file } = event.data;
      yield `${JSON.stringify({ type: event.type, data: { tests, passed, failed, cancelled, skipped, todo, file } })}\n`;
    }
  }
}

