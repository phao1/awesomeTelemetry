import type { ParsedRequest } from '../parser-router.js';
import { extractTokenUsageFromSse, parseSseChunk } from '../sse-accumulator.js';
import { extractTextContent, extractOpenAiUsage } from './openai.js';

interface AnthropicParsedBody {
  model?: unknown;
  system?: unknown;
}

/** REQ-009：Anthropic 请求解析（system 顶层字段 + messages）。 */
export function parseAnthropicRequest(input: {
  requestBody: string;
  responseBody?: string | null;
}): Omit<ParsedRequest, 'parserRoute'> {
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  let parsedBody: AnthropicParsedBody | null;
  try {
    const value: unknown = JSON.parse(input.requestBody);
    parsedBody = typeof value === 'object' && value !== null && !Array.isArray(value) ? value as AnthropicParsedBody : null;
  } catch {
    parsedBody = null;
  }
  const model =
    parsedBody !== null && typeof parsedBody.model === 'string'
      ? parsedBody.model
      : (/"model"\s*:\s*"([^"]+)"/.exec(input.requestBody)?.[1] ?? null);
  const systemPrompt =
    parsedBody !== null ? extractTextContent(parsedBody.system)
      : (/"system"\s*:\s*"([^"]*)"/.exec(input.requestBody)?.[1] ?? null);
  if (input.responseBody !== null && input.responseBody !== undefined) {
    const usage = extractTokenUsageFromSse(parseSseChunk(input.responseBody)) ?? extractOpenAiUsage(input.responseBody);
    inputTokens = usage.inputTokens;
    outputTokens = usage.outputTokens;
  }
  return {
    model,
    systemPrompt,
    systemPromptLen: systemPrompt === null ? 0 : systemPrompt.length,
    inputTokens,
    outputTokens,
  };
}
