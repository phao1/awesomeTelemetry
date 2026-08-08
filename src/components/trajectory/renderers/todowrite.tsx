import { IconCancelled, IconPending, IconRunning, IconSuccess, IconWarning, type IconProps } from '../../icons/index.js';
import {
  tryParseJson,
  type ToolRenderer,
  type ToolRenderResult,
  withinCharBound,
} from './index.js';

/**
 * `todowrite` renderer (task 7.5 / design D11): task rows with an icon PLUS a
 * label per status and a priority badge. A coloured dot alone is prohibited —
 * every status pill pairs its colour with an icon and the status word.
 */

type TodoStatus =
  | 'completed'
  | 'in_progress'
  | 'pending'
  | 'cancelled'
  | 'unknown';

type StatusTone = 'success' | 'attention' | 'neutral';

interface TodoStatusStyle {
  tone: StatusTone;
  label: string;
  icon: (props: IconProps) => React.JSX.Element;
}

const STATUS_STYLES: Record<TodoStatus, TodoStatusStyle> = {
  completed: { tone: 'success', label: 'completed', icon: IconSuccess },
  in_progress: { tone: 'attention', label: 'in_progress', icon: IconRunning },
  pending: { tone: 'neutral', label: 'pending', icon: IconPending },
  cancelled: { tone: 'neutral', label: 'cancelled', icon: IconCancelled },
  unknown: { tone: 'neutral', label: 'unknown', icon: IconWarning },
};

function statusOf(value: unknown): TodoStatus {
  if (typeof value !== 'string') {
    return 'unknown';
  }
  const key = value.trim().toLowerCase().replaceAll(' ', '_');
  if (key === 'completed' || key === 'done' || key === 'complete') {
    return 'completed';
  }
  if (key === 'in_progress' || key === 'in-progress' || key === 'inprogress') {
    return 'in_progress';
  }
  if (key === 'pending') {
    return 'pending';
  }
  if (key === 'cancelled' || key === 'canceled') {
    return 'cancelled';
  }
  return 'unknown';
}

interface TodoItem {
  content: string | null;
  status: TodoStatus;
  priority: string | null;
  activeGoal: string | null;
}

function itemOf(value: unknown): TodoItem | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const content = typeof record.content === 'string' && record.content.trim() !== '' ? record.content : null;
  if (content === null) {
    return null;
  }
  const priority =
    typeof record.priority === 'string' && record.priority.trim() !== ''
      ? record.priority
      : typeof record.priority === 'number'
        ? String(record.priority)
        : null;
  return {
    content,
    status: statusOf(record.status),
    priority,
    activeGoal: typeof record.activeGoal === 'string' && record.activeGoal.trim() !== '' ? record.activeGoal : null,
  };
}

function parseTodoArgs(text: string): TodoItem[] | null {
  const value = tryParseJson(text);
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.todos)) {
    return null;
  }
  const items: TodoItem[] = [];
  for (const entry of record.todos) {
    const item = itemOf(entry);
    if (item === null) {
      return null;
    }
    items.push(item);
  }
  return items.length > 0 ? items : null;
}

function TodoRow({ item }: { item: TodoItem }): React.JSX.Element {
  const style = STATUS_STYLES[item.status];
  const Icon = style.icon;
  return (
    <div
      className="tr-renderer-todo-row"
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 'var(--space-2)',
        padding: 'var(--space-1) 0',
        flexWrap: 'wrap',
      }}
    >
      <span
        className="tr-renderer-todo-status"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 'var(--space-1)',
          color: `var(--${style.tone}-fg)`,
          background: `var(--${style.tone}-subtle)`,
          borderRadius: 'var(--radius-sm)',
          padding: '0 var(--space-1)',
          fontSize: 'var(--text-xs)',
          flex: 'none',
        }}
      >
        <Icon size={12} label={style.label} />
        {style.label}
      </span>
      {item.priority !== null && (
        <span
          className="tr-renderer-todo-priority"
          style={{
            color: 'var(--attention-fg)',
            background: 'var(--attention-subtle)',
            borderRadius: 'var(--radius-sm)',
            padding: '0 var(--space-1)',
            fontSize: 'var(--text-xs)',
            flex: 'none',
          }}
        >
          priority: {item.priority}
        </span>
      )}
      <span style={{ color: 'var(--fg-default)' }}>{item.content}</span>
      {item.activeGoal !== null && (
        <span style={{ color: 'var(--fg-subtle)', fontSize: 'var(--text-xs)' }}>{item.activeGoal}</span>
      )}
    </div>
  );
}

function TodoList({ items }: { items: TodoItem[] }): React.JSX.Element {
  return (
    <div
      className="tr-renderer-todo-list"
      style={{
        background: 'var(--canvas-inset)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-1) var(--space-2)',
        fontSize: 'var(--text-sm)',
      }}
    >
      {items.map((item, index) => (
        <TodoRow key={index} item={item} />
      ))}
    </div>
  );
}

function ConfirmationBlock({ text }: { text: string }): React.JSX.Element {
  return (
    <pre
      className="tr-renderer-todo-result"
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

export function renderTodoWriteArguments(text: string): ToolRenderResult {
  if (!withinCharBound(text)) {
    return { kind: 'fallback' };
  }
  const items = parseTodoArgs(text);
  if (items === null) {
    return { kind: 'fallback' };
  }
  return { kind: 'ok', node: <TodoList items={items} /> };
}

export function renderTodoWriteResult(text: string): ToolRenderResult {
  if (!withinCharBound(text)) {
    return { kind: 'fallback' };
  }
  const trimmed = text.trim();
  if (trimmed === '') {
    return { kind: 'fallback' };
  }
  return { kind: 'ok', node: <ConfirmationBlock text={trimmed} /> };
}

export const todowriteRenderer: ToolRenderer = {
  tool: 'todowrite',
  renderArguments: renderTodoWriteArguments,
  renderResult: renderTodoWriteResult,
};
