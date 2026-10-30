import { resolve } from 'node:path';
import { openReadonly } from '../storage/db.js';
import { collectTaskHealth, generateHealthReport } from './collector.js';
import { renderTaskHealthMarkdown } from '../../src/core/task-health/render.js';
export function parseTaskHealthArgs(args: string[]): { taskId: string; member: string; format: 'json' | 'md'; db: string } {
  if (!args[0] || args[0].startsWith('--')) throw new Error('A task ID is required. Use --help.');
  const options = new Map<string, string>();
  for (let i = 1; i < args.length; i += 2) {
    const key = args[i]!, value = args[i + 1];
    if (!['--member', '--format', '--db'].includes(key) || options.has(key) || !value || value.startsWith('--')) throw new Error('Invalid arguments. Use --help.');
    options.set(key, value);
  }
  const format = options.get('--format') ?? 'json', member = options.get('--member') ?? 'all';
  if (!['json', 'md'].includes(format) || !member || member.length > 512) throw new Error('Invalid format or member.');
  return { taskId: args[0], member, format: format as 'json' | 'md', db: resolve(options.get('--db') ?? 'awesome-telemetry-data/observe.sqlite') };
}
export async function runTaskHealthCli(args: string[]): Promise<void> {
  if (args.includes('--help')) { console.log('telemetry-task-health <taskId> [--member all|main|<id>] [--format json|md] [--db existing.sqlite]\nRead-only local analysis; reports go to stdout. No scan, network or saved report files.'); return; }
  const options = parseTaskHealthArgs(args), db = openReadonly(options.db), controller = new AbortController();
  const cancel = () => controller.abort(), timer = setTimeout(cancel, 45000); timer.unref();
  process.on('SIGINT', cancel); process.on('SIGTERM', cancel);
  try {
    const input = await collectTaskHealth(db, options.taskId, { member: options.member, from: null, to: null }, controller.signal);
    const report = await generateHealthReport(input, undefined, controller.signal);
    console.log(options.format === 'json' ? JSON.stringify(report) : renderTaskHealthMarkdown(report));
  } finally { clearTimeout(timer); process.off('SIGINT', cancel); process.off('SIGTERM', cancel); db.close(); }
}
