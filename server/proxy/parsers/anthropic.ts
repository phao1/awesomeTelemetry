import type { ParsedRequest } from '../parser-router.js';

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
    parsedBody = JSON.parse(input.requestBody) as AnthropicParsedBody;
  } catch {
    parsedBody = null;
  }
  const model =
    parsedBody !== null && typeof parsedBody.model === 'string'
      ? parsedBody.model
      : (/"model"\s*:\s*"([^"]+)"/.exec(input.requestBody)?.[1] ?? null);
  const systemPrompt =
    parsedBody !== null && typeof parsedBody.system === 'string'
      ? parsedBody.system
      : (/"system"\s*:\s*"([^"]*)"/.exec(input.requestBody)?.[1] ?? null);
  if (input.responseBody !== null && input.responseBody !== undefined) {
    try {
      const parsed = JSON.parse(input.responseBody) as {
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      inputTokens = parsed.usage?.input_tokens ?? null;
      outputTokens = parsed.usage?.output_tokens ?? null;
    } catch {
      // 保持 null
    }
  }
  return {
    model,
    systemPrompt,
    systemPromptLen: systemPrompt === null ? 0 : systemPrompt.length,
    inputTokens,
    outputTokens,
  };
}
