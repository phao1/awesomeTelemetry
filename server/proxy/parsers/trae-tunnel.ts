import type { ParsedRequest } from '../parser-router.js';

/** REQ-009：Trae TTNet tunnel——加密 body 无法解析（G6.2），尽力而为。 */
export function parseTraeTunnelRequest(input: {
  requestBody: string;
  responseBody?: string | null;
}): Omit<ParsedRequest, 'parserRoute'> {
  let model: string | null = null;
  const modelMatch = /"model"\s*:\s*"([^"]+)"/.exec(input.requestBody);
  if (modelMatch !== null) {
    model = modelMatch[1] ?? null;
  }
  return {
    model,
    systemPrompt: null,
    systemPromptLen: 0,
    inputTokens: null,
    outputTokens: null,
  };
}
