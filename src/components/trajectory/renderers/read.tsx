import {
  limitLines,
  tryParseJson,
  type ToolRenderer,
  type ToolRenderResult,
  withinCharBound,
} from './index.js';

/**
 * `read` renderer (task 7.3 / design D11): arguments render the path with a
 * muted directory and an emphasised basename plus an extension-derived
 * language label; the result renders as a fenced code block with line
 * numbers. Unparseable input returns `{ kind: 'fallback' }` and the
 * RENDER_MAX_CHARS bound is enforced before parsing.
 */

const EXTENSION_LANGUAGE: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  go: 'go',
  rs: 'rust',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  hpp: 'cpp',
  cc: 'cpp',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  md: 'markdown',
  css: 'css',
  scss: 'scss',
  html: 'html',
  htm: 'html',
  xml: 'xml',
  sql: 'sql',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  fish: 'bash',
  txt: 'text',
};

export function languageFromPath(path: string): string | null {
  const basename = path.split('/').pop() ?? path;
  const dot = basename.lastIndexOf('.');
  if (dot <= 0 || dot === basename.length - 1) {
    return null;
  }
  const ext = basename.slice(dot + 1).toLowerCase();
  return EXTENSION_LANGUAGE[ext] ?? null;
}

function splitPath(path: string): { dir: string; base: string } {
  const index = path.lastIndexOf('/');
  if (index < 0) {
    return { dir: '', base: path };
  }
  return { dir: path.slice(0, index), base: path.slice(index + 1) };
}

interface ParsedReadArgs {
  path: string | null;
  offset: number | null;
  limit: number | null;
}

function parseReadArgs(text: string): ParsedReadArgs {
  const value = tryParseJson(text);
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    const path =
      typeof record.file_path === 'string' && record.file_path.trim() !== ''
        ? record.file_path
        : typeof record.path === 'string' && record.path.trim() !== ''
          ? record.path
          : null;
    if (path === null) {
      return { path: null, offset: null, limit: null };
    }
    return {
      path,
      offset: typeof record.offset === 'number' ? record.offset : null,
      limit: typeof record.limit === 'number' ? record.limit : null,
    };
  }
  // Some sources pass the bare path instead of a JSON object.
  const trimmed = text.trim();
  if (trimmed !== '' && !trimmed.includes('\n')) {
    return { path: trimmed, offset: null, limit: null };
  }
  return { path: null, offset: null, limit: null };
}

function PathRow({ path, offset, limit }: { path: string; offset: number | null; limit: number | null }): React.JSX.Element {
  const { dir, base } = splitPath(path);
  const language = languageFromPath(path);
  return (
    <div
      className="tr-renderer-read-path"
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 'var(--space-2)',
        flexWrap: 'wrap',
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--text-sm)',
      }}
    >
      <span style={{ color: 'var(--fg-muted)' }}>{dir === '' ? '' : `${dir}/`}</span>
      <span style={{ color: 'var(--fg-default)', fontWeight: 'var(--weight-semibold)' }}>{base}</span>
      {language !== null && (
        <span
          style={{
            color: 'var(--accent-fg)',
            background: 'var(--accent-subtle)',
            borderRadius: 'var(--radius-sm)',
            padding: '0 var(--space-1)',
            fontSize: 'var(--text-xs)',
          }}
        >
          {language}
        </span>
      )}
      {(offset !== null || limit !== null) && (
        <span style={{ color: 'var(--fg-subtle)', fontSize: 'var(--text-xs)' }}>
          {offset !== null ? `offset ${offset}` : ''}
          {offset !== null && limit !== null ? ' · ' : ''}
          {limit !== null ? `limit ${limit}` : ''}
        </span>
      )}
    </div>
  );
}

/** Line-numbered fenced code block. */
function ReadResultBlock({ text }: { text: string }): React.JSX.Element {
  const rawLines = text.replace(/\n$/, '').split('\n');
  const { lines, omitted } = limitLines(rawLines);
  const numbered = lines.map((line, index) => {
    const match = /^(\d+)\t(.*)$/.exec(line);
    if (match !== null) {
      return `${match[1]}\t${match[2]}`;
    }
    return `${index + 1}\t${line}`;
  });
  return (
    <div>
      <pre
        className="tr-renderer-read-result"
        style={{
          margin: '0',
          padding: 'var(--space-2)',
          background: 'var(--canvas-inset)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-md)',
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-sm)',
          overflowX: 'auto',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          tabSize: 2,
        }}
      >
        {numbered.join('\n')}
      </pre>
      {omitted > 0 && (
        <div style={{ color: 'var(--fg-subtle)', fontSize: 'var(--text-xs)', paddingTop: 'var(--space-1)' }}>
          … +{omitted} more lines
        </div>
      )}
    </div>
  );
}

export function renderReadArguments(text: string): ToolRenderResult {
  if (!withinCharBound(text)) {
    return { kind: 'fallback' };
  }
  const { path, offset, limit } = parseReadArgs(text);
  if (path === null) {
    return { kind: 'fallback' };
  }
  return { kind: 'ok', node: <PathRow path={path} offset={offset} limit={limit} /> };
}

export function renderReadResult(text: string): ToolRenderResult {
  if (!withinCharBound(text)) {
    return { kind: 'fallback' };
  }
  return { kind: 'ok', node: <ReadResultBlock text={text} /> };
}

export const readRenderer: ToolRenderer = {
  tool: 'read',
  renderArguments: renderReadArguments,
  renderResult: renderReadResult,
};
