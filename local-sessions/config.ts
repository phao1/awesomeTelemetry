import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, sep } from 'node:path';

import type {
  LocalSessionConfig,
  ProviderConfig,
  ProviderKey,
} from '../src/core/trace-types.js';
import type { ModelPrice } from '../src/core/pricing.js';

/** REQ-005 / G2.2：三种路径展开语法：~、~\、%VAR%。 */
export function expandLocalSessionPath(raw: string): string {
  let out = raw.replace(/%([^%]+)%/g, (match, name: string) => process.env[name] ?? match);
  if (out.startsWith('~\\')) {
    out = homedir() + sep + out.slice(2).replace(/\\/g, sep);
  } else if (out === '~' || out.startsWith('~/')) {
    out = homedir() + out.slice(1);
  }
  return out;
}

/** REQ-006：默认路径（env 优先），按表逐字实现。 */
function defaultProvider(key: ProviderKey): ProviderConfig {
  const base = {
    key,
    enabled: true,
    label: '',
    pollIntervalMs: 0,
  };
  switch (key) {
    case 'claude':
      return {
        ...base,
        enabled: true,
        label: 'Claude Code',
        path: process.env.CLAUDE_CONFIG_DIR
          ? join(process.env.CLAUDE_CONFIG_DIR, 'projects')
          : '~/.claude/projects',
        sourceKind: 'jsonl',
        watchStrategy: 'chokidar',
      };
    case 'codex':
      return {
        ...base,
        label: 'Codex',
        path: process.env.CODEX_HOME ? join(process.env.CODEX_HOME, 'sessions') : '~/.codex/sessions',
        sourceKind: 'jsonl',
        watchStrategy: 'chokidar',
      };
    case 'opencode':
      return {
        ...base,
        label: 'OpenCode',
        path:
          process.platform === 'win32'
            ? join(process.env.APPDATA ?? '%APPDATA%', 'opencode')
            : '~/.local/share/opencode',
        sourceKind: 'sqlite',
        watchStrategy: 'poll',
        pollIntervalMs: 30000,
      };
    case 'codearts':
      return {
        ...base,
        label: 'CodeArts',
        path: process.env.CODEARTS_HOME
          ? process.env.CODEARTS_HOME
          : '~/.codeartsdoer/codearts-data',
        sourceKind: 'sqlite',
        watchStrategy: 'poll',
        pollIntervalMs: 30000,
      };
    case 'codeagent':
      return {
        ...base,
        label: 'CodeAgent 3.0',
        path: process.env.CAC_HOME ? join(process.env.CAC_HOME, 'projects') : '~/.cac/projects',
        sourceKind: 'jsonl',
        watchStrategy: 'chokidar',
      };
    case 'codeagent2':
      return {
        ...base,
        label: 'CodeAgent 2.0',
        path: '~/.local/share/codemate',
        sourceKind: 'sqlite',
        watchStrategy: 'poll',
        pollIntervalMs: 30000,
      };
    case 'trae':
      return {
        ...base,
        label: 'Trae CN',
        path:
          process.platform === 'darwin'
            ? join(
                process.env.HOME ?? '~',
                'Library',
                'Application Support',
                'Trae CN',
                'ModularData',
                'ai-agent',
              )
            : join(process.env.APPDATA ?? '%APPDATA%', 'Trae CN', 'ModularData', 'ai-agent'),
        sourceKind: 'sqlcipher',
        watchStrategy: 'poll',
        pollIntervalMs: 30000,
      };
    case 'qoder':
      return {
        ...base,
        enabled: false, // REQ-006：qoder 默认禁用
        label: 'Qoder',
        path: '~/.qoder',
        sourceKind: 'jsonl',
        watchStrategy: 'chokidar',
      };
    case 'workbuddy':
      return {
        ...base,
        label: 'WorkBuddy',
        path: process.env.WORKBUDDY_HOME
          ? join(process.env.WORKBUDDY_HOME, 'projects')
          : '~/.workbuddy/projects',
        sourceKind: 'jsonl',
        watchStrategy: 'chokidar',
      };
  }
}

export const DEFAULT_LOCAL_SESSION_CONFIG: LocalSessionConfig = {
  prewarmRecent: 0,
  traeKeyPath: null,
  providers: {
    claude: defaultProvider('claude'),
    codex: defaultProvider('codex'),
    opencode: defaultProvider('opencode'),
    codearts: defaultProvider('codearts'),
    codeagent: defaultProvider('codeagent'),
    codeagent2: defaultProvider('codeagent2'),
    trae: defaultProvider('trae'),
    qoder: defaultProvider('qoder'),
    workbuddy: defaultProvider('workbuddy'),
  },
};

export function defaultUserConfigPath(): string {
  if (process.platform === 'win32') {
    return join(process.env.APPDATA ?? homedir(), 'agent-observe', 'agent-observe.json');
  }
  const xdg = process.env.XDG_CONFIG_HOME;
  const root = xdg !== undefined && xdg !== '' ? xdg : join(homedir(), '.config');
  return join(root, 'agent-observe', 'agent-observe.json');
}

function readJsonIfExists(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) {
    return null;
  }
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

function mergeProvider(base: ProviderConfig, overlay?: Partial<ProviderConfig>): ProviderConfig {
  if (overlay === undefined) {
    return base;
  }
  return { ...base, ...overlay, key: base.key };
}

