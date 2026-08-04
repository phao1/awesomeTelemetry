import type { ParsedRequest } from '../parser-router.js';

interface OpenAiParsedBody {
  model?: unknown;
  messages?: Array<{ role?: string; content?: unknown }>;
}

/** REQ-009：OpenAI 系（含 ByteDance/SiliconFlow）请求解析。 */
export function parseOpenAiRequest(input: {
  requestBody: string;
  responseBody?: string | null;
}): Omit<ParsedRequest, 'parserRoute'> {
  let parsedBody: OpenAiParsedBody | null;
  try {
    parsedBody = JSON.parse(input.requestBody) as OpenAiParsedBody;
  } catch {
    parsedBody = null;
  }
  const model =
    parsedBody !== null && typeof parsedBody.model === 'string'
      ? parsedBody.model
      : (/"model"\s*:\s*"([^"]+)"/.exec(input.requestBody)?.[1] ?? null);
  const systemMessage = parsedBody?.messages?.find((m) => m.role === 'system');
  const systemPrompt =
    systemMessage !== undefined && typeof systemMessage.content === 'string'
      ? systemMessage.content
      : (/"role"\s*:\s*"system"[^}]*"content"\s*:\s*"([^"]*)"/.exec(input.requestBody)?.[1] ?? null);
  return {
    model,
    systemPrompt,
    systemPromptLen: systemPrompt === null ? 0 : systemPrompt.length,
    inputTokens: null,
    outputTokens: null,
  };
}

export function extractOpenAiUsage(responseBody: string | null | undefined): {
  inputTokens: number | null;
  outputTokens: number | null;
} {
  if (responseBody === null || responseBody === undefined || responseBody === '') {
    return { inputTokens: null, outputTokens: null };
  }
  try {
    const parsed = JSON.parse(responseBody) as { usage?: { prompt_tokens?: number; completion_tokens?: number } };
    return {
      inputTokens: parsed.usage?.prompt_tokens ?? null,
      outputTokens: parsed.usage?.completion_tokens ?? null,
    };
  } catch {
    return { inputTokens: null, outputTokens: null };
  }
}
