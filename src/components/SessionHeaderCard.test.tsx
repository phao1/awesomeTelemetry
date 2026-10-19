import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';

import { SessionHeaderCard } from './SessionHeaderCard.js';
import { makeEvent, makeSession } from './compare-test-fixtures.js';

describe('SessionHeaderCard scan timing', () => {
  it.each(['zh', 'en'] as const)('keeps legacy numbers and exposes declaration, formula and partial evidence (%s)', (locale) => {
    const div = document.createElement('div'); const root = createRoot(div);
    const session = makeSession('s', { durationSource: 'derived', eventCount: 3 });
    const events = [makeEvent({ kind: 'user_prompt', actor: 'user' }),
      makeEvent({ id: 'llm', startedAt: '2026-08-01T00:00:00.120Z', durationMs: 500 })];
    try {
      act(() => root.render(<SessionHeaderCard session={session} events={events} locale={locale} />));
      expect(div.querySelector('.ui-metric-card-value')?.textContent).toContain('120ms');
      expect(div.textContent).toContain('durationSource');
      expect(div.textContent).toContain('derived');
      expect(div.textContent).toContain('pureInferenceMs');
      expect(div.querySelector('.scan-timing-criteria [role="status"]')).not.toBeNull();
      expect(div.textContent).toContain(locale === 'zh' ? '含调度间隔' : 'including scheduling gaps');
    } finally { act(() => root.unmount()); }
  });
});
