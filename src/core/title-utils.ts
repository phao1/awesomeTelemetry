/**
 * 会话标题提取的共享工具（REQ-021，G5.5）。
 * 索引阶段（local-sessions/index-title.ts）与 adapter 详情阶段共用同一套
 * 注入内容黑名单，保证「打开会话不会把好标题覆盖成注入内容」。
 */

export const TITLE_MAX_LENGTH = 120;

const INJECTION_PREFIXES = [
  '# AGENTS.md',
  '<environment_context>',
  '<system-reminder>',
  '<user_instructions>',
  '<codex_internal_context',
  '<recommended_plugins>',
  '<app-context>',
] as const;

export function isInjectedFirstLine(firstLine: string): boolean {
  const normalized = firstLine.trim().toLowerCase();
  return INJECTION_PREFIXES.some((prefix) =>
    normalized.startsWith(prefix.toLowerCase()),
  );
}

/**
 * 标题净化：把首行里对人无意义的包装剥掉。
 *
 * 侧栏一行只放得下十几个字，而大量会话的开头是同一段样板
 * （`<command-name>/goal</command-name>`、`/goal ` 前缀、markdown 链接的 URL 部分），
 * 截断后会渲染成一批完全同形、无法区分的条目。
 */
export function cleanTitleText(raw: string): string {
  return raw
    // <command-name>/goal</command-name> → /goal
    .replace(/<command-(?:name|message|args)>([\s\S]*?)<\/command-\w+>/g, '$1')
    // 剩余的单标签包装（<foo> / </foo>）直接去掉，不吞正文
    .replace(/<\/?[a-z][\w-]*\s*\/?>/gi, ' ')
    // [文字](链接) → 文字；![图](url) → 去掉
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
    // 行首的 slash 命令由调用方单独展示成标签，不占标题正文；
    // 但整条标题只有这个命令时必须保留，否则会得到空标题。
    .replace(/^\/[a-z][\w-]*\s+(?=\S)/i, '');
}

/** 首行以 slash 命令开头时返回该命令（不含参数），供 UI 渲染成独立标签。 */
export function extractSlashCommand(text: string): string | null {
  const firstLine = text.split('\n').map((l) => l.trim()).find((l) => l !== '');
  if (firstLine === undefined) {
    return null;
  }
  const unwrapped = firstLine.replace(
    /<command-name>([\s\S]*?)<\/command-name>/,
    '$1',
  ).trim();
  return /^\/[a-z][\w-]*/i.exec(unwrapped)?.[0] ?? null;
}

/** 从用户消息正文提取标题：首个非空行，净化后截断 120 字符；注入内容返回 null。 */
export function extractTitleFromUserText(text: string): string | null {
  const firstLine = text
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line !== '');
  if (firstLine === undefined) {
    return null;
  }
  if (isInjectedFirstLine(firstLine)) {
    return null;
  }
  const cleaned = cleanTitleText(firstLine);
  // 整行只有包装（如纯 `<command-name>/goal</command-name>`）时保留原文，
  // 总比给用户一个空标题好。
  const title = cleaned === '' ? firstLine : cleaned;
  return title.length <= TITLE_MAX_LENGTH ? title : title.slice(0, TITLE_MAX_LENGTH);
}

/** D5：标题取不到时回落 `<provider> session · <本地化的起始时间>`。 */
export function fallbackSessionTitle(provider: string, startMs: number): string {
  return `${provider} session · ${new Date(startMs).toLocaleString()}`;
}
