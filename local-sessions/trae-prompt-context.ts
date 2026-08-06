import { desensitizeChecked } from '../server/desensitization/engine.js';
import type {
  PromptContextCategory,
  PromptContextSection,
  PromptModelConfig,
  SessionPromptContext,
} from '../src/core/trace-types.js';

export type TraePromptContextDraft = Omit<SessionPromptContext, 'sessionId' | 'provider'>;

interface JsonRecord {
  [key: string]: unknown;
}

function objectValue(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function contentText(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (!Array.isArray(value)) {
    return '';
  }
  const parts: string[] = [];
  for (const item of value) {
    if (typeof item === 'string') {
      parts.push(item);
      continue;
    }
    const block = objectValue(item);
    const text = stringValue(block?.text) ?? stringValue(block?.content);
    if (text !== null) {
      parts.push(text);
    }
  }
  return parts.join('\n');
}

/** 从 server_history_info.messages 的兼容 envelope 中读取完整 user 文本。 */
export function extractTraeUserEnvelope(raw: string | null): string | null {
  if (raw === null || raw === '') {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return raw.includes('<system-reminder') ? raw : null;
  }
  const record = objectValue(parsed);
  const messages = Array.isArray(record?.raw_messages)
    ? record.raw_messages
    : Array.isArray(parsed)
      ? parsed
      : record === null
        ? []
        : [record];
  const userParts: string[] = [];
  for (const value of messages) {
    const message = objectValue(value);
    if (stringValue(message?.role)?.toLowerCase() !== 'user') {
      continue;
    }
    const text = contentText(message?.content);
    if (text !== '') {
      userParts.push(text);
    }
  }
  const joined = userParts.join('\n');
  return joined.includes('<system-reminder') ? joined : null;
}

function categoryFor(content: string): PromptContextCategory {
  const text = content.toLowerCase();
  if (/\bterminal\b|\bshell\b|command status|command output/.test(text)) return 'terminal';
  if (/agents\.md|workspace rules?|project rules?|instructions for \/|repo(?:sitory)? rules?/.test(text)) {
    return 'workspace_rules';
  }
  if (/\benvironment\b|working directory|workspace folder|operating system|\bplatform\b/.test(text)) {
    return 'environment';
  }
  if (/\bskills?\b|<user_input>|user input/.test(text)) return 'skills';
  if (/\blanguage\b|respond in|reply in|locale/.test(text)) return 'language';
  if (/important instruction|\byou are\b|model instruction|must follow/.test(text)) {
    return 'instructions';
  }
  return 'other';
}

const CATEGORY_TITLES: Record<PromptContextCategory, string> = {
  terminal: 'Terminal state',
  workspace_rules: 'Workspace rules',
  environment: 'Environment',
  instructions: 'Important instructions',
  skills: 'Skills and user input',
  language: 'Language',
  other: 'Other context',
};

function parseSections(envelope: string): PromptContextSection[] {
  const matches = [...envelope.matchAll(/<system-reminder(?:\s[^>]*)?>([\s\S]*?)<\/system-reminder>/gi)];
  const firstByContent = new Map<string, string>();
  const sections: PromptContextSection[] = [];
  for (const match of matches) {
    const original = (match[1] ?? '').trim();
    if (original === '') {
      continue;
    }
    // 扫描后台不是请求热路径；禁止预算跳过后把原始 secret 写入派生 DB。
    const content = desensitizeChecked(original, {}, Number.POSITIVE_INFINITY).text;
    const normalized = content.replace(/\s+/g, ' ').trim();
    const id = `reminder-${sections.length + 1}`;
    const duplicateOf = firstByContent.get(normalized) ?? null;
    if (duplicateOf === null) {
      firstByContent.set(normalized, id);
    }
    const category = categoryFor(content);
    sections.push({
      id,
      category,
      title: CATEGORY_TITLES[category],
      content,
      chars: content.length,
      estimatedTokens: Math.ceil(content.length / 4),
      duplicateOf,
    });
  }
  return sections;
}

export function parseTraeModelConfig(
  turnContext: string | null,
  fallback: { agentType?: string; agentName?: string } = {},
): PromptModelConfig {
  let root: JsonRecord | null = null;
  if (turnContext !== null && turnContext !== '') {
    try {
      root = objectValue(JSON.parse(turnContext));
    } catch {
      root = null;
    }
  }
  const persisted = objectValue(root?.persist_user_message_context);
  const model = objectValue(persisted?.model_info);
  const extra = objectValue(model?.extra_config);
  const enabledFeatures = extra === null
    ? []
    : Object.entries(extra)
        .filter(([, value]) => value === true)
        .map(([key]) => key)
        .sort();
  return {
    modelName: stringValue(model?.model_name),
    configName: stringValue(model?.config_name),
    promptMaxTokens: numberValue(model?.prompt_max_tokens),
    maxOutputTokens: numberValue(model?.max_tokens),
    maxTurns: numberValue(model?.max_turn),
    isPreset: booleanValue(model?.is_preset),
    locale: stringValue(root?.locale),
    agentType: stringValue(fallback.agentType) ?? stringValue(persisted?.agent_type),
    agentName: stringValue(fallback.agentName) ?? stringValue(persisted?.agent_name),
    enabledFeatures,
  };
}

/** 数据库只能证明动态 reminder 与模型配置；完整静态 prompt 始终为 null。 */
export function buildTraePromptContextDraft(input: {
  userMessageRaw: string | null;
  turnContext: string | null;
  capturedAt: string;
  agentType?: string;
  agentName?: string;
}): TraePromptContextDraft | null {
  const envelope = extractTraeUserEnvelope(input.userMessageRaw);
  if (envelope === null) {
    return null;
  }
  const dynamicSections = parseSections(envelope);
  if (dynamicSections.length === 0) {
    return null;
  }
  const modelConfig = parseTraeModelConfig(input.turnContext, input);
  const totalChars = dynamicSections.reduce((sum, section) => sum + section.chars, 0);
  const estimatedTokens = Math.ceil(totalChars / 4);
  const duplicates = dynamicSections.filter((section) => section.duplicateOf !== null);
  return {
    source: 'trae_db',
    completeness: 'dynamic_only',
    capturedAt: input.capturedAt,
    dynamicSections,
    modelConfig,
    analysis: {
      totalChars,
      estimatedTokens,
      sectionCount: dynamicSections.length,
      uniqueSectionCount: dynamicSections.length - duplicates.length,
      duplicateSectionCount: duplicates.length,
      duplicateChars: duplicates.reduce((sum, section) => sum + section.chars, 0),
      contextWindowPercent:
        modelConfig.promptMaxTokens !== null && modelConfig.promptMaxTokens > 0
          ? (estimatedTokens / modelConfig.promptMaxTokens) * 100
          : null,
    },
    fullSystemPrompt: null,
  };
}
