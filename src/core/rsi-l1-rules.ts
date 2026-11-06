import type { RsiDiffFinding, RsiFingerprint, RsiFingerprintDictionary, RsiL1Config, RsiQuestionMetadata } from './rsi-types.js';
import { defaultRsiConfig } from './rsi-validation.js';

/** RSI-006.1: deliberately small, auditable stop dictionary; normalized below. */
export const RSI_COMMON_FINGERPRINTS = ['undefined', 'null', 'true', 'false', 'function', 'return', 'expected', 'actual',
  'test', 'tests', 'testing', 'testcase', 'assert', 'assertequal', 'assertequals', 'asserttrue', 'assertfalse',
  'readme', 'readmemd', 'packagejson', 'srcindexts', 'indexjs', 'indexts', 'indextsx',
  'mainpy', 'requirements', 'localhost', 'helloworld', 'error', 'exception', 'success', 'failure', 'password'] as const;
const normalize = (text: string): string => text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const common = new Set<string>(RSI_COMMON_FINGERPRINTS);
const ordered = (values: Iterable<string>): string[] => [...values].sort();

function validateConfig(c: RsiL1Config): void {
  for (const v of [c.maxDiffLines, c.maxDiffBytes, c.opaqueMinLength, c.minFingerprintLength]) {
    if (!Number.isSafeInteger(v) || v < 1) throw new Error('Invalid RSI L1 limit');
  }
  if (c.minFingerprintLength < 4 || !Number.isFinite(c.commonFingerprintRatio) || c.commonFingerprintRatio <= 0 || c.commonFingerprintRatio > 1) throw new Error('Invalid RSI fingerprint limit');
}
export function buildFingerprintDictionary(metadata: RsiQuestionMetadata[], config: RsiL1Config = defaultRsiConfig().l1): RsiFingerprintDictionary {
  validateConfig(config);
  const ids = new Set<string>();
  const values = new Map<string, { questions: Set<string>; kinds: Set<RsiFingerprint['kinds'][number]> }>();
  for (const question of metadata) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(question.questionId) || ids.has(question.questionId)) throw new Error('Invalid or duplicate RSI question ID');
    ids.add(question.questionId);
    const groups: [RsiFingerprint['kinds'][number], string[]][] = [
      ['questionId', [question.questionId]], ['repository', [question.repository]], ['testName', question.testNames],
      ['filePath', question.filePaths], ['rareString', question.rareStrings], ['expectedValue', question.expectedValues],
    ];
    for (const [kind, strings] of groups) for (const raw of strings) {
      if (typeof raw !== 'string') throw new Error('Invalid RSI fingerprint string');
      const value = normalize(raw);
      if (value.length < config.minFingerprintLength || /^\d+$/.test(value) || new Set(value).size <= 2 || common.has(value)) continue;
      const entry = values.get(value) ?? { questions: new Set<string>(), kinds: new Set<RsiFingerprint['kinds'][number]>() };
      entry.questions.add(question.questionId); entry.kinds.add(kind); values.set(value, entry);
    }
  }
  const entries: RsiFingerprint[] = [];
  for (const value of ordered(values.keys())) {
    const entry = values.get(value)!;
    if (ids.size >= 4 && entry.questions.size / ids.size >= config.commonFingerprintRatio) continue;
    entries.push({ value, questionIds: ordered(entry.questions), kinds: [...entry.kinds].sort() });
  }
  return { version: 1, config: { ...config }, entries };
}

