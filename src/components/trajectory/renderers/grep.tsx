import {
  limitLines,
  tryParseJson,
  type ToolRenderer,
  type ToolRenderResult,
  withinCharBound,
} from './index.js';

/**
 * `grep` renderer (task 7.6 / design D11): arguments render the pattern and
 * path; the result renders rows of path, line, and matched content. Matches
 * are marked structurally — the path and line number form a distinct,
 * colour-independent prefix per row — never by highlight colour alone.
 */

interface ParsedGrepArgs {
  pattern: string | null;
  path: string | null;
}

function parseGrepArgs(text: string): ParsedGrepArgs {
  const value = tryParseJson(text);
  if (typeof value !== 'object' || value === null) {
    return { pattern: null, path: null };
  }
  const record = value as Record<string, unknown>;
  const pattern =
    typeof record.pattern === 'string' && record.pattern.trim() !== '' ? record.pattern : null;
  const path =
    typeof record.path === 'string' && record.path.trim() !== '' ? record.path : null;
  return { pattern, path };
}

function GrepArgs({ pattern, path }: { pattern: string; path: string | null }): React.JSX.Element {
  return (
    <div
      className="tr-renderer-grep-args"
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 'var(--space-2)',
        flexWrap: 'wrap',
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--text-sm)',
      }}
    >
      <span
        style={{
          color: 'var(--accent-fg)',
          background: 'var(--accent-subtle)',
          borderRadius: 'var(--radius-sm)',
          padding: '0 var(--space-1)',
        }}
      >
        /{pattern}/
      </span>
      {path !== null && <span style={{ color: 'var(--fg-muted)' }}>{path}</span>}
    </div>
  );
}

interface GrepRow {
  path: string | null;
  line: number | null;
  content: string;
}

const RE_PATH_LINE_CONTENT = /^(.+?):(\d+):(.*)$/;
const RE_LINE_CONTENT = /^(\d+):(.*)$/;

function parseGrepLine(line: string): GrepRow {
  const withPath = RE_PATH_LINE_CONTENT.exec(line);
  if (withPath !== null) {
    return { path: withPath[1] ?? '', line: Number(withPath[2]), content: withPath[3] ?? '' };
  }
  const withLine = RE_LINE_CONTENT.exec(line);
  if (withLine !== null) {
    return { path: null, line: Number(withLine[1]), content: withLine[2] ?? '' };
  }
  return { path: null, line: null, content: line };
}

function GrepResultRow({ row }: { row: GrepRow }): React.JSX.Element {
  if (row.path === null && row.line === null) {
    return (
      <div
        style={{
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          color: 'var(--fg-default)',
        }}
      >
        {row.content}
      </div>
    );
  }
  return (
    <div
      className="tr-renderer-grep-row"
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: '0',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
    >
      {row.path !== null && (
        <>
          <span style={{ color: 'var(--fg-muted)' }}>{row.path}</span>
          <span style={{ color: 'var(--fg-subtle)' }}>:</span>
        </>
      )}
      {row.line !== null && (
        <>
          <span
            style={{
              color: 'var(--accent-fg)',
              fontWeight: 'var(--weight-semibold)',
              flex: 'none',
            }}
          >
            {row.line}
          </span>
          <span style={{ color: 'var(--fg-subtle)' }}>:</span>
        </>
      )}
      <span style={{ color: 'var(--fg-default)' }}>{row.content}</span>
    </div>
  );
}

function GrepResult({ text }: { text: string }): React.JSX.Element {
  const rawLines = text.replace(/\n$/, '').split('\n');
  const { lines, omitted } = limitLines(rawLines);
  return (
    <div>
      <div
        className="tr-renderer-grep-result"
        style={{
          background: 'var(--canvas-inset)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-md)',
          padding: 'var(--space-2)',
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-sm)',
          overflowX: 'auto',
        }}
      >
        {lines.map((line, index) => (
          <GrepResultRow key={index} row={parseGrepLine(line)} />
        ))}
      </div>
      {omitted > 0 && (
        <div style={{ color: 'var(--fg-subtle)', fontSize: 'var(--text-xs)', paddingTop: 'var(--space-1)' }}>
          … +{omitted} more lines
        </div>
      )}
    </div>
  );
}

export function renderGrepArguments(text: string): ToolRenderResult {
  if (!withinCharBound(text)) {
    return { kind: 'fallback' };
  }
  const { pattern, path } = parseGrepArgs(text);
  if (pattern === null) {
    return { kind: 'fallback' };
  }
  return { kind: 'ok', node: <GrepArgs pattern={pattern} path={path} /> };
}

export function renderGrepResult(text: string): ToolRenderResult {
  if (!withinCharBound(text)) {
    return { kind: 'fallback' };
  }
  return { kind: 'ok', node: <GrepResult text={text} /> };
}

export const grepRenderer: ToolRenderer = {
  tool: 'grep',
  renderArguments: renderGrepArguments,
  renderResult: renderGrepResult,
};
