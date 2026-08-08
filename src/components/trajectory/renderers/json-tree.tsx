import { useState } from 'react';

import {
  JSON_TREE_ARRAY_PREVIEW,
  JSON_TREE_DEFAULT_DEPTH,
  tryParseJson,
  type ToolRenderResult,
  withinCharBound,
} from './index.js';

/**
 * Default tool renderer (tasks 7.2): a collapsible JSON tree with
 * JSON_TREE_DEFAULT_DEPTH and a JSON_TREE_ARRAY_PREVIEW root-array preview.
 * Non-JSON input falls back to preformatted text (design D11) — that is the
 * designed behaviour, so it returns `{ kind: 'ok' }`, never `fallback`.
 */

const MAX_STRING_DISPLAY_CHARS = 160;

function truncateString(text: string): { display: string; truncated: boolean } {
  if (text.length <= MAX_STRING_DISPLAY_CHARS) {
    return { display: text, truncated: false };
  }
  return { display: `${text.slice(0, MAX_STRING_DISPLAY_CHARS)}…`, truncated: true };
}

function formatPrimitive(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  return String(value);
}

interface JsonTreeProps {
  value: unknown;
  depth: number;
  label?: string;
  /** Root arrays preview at most JSON_TREE_ARRAY_PREVIEW entries. */
  root?: boolean;
}

interface JsonLeafProps {
  value: unknown;
}

function JsonLeaf({ value }: JsonLeafProps): React.JSX.Element {
  if (typeof value === 'string') {
    const { display, truncated } = truncateString(value);
    return (
      <span
        className="tr-renderer-json-string"
        title={truncated ? value : undefined}
        style={{ color: 'var(--success-fg)' }}
      >
        {JSON.stringify(display)}
      </span>
    );
  }
  const style: React.CSSProperties =
    typeof value === 'number'
      ? { color: 'var(--accent-fg)' }
      : value === null
        ? { color: 'var(--fg-subtle)' }
        : { color: 'var(--attention-fg)' };
  return <span style={style}>{formatPrimitive(value)}</span>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function entriesOf(value: unknown): Array<[string, unknown]> {
  if (Array.isArray(value)) {
    return value.map((item, index) => [`${index}`, item]);
  }
  if (isObject(value)) {
    return Object.entries(value);
  }
  return [];
}

function previewEntries(
  entries: Array<[string, unknown]>,
  root: boolean,
): { shown: Array<[string, unknown]>; hidden: number } {
  if (!root || entries.length <= JSON_TREE_ARRAY_PREVIEW) {
    return { shown: entries, hidden: 0 };
  }
  return {
    shown: entries.slice(0, JSON_TREE_ARRAY_PREVIEW),
    hidden: entries.length - JSON_TREE_ARRAY_PREVIEW,
  };
}

function JsonTreeNode({ value, depth, label, root = false }: JsonTreeProps): React.JSX.Element {
  const isArray = Array.isArray(value);
  const isObj = isObject(value);
  const collapsible = isArray || isObj;
  const [collapsed, setCollapsed] = useState(collapsible && depth >= JSON_TREE_DEFAULT_DEPTH);

  if (!collapsible) {
    return (
      <div className="tr-renderer-json-row" style={rowStyle(depth)}>
        {label !== undefined && <JsonKey label={label} />}
        <JsonLeaf value={value} />
      </div>
    );
  }

  const entries = entriesOf(value);
  const { shown, hidden } = previewEntries(entries, root);
  const count = entries.length;
  const summary = isArray ? `[${count}]` : `{${count}}`;
  const chevron = collapsed ? '▸' : '▾';

  return (
    <div className="tr-renderer-json-node">
      <div className="tr-renderer-json-row" style={rowStyle(depth)}>
        <button
          type="button"
          className="tr-renderer-json-toggle"
          aria-expanded={!collapsed}
          aria-label={`${label ?? summary} ${collapsed ? 'collapsed' : 'expanded'}`}
          onClick={() => setCollapsed((prev) => !prev)}
          style={toggleStyle()}
        >
          <span aria-hidden="true" style={{ color: 'var(--fg-muted)' }}>
            {chevron}
          </span>
          {label !== undefined && <JsonKey label={label} />}
          <span style={{ color: 'var(--fg-muted)' }}>{summary}</span>
        </button>
      </div>
      {!collapsed && (
        <div className="tr-renderer-json-children">
          {shown.map(([childLabel, childValue]) => (
            <JsonTreeNode key={childLabel} value={childValue} depth={depth + 1} label={childLabel} />
          ))}
          {hidden > 0 && (
            <div className="tr-renderer-json-more" style={rowStyle(depth + 1)}>
              <span style={{ color: 'var(--fg-subtle)' }}>… +{hidden} more</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function JsonKey({ label }: { label: string }): React.JSX.Element {
  const isIndex = /^\d+$/.test(label);
  return (
    <span
      style={{
        color: isIndex ? 'var(--fg-subtle)' : 'var(--fg-default)',
        marginRight: 'var(--space-1)',
      }}
    >
      {isIndex ? label : JSON.stringify(label)}
      {isIndex ? '' : ': '}
    </span>
  );
}

function rowStyle(depth: number): React.CSSProperties {
  return {
    paddingLeft: `calc(${depth} * var(--space-4))`,
    display: 'flex',
    alignItems: 'baseline',
    gap: 'var(--space-1)',
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--text-sm)',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  };
}

function toggleStyle(): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 'var(--space-1)',
    padding: '0',
    border: '0',
    background: 'transparent',
    color: 'inherit',
    cursor: 'pointer',
    font: 'inherit',
    textAlign: 'left',
    minHeight: 'var(--space-6)',
  };
}

function PreformattedBlock({ text }: { text: string }): React.JSX.Element {
  return (
    <pre
      className="tr-renderer-pre"
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
      {text}
    </pre>
  );
}

/**
 * Default tool renderer. JSON input renders as a collapsible tree; non-JSON
 * renders as preformatted text (D11). The RENDER_MAX_CHARS bound is enforced
 * before parsing (task 7.11).
 */
export function renderJsonTree(text: string): ToolRenderResult {
  if (!withinCharBound(text)) {
    return { kind: 'fallback' };
  }
  const value = tryParseJson(text);
  if (value === undefined) {
    return { kind: 'ok', node: <PreformattedBlock text={text} /> };
  }
  return { kind: 'ok', node: <JsonTreeNode value={value} depth={0} root /> };
}

/** Exported for tests: the collapsible tree root node. */
export function JsonTree({ value }: { value: unknown }): React.JSX.Element {
  return <JsonTreeNode value={value} depth={0} root />;
}
