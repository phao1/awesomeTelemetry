import type { ProxyProtocolAnalysis } from './trace-types.js';

/** Local view model only. Every count describes this bounded projection, not a new call. */
export interface ProxyInsightSize {
  kind: 'system' | 'declaration' | 'tool_result';
  chars: number;
  sourcePath: string;
  evidenceKey: string;
}

export interface ProxyInsights {
  cache: {
    ratio: number | null;
    readTokens: number | null;
    inputTokens: number | null;
    reason: 'known' | 'missing' | 'unknown_accounting' | 'zero_input' | 'inconsistent';
  };
  sizes: ProxyInsightSize[];
  toolResultSignals: Array<{ sourcePath: string; evidenceKey: string; signal: string }>;
  proposalCount: number;
}

function counter(value: number | null): number | null {
  return value !== null && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function failureSignal(content: string): string | null {
  let value: unknown;
  try { value = JSON.parse(content) as unknown; } catch { return null; }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const fields = value as Record<string, unknown>;
  if (fields.is_error === true) return 'is_error=true';
  if (fields.isError === true) return 'isError=true';
  if (fields.status === 'error' || fields.status === 'failed') return 'status=' + fields.status;
  if (typeof fields.exit_code === 'number' && Number.isSafeInteger(fields.exit_code) && fields.exit_code !== 0) return 'exit_code=' + fields.exit_code;
  const error = fields.error;
  if (error === true || (typeof error === 'string' && error.trim().length > 0)
    || (error !== null && typeof error === 'object' && !Array.isArray(error) && Object.keys(error).length > 0)) return 'error';
  return null;
}

export function deriveProxyInsights(analysis: ProxyProtocolAnalysis): ProxyInsights {
  const usage = analysis.usage;
  const readTokens = counter(usage.cacheReadTokens);
  const input = counter(usage.inputTokens);
  const write = counter(usage.cacheWriteTokens);
  let inputTokens: number | null = null;
  let reason: ProxyInsights['cache']['reason'] = 'missing';
  if (usage.accounting === 'unknown') reason = 'unknown_accounting';
  else if (input !== null && readTokens !== null) {
    if (usage.accounting === 'openai_subsets') inputTokens = input;
    else if (write !== null && Number.isSafeInteger(input + readTokens + write)) inputTokens = input + readTokens + write;
    if (inputTokens !== null) reason = inputTokens === 0 ? 'zero_input' : readTokens > inputTokens ? 'inconsistent' : 'known';
  }
  const sizes: ProxyInsightSize[] = [];
  if (analysis.system !== null) sizes.push({ kind: 'system', chars: analysis.system.length, sourcePath: 'analysis.system', evidenceKey: 'system' });
  analysis.declarations.forEach((tool, index) => sizes.push({ kind: 'declaration', chars: tool.definition.length, sourcePath: tool.sourcePath, evidenceKey: 'declaration-' + index }));
  const toolResultSignals: ProxyInsights['toolResultSignals'] = [];
  let proposalCount = 0;
  analysis.items.forEach((item, index) => {
    if (item.phase === 'response' && item.kind === 'tool_call') proposalCount += 1;
    if (item.kind !== 'tool_result') return;
    sizes.push({ kind: 'tool_result', chars: item.content.length, sourcePath: item.sourcePath, evidenceKey: 'item-' + index });
    const nativeError = item.toolResultIsError === true;
    const signal = nativeError ? 'is_error=true' : failureSignal(item.content);
    if (signal !== null) toolResultSignals.push({ sourcePath: item.sourcePath + (nativeError ? '.is_error' : ''), evidenceKey: 'item-' + index, signal });
  });
  sizes.sort((left, right) => right.chars - left.chars || left.evidenceKey.localeCompare(right.evidenceKey));
  return { cache: { ratio: reason === 'known' ? readTokens! / inputTokens! : null, readTokens, inputTokens, reason }, sizes, toolResultSignals, proposalCount };
}