function utf8Bytes(value: string): number {
  let count = 0;
  for (const c of value) { const n = c.codePointAt(0)!; count += n < 0x80 ? 1 : n < 0x800 ? 2 : n < 0x10000 ? 3 : 4; }
  return count;
}
function decodeUtf8(bytes: number[]): string | null {
  try { return decodeURIComponent(bytes.map(n => `%${n.toString(16).padStart(2, '0')}`).join('')); }
  catch { return null; }
}
function decodedLiterals(line: string): string[] {
  const decoded: string[] = [];
  for (const match of line.matchAll(/(?:^|[^A-Za-z0-9+/_-])([A-Za-z0-9+/_-]{32,}={0,2})(?=$|[^A-Za-z0-9+/_=-])/g)) {
    const token = match[1]!;
    const hex = token.replace(/^0x/i, '');
    if (/^[0-9a-f]+$/i.test(hex) && hex.length % 2 === 0) {
      const value = decodeUtf8(hex.match(/../g)!.map(n => Number.parseInt(n, 16)));
      if (value !== null) decoded.push(value);
    }
    if (token.length % 4 === 1) continue;
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let bits = 0, accumulator = 0; const bytes: number[] = [];
    for (const c of token.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '')) {
      const digit = alphabet.indexOf(c); if (digit < 0) continue;
      accumulator = (accumulator << 6) | digit; bits += 6;
      if (bits >= 8) { bits -= 8; bytes.push((accumulator >> bits) & 255); }
    }
    const value = decodeUtf8(bytes); if (value !== null) decoded.push(value);
  }
  return decoded;
}
function parsePath(raw: string): string | null {
  let path = raw.trim();
  if (path.startsWith('"')) {
    if (!path.endsWith('"')) return null;
    path = path.slice(1, -1).replace(/\\([0-7]{3}|["\\tnr])/g, (_m, escape: string) => {
      if (/^[0-7]{3}$/.test(escape)) return String.fromCharCode(Number.parseInt(escape, 8));
      return ({ t: '\t', n: '\n', r: '\r', '"': '"', '\\': '\\' } as Record<string, string>)[escape]!;
    });
  } else path = path.split('\t')[0]!;
  if (path === '/dev/null') return path;
  path = path.replace(/\\/g, '/').replace(/^[ab]\//, '');
  if (!path || path.startsWith('/') || /^[a-z]:/i.test(path) || path.split('/').some(p => p === '..' || p === '.') || [...path].some(c => c.codePointAt(0)! < 32)) return null;
  return path;
}
function protectedPath(path: string): boolean {
  return /(?:^|\/)(?:tests?|__tests__|evaluators?|graders?|detectors?|detection[-_]?rules|\.github|\.circleci|\.buildkite|ci)(?:\/|$)/i.test(path)
    || /(?:^|\/)(?:[^/]+\.(?:test|spec)\.[^/]+|test_[^/]+\.[^/]+|[^/]+_test\.[^/]+|(?:evaluator|grader|detector)\.[^/]+|rsi-l1-rules\.[^/]+|\.(?:gitlab-ci|travis)\.ya?ml|Jenkinsfile|azure-pipelines\.ya?ml)$/i.test(path);
}
function dependencyPath(path: string): boolean {
  return /(?:^|\/)patches\//i.test(path) || /(?:^|\/)(?:\.npmrc|bunfig\.toml)$/i.test(path)
    || /(?:^|\/)(?:[^/]*lock(?:b|\.json|\.yaml|\.yml|\.toml)?|package(?:-lock)?\.json|npm-shrinkwrap\.json|requirements[^/]*\.txt|pyproject\.toml|Pipfile|Cargo\.toml|go\.(?:mod|sum)|Gemfile|composer\.json|pom\.xml|build\.gradle(?:\.kts)?)$/i.test(path);
}

export function scanDiff(diff: string, dictionary: RsiFingerprintDictionary): RsiDiffFinding[] {
  validateConfig(dictionary.config);
  if (dictionary.version !== 1 || dictionary.entries.some(e => !e.value || e.value !== normalize(e.value))) throw new Error('Invalid RSI dictionary');
  const findings: RsiDiffFinding[] = []; const seen = new Set<string>();
  const add = (category: RsiDiffFinding['category'], severity: 'reject' | 'hold', file: string, line: number, evidence: string): void => {
    const key = JSON.stringify([category, file, line]); if (seen.has(key)) return;
    seen.add(key); findings.push({ category, severity, file, line, evidence: evidence.slice(0, 160) });
  };
  if (utf8Bytes(diff) > dictionary.config.maxDiffBytes) {
    add('diff_too_large', 'reject', '', 0, 'Diff byte budget exceeded'); return findings;
  }
  let file = '', nextLine = 0, inHunk = false, changed = 0;
  const inspectPath = (raw: string): string => {
    const parsed = parsePath(raw);
    if (parsed === null) { add('protected_path', 'reject', raw.slice(0, 160), 0, 'Untrusted diff path'); return ''; }
    if (parsed === '/dev/null') return '';
    if (protectedPath(parsed)) add('protected_path', 'reject', parsed, 0, 'Protected test/evaluator/detector/CI path');
    if (dependencyPath(parsed)) add('dependency_change', 'hold', parsed, 0, 'Dependency manifest or lockfile requires review');
    return parsed;
  };
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      inHunk = false; nextLine = 0;
      const paths = line.slice(11).match(/"(?:\\.|[^"\\])*"|\S+/g);
      if (!paths || paths.length !== 2) { add('protected_path', 'reject', '', 0, 'Unparseable Git paths'); file = ''; }
      else { inspectPath(paths[0]!); file = inspectPath(paths[1]!); }
      continue;
    }
    if (!inHunk && /^(?:---|\+\+\+) /.test(line)) { const path = inspectPath(line.slice(4)); if (line.startsWith('+++') && path) file = path; continue; }
    if (!inHunk && /^(?:rename|copy) (?:from|to) /.test(line)) { const path = inspectPath(line.replace(/^(?:rename|copy) (?:from|to) /, '')); if (/ to /.test(line) && path) file = path; continue; }
    if (/^(?:old mode|new mode|new file mode|deleted file mode) /.test(line)) {
      if (/ (?:120000|160000)$/.test(line)) add('symbolic_link', 'reject', file, 0, 'Symbolic link or gitlink mode');
      if (/^(?:old mode|new mode) /.test(line)) add('file_mode_change', 'hold', file, 0, 'File mode changed');
      continue;
    }
    // Editing an existing symlink or gitlink has no mode line, only this index line.
    if (!inHunk && /^index [0-9a-f]+\.\.[0-9a-f]+ (?:120000|160000)$/.test(line)) {
      add('symbolic_link', 'reject', file, 0, 'Symbolic link or gitlink mode');
      continue;
    }
    if (line === 'GIT binary patch' || /^Binary files .+ differ$/.test(line)) { add('binary_file', 'reject', file, 0, 'Binary diff'); continue; }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) { inHunk = true; nextLine = Number(hunk[1]); continue; }
    if (!inHunk) continue;
    if (line.startsWith('-')) { changed++; continue; }
    if (line.startsWith(' ')) { nextLine++; continue; }
    if (!line.startsWith('+')) continue;
    changed++;
    if (!file) add('protected_path', 'reject', '', 0, 'Added content without a trusted path');
    // Preserve literal-concatenation boundaries; normalize punctuation inside
    // intact data exactly as the dictionary does, without evaluating code.
    const content = line.slice(1), normalized = [content, ...decodedLiterals(content)]
      .flatMap(value => value.split(/["'`]\s*\+\s*["'`]/).map(normalize));
    for (const entry of dictionary.entries) if (normalized.some(value => value.includes(entry.value))) {
      add('task_fingerprint', 'reject', file, nextLine, `Matched ${entry.kinds.join(',')}: ${entry.value}`);
    }
    const chunks = content.match(/[A-Za-z0-9+/_=-]+/g) ?? [];
    if (chunks.some(chunk => chunk.length >= dictionary.config.opaqueMinLength)) add('opaque_blob', 'reject', file, nextLine, 'Opaque contiguous data literal');
    nextLine++;
  }
  if (changed > dictionary.config.maxDiffLines) add('diff_too_large', 'reject', '', 0, 'Diff changed-line budget exceeded');
  return findings;
}
