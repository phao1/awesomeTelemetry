import type { Locale } from '../i18n.js';
import { t } from '../i18n.js';
import type { TimeComposition, TimeSegment, TimeSegmentKey } from '../core/time-composition.js';
import { fmtDur } from '../core/session-findings.js';

export interface TimeCompositionBarProps {
  composition: TimeComposition;
  locale: Locale;
  /** 当前甘特图过滤分段（点击分段切换）。 */
  active: TimeSegmentKey | null;
  onToggle: (key: TimeSegmentKey) => void;
  /** 对比视图等只读场景传 false，避免"点了没反应"（P4）。 */
  interactive?: boolean;
}

const SEGMENT_TONE: Record<TimeSegmentKey, string> = {
  model: 'var(--seg-model)',
  tool: 'var(--seg-tool)',
  idle: 'var(--seg-idle)',
  userWait: 'var(--seg-user)',
};

/** ui-design-v2 §3.2 【新增·L2】时间构成条：模型 / 工具 / 空转 / 用户等待。 */
export function TimeCompositionBar({
  composition,
  locale,
  active,
  onToggle,
  interactive = true,
}: TimeCompositionBarProps): React.JSX.Element {
  if (composition.segments.length === 0) {
    return (
      <section className="timecomp" aria-label={t('timecomp.title', locale)}>
        <div className="timecomp-head">
          <span className="timecomp-title">{t('timecomp.title', locale)}</span>
          <span className="mono timecomp-total">{t('timecomp.total', locale)} 0s</span>
        </div>
        <div className="timecomp-bar timecomp-bar-empty" aria-hidden="true" />
      </section>
    );
  }

  const segmentLabel = (segment: TimeSegment): string => {
    const name = t(`timecomp.${segment.key}`, locale);
    return `${name} · ${fmtDur(segment.ms)} (${segment.pct.toFixed(0)}%)`;
  };

  return (
    <section className="timecomp" aria-label={t('timecomp.title', locale)}>
      <div className="timecomp-head">
        <span className="timecomp-title">{t('timecomp.title', locale)}</span>
        <span className="mono timecomp-total">
          {t('timecomp.total', locale)} {fmtDur(composition.totalMs)}
        </span>
      </div>
      <div className="timecomp-bar" role="img" aria-label={t('timecomp.title', locale)}>
        {composition.segments.map((segment) =>
          interactive ? (
            <button
              key={segment.key}
              type="button"
              className={`timecomp-seg ${active === segment.key ? 'timecomp-seg-on' : ''} ${
                segment.key === 'idle' ? 'timecomp-seg-idle' : ''
              }`}
              style={{
                width: `${Math.max(0.5, segment.pct)}%`,
                background: SEGMENT_TONE[segment.key],
              }}
              title={segmentLabel(segment)}
              aria-label={segmentLabel(segment)}
              onClick={() => onToggle(segment.key)}
            />
          ) : (
            <div
              key={segment.key}
              className={`timecomp-seg ${segment.key === 'idle' ? 'timecomp-seg-idle' : ''}`}
              style={{
                width: `${Math.max(0.5, segment.pct)}%`,
                background: SEGMENT_TONE[segment.key],
              }}
              title={segmentLabel(segment)}
              aria-label={segmentLabel(segment)}
            />
          ),
        )}
      </div>
      <div className="timecomp-legend">
        {composition.segments.map((segment) =>
          interactive ? (
            <button
              key={segment.key}
              type="button"
              className={`timecomp-item ${active === segment.key ? 'timecomp-item-on' : ''}`}
              onClick={() => onToggle(segment.key)}
            >
              <TimeCompSwatch segment={segment} />
              <span>{t(`timecomp.${segment.key}`, locale)}</span>
              <span className="mono timecomp-ms">
                {fmtDur(segment.ms)} · {segment.pct.toFixed(0)}%
              </span>
            </button>
          ) : (
            <span key={segment.key} className="timecomp-item">
              <TimeCompSwatch segment={segment} />
              <span>{t(`timecomp.${segment.key}`, locale)}</span>
              <span className="mono timecomp-ms">
                {fmtDur(segment.ms)} · {segment.pct.toFixed(0)}%
              </span>
            </span>
          ),
        )}
      </div>
    </section>
  );
}

function TimeCompSwatch({ segment }: { segment: TimeSegment }): React.JSX.Element {
  return (
    <span
      className="timecomp-swatch"
      style={{
        background: SEGMENT_TONE[segment.key],
        ...(segment.key === 'idle'
          ? { backgroundImage: 'repeating-linear-gradient(135deg, transparent 0 2px, var(--seg-idle-stripe) 2px 4px)' }
          : {}),
      }}
      aria-hidden="true"
    />
  );
}
