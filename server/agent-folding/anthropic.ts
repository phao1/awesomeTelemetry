import type { FoldingJson, FoldingProviderStatus } from '../../src/core/agent-folding-types.js';

export interface FoldingToolDefinition { name: string; description: string; input_schema: Record<string, unknown>; defer_loading?: boolean }
export interface FoldingBlock { type: string; text?: string; id?: string; name?: string; input?: Record<string, FoldingJson>; [key: string]: unknown }
export interface FoldingMessage { role: 'user' | 'assistant'; content: string | FoldingBlock[] }
export interface FoldingModelRequest { agentId: string; model: string; system: string; tools: FoldingToolDefinition[]; messages: FoldingMessage[]; maxTokens: number; signal: AbortSignal }
export interface FoldingModelResponse { content: FoldingBlock[]; stopReason: string; inputTokens: number; outputTokens: number; model: string }
export interface FoldingModelClient { readonly fixture: boolean; create(request: FoldingModelRequest): Promise<FoldingModelResponse> }

export function foldingProviderStatus(env: NodeJS.ProcessEnv = process.env): FoldingProviderStatus {
  const model = env.FOLDING_MODEL?.trim() || null;
  return { anthropicConfigured: Boolean(env.ANTHROPIC_API_KEY), modelConfigured: model !== null, model, paidExecution: 'cli_only' };
}
function tokens(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Invalid model usage.');
  return value;
}
function sumTokens(values: number[]): number { const sum = values.reduce((a, b) => a + b, 0); if (!Number.isSafeInteger(sum)) throw new Error('Invalid model usage total.'); return sum; }
/** No retries. The endpoint override is a constructor seam for local HTTP conformance tests only. */
export class AnthropicFoldingClient implements FoldingModelClient {
  readonly fixture: boolean;
  private readonly key: string;
  private readonly endpoint: string;
  constructor(options: { env?: NodeJS.ProcessEnv; endpoint?: string; fixture?: boolean } = {}) {
    this.fixture = options.fixture ?? false;
    this.key = (options.env ?? process.env).ANTHROPIC_API_KEY ?? '';
    if (!this.key) throw new Error('ANTHROPIC_API_KEY is required in the environment.');
    this.endpoint = options.endpoint ?? 'https://api.anthropic.com/v1/messages';
  }
  async create(request: FoldingModelRequest): Promise<FoldingModelResponse> {
    const response = await fetch(this.endpoint, { method: 'POST', signal: request.signal, headers: {
      'x-api-key': this.key, 'content-type': 'application/json', 'anthropic-version': '2023-06-01',
    }, body: JSON.stringify({ model: request.model, max_tokens: request.maxTokens, system: request.system,
      messages: request.messages, tools: request.tools.map(t => t.name.startsWith('tool_search_tool_') ? { name: t.name, type: (t as unknown as { type: string }).type } : t) }) });
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Anthropic request failed (HTTP ${response.status}); no retry was attempted.`); }
    if (!response.body) throw new Error('Model response body is absent.');
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const chunk = await reader.read(); if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 2 * 1024 * 1024) { await reader.cancel(); throw new Error('Model response exceeds 2 MiB.'); }
        chunks.push(chunk.value);
      }
    } finally { reader.releaseLock(); }
    let raw: unknown;
    try { raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
    catch { throw new Error('Invalid model response JSON.'); }
    if (!raw || typeof raw !== 'object') throw new Error('Invalid model response.');
    const body = raw as Record<string, unknown>, usage = body.usage as Record<string, unknown> | undefined;
    if (!Array.isArray(body.content) || typeof body.stop_reason !== 'string' || typeof body.model !== 'string' || !usage) throw new Error('Invalid model response shape.');
    const content = body.content as FoldingBlock[];
    if (content.some(b => !b || typeof b.type !== 'string' || (b.type === 'tool_use' && (typeof b.id !== 'string' || typeof b.name !== 'string' || !b.input || typeof b.input !== 'object' || Array.isArray(b.input))))) throw new Error('Invalid model content blocks.');
    const ids = content.filter(b => b.type === 'tool_use').map(b => b.id);
    if (new Set(ids).size !== ids.length) throw new Error('Duplicate model tool-call IDs.');
    if (body.stop_details && typeof body.stop_details === 'object' && (body.stop_details as Record<string, unknown>).type === 'refusal') throw new Error('Model refused this request.');
    return { content, stopReason: body.stop_reason, model: body.model,
      inputTokens: sumTokens([tokens(usage.input_tokens), tokens(usage.cache_creation_input_tokens ?? 0), tokens(usage.cache_read_input_tokens ?? 0)]),
      outputTokens: tokens(usage.output_tokens) };
  }
}
