import { useState } from 'react';

import type { Locale } from '../i18n.js';
import type { TraceEventSlim } from '../core/trace-types.js';
import type { CompareResult } from './compare-types.js';
import { TraceTimeline } from './TraceTimeline.js';

/** 建议 8：Compare 时间线 —— 左右各自独立的时间/序列模式切换。 */
export function CompareTimeline({
  result,
  locale,
}: {
  result: CompareResult;
  locale: Locale;
}): React.JSX.Element {
  const [leftMode, setLeftMode] = useState<'time' | 'sequence'>('time');
  const [rightMode, setRightMode] = useState<'time' | 'sequence'>('time');
  const leftName = result.left.session.title || result.left.session.id;
  const rightName = result.right.session.title || result.right.session.id;

  return (
    <div className="compare-timelines">
      <div className="compare-timeline">
        <h4>
          <span className="compare-side-mark" style={{ color: 'var(--accent-fg)' }}>L</span>
          {' '}{leftName}
        </h4>
        <TraceTimeline
          events={(result.left.events as TraceEventSlim[]).slice(0, 200)}
          total={result.left.eventTotal}
          hasMore={false}
          onLoadMore={() => undefined}
          onSelectEvent={() => undefined}
          selectedEventId={null}
          locale={locale}
          layoutMode={leftMode}
          onLayoutModeChange={setLeftMode}
        />
      </div>
      <div className="compare-timeline">
        <h4>
          <span className="compare-side-mark" style={{ color: 'var(--attention-fg)' }}>R</span>
          {' '}{rightName}
        </h4>
        <TraceTimeline
          events={(result.right.events as TraceEventSlim[]).slice(0, 200)}
          total={result.right.eventTotal}
          hasMore={false}
          onLoadMore={() => undefined}
          onSelectEvent={() => undefined}
          selectedEventId={null}
          locale={locale}
          layoutMode={rightMode}
          onLayoutModeChange={setRightMode}
        />
      </div>
    </div>
  );
}
