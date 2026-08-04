import type { ReactNode } from 'react';

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
  const classes = ['ui-tabs', variant === 'pill' ? 'ui-tabs-pill' : '', className ?? '']
    .filter(Boolean)
    .join(' ');
  return (
    <div className={classes} role="tablist">
      {items.map((item) => {
        const selected = item.id === activeId;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`tab-${item.id}`}
            aria-selected={selected}
            aria-controls={`panel-${item.id}`}
            className="ui-tab"
            disabled={item.disabled}
            onClick={() => onChange(item.id)}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
