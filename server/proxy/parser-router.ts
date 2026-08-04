import { extractOpenAiUsage, parseOpenAiRequest } from './parsers/openai.js';
import { parseAnthropicRequest } from './parsers/anthropic.js';
import { parseTraeTunnelRequest } from './parsers/trae-tunnel.js';
import { extractTokenUsageFromSse } from './sse-accumulator.js';

export interface ParsedRequest {
  parserRoute: string;
  model: string | null;
  systemPrompt: string | null;
  systemPromptLen: number;
  inputTokens: number | null;
  outputTokens: number | null;
}

export type ParserRoute = 'openai' | 'anthropic' | 'trae-tunnel' | null;

/** REQ-008：hostname 精确路由 + 关键词启发式。 */
export function routeParser(hostname: string): ParserRoute {
  const host = hostname.toLowerCase();
  if (host === 'api.openai.com' || host === 'openai.azure.com') {
    return 'openai';
  }
  if (host === 'api.anthropic.com') {
    return 'anthropic';
  }
  if (host === 'console.enterprise.trae.cn') {
    return 'trae-tunnel';
  }
  if (/(bytedance|volces|doubao)/.test(host)) {
    return 'openai';
  }
  if (/(openai|gpt|siliconflow)/.test(host)) {
    return 'openai';
  }
  if (/claude/.test(host)) {
    return 'anthropic';
  }
  if (/trae/.test(host)) {
    return 'trae-tunnel';
  }
  if (/huawei/.test(host)) {
    return 'openai';
  }
  return null;
}

export interface ParseInput {
  hostname: string;
  requestBody: string;
  responseBody?: string | null;
  sseEvents?: Array<{ event?: string; data?: string }>;
  isStreaming?: boolean;
}

/** REQ-008/009：路由并解析 model / system prompt / token usage。 */
export function parseProxyRequest(input: ParseInput): ParsedRequest {
  const route = routeParser(input.hostname);
  if (route === 'anthropic') {
    return { parserRoute: 'anthropic', ...parseAnthropicRequest(input) };
  }
  if (route === 'trae-tunnel') {
    return { parserRoute: 'trae-tunnel', ...parseTraeTunnelRequest(input) };
  }
  const base =
    route === 'openai'
      ? parseOpenAiRequest(input)
      : parseOpenAiRequest(input); // 未知 host 也按 openai 格式尽力解析
  let usage = extractOpenAiUsage(input.responseBody);
  if (input.isStreaming === true && input.sseEvents !== undefined) {
    const fromSse = extractTokenUsageFromSse(input.sseEvents);
    if (fromSse !== null) {
      usage = fromSse;
    }
  }
  return {
    parserRoute: route ?? 'openai',
    ...base,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
  };
}
