import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, cp } from 'node:fs/promises';
import { dirname, join, posix } from 'node:path';
import { tmpdir } from 'node:os';
import type { RsiFingerprintDictionary } from '../../src/core/rsi-types.js';
import { scanDiff } from '../../src/core/rsi-l1-rules.js';
import type { DockerClient, CommandOptions } from './docker.js';
import { mustDocker, runProcess, successful, RSI_LABEL } from './docker.js';
import { extractFiles, privateWrite, relativePath, treeFiles } from './artifacts.js';
import type { RsiBankToolchain } from './bank.js';

const gitOptions = ['-c', 'core.hooksPath=/dev/null', '-c', 'protocol.file.allow=always'];
export async function git(argv: string[], options: CommandOptions = {}): Promise<Buffer> {
  const r = await runProcess('git', [...gitOptions, ...argv], { ...options, env: { PATH: process.env.PATH,
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' } });
  if (!successful(r)) throw new Error('Trusted Git operation failed');
  return r.stdout;
}
export async function createMirror(repository: string, mirror: string): Promise<void> {
  // No hard links to an optimizer-owned object database; never run checkout/hooks.
  await git(['clone', '--bare', '--no-hardlinks', '--', repository, mirror]);
  await git(['--git-dir', mirror, 'config', 'core.hooksPath', '/dev/null']);
}
export async function importCommit(repository: string, mirror: string, commit: string): Promise<void> {
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit)) throw new Error('Full commit required');
  await git(['--git-dir', mirror, 'fetch', '--no-tags', '--no-recurse-submodules', '--', repository, commit]);
  const found = (await git(['--git-dir', mirror, 'rev-parse', '--verify', `${commit}^{commit}`])).toString().trim();
  if (found !== commit) throw new Error('Candidate is not an exact commit');
}
export async function candidateDiff(mirror: string, parent: string, commit: string): Promise<string> {
  return (await git(['--git-dir', mirror, 'diff', '--no-ext-diff', '--no-textconv', '--binary', parent, commit, '--'])).toString('utf8');
}
export function precheck(diff: string, dictionary: RsiFingerprintDictionary): ReturnType<typeof scanDiff> { return scanDiff(diff, dictionary); }

/** Only dependency inputs enter the networked layer. No candidate registry config. */
export async function dependencyInputs(source: string, deps: string): Promise<string> {
  const files = await treeFiles(source), allowed = new Set<string>();
  const root = JSON.parse(await readFile(join(source, 'package.json'), 'utf8')) as { workspaces?: string[] | { packages: string[] } };
  const patterns = Array.isArray(root.workspaces) ? root.workspaces : root.workspaces?.packages ?? [];
  if (!Array.isArray(patterns) || patterns.some(p => typeof p !== 'string')) throw new Error('Invalid workspace manifests');
  const escape = (s: string): string => s.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const matchers = patterns.map(pattern => {
    relativePath(pattern);
    return new RegExp(`^${pattern.split('/').map(part => part === '**' ? '.*' : part.split('*').map(escape).join('[^/]*')).join('/')}$`);
  });
  const workspaceDirs = new Set(files.filter(f => f.endsWith('/package.json') && matchers.some(re => re.test(dirname(f)))).map(f => dirname(f)));
  for (const file of files) {
    const dir = dirname(file), leaf = posix.basename(file);
    if (file === 'package.json' || leaf === 'package.json' && workspaceDirs.has(dir)
      || /^(?:bun.lockb?|package-lock.json|npm-shrinkwrap.json|pnpm-lock.yaml|yarn.lock)$/.test(leaf) && (dir === '.' || workspaceDirs.has(dir))) allowed.add(file);
  }
  const allowPatch = (file: string, raw: string): void => {
    relativePath(raw);
    const patch = posix.join(dirname(file), raw);
    if (!patch.split('/').includes('patches') || !files.includes(patch)
      || ['.npmrc', 'bunfig.toml'].includes(posix.basename(patch))) throw new Error('Invalid dependency patch input');
    allowed.add(patch);
  };
  for (const file of [...allowed].filter(f => f.endsWith('package.json'))) {
    const p = JSON.parse(await readFile(join(source, file), 'utf8')) as { patchedDependencies?: Record<string, string> };
    for (const raw of Object.values(p.patchedDependencies ?? {})) allowPatch(file, raw);
  }
  // Bun's text lock is JSONC. Decode quoted string tokens without evaluating
  // comments/expressions, including paths retained only in the frozen lock.
  for (const file of [...allowed].filter(f => posix.basename(f) === 'bun.lock')) {
    const lock = await readFile(join(source, file), 'utf8');
    for (const token of lock.matchAll(/"(?:\\.|[^"\\])*"/g)) {
      const value = JSON.parse(token[0]) as string;
      if (value.startsWith('patches/') || value.includes('/patches/')) allowPatch(file, value);
    }
  }
  const hash = createHash('sha256');
  for (const file of [...allowed].sort()) {
    const data = await readFile(join(source, file)); hash.update(file); hash.update('\0'); hash.update(data);
    await privateWrite(join(deps, file), data);
  }
  if (!allowed.has('package.json') || !allowed.has('bun.lock')) throw new Error('OpenCode requires package.json and bun.lock');
  return hash.digest('hex');
}
export interface BuiltCandidate { images: Record<RsiBankToolchain, string>; packageSha256: string; dependencyHash: string }
export class BuildRejected extends Error {
  constructor() { super('Candidate offline compilation failed'); }
}
export function isCandidateCompileFailure(result: Awaited<ReturnType<DockerClient['run']>>): boolean {
  const output = Buffer.concat([result.stdout, result.stderr]).toString();
  return result.code === 1 && !result.timedOut && !result.cancelled && !result.overflow
    && !/EACCES|ENOSPC|permission denied|input\/output error|no space left|network is unreachable/i.test(output)
    && /SyntaxError|syntax error|parse error|Could not resolve|Cannot find (?:module|package)|Unexpected token|TypeScript error/i.test(output);
}
export async function buildCandidate(client: DockerClient, taskId: string, mirror: string, commit: string,
  imagesRoot: string, signal?: AbortSignal): Promise<BuiltCandidate> {
  const context = await mkdtemp(join(tmpdir(), 'rsi-build-'));
  try {
    const archive = await git(['--git-dir', mirror, 'archive', '--format=tar', commit], { signal, maxOutputBytes: 256 * 1024 * 1024 });
    const source = join(context, 'source'); await mkdir(source);
    await extractFiles(archive, source, true);
    const dependencyHash = await dependencyInputs(source, join(context, 'deps'));
    await cp(join(imagesRoot, 'target.Dockerfile'), join(context, 'Dockerfile'));
    const images = {} as Record<RsiBankToolchain, string>;
    for (const toolchain of ['node', 'python', 'go'] as const) {
      const tag = `rsi-${createHash('sha256').update(taskId).digest('hex').slice(0, 16)}:${commit}-${toolchain}`;
      const result = await client.run(['build', '--label', `${RSI_LABEL}=${taskId}`, '--label', `rsi.commit=${commit}`,
        '--target', `target-${toolchain}`, '-t', tag, context], { timeoutMs: 45 * 60_000, maxOutputBytes: 16 * 1024 * 1024, signal });
      await privateWrite(join(dirname(mirror), 'build', `${commit}-${toolchain}.log`), Buffer.concat([result.stdout, result.stderr]));
      if (!successful(result)) {
        if (isCandidateCompileFailure(result)) throw new BuildRejected();
        throw new Error('Docker build infrastructure failed; inspect private build log');
      }
      images[toolchain] = tag;
    }
    return { images, packageSha256: createHash('sha256').update(archive).digest('hex'), dependencyHash };
  } finally { await rm(context, { recursive: true, force: true }); }
}
export async function pruneImages(client: DockerClient, taskId: string, keepCommits: string[], keepRecent = 2): Promise<void> {
  const rows = (await mustDocker(client, ['image', 'ls', '--filter', `label=${RSI_LABEL}=${taskId}`, '--format', '{{.ID}} {{.Tag}} {{.Repository}}:{{.Tag}}'])).toString().trim().split('\n').filter(Boolean);
  const recent = new Set(rows.map(r => r.split(' ')[1]!.split('-')[0]!).filter(c => !keepCommits.includes(c)).slice(0, keepRecent * 3));
  for (const row of rows) {
    const [id, tag, reference] = row.split(' '), commit = tag?.split('-')[0];
    if (id && commit && !keepCommits.includes(commit) && !recent.has(commit)) await mustDocker(client, ['image', 'rm', tag === '<none>' ? id : reference!]);
  }
  // BuildKit cache is separate from images; cap it for the 30GB VM.
  await mustDocker(client, ['builder', 'prune', '-f', '--keep-storage', '6GB'], { timeoutMs: 120_000 });
}