/** REQ-004：内置默认 → 项目配置 → 用户配置，后者覆盖前者。 */
export function mergeLocalSessionConfig(
  defaults: LocalSessionConfig,
  project?: LocalSessionConfig | null,
  user?: LocalSessionConfig | null,
): LocalSessionConfig {
  const providers = {} as Record<ProviderKey, ProviderConfig>;
  for (const key of Object.keys(defaults.providers) as ProviderKey[]) {
    providers[key] = mergeProvider(
      mergeProvider(defaults.providers[key]!, project?.providers?.[key]),
      user?.providers?.[key],
    );
  }
  return {
    prewarmRecent: user?.prewarmRecent ?? project?.prewarmRecent ?? defaults.prewarmRecent,
    traeKeyPath: user?.traeKeyPath ?? project?.traeKeyPath ?? defaults.traeKeyPath,
    providers,
  };
}

export interface LoadConfigOptions {
  projectConfigPath?: string;
  userConfigPath?: string;
}

export function loadLocalSessionConfig(opts: LoadConfigOptions = {}): LocalSessionConfig {
  const projectPath =
    opts.projectConfigPath ?? join(process.cwd(), 'config', 'local-sessions.local.json');
  const userPath = opts.userConfigPath ?? defaultUserConfigPath();
  return mergeLocalSessionConfig(
    DEFAULT_LOCAL_SESSION_CONFIG,
    readJsonIfExists(projectPath) as LocalSessionConfig | null,
    readJsonIfExists(userPath) as LocalSessionConfig | null,
  );
}

/**
 * G2.3 三层覆盖：内置默认（pricing.ts）→ 项目级 `config/model-pricing.json`
 * → 用户级 `<configDir>/model-pricing.json`。后写覆盖先写；`_` 开头的元数据
 * 键（如 example 的 `_comment`）被过滤，缺 `source` 的条目被忽略。
 */
export function loadModelPricingOverrides(configRoot = process.cwd()): Record<string, ModelPrice> {
  const projectPath = join(configRoot, 'config', 'model-pricing.json');
  const userPath = join(dirname(defaultUserConfigPath()), 'model-pricing.json');
  const project = readJsonIfExists(projectPath) as Record<string, unknown> | null;
  const user = readJsonIfExists(userPath) as Record<string, unknown> | null;
  const merged: Record<string, ModelPrice> = {};
  for (const layer of [project, user]) {
    if (layer === null) {
      continue;
    }
    for (const [key, value] of Object.entries(layer)) {
      if (key.startsWith('_')) {
        continue;
      }
      if (typeof value === 'object' && value !== null && typeof (value as ModelPrice).source === 'string') {
        const price = value as ModelPrice;
        // currency 是手写 JSON，拼错了不能让它一路流到 CURRENCY_SYMBOL 查表变 undefined；
        // 认不出的值按缺省 USD 处理（价格数字照用，只是符号退回 $）。
        merged[key] =
          price.currency === 'CNY' || price.currency === 'USD'
            ? price
            : { ...price, currency: 'USD' };
      }
    }
  }
  return merged;
}

/** REQ-004：写入用户配置 MUST 原子写（tmp + rename，G2.3）。 */
export function saveUserConfig(config: LocalSessionConfig, targetPath?: string): void {
  const target = targetPath ?? defaultUserConfigPath();
  mkdirSync(dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(config, null, 2), 'utf8');
  renameSync(tmp, target);
}

// ══════════════════════════════════════════════════════════════════════════
// §4.15 team 源默认配置（自动发现，无需手动配置）。
//
// CodeArts agent-team 目录：~/.codeartsdoer/agent-team/（contact.json +
// team-task.json + 可选 opencode.db）。Codex sessions 目录：~/.codex/sessions/
// （fork 森林分组为 runs）。两者均通过 expandLocalSessionPath 展开 ~ 语法。
// ══════════════════════════════════════════════════════════════════════════

/** CodeArts agent-team 默认根目录（~/.codeartsdoer/agent-team）。 */
export function defaultCodeArtsAgentTeamRoot(): string {
  return process.env.CODEARTS_AGENT_TEAM_HOME
    ? process.env.CODEARTS_AGENT_TEAM_HOME
    : '~/.codeartsdoer/agent-team';
}

/** CodeArts opencode.db 默认路径（~/.codeartsdoer/codearts-data/opencode.db）。 */
export function defaultCodeArtsOpencodeDb(): string {
  return process.env.CODEARTS_HOME
    ? join(process.env.CODEARTS_HOME, 'opencode.db')
    : '~/.codeartsdoer/codearts-data/opencode.db';
}

/** Codex sessions 默认目录（~/.codex/sessions）。 */
export function defaultCodexSessionsRoot(): string {
  return process.env.CODEX_HOME
    ? join(process.env.CODEX_HOME, 'sessions')
    : '~/.codex/sessions';
}

/**
 * §4.15 默认 team 源配置（自动发现，无需手动配置）。
 * 返回 CodeArts + Codex 两个源的默认配置。调用方按需过滤掉不存在的路径。
 */
export function defaultTeamSources(): Array<{
  provider: 'codearts' | 'codex';
  root: string;
  auxiliary?: string[];
}> {
  return [
    {
      provider: 'codearts',
      root: defaultCodeArtsAgentTeamRoot(),
      auxiliary: [defaultCodeArtsOpencodeDb()],
    },
    {
      provider: 'codex',
      root: defaultCodexSessionsRoot(),
    },
  ];
}
