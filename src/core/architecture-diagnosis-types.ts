/** Canonical additive DTOs: openspec/contracts/architecture-diagnosis.md. */
export type ArchitectureCategory = 'context_bloat' | 'tool_conflict' | 'handoff_loss';
export interface ArchitectureText { zh: string; en: string }
export interface ArchitectureEvidence {
  id: string;
  source: 'native_event' | 'http_capture' | 'codex_call';
  taskId: string; sessionKey: string | null; eventId: string | null;
  captureId: number | null; callSequence: number | null;
  path: string; excerpt: string | null;
}
export interface ArchitectureToolDefinition {
  name: string; signature: string; requiredArguments: string[]; refId: string;
}
export interface ArchitectureToolProposal {
  id: string; name: string; argumentKeys: string[] | null;
  argumentsComplete: boolean; refId: string;
}
export interface ArchitectureContextSample {
  id: string; streamId: string; agentId: string | null; order: number; refId: string;
  contextTokens: number | null;
  tokenBasis: 'request_usage' | 'last_call_usage' | 'unavailable';
  contextChars: number | null; contextComplete: boolean;
  parts: Array<{ kind: 'system' | 'message' | 'tool'; hash: string; chars: number; refId: string }>;
  tools: ArchitectureToolDefinition[]; toolCatalogComplete: boolean;
  toolChoice: { mode: 'auto' | 'none' | 'required' | 'named' | 'unknown'; name: string | null };
  proposals: ArchitectureToolProposal[];
}
export interface ArchitectureToolOutcome {
  id: string; agentId: string | null; order: number; name: string;
  callId: string | null; decisionKey: string | null;
  status: 'ok' | 'error' | 'unknown';
  errorClass: 'unknown_tool' | 'invalid_arguments' | 'permission' | 'other' | null;
  refId: string; proposalRefId: string | null;
}
export interface ArchitectureHandoff {
  id: string; senderAgentId: string; recipientAgentId: string | null;
  sentRefId: string; receivedRefId: string | null;
  linkage: 'explicit' | 'ambiguous' | 'unresolved';
  sentText: string | null; receivedText: string | null;
  sentComplete: boolean; receivedComplete: boolean;
  /** Only explicit required-reference/requirement fields, never an LLM-generated rubric. */
  requiredFacts: Array<{ key: string; value: string; refId: string }>;
}
export interface ArchitectureThresholds {
  minSamples: number; minContextTokens: number; minContextChars: number;
  growthRatio: number; duplicateRatio: number; toolCatalogLimit: number;
  repeatedToolErrors: number; minHandoffAnchors: number;
}
export interface ArchitectureCoverage {
  context: 'complete' | 'partial' | 'unavailable';
  tools: 'complete' | 'partial' | 'unavailable';
  handoffs: 'complete' | 'partial' | 'unavailable';
  nativeEvents: number; nativeEventTotal: number | null;
  captures: number; logicalCalls: number; omitted: number;
  reasons: string[];
}
export interface ArchitectureDiagnosisInput {
  version: 1; taskId: string; title: string; member: string;
  origin: 'collected' | 'imported'; revision: string;
  evidence: ArchitectureEvidence[]; contexts: ArchitectureContextSample[];
  outcomes: ArchitectureToolOutcome[]; handoffs: ArchitectureHandoff[];
  coverage: ArchitectureCoverage;
}
export type ArchitectureAction = 'progressive_disclosure' | 'split_candidate' | 'merge_candidate' | 'repair_tool_contract' | 'verify_first';
export interface ArchitectureFinding {
  id: string; category: ArchitectureCategory; rule: string;
  severity: 'info' | 'warning'; confidence: 'observed' | 'heuristic';
  title: ArchitectureText; explanation: ArchitectureText;
  evidenceIds: string[];
  metrics: Array<{ key: string; label: ArchitectureText; value: number | null; unit: string }>;
  recommendation: { action: ArchitectureAction; reason: ArchitectureText; conditions: ArchitectureText; verification: ArchitectureText };
}
export interface ArchitectureDiagnosisReport {
  version: 1; taskId: string; title: string; member: string;
  origin: 'collected' | 'imported'; revision: string; analyzedAt: string;
  thresholds: ArchitectureThresholds; coverage: ArchitectureCoverage;
  categories: Record<ArchitectureCategory, 'findings' | 'not_observed' | 'insufficient'>;
  findings: ArchitectureFinding[]; evidence: ArchitectureEvidence[];
  limitations: ArchitectureText[];
}
