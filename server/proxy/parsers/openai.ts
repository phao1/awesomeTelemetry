import type { ParsedRequest } from '../parser-router.js';
import { readTokenUsage } from '../sse-accumulator.js';

interface OpenAiParsedBody {
  model?: unknown;
  messages?: Array<{ role?: string; content?: unknown }>;
}

/** Text blocks only; image/audio/opaque reasoning payloads are not coerced. */
export function extractTextContent(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return null;
  const text = value.flatMap((block: unknown) => {
    if (typeof block === 'object' && block !== null && 'text' in block && typeof block.text === 'string') {
      return [block.text];
    }
    return [];
  });
  return text.length === 0 ? null : text.join('\n');
}

/** REQ-009：OpenAI 系（含 ByteDance/SiliconFlow）请求解析。 */
export function parseOpenAiRequest(input: {
  requestBody: string;
  responseBody?: string | null;
}): Omit<ParsedRequest, 'parserRoute'> {
  let parsedBody: OpenAiParsedBody | null;
  try {
    const value: unknown = JSON.parse(input.requestBody);
    parsedBody = typeof value === 'object' && value !== null && !Array.isArray(value) ? value as OpenAiParsedBody : null;
  } catch {
    parsedBody = null;
  }
  const model =
    parsedBody !== null && typeof parsedBody.model === 'string'
      ? parsedBody.model
      : (/"model"\s*:\s*"([^"]+)"/.exec(input.requestBody)?.[1] ?? null);
  const messages = Array.isArray(parsedBody?.messages) ? parsedBody.messages : [];
  const prompts = messages.flatMap((message) => {
    if (message === null || typeof message !== 'object') return [];
    if (message.role !== 'system' && message.role !== 'developer') return [];
    const text = extractTextContent(message.content);
    return text === null ? [] : [text];
  });
  const systemPrompt = prompts.length > 0 ? prompts.join('\n') : parsedBody === null
    ? (/"role"\s*:\s*"system"[^}]*"content"\s*:\s*"([^"]*)"/.exec(input.requestBody)?.[1] ?? null) : null;
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
    return readTokenUsage(JSON.parse(responseBody)) ?? { inputTokens: null, outputTokens: null };
  } catch {
    return { inputTokens: null, outputTokens: null };
  }
}
