import {
  RENDER_MAX_LINES,
  limitLines,
  tryParseJson,
  type ToolRenderer,
  type ToolRenderResult,
  withinCharBound,
} from './index.js';

/**
 * `edit` renderer (task 7.8 / design D11): the file path plus a unified diff
 * between old_string and new_string. Diff rows carry their `+` / `-` sign in
 * addition to the background colour — the sign is the semantic carrier.
 */

interface ParsedEditArgs {
  filePath: string | null;
  oldLines: string[] | null;
  newLines: string[] | null;
  replaceAll: boolean;
  omittedOld: number;
  omittedNew: number;
}

function parseEditArgs(text: string): ParsedEditArgs {
  const value = tryParseJson(text);
  if (typeof value !== 'object' || value === null) {
    return {
      filePath: null,
      oldLines: null,
      newLines: null,
      replaceAll: false,
      omittedOld: 0,
      omittedNew: 0,
    };
  }
  const record = value as Record<string, unknown>;
  const filePath =
    typeof record.file_path === 'string' && record.file_path.trim() !== '' ? record.file_path : null;
  const oldText = typeof record.old_string === 'string' ? record.old_string : null;
  const newText = typeof record.new_string === 'string' ? record.new_string : null;
  if (filePath === null || oldText === null || newText === null) {
    return {
      filePath: null,
      oldLines: null,
      newLines: null,
      replaceAll: false,
      omittedOld: 0,
      omittedNew: 0,
    };
  }
  const oldAll = oldText.split('\n');
  const newAll = newText.split('\n');
  const oldLimited = limitLines(oldAll);
  const newLimited = limitLines(newAll);
  return {
    filePath,
    oldLines: oldLimited.lines,
    newLines: newLimited.lines,
    replaceAll: record.replace_all === true,
    omittedOld: oldLimited.omitted,
    omittedNew: newLimited.omitted,
  };
}

type DiffRowKind = 'ctx' | 'add' | 'del';

interface DiffRow {
  kind: DiffRowKind;
  text: string;
}

/**
 * Line-based LCS diff. Inputs are capped at RENDER_MAX_LINES by the caller,
 * bounding the DP table at 200 x 200 cells.
 */
function diffLines(a: readonly string[], b: readonly string[]): DiffRow[] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      const left = dp[i + 1]?.[j] ?? 0;
      const down = dp[i]?.[j + 1] ?? 0;
      const diag = dp[i + 1]?.[j + 1] ?? 0;
      dp[i]![j] = a[i] === b[j] ? diag + 1 : Math.max(left, down);
    }
  }
  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      rows.push({ kind: 'ctx', text: a[i] ?? '' });
      i += 1;
      j += 1;
    } else if ((dp[i + 1]?.[j] ?? 0) >= (dp[i]?.[j + 1] ?? 0)) {
      rows.push({ kind: 'del', text: a[i] ?? '' });
      i += 1;
    } else {
      rows.push({ kind: 'add', text: b[j] ?? '' });
      j += 1;
    }
  }
  while (i < n) {
    rows.push({ kind: 'del', text: a[i] ?? '' });
    i += 1;
  }
  while (j < m) {
    rows.push({ kind: 'add', text: b[j] ?? '' });
    j += 1;
  }
  return rows;
}

function DiffRowView({ row }: { row: DiffRow }): React.JSX.Element {
  if (row.kind === 'ctx') {
    return (
      <div
        style={{
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          color: 'var(--fg-default)',
        }}
      >
        {row.text}
      </div>
    );
  }
  const added = row.kind === 'add';
  return (
    <div
      className={added ? 'tr-renderer-diff-add' : 'tr-renderer-diff-del'}
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 'var(--space-1)',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        color: 'var(--fg-default)',
        background: added ? 'var(--success-subtle)' : 'var(--danger-subtle)',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          flex: 'none',
          fontWeight: 'var(--weight-semibold)',
          color: added ? 'var(--success-fg)' : 'var(--danger-fg)',
        }}
      >
        {added ? '+' : '-'}
      </span>
      <span>{row.text}</span>
    </div>
  );
}

function EditDiff({
  filePath,
  rows,
  replaceAll,
  omittedOld,
  omittedNew,
}: {
  filePath: string;
  rows: DiffRow[];
  replaceAll: boolean;
  omittedOld: number;
  omittedNew: number;
}): React.JSX.Element {
  const index = filePath.lastIndexOf('/');
  const dir = index >= 0 ? filePath.slice(0, index) : '';
  const base = index >= 0 ? filePath.slice(index + 1) : filePath;
  return (
    <div>
      <div
        className="tr-renderer-edit-path"
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 'var(--space-2)',
          flexWrap: 'wrap',
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-sm)',
          marginBottom: 'var(--space-1)',
        }}
      >
        <span style={{ color: 'var(--fg-muted)' }}>{dir === '' ? '' : `${dir}/`}</span>
        <span style={{ color: 'var(--fg-default)', fontWeight: 'var(--weight-semibold)' }}>{base}</span>
        {replaceAll && (
          <span style={{ color: 'var(--fg-subtle)', fontSize: 'var(--text-xs)' }}>replace all</span>
        )}
      </div>
      <div
        className="tr-renderer-edit-diff"
        style={{
          background: 'var(--canvas-inset)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-md)',
          padding: 'var(--space-1) var(--space-2)',
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-sm)',
          overflowX: 'auto',
        }}
      >
        {rows.map((row, indexRow) => (
          <DiffRowView key={indexRow} row={row} />
        ))}
      </div>
      {(omittedOld > 0 || omittedNew > 0) && (
        <div style={{ color: 'var(--fg-subtle)', fontSize: 'var(--text-xs)', paddingTop: 'var(--space-1)' }}>
          … diff truncated at {RENDER_MAX_LINES} lines per side
        </div>
      )}
    </div>
  );
}

function ConfirmationBlock({ text }: { text: string }): React.JSX.Element {
  return (
    <pre
      className="tr-renderer-edit-result"
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

export function renderEditArguments(text: string): ToolRenderResult {
  if (!withinCharBound(text)) {
    return { kind: 'fallback' };
  }
  const args = parseEditArgs(text);
  if (args.filePath === null || args.oldLines === null || args.newLines === null) {
    return { kind: 'fallback' };
  }
  const rows = diffLines(args.oldLines, args.newLines);
  return {
    kind: 'ok',
    node: (
      <EditDiff
        filePath={args.filePath}
        rows={rows}
        replaceAll={args.replaceAll}
        omittedOld={args.omittedOld}
        omittedNew={args.omittedNew}
      />
    ),
  };
}

export function renderEditResult(text: string): ToolRenderResult {
  if (!withinCharBound(text)) {
    return { kind: 'fallback' };
  }
  const trimmed = text.trim();
  if (trimmed === '') {
    return { kind: 'fallback' };
  }
  return { kind: 'ok', node: <ConfirmationBlock text={trimmed} /> };
}

export const editRenderer: ToolRenderer = {
  tool: 'edit',
  renderArguments: renderEditArguments,
  renderResult: renderEditResult,
};
