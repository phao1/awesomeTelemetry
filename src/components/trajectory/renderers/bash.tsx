import { classifyErrorText } from '../../../core/error-classifier.js';
import { IconError } from '../../icons/index.js';
import {
  limitLines,
  tryParseJson,
  type ToolRenderer,
  type ToolRenderResult,
  withinCharBound,
} from './index.js';

/**
 * `bash` renderer (task 7.4 / design D11): the command renders on
 * --canvas-inset with the description as a leading comment; the result
 * renders terminal-styled with error lines detected via the existing
 * src/core/error-classifier.ts — never a second pattern list. Error lines
 * carry an icon and the danger colour, never colour alone.
 */

interface ParsedBashArgs {
  command: string | null;
  description: string | null;
}

function parseBashArgs(text: string): ParsedBashArgs {
  const value = tryParseJson(text);
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    const command =
      typeof record.command === 'string' && record.command.trim() !== '' ? record.command : null;
    if (command === null) {
      return { command: null, description: null };
    }
    return {
      command,
      description: typeof record.description === 'string' ? record.description : null,
    };
  }
  const trimmed = text.trim();
  if (trimmed === '') {
    return { command: null, description: null };
  }
  return { command: trimmed, description: null };
}

function BashCommand({ command, description }: { command: string; description: string | null }): React.JSX.Element {
  return (
    <div
      className="tr-renderer-bash-args"
      style={{
        background: 'var(--canvas-inset)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-2)',
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--text-sm)',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
    >
      {description !== null && (
        <div style={{ color: 'var(--fg-subtle)' }}>{`# ${description}`}</div>
      )}
      <div style={{ color: 'var(--fg-default)' }}>{command}</div>
    </div>
  );
}

function TerminalRow({ line, isError }: { line: string; isError: boolean }): React.JSX.Element {
  if (!isError) {
    return (
      <div
        style={{
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          color: 'var(--fg-default)',
        }}
      >
        {line}
      </div>
    );
  }
  const cls = classifyErrorText(line);
  return (
    <div
      className="tr-renderer-bash-error"
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 'var(--space-1)',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        color: 'var(--danger-fg)',
      }}
      title={`error class: ${cls}`}
    >
      <span style={{ flex: 'none' }} aria-hidden="true">
        <IconError size={12} />
      </span>
      <span>{line}</span>
    </div>
  );
}

function BashResult({ text }: { text: string }): React.JSX.Element {
  const rawLines = text.replace(/\n$/, '').split('\n');
  const { lines, omitted } = limitLines(rawLines);
  return (
    <div>
      <div
        className="tr-renderer-bash-result"
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
          <TerminalRow key={index} line={line} isError={classifyErrorText(line) !== 'other'} />
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

export function renderBashArguments(text: string): ToolRenderResult {
  if (!withinCharBound(text)) {
    return { kind: 'fallback' };
  }
  const { command, description } = parseBashArgs(text);
  if (command === null) {
    return { kind: 'fallback' };
  }
  return { kind: 'ok', node: <BashCommand command={command} description={description} /> };
}

export function renderBashResult(text: string): ToolRenderResult {
  if (!withinCharBound(text)) {
    return { kind: 'fallback' };
  }
  return { kind: 'ok', node: <BashResult text={text} /> };
}

export const bashRenderer: ToolRenderer = {
  tool: 'bash',
  renderArguments: renderBashArguments,
  renderResult: renderBashResult,
};
