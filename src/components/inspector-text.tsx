import { useSyncExternalStore } from 'react';

/** 建议 6：Inspector 密钥脱敏开关（localStorage 持久化，Settings 中切换）。 */
export const DESENSITIZE_KEY = 'agent-observability.desensitize';

const listeners = new Set<() => void>();

export function isDesensitizationEnabled(): boolean {
  try {
    return localStorage.getItem(DESENSITIZE_KEY) !== '0';
  } catch {
    return true;
  }
}

export function setDesensitizationEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(DESENSITIZE_KEY, enabled ? '1' : '0');
  } catch {
    // 隐私模式等场景 localStorage 不可写：保持内存状态即可
    return;
  }
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeDesensitization(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** React hook：跟随 Settings 开关实时生效。 */
export function useDesensitizationEnabled(): boolean {
  return useSyncExternalStore(subscribeDesensitization, isDesensitizationEnabled);
}

/**
 * 建议 6：客户端密钥脱敏（渲染前应用，纯正则、无依赖）。
 * - API keys：sk- / Bearer 后 20+ 字符
 * - token 字段：["']?token["']?\s*[:=]\s*["']?[\w-]{16,}
 * - 私钥块：-----BEGIN...PRIVATE KEY----- 到 -----END...-----
 */
export function redactSecrets(text: string): string {
  let out = text;
  out = out.replace(/(sk-|Bearer )[\w-]{20,}/gi, '$1****');
  out = out.replace(
    /(["']?token["']?\s*[:=]\s*["']?)[\w-]{16,}(["']?)/gi,
    '$1****$2',
  );
  out = out.replace(
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gi,
    '***PRIVATE KEY REDACTED***',
  );
  return out;
}

export type JsonTokenType =
  | 'key'
  | 'string'
  | 'number'
  | 'boolean'
  | 'null'
  | 'punctuation';

export interface JsonToken {
  type: JsonTokenType;
  text: string;
}

const JSON_TOKEN_RE =
  /("(?:[^"\\]|\\.)*")(\s*:)?|\b(true|false)\b|\b(null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;

/** 建议 5：轻量 JSON 语法高亮 tokenizer（纯 regex，6 类 token，无依赖）。 */
export function tokenizeJson(text: string): JsonToken[] {
  const tokens: JsonToken[] = [];
  let last = 0;
  JSON_TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = JSON_TOKEN_RE.exec(text)) !== null) {
    const index = match.index;
    if (index > last) {
      tokens.push({ type: 'punctuation', text: text.slice(last, index) });
    }
    if (match[1] !== undefined) {
      if (match[2] !== undefined) {
        tokens.push({ type: 'key', text: match[0] });
      } else {
        tokens.push({ type: 'string', text: match[1] });
      }
    } else if (match[3] !== undefined) {
      tokens.push({ type: 'boolean', text: match[3] });
    } else if (match[4] !== undefined) {
      tokens.push({ type: 'null', text: match[4] });
    } else {
      tokens.push({ type: 'number', text: match[0] });
    }
    last = index + match[0].length;
  }
  if (last < text.length) {
    tokens.push({ type: 'punctuation', text: text.slice(last) });
  }
  return tokens;
}

/** 判定文本是否为 JSON（首/末非空白字符为 { } 或 [ ]）。 */
export function looksLikeJson(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return false;
  }
  const first = trimmed[0]!;
  const last = trimmed[trimmed.length - 1]!;
  return (
    (first === '{' && last === '}') ||
    (first === '[' && last === ']')
  );
}

/** 渲染 JSON 高亮（span 用 inspector-json-* 类，颜色由 CSS token 决定）。 */
export function HighlightedJson({ text }: { text: string }): React.JSX.Element {
  const tokens = tokenizeJson(text);
  return (
    <span className="inspector-json">
      {tokens.map((token, i) => (
        <span key={i} className={`inspector-json-${token.type}`}>
          {token.text}
        </span>
      ))}
    </span>
  );
}
