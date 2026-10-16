import type { ParsedRequest } from '../parser-router.js';
import { extractOpenAiUsage, extractTextContent } from './openai.js';

/** Responses instructions are distinct from Chat messages; native input stays in originals. */
export function parseResponsesRequest(input: {
  requestBody: string;
  responseBody?: string | null;
}): Omit<ParsedRequest, 'parserRoute'> {
  let body: Record<string, unknown> | null = null;
  try {
    const value: unknown = JSON.parse(input.requestBody);
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) body = value as Record<string, unknown>;
  } catch {
    // No valid semantic body. Original bytes remain available separately.
  }
  const prompt = extractTextContent(body?.instructions);
  return {
    model: typeof body?.model === 'string' ? body.model : null,
    systemPrompt: prompt,
    systemPromptLen: prompt?.length ?? 0,
    ...extractOpenAiUsage(input.responseBody),
  };
}
