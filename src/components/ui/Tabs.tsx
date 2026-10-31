import { useId, type ReactNode } from 'react';

export interface TabItem {
  id: string;
  label: ReactNode;
  disabled?: boolean;
}

export interface TabsProps {
  items: TabItem[];
  activeId: string;
  onChange: (id: string) => void;
  variant?: 'underline' | 'pill';
  className?: string;
}

/** REQ-005：Tabs。role="tablist"（REQ-009 语义）。 */
export function Tabs({
  items,
  activeId,
  onChange,
  variant = 'underline',
  className,
}: TabsProps): React.JSX.Element {
  const instanceId = useId();
  const classes = ['ui-tabs', variant === 'pill' ? 'ui-tabs-pill' : '', className ?? '']
    .filter(Boolean)
    .join(' ');
  const enabled = items.filter(item => !item.disabled);
  const tabStop = enabled.find(item => item.id === activeId)?.id ?? enabled[0]?.id;
  return (
    <div className={classes} role="tablist">
      {items.map((item) => {
        const selected = item.id === activeId;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`${instanceId}-tab-${item.id}`}
            aria-selected={selected}
            tabIndex={item.id === tabStop ? 0 : -1}
            className="ui-tab"
            disabled={item.disabled}
            onClick={() => onChange(item.id)}
            onKeyDown={event => {
              if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing) return;
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || enabled.length === 0) return;
              const current = Math.max(0, enabled.findIndex(candidate => candidate.id === item.id));
              const index = event.key === 'Home' ? 0 : event.key === 'End' ? enabled.length - 1
                : (current + (event.key === 'ArrowRight' ? 1 : -1) + enabled.length) % enabled.length;
              const target = enabled[index]!;
              event.preventDefault();
              const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
              [...(buttons ?? [])].find(button => button.id === `${instanceId}-tab-${target.id}`)?.focus();
              onChange(target.id);
            }}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
