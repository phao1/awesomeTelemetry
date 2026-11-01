import type { TraceKind, TraceStatus } from './trace-types.js';
export type TelemetrySource = 'OpenTelemetry' | 'Langfuse' | 'LangSmith';
export interface TelemetrySpan {
  source: TelemetrySource;
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  group: string | null;
  name: string;
  kind: TraceKind;
  operation: string | null;
  agentName: string | null;
  agentId: string | null;
  toolName: string | null;
  toolCallId: string | null;
  userId: string | null;
  model: string | null;
  start: string | null;
  end: string | null;
  durationMs: number | null;
  status: TraceStatus;
  error: string | null;
  input: string | null;
  output: string | null;
  usage: { input: number | null; output: number | null; total: number | null; cacheRead: number | null; cacheWrite: number | null; reasoning: number | null };
}
export interface TelemetryStatus {
  enabled: boolean;
  requireToken: boolean;
  endpoint: string;
  spanCount: number;
  traceCount: number;
  rejectedCount: number;
  reasons: Record<string, number>;
  lastReceivedAt: string | null;
}
export interface TelemetryImportResult { format: TelemetrySource; spanCount: number; taskIds: string[] }

export type TelemetryMetadata = Omit<TelemetrySpan, 'input' | 'output'>;
