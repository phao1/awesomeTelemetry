import type { TraceRecord } from '../core/trace-types.js';
import { claudeAdapter } from './claude-code.js';
import { codeAgentAdapter } from './codeagent.js';
import { codeagent2Adapter } from './codeagent2.js';
import { codeartsAdapter } from './codearts.js';
import { codexAdapter } from './codex.js';
import { opencodeAdapter } from './opencode.js';
import { qoderAdapter } from './qoder.js';
import { traeAdapter } from './trae.js';
import { workbuddyAdapter } from './workbuddy.js';

/** REQ-011：含 sourceAgent 的原始样本。TSession/TEvent 由具体 adapter 定义。 */
export interface RawSample<TSession = unknown, TEvent = unknown> {
  sourceAgent: string;
  session: TSession;
  events: TEvent[];
}

export interface Adapter<TSession = unknown, TEvent = unknown> {
  readonly sourceAgent: string;
  normalize(sample: RawSample<TSession, TEvent>, sourcePath: string): TraceRecord;
}

const registry = new Map<string, Adapter<unknown, unknown>>();

function register(adapter: Adapter<unknown, unknown>): void {
  registry.set(adapter.sourceAgent, adapter);
}

register(claudeAdapter);
register(codeAgentAdapter);
register(codexAdapter);
register(opencodeAdapter);
register(codeartsAdapter);
register(codeagent2Adapter);
register(traeAdapter);
register(qoderAdapter);
register(workbuddyAdapter);

/** REQ-001：按 sourceAgent 分发到对应 adapter。 */
export function normalizeRawSample(sample: RawSample, sourcePath: string): TraceRecord {
  const adapter = registry.get(sample.sourceAgent);
  if (adapter === undefined) {
    throw new Error(`Unknown sourceAgent: ${sample.sourceAgent} (register the adapter first)`);
  }
  return adapter.normalize(sample, sourcePath);
}
