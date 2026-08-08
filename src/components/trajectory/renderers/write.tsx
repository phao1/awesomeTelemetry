import {
  limitLines,
  tryParseJson,
  type ToolRenderer,
  type ToolRenderResult,
  withinCharBound,
} from './index.js';

/**
 * `write` renderer (task 7.9 / design D11): the file path plus a content
 * block; the result renders as a preformatted confirmation block.
 */

interface ParsedWriteArgs {
  filePath: string | null;
  content: string | null;
}

function parseWriteArgs(text: string): ParsedWriteArgs {
  const value = tryParseJson(text);
  if (typeof value !== 'object' || value === null) {
    return { filePath: null, content: null };
  }
  const record = value as Record<string, unknown>;
  const filePath =
    typeof record.file_path === 'string' && record.file_path.trim() !== '' ? record.file_path : null;
  const content = typeof record.content === 'string' ? record.content : null;
  if (filePath === null || content === null) {
    return { filePath: null, content: null };
  }
  return { filePath, content };
}

function WriteContent({
  filePath,
  content,
}: {
  filePath: string;
  content: string;
}): React.JSX.Element {
  const index = filePath.lastIndexOf('/');
  const dir = index >= 0 ? filePath.slice(0, index) : '';
  const base = index >= 0 ? filePath.slice(index + 1) : filePath;
  const rawLines = content.split('\n');
  const { lines, omitted } = limitLines(rawLines);
  return (
    <div>
      <div
        className="tr-renderer-write-path"
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 'var(--space-2)',
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-sm)',
          marginBottom: 'var(--space-1)',
        }}
      >
        <span style={{ color: 'var(--fg-muted)' }}>{dir === '' ? '' : `${dir}/`}</span>
        <span style={{ color: 'var(--fg-default)', fontWeight: 'var(--weight-semibold)' }}>{base}</span>
      </div>
      <pre
        className="tr-renderer-write-content"
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
        }}
      >
        {lines.join('\n')}
      </pre>
      {omitted > 0 && (
        <div style={{ color: 'var(--fg-subtle)', fontSize: 'var(--text-xs)', paddingTop: 'var(--space-1)' }}>
          … +{omitted} more lines
        </div>
      )}
    </div>
  );
}

function ConfirmationBlock({ text }: { text: string }): React.JSX.Element {
  return (
    <pre
      className="tr-renderer-write-result"
      style={{
        margin: '0',
        padding: 'var(--space-2)',
        background: 'var(--canvas-inset)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-md)',
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--text-sm)',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
    >
      {text}
    </pre>
  );
}

export function renderWriteArguments(text: string): ToolRenderResult {
  if (!withinCharBound(text)) {
    return { kind: 'fallback' };
  }
  const args = parseWriteArgs(text);
  if (args.filePath === null || args.content === null) {
    return { kind: 'fallback' };
  }
  return { kind: 'ok', node: <WriteContent filePath={args.filePath} content={args.content} /> };
}

export function renderWriteResult(text: string): ToolRenderResult {
  if (!withinCharBound(text)) {
    return { kind: 'fallback' };
  }
  const trimmed = text.trim();
  if (trimmed === '') {
    return { kind: 'fallback' };
  }
  return { kind: 'ok', node: <ConfirmationBlock text={trimmed} /> };
}

export const writeRenderer: ToolRenderer = {
  tool: 'write',
  renderArguments: renderWriteArguments,
  renderResult: renderWriteResult,
};
