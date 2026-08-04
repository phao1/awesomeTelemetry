import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, sep } from 'node:path';

import type {
  LocalSessionConfig,
  ProviderConfig,
  ProviderKey,
} from '../src/core/trace-types.js';

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
        path: join(process.env.APPDATA ?? '%APPDATA%', 'Trae CN', 'ModularData', 'ai-agent'),
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
      mergeProvider(defaults.providers[key]!, project?.providers[key]),
      user?.providers[key],
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

/** REQ-004：写入用户配置 MUST 原子写（tmp + rename，G2.3）。 */
export function saveUserConfig(config: LocalSessionConfig, targetPath?: string): void {
  const target = targetPath ?? defaultUserConfigPath();
  mkdirSync(dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(config, null, 2), 'utf8');
  renameSync(tmp, target);
}
