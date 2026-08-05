/**
 * add-mission-control §7.3（B7）：prompt → 场景分类器。
 * 关键词/规则启发式，准确率有限 → 必须保留 unclassified / other 逃生舱。
 * ⚠️ 聚合端点只返回 {scene, count, tokenSum}，正文绝不出服务端。
 */

export const SCENE_CLASSES = [
  'feature-dev',
  'bug-fix',
  'refactor',
  'test-writing',
  'debugging',
  'code-review',
  'explanation',
  'documentation',
  'config-setup',
  'dependency-mgmt',
  'data-analysis',
  'devops',
  'unclassified',
  'other',
] as const;

export type SceneClass = (typeof SCENE_CLASSES)[number];

const RULES: Array<{ cls: SceneClass; re: RegExp }> = [
  // 顺序即优先级；正则全部避免嵌套量词（G11.13）。
  { cls: 'test-writing', re: /write (unit |integration |e2e )?tests?|add tests?|test coverage|make (the )?tests? pass|fix (the )?test/i },
  { cls: 'bug-fix', re: /\bfix\b|\bbug\b|error|crash|broken|not working|failing|regression/i },
  { cls: 'debugging', re: /\bdebug|why (is|does|isn't)|trace|log analysis|investigate/i },
  { cls: 'code-review', re: /review|comments? on (the )?code|code quality|pull request/i },
  { cls: 'refactor', re: /refactor|clean up|simplify|restructure|extract (method|function)|deduplicate/i },
  { cls: 'explanation', re: /explain|how does|what does|why did|walk me through|understand/i },
  { cls: 'documentation', re: /document|readme|comment(s)?|docstring|write docs/i },
  { cls: 'config-setup', re: /configure|setup|install|init(ialize)?\b|environment|\.env/i },
  { cls: 'dependency-mgmt', re: /install|upgrade|downgrade|dependency|package\.json|requirements/i },
  { cls: 'data-analysis', re: /analy[sz]e|parse data|csv|json data|statistics|aggregate/i },
  { cls: 'devops', re: /deploy|ci\/cd|docker|kubernetes|terraform|pipeline|build script/i },
  { cls: 'feature-dev', re: /implement|add (a |an |the )?(feature|support|endpoint|function|component)|build a|create (a |an |the )?new/i },
];

/** 分类 genuine user prompt。空文本 → unclassified；未命中 → other。 */
export function classifyScene(prompt: string | null | undefined): SceneClass {
  const text = (prompt ?? '').trim();
  if (text === '') {
    return 'unclassified';
  }
  for (const rule of RULES) {
    if (rule.re.test(text)) {
      return rule.cls;
    }
  }
  return 'other';
}
