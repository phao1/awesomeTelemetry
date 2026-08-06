import { useSyncExternalStore } from 'react';

/** 建议 6：Inspector 密钥脱敏开关（localStorage 持久化，Settings 中切换）。 */
export const DESENSITIZE_KEY = 'awesome-telemetry.desensitize';

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
    /(["']?(?:token|secret|api[_-]?key)["']?\s*[:=]\s*["']?)([^"'\s,{}]+)(["']?)/gi,
    '$1<REDACTED>$3',
  );
  out = out.replace(
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gi,
    '***PRIVATE KEY REDACTED***',
  );
  return out;
}

/** 面板内搜索一次最多标记的匹配数（避免超长文本生成上万个 <mark>）。 */
export const FIND_MATCH_LIMIT = 500;

/** REQ-116：统计 query 在 text 中的出现次数（大小写不敏感，上限 FIND_MATCH_LIMIT+1）。 */
export function countMatches(text: string, query: string): number {
  const needle = query.trim().toLowerCase();
  if (needle === '') {
    return 0;
  }
  const haystack = text.toLowerCase();
  let count = 0;
  let cursor = 0;
  while (true) {
    const at = haystack.indexOf(needle, cursor);
    if (at < 0) {
      break;
    }
    count += 1;
    cursor = at + needle.length;
    if (count > FIND_MATCH_LIMIT) {
      break;
    }
  }
  return count;
}

/**
 * REQ-116：find-in-text 高亮 —— EventInspector 与 TokenTextModal 共用同一实现，
 * 保证快捷键、高亮样式、导航行为一致（G-C3）。
 * `activeIndex >= 0` 时给第 N 个匹配加 `.inspector-find-active`（用于跳转定位）。
 */
export function highlightMatches(
  text: string,
  query: string,
  activeIndex = -1,
): React.JSX.Element {
  const needle = query.trim().toLowerCase();
  if (needle === '') {
    return <>{text}</>;
  }
  const haystack = text.toLowerCase();
  const parts: Array<React.JSX.Element> = [];
  let cursor = 0;
  let count = 0;
  while (true) {
    const at = haystack.indexOf(needle, cursor);
    if (at < 0) {
      break;
    }
    if (at > cursor) {
      parts.push(<span key={`t${cursor}`}>{text.slice(cursor, at)}</span>);
    }
    parts.push(
      <mark
        key={`m${at}`}
        className={count === activeIndex ? 'inspector-find-active' : undefined}
      >
        {text.slice(at, at + needle.length)}
      </mark>,
    );
    cursor = at + needle.length;
    count += 1;
    if (count > FIND_MATCH_LIMIT) {
      break;
    }
  }
  if (cursor < text.length) {
    parts.push(<span key={`t${cursor}`}>{text.slice(cursor)}</span>);
  }
  return <>{parts}</>;
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

/** 渲染 JSON 高亮（span 用 inspector-json-* 类，颜色由 CSS token 决定）。
 * 大文本只高亮前 maxChars 字符（observability-designer 成本优化），
 * 避免一次生成数万个 span 拖慢 Inspector。 */
export function HighlightedJson({
  text,
  maxChars = 64_000,
  truncatedLabel,
}: {
  text: string;
  maxChars?: number;
  truncatedLabel?: string;
}): React.JSX.Element {
  const truncated = text.length > maxChars;
  const tokens = tokenizeJson(truncated ? text.slice(0, maxChars) : text);
  return (
    <span className="inspector-json">
      {tokens.map((token, i) => (
        <span key={i} className={`inspector-json-${token.type}`}>
          {token.text}
        </span>
      ))}
      {truncated && (
        <span className="inspector-json-truncated">
          {truncatedLabel ?? `…（高亮截断，前 ${maxChars.toLocaleString()} 字符）`}
        </span>
      )}
    </span>
  );
}
