// G9.2：CodeAgent 3.0 包装 claude-code：drop file-history-snapshot 行，relabel actor。
import { normalizeClaudeSample, type ClaudeRawRow } from './claude-code.js';
import type { Adapter, RawSample } from './sample-loader.js';

function isSnapshotRow(row: ClaudeRawRow): boolean {
  if (row.isSnapshot === true || row.subtype === 'file-history-snapshot') {
    return true;
  }
  const content = Array.isArray(row.message?.content) ? row.message?.content : [];
  return content.some(
    (part) => part.type === 'snapshot' || part.type === 'file-history-snapshot',
  );
}

export const codeAgentAdapter: Adapter<Record<string, never>, ClaudeRawRow> = {
  sourceAgent: 'CodeAgent',
  normalize(sample: RawSample<Record<string, never>, ClaudeRawRow>, sourcePath: string) {
    const filtered = sample.events.filter((row) => !isSnapshotRow(row));
    const record = normalizeClaudeSample({ ...sample, events: filtered }, sourcePath);
    return {
      ...record,
      session: { ...record.session, provider: 'codeagent', sourceAgent: 'CodeAgent' },
      events: record.events.map((event) => ({
        ...event,
        actor: event.actor === 'assistant' ? 'codeagent' : event.actor,
      })),
    };
  },
};
