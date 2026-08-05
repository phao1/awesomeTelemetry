/**
 * add-mission-control §7.1（B9）：把自由文本错误归一到有限类。
 * 口径行必须标注「派生分类，非厂商原始错误码」。
 */

export type ErrorClass =
  | 'network'
  | 'timeout'
  | 'permission'
  | 'shell'
  | 'parse'
  | 'notfound'
  | 'other';

export const ERROR_CLASSES: readonly ErrorClass[] = [
  'network', 'timeout', 'permission', 'shell', 'parse', 'notfound', 'other',
] as const;

const RULES: Array<{ cls: ErrorClass; re: RegExp }> = [
  // 注意：全部正则避免嵌套量词（G11.13）。
  { cls: 'timeout', re: /timed?\s?out|timeout|ETIMEDOUT|read\s+timed/i },
  { cls: 'network', re: /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|connection\s+refused|network\s+(error|unreachable)|socket|EPIPE|ECONNRESET|failed to (fetch|connect)/i },
  { cls: 'permission', re: /permission\s+denied|EACCES|EPERM|not\s+authorized|unauthorized|forbidden|sudo/i },
  { cls: 'shell', re: /command\s+not found|exit code|non-zero exit|bash:|\/bin\/sh:|zsh:/i },
  { cls: 'notfound', re: /ENOENT|no such file|not found|does not exist|404/i },
  { cls: 'parse', re: /parse\s+error|syntax\s+error|unexpected token|JSON.*(invalid|parse)|Unexpected end of/i },
];

/** 错误文本 → 有限类。空/未知 → other。 */
export function classifyErrorText(error: string | null | undefined): ErrorClass {
  const text = (error ?? '').trim();
  if (text === '') {
    return 'other';
  }
  for (const rule of RULES) {
    if (rule.re.test(text)) {
      return rule.cls;
    }
  }
  return 'other';
}
