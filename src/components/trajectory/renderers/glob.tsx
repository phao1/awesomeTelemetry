import {
  limitLines,
  tryParseJson,
  type ToolRenderer,
  type ToolRenderResult,
  withinCharBound,
} from './index.js';

/**
 * `glob` renderer (task 7.7 / design D11): the pattern renders in monospace
 * with an optional base path; the result renders monospace path rows.
 */

interface ParsedGlobArgs {
  pattern: string | null;
  path: string | null;
}

function parseGlobArgs(text: string): ParsedGlobArgs {
  const value = tryParseJson(text);
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    const pattern =
      typeof record.pattern === 'string' && record.pattern.trim() !== '' ? record.pattern : null;
    const path =
      typeof record.path === 'string' && record.path.trim() !== ''
        ? record.path
        : typeof record.cwd === 'string' && record.cwd.trim() !== ''
          ? record.cwd
          : null;
    return { pattern, path };
  }
  const trimmed = text.trim();
  if (trimmed === '' || trimmed.includes('\n')) {
    return { pattern: null, path: null };
  }
  return { pattern: trimmed, path: null };
}

function GlobArgs({ pattern, path }: { pattern: string; path: string | null }): React.JSX.Element {
  return (
    <div
      className="tr-renderer-glob-args"
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 'var(--space-2)',
        flexWrap: 'wrap',
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--text-sm)',
      }}
    >
      <span style={{ color: 'var(--fg-default)', fontWeight: 'var(--weight-medium)' }}>{pattern}</span>
      {path !== null && <span style={{ color: 'var(--fg-muted)' }}>{path}</span>}
    </div>
  );
}

function GlobResult({ text }: { text: string }): React.JSX.Element {
  const rawLines = text.replace(/\n$/, '').split('\n');
  const { lines, omitted } = limitLines(rawLines);
  return (
    <div>
      <div
        className="tr-renderer-glob-result"
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
          <div
            key={index}
            style={{
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              color: 'var(--fg-default)',
            }}
          >
            {line}
          </div>
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

export function renderGlobArguments(text: string): ToolRenderResult {
  if (!withinCharBound(text)) {
    return { kind: 'fallback' };
  }
  const { pattern, path } = parseGlobArgs(text);
  if (pattern === null) {
    return { kind: 'fallback' };
  }
  return { kind: 'ok', node: <GlobArgs pattern={pattern} path={path} /> };
}

export function renderGlobResult(text: string): ToolRenderResult {
  if (!withinCharBound(text)) {
    return { kind: 'fallback' };
  }
  return { kind: 'ok', node: <GlobResult text={text} /> };
}

export const globRenderer: ToolRenderer = {
  tool: 'glob',
  renderArguments: renderGlobArguments,
  renderResult: renderGlobResult,
};
