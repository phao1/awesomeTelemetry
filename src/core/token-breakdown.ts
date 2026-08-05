import type { TokenUsage, TraceEvent, TraceRecord } from './trace-types.js';
import { aggregateTokenUsage } from '../adapters/helpers.js';

/** REQ-007：token 分解（input / output / reasoning / cacheRead / cacheWrite）。 */
export function computeTokenBreakdown(record: TraceRecord): TokenUsage {
  return aggregateTokenUsage(record.events, record.tokenSemantics);
}

/** REQ-007：可读文本。 */
export function extractTokenText(tokens: TokenUsage | null): string {
  if (tokens === null) {
    return 'tokens: n/a';
  }
  return [
    `input ${tokens.input}`,
    `output ${tokens.output}`,
    `reasoning ${tokens.reasoning}`,
    `cacheRead ${tokens.cacheRead}`,
    `cacheWrite ${tokens.cacheWrite}`,
    `total ${tokens.total}`,
  ].join(' · ');
}

/** #19（审查 P3）：按类别提取真实 token 文本（system/input/output/reasoning）。 */
export interface TokenTexts {
  system: string | null;
  input: string | null;
  output: string | null;
  reasoning: string | null;
}

/**
 * #19：从事件正文/raw 中提取四类 token 的实际文本，支持 token 下钻。
 * - input：user_prompt 的 inputSummary（用户真实输入）
 * - output：llm 的 outputSummary（助手输出；Trae 无正文时回退 reasoningContent）
 * - reasoning：raw JSON 中 OpenCode 系 part.type='reasoning' / Claude 'thinking' /
 *   Trae turn.reasoningContent 的文本
 * - system：session.systemPrompt 或 system 事件正文
 * 无法解析的 raw 一律忽略，不抛错。
 */
export function extractTokenTexts(record: TraceRecord): TokenTexts {
  const input: string[] = [];
  const output: string[] = [];
  const reasoning: string[] = [];
  let system: string | null = record.session.systemPrompt;

  for (const event of record.events) {
    const full = event as TraceEvent;
    if (event.kind === 'user_prompt' && typeof full.inputSummary === 'string' && full.inputSummary !== '') {
      input.push(full.inputSummary);
    } else if (event.kind === 'llm' && typeof full.outputSummary === 'string' && full.outputSummary !== '') {
      output.push(full.outputSummary);
    } else if (
      event.kind === 'system' &&
      system === null &&
      typeof full.outputSummary === 'string' &&
      full.outputSummary !== ''
    ) {
      system = full.outputSummary;
    }

    const raw = (event as { raw?: unknown }).raw;
    if (typeof raw !== 'string') {
      continue;
    }
    let parsed: {
      type?: unknown;
      text?: unknown;
      reasoning_content?: unknown;
      reasoningContent?: unknown;
    };
    try {
      parsed = JSON.parse(raw) as typeof parsed;
    } catch {
      continue;
    }
    const type = typeof parsed.type === 'string' ? parsed.type : '';
    const text = typeof parsed.text === 'string' ? parsed.text : '';
    if ((type === 'reasoning' || type === 'thinking') && text !== '') {
      reasoning.push(text);
    }
    const reasoningRaw =
      typeof parsed.reasoning_content === 'string'
        ? parsed.reasoning_content
        : typeof parsed.reasoningContent === 'string'
          ? parsed.reasoningContent
          : null;
    if (reasoningRaw !== null && reasoningRaw !== '') {
      reasoning.push(reasoningRaw);
    }
  }

  return {
    system,
    input: input.length > 0 ? input.join('\n') : null,
    output: output.length > 0 ? output.join('\n') : null,
    reasoning: reasoning.length > 0 ? reasoning.join('\n') : null,
  };
}
