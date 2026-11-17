// External question banks and calibration corpora are supplied separately.
export const rsiPackageAssets = [
  'bin/rsi.js',
  'bin/task-health.js',
  'rsi-agents/mini-agent/profile.json',
  'rsi-agents/mini-agent/target.Dockerfile',
  'rsi-agents/mini-agent/demo-source/agent.mjs',
  'rsi-agents/mini-agent/demo-source/package.json',
  'rsi-agents/mini-agent/source/agent.mjs',
  'rsi-agents/mini-agent/source/package.json',
  'rsi-agents/opencode/profile.json',
  'rsi-agents/opencode/profile.deepseek.json',
  'rsi-agents/opencode/target.Dockerfile',
  ...['claude-code', 'codex', 'opencode-deepseek', 'scripted'].flatMap(id =>
    ['profile.json', 'Dockerfile'].map(file => `rsi-agents/optimizers/${id}/${file}`)),
  ...['evaluator.Dockerfile', 'proxy.Dockerfile', 'mock-model.mjs', 'model-proxy.mjs', 'protocol.mjs', 'sidecar.mjs', 'trace.mjs']
    .map(file => `scripts/rsi-images/${file}`),
  ...['go.mjs', 'node.mjs', 'unittest.py'].map(file => `server/rsi/reporters/${file}`),
  'scripts/codex-health-proxy.mjs',
  'scripts/claude-monitor-proxy.mjs',
];

export const requiredBuildFiles = [
  'dist/index.html',
  ...['agent-folding', 'benchmark', 'capture-worker', 'cli', 'codex-worker', 'rsi', 'task-health/cli', 'team-experiment', 'telemetry-worker', 'trace-import-worker']
    .map(entry => `server-dist/${entry}.js`),
];

const privateDirectory = /^(?:\.git|\.aws|\.claude|\.codex|\.ssh|\.http-mitm-proxy|node_modules|rsi-bank(?:-hard)?|hidden_tests|private|awesome-telemetry-data|agent-observe-data|captured-prompts|captures|capture-bodies|proxy-ca|proxy-certs)$/i;
const privateFile = /^(?:\.env(?:\..*)?|\.npmrc|credentials(?:\..*)?|reference\.patch)$|\.(?:db|sqlite3?)(?:[-.].*)?$|\.(?:key|pem|p12|pfx|log|map)$/i;

export function excludedPackagePath(path) {
  return path.startsWith('/') || /[\\\0\r\n]/.test(path)
    || path.split('/').some(part => part === '.' || part === '..' || privateDirectory.test(part) || privateFile.test(part))
    || (path.startsWith('data/') && path !== 'data/agent-folding' && !path.startsWith('data/agent-folding/'));
}
