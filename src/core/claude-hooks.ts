export const CLAUDE_HOOK_EVENTS = ['SessionStart','SessionEnd','PreToolUse','PostToolUse','PostToolUseFailure','SubagentStart','SubagentStop','Stop'] as const;
export type ClaudeHookEvent = typeof CLAUDE_HOOK_EVENTS[number];
export interface ClaudeHookStatus { enabled: boolean; revision: number; receivedCount: number; lastReceivedAt: string | null }
export interface ClaudeHookSummary {
  id: number; receivedAt: string; eventName: ClaudeHookEvent; nativeSessionId: string;
  agentId: string | null; agentType: string | null; toolUseId: string | null; toolName: string | null;
  nativeDurationMs: number | null; payloadBytes: number; nativeSessionKey: string | null;
  nativeSessionState: 'unique' | 'ambiguous' | 'unresolved' | 'manifest_incomplete';
}
export interface ClaudeHookDetail extends ClaudeHookSummary { rawJson: string; sha256: string }
export interface ClaudeHookPage { status: ClaudeHookStatus; items: ClaudeHookSummary[]; nextCursor: number | null; hasMore: boolean }
export interface ClaudeHookSettings {
  hooks: Record<string, Array<{ hooks: Array<{ type: 'http'; url: string; timeout: number; headers: { Authorization: string } }> }>>;
}
export interface ClaudeHookConfigureResult { status: ClaudeHookStatus; settings: ClaudeHookSettings | null }
