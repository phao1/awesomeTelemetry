import { useEffect, useRef, useState } from 'react';

import { t, type Locale } from '../../i18n.js';
import type { TurnModel } from '../../core/trace-types.js';

/** Every turn has the same click target, regardless of its duration or token count. */
const PITCH = 48;
const MARK_WIDTH = 44;

function durationLabel(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}s`;
}

export function TurnNavigator({ model, locale, activeTurnIndex, onActivate }: {
  model: TurnModel;
  locale: Locale;
  activeTurnIndex: number | null;
  onActivate: (index: number) => void;
}): React.JSX.Element {
  const [left, setLeft] = useState(0);
  const [width, setWidth] = useState(880);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = (): void => setWidth(el.clientWidth || 880);
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(el);
    return () => observer?.disconnect();
  }, []);

  useEffect(() => {
    const el = ref.current;
    const position = model.turns.findIndex((turn) => turn.index === activeTurnIndex);
    if (!el || position < 0) return;
    const start = position * PITCH;
    if (start < el.scrollLeft || start + PITCH > el.scrollLeft + width) {
      el.scrollLeft = Math.max(0, Math.floor((start - width / 2) / PITCH) * PITCH);
      setLeft(el.scrollLeft);
    }
  }, [activeTurnIndex, model.turns, width]);

  const start = Math.max(0, Math.floor(left / PITCH) - 2);
  const end = Math.min(model.turns.length, Math.ceil((left + width) / PITCH) + 2);

  return <nav className="turn-navigator" aria-label={t('trajectory.navigator', locale)}>
    <span className="turn-navigator-count mono" aria-label={`${model.turns.length} ${t('trajectory.pill.turns', locale)}`}>
      {activeTurnIndex ?? '—'} / {model.complete ? model.turns.length : `${model.turns.length}+`}
    </span>
    <div className="turn-navigator-scroll" ref={ref} onScroll={(event) => setLeft(event.currentTarget.scrollLeft)}>
      <div className="turn-navigator-track" style={{ width: model.turns.length * PITCH }}>
        {model.turns.slice(start, end).map((turn, offset) => {
          const error = turn.status === 'error' || turn.messages.some((message) => message.status === 'error' || message.error !== null);
          const role = error ? 'error' : turn.toolCount > 0 ? 'tool' : turn.kind === 'user' ? 'user' : turn.kind === 'init' ? 'system' : 'assistant';
          const label = [
            t('trajectory.turn.title', locale).replace('{index}', String(turn.index)),
            durationLabel(turn.durationMs),
            `${turn.tokens.total.toLocaleString()} tokens`,
            t('trajectory.turn.toolCalls', locale).replace('{n}', String(turn.toolCount)),
            ...(error ? [t('trajectory.filter.errors', locale)] : []),
          ].join(' · ');
          return <button type="button" key={turn.index}
            className={`turn-mark ${activeTurnIndex === turn.index ? 'turn-mark-active' : ''} ${error ? 'turn-mark-error' : ''}`}
            data-role={role} style={{ left: (start + offset) * PITCH, width: MARK_WIDTH }}
            aria-pressed={activeTurnIndex === turn.index} aria-label={label}
            onClick={() => onActivate(turn.index)}>
            {turn.index}
          </button>;
        })}
      </div>
    </div>
  </nav>;
}
