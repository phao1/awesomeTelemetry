import { extractOpenAiUsage, parseOpenAiRequest } from './parsers/openai.js';
import { parseAnthropicRequest } from './parsers/anthropic.js';
import { parseTraeTunnelRequest } from './parsers/trae-tunnel.js';
import { extractTokenUsageFromSse } from './sse-accumulator.js';
import type { RequestContextFormat } from '../../src/core/trace-types.js';

export interface ParsedRequest {
  parserRoute: string;
  model: string | null;
  systemPrompt: string | null;
  systemPromptLen: number;
  inputTokens: number | null;
  outputTokens: number | null;
  /**
   * design D3 封闭 phase-1 请求格式分类。parseProxyRequest 恒赋值；
   * 直接调用各 provider parser 时可能缺失，writer 以 `unknown` 兜底。
   */
  requestFormat?: RequestContextFormat;
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
  /** 请求行 URL（绝对 URL 或相对 path），供 design D3 path 信号分类。 */
  url?: string;
  responseBody?: string | null;
  sseEvents?: Array<{ event?: string; data?: string }>;
  isStreaming?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** 从代理请求行（绝对 URL 或相对 path）提取 pathname；无法解析时返回 null。 */
export function pathFromRequestUrl(url: string | undefined): string | null {
  if (url === undefined || url === '') {
    return null;
  }
  try {
    return new URL(url).pathname;
  } catch {
    const withoutQuery = url.split('?')[0] ?? '';
    return withoutQuery.startsWith('/') ? withoutQuery : `/${withoutQuery}`;
  }
}

/**
 * design D3：按 body 形状 + 显式信号分类请求格式，绝不仅凭 hostname
 * （兼容网关会在自定义 host 复用 OpenAI/Anthropic 形状）。规则按序评估：
 * anthropic_messages → openai_responses → openai_chat → unknown。
 * 仅含 messages 且无任何显式信号的歧义负载保持 `unknown`，不猜（§3.4）。
 */
export function classifyRequestFormat(input: {
  parserRoute: ParserRoute;
  url?: string;
  body: unknown;
}): RequestContextFormat {
  if (!isRecord(input.body)) {
    return 'unknown';
  }
  const body = input.body;
  const hasMessages = Array.isArray(body.messages);
  const path = pathFromRequestUrl(input.url);
  const hasAnthropicToolSchema =
    Array.isArray(body.tools) &&
    body.tools.some((tool) => isRecord(tool) && 'input_schema' in tool);
  const hasOpenAiToolShape =
    (Array.isArray(body.tools) &&
      body.tools.some((tool) => isRecord(tool) && isRecord(tool.function))) ||
    Array.isArray(body.functions);

  if (hasMessages) {
    const anthropicSignal =
      input.parserRoute === 'anthropic' ||
      (path !== null && path.endsWith('/v1/messages')) ||
      'system' in body ||
      hasAnthropicToolSchema;
    if (anthropicSignal) {
      return 'anthropic_messages';
    }
  }

  // OpenAI Responses 先于 Chat 判定：instructions / Responses input 不得误标为 Chat（§3.5）。
  const responsesSignal =
    'input' in body ||
    'instructions' in body ||
    (path !== null && path.endsWith('/responses'));
  if (!hasMessages && responsesSignal) {
    return 'openai_responses';
  }

  if (hasMessages) {
    const openaiSignal =
      input.parserRoute === 'openai' ||
      (path !== null && path.endsWith('/chat/completions')) ||
      hasOpenAiToolShape;
    if (openaiSignal) {
      return 'openai_chat';
    }
  }

  return 'unknown';
}

/** REQ-008/009：路由并解析 model / system prompt / token usage。 */
export function parseProxyRequest(input: ParseInput): ParsedRequest {
  const route = routeParser(input.hostname);
  let parsedBody: unknown = null;
  if (input.requestBody !== '' && input.requestBody !== undefined) {
    try {
      parsedBody = JSON.parse(input.requestBody) as unknown;
    } catch {
      parsedBody = null;
    }
  }
  const requestFormat = classifyRequestFormat({
    parserRoute: route,
    url: input.url,
    body: parsedBody,
  });
  if (route === 'anthropic') {
    return { parserRoute: 'anthropic', requestFormat, ...parseAnthropicRequest(input) };
  }
  if (route === 'trae-tunnel') {
    return { parserRoute: 'trae-tunnel', requestFormat, ...parseTraeTunnelRequest(input) };
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
    requestFormat,
    ...base,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
  };
}
