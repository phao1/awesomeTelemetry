/** TH-004a / TR-001. Catalogue for docs/tests, never the generic classifier's allowlist. */
export const KNOWN_PLATFORM_USER_TAGS = [
  'external_codex_apps_open_page', 'codex_apps_open_page', 'codex_apps_context',
  'app-context', 'app_context', 'environment_context', 'multi_agent_role',
  'multi_agent_mode', 'codex_internal_context', 'in-app-browser-context',
  'user_instructions', 'turn_aborted', 'subagent_notification',
  'send_user_message_question_reply', 'system-reminder', 'system', 'skills',
  'skill_instructions', 'tools', 'developer_instructions', 'turn_context', 'world_state',
] as const;
export const USER_PROMPT_POLICY_VERSION = 1;
export type UserPromptClass = 'question' | 'reply' | 'injection';
const REPLY_TAG = 'send_user_message_question_reply';
interface Tag { name: string; closing: boolean; selfClosing: boolean; end: number }
/** Small lexical reader, not an XML interpreter. No entities, execution or DOM needed. */
function tagAt(text: string, offset: number): Tag | null {
  const head = /^<(\/?)([A-Za-z_][\w:.-]*)(?=[\s/>])/.exec(text.slice(offset));
  if (!head) return null;
  let quote: string | null = null;
  for (let i = offset + head[0].length; i < text.length; i++) {
    const ch = text[i]!;
    if (quote) { if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '<') return null;
    if (ch === '>') return { name: head[2]!.toLowerCase(), closing: head[1] === '/', selfClosing: text[i-1] === '/', end: i+1 };
  }
  return null;
}
/** Only envelope structure matters; payload may itself contain JSON, code or tags. */
function envelope(text: string, retainedPrefix: boolean): { tags: string[] } | null {
  const tags: string[] = [];
  let at = 0;
  while (at < text.length) {
    while (/\s/.test(text[at] ?? '') && at < text.length) at++;
    if (at === text.length) break;
    const open = tagAt(text, at);
    if (!open || open.closing) {
      const prefix = retainedPrefix && /^<([A-Za-z_][\w:.-]*)(?:\s|$)/.exec(text.slice(at));
      if (prefix) { tags.push(prefix[1]!.toLowerCase()); return { tags }; }
      return null;
    }
    tags.push(open.name); at = open.end;
    if (open.selfClosing) continue;
    let depth = 1;
    while (depth > 0) {
      const start = text.indexOf('<', at);
      if (start < 0) return retainedPrefix ? { tags } : null;
      const next = tagAt(text, start);
      if (!next) { at = start+1; continue; }
      at = next.end;
      if (next.name === open.name) { if (next.closing) depth--; else if (!next.selfClosing) depth++; }
    }
  }
  return tags.length ? { tags } : null;
}

/** Full text by default; retainedPrefix is explicitly for first-line slim titles. */
export function classifyUserPrompt(text: string, retainedPrefix = false): UserPromptClass {
  const value = text.trim();
  if (/^#\s+AGENTS\.md instructions for\b/i.test(value)
    || /^#{1,6}\s+(?:skills?(?:\s+instructions?)?|(?:system|developer)(?:\s+(?:instructions?|prompt))?)\s*(?:$|[:\r\n])/i.test(value)
    // Known Trae tail fragment: retain the old injection safeguard, without
    // rejecting ordinary prose just because it mentions </system-reminder>.
    || /^intent\. When a skill is relevant, you must invoke the Skill tool IMMEDIATELY as your first action\./i.test(value) && (retainedPrefix || /<\/system-reminder>/i.test(value))) return 'injection';
  const blocks = envelope(value, retainedPrefix);
  if (!blocks) return 'question';
  return blocks.tags.includes(REPLY_TAG) ? 'reply' : 'injection';
}
