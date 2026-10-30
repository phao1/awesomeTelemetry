import { AnthropicFoldingClient } from '../agent-folding/anthropic.js';
import type { FoldingModelClient } from '../agent-folding/anthropic.js';
import { HealthError } from './collector.js';
export interface HealthModelRequest { system: string; user: string; maxTokens: number; signal: AbortSignal }
export interface HealthModelResponse { text: string; inputTokens: number | null; outputTokens: number | null }
export interface HealthModelClient { create(request: HealthModelRequest): Promise<HealthModelResponse> }
export function healthModelStatus(env: NodeJS.ProcessEnv = process.env): { configured: boolean; provider: 'anthropic' | 'openai-compatible' | null; model: string | null } {
  const provider = env.HEALTH_MODEL_PROVIDER === 'anthropic' || env.HEALTH_MODEL_PROVIDER === 'openai-compatible' ? env.HEALTH_MODEL_PROVIDER : null;
  const requestedModel = env.HEALTH_MODEL?.trim();
  const model = requestedModel && requestedModel.length <= 512 && ![...requestedModel].some(character => character.charCodeAt(0) < 32) ? requestedModel : null;
  let valid = false;
  try { const url = new URL(env.HEALTH_MODEL_BASE_URL ?? (provider === 'anthropic' ? 'https://api.anthropic.com/v1' : '')); valid = ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash; } catch { /* Invalid configuration stays unavailable. */ }
  return { configured: Boolean(provider && model && env.HEALTH_MODEL_API_KEY?.trim() && valid), provider, model };
}
const usage = (v: unknown): number | null => v === undefined || v === null ? null : typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : (() => { throw new HealthError('HEALTH_MODEL_FAILED'); })();
export class AnthropicHealthClient implements HealthModelClient {
  private readonly client: FoldingModelClient;
  private readonly model: string;
  constructor(env: NodeJS.ProcessEnv, client?: FoldingModelClient) {
    if (!healthModelStatus(env).configured) throw new HealthError('HEALTH_MODEL_UNAVAILABLE');
    this.model = env.HEALTH_MODEL!.trim();
    this.client = client ?? new AnthropicFoldingClient({ env: { ANTHROPIC_API_KEY: env.HEALTH_MODEL_API_KEY }, endpoint: (env.HEALTH_MODEL_BASE_URL ?? 'https://api.anthropic.com/v1').replace(/\/$/, '') + '/messages' });
  }
  async create(request: HealthModelRequest): Promise<HealthModelResponse> {
    const r = await this.client.create({ agentId: 'task-health', model: this.model, system: request.system, messages: [{ role: 'user', content: request.user }], tools: [], maxTokens: request.maxTokens, signal: request.signal });
    if (r.stopReason !== 'end_turn' || r.content.some(b => b.type !== 'text' || typeof b.text !== 'string')) throw new HealthError('HEALTH_MODEL_FAILED');
    return { text: r.content.map(b => b.text).join(''), inputTokens: r.inputTokens, outputTokens: r.outputTokens };
  }
}
export class OpenAICompatibleHealthClient implements HealthModelClient {
  private readonly env: NodeJS.ProcessEnv;
  private readonly transport: typeof fetch;
  constructor(env: NodeJS.ProcessEnv, transport: typeof fetch = fetch) { this.env = env; this.transport = transport; if (!healthModelStatus(env).configured) throw new HealthError('HEALTH_MODEL_UNAVAILABLE'); }
  async create(request: HealthModelRequest): Promise<HealthModelResponse> {
    const response = await this.transport(this.env.HEALTH_MODEL_BASE_URL!.replace(/\/$/, '') + '/chat/completions', { method: 'POST', redirect: 'error', signal: request.signal, headers: { 'content-type': 'application/json', authorization: `Bearer ${this.env.HEALTH_MODEL_API_KEY}` }, body: JSON.stringify({ model: this.env.HEALTH_MODEL!.trim(), messages: [{ role: 'system', content: request.system }, { role: 'user', content: request.user }], max_tokens: request.maxTokens, stream: false }) });
    if (!response.ok) { await response.body?.cancel(); throw new HealthError('HEALTH_MODEL_FAILED'); }
    if (!response.body) throw new HealthError('HEALTH_MODEL_FAILED');
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
    try { while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength; if (size > 2 * 1024 * 1024) { await reader.cancel(); throw new HealthError('HEALTH_SIZE_LIMIT'); } chunks.push(chunk.value); } }
    finally { reader.releaseLock(); }
    try {
      const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))) as { choices?: { finish_reason?: string; message?: { content?: unknown; tool_calls?: unknown; function_call?: unknown; refusal?: unknown } }[]; usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } };
      const choice = body.choices?.[0], message = choice?.message;
      if (body.choices?.length !== 1 || choice?.finish_reason !== 'stop' || typeof message?.content !== 'string' || message.tool_calls || message.function_call || message.refusal) throw new Error();
      return { text: message.content, inputTokens: usage(body.usage?.prompt_tokens), outputTokens: usage(body.usage?.completion_tokens) };
    } catch { throw new HealthError('HEALTH_MODEL_FAILED'); }
  }
}
export function createHealthModelClient(env: NodeJS.ProcessEnv = process.env): HealthModelClient {
  if (!healthModelStatus(env).configured) throw new HealthError('HEALTH_MODEL_UNAVAILABLE');
  return env.HEALTH_MODEL_PROVIDER === 'anthropic' ? new AnthropicHealthClient(env) : new OpenAICompatibleHealthClient(env);
}
