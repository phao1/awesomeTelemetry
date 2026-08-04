/** REQ-001：10 条内置规则。G11.13：所有模式避免嵌套量词。 */
export interface DesensitizationRule {
  id: string;
  pattern: RegExp;
  replacement: string;
  /** aws_secret_key 默认禁用（G8.2，40 字符 base64 误报多）。 */
  enabled: boolean;
}

export const DEFAULT_RULES: readonly DesensitizationRule[] = [
  {
    id: 'api_key',
    pattern: /sk-[a-zA-Z0-9]{20,}/g,
    replacement: 'sk-***',
    enabled: true,
  },
  {
    id: 'api_key_generic',
    pattern: /key-[a-zA-Z0-9]{20,}/g,
    replacement: 'key-***',
    enabled: true,
  },
  {
    id: 'bearer_token',
    pattern: /Bearer\s+\S+/g,
    replacement: 'Bearer ***',
    enabled: true,
  },
  {
    id: 'email',
    pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    replacement: 'u***@e***.c***',
    enabled: true,
  },
  {
    id: 'ip_address',
    pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    replacement: '***.***.***.***',
    enabled: true,
  },
  {
    id: 'file_path_win',
    pattern: /\b[A-Z]:\\[^\s"'<>|]+/g,
    replacement: 'C:\\***',
    enabled: true,
  },
  {
    id: 'file_path_unix',
    pattern: /\/(?:home|Users|root)\/[^\s"'<>|]+/g,
    replacement: '/home/***',
    enabled: true,
  },
  {
    id: 'aws_access_key',
    pattern: /\bAKIA[A-Z0-9]{16}\b/g,
    replacement: 'AKIA***',
    enabled: true,
  },
  {
    id: 'aws_secret_key',
    pattern: /\b[A-Za-z0-9+/]{40}\b/g,
    replacement: '***',
    enabled: false,
  },
  {
    id: 'private_key',
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replacement: '***PRIVATE KEY REDACTED***',
    enabled: true,
  },
];

export interface RulesOverride {
  enabled?: string[];
  disabled?: string[];
}

/** REQ-004：合并内置默认与用户覆盖。 */
export function resolveRules(opts: RulesOverride = {}): DesensitizationRule[] {
  return DEFAULT_RULES.map((rule) => {
    let enabled = rule.enabled;
    if (opts.disabled?.includes(rule.id)) {
      enabled = false;
    }
    if (opts.enabled?.includes(rule.id)) {
      enabled = true;
    }
    return { ...rule, enabled };
  });
}
