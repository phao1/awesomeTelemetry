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

/** 从用户消息正文提取标题：首个非空行，截断 120 字符；注入内容返回 null。 */
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
  return firstLine.length <= TITLE_MAX_LENGTH
    ? firstLine
    : firstLine.slice(0, TITLE_MAX_LENGTH);
}

/** D5：标题取不到时回落 `<provider> session · <本地化的起始时间>`。 */
export function fallbackSessionTitle(provider: string, startMs: number): string {
  return `${provider} session · ${new Date(startMs).toLocaleString()}`;
}
