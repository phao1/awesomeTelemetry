import type { TracePhase, TraceStatus, ProviderKey } from '../../core/trace-types.js';
import { t, type Locale } from '../../i18n.js';
import {
  IconCancelled,
  IconDebug,
  IconError,
  IconImplement,
  IconPlan,
  IconReport,
  IconRunning,
  IconSuccess,
  IconUnderstand,
  IconVerify,
  IconWarning,
  type IconProps,
} from '../icons/index.js';

export type BadgeTone = 'accent' | 'success' | 'attention' | 'danger' | 'done' | 'neutral';

export interface BadgeProps {
  tone?: BadgeTone;
  variant?: 'subtle' | 'solid';
  children: React.ReactNode;
  className?: string;
}

/** REQ-005：Badge。色见契约 §2.4 语义组。 */
export function Badge({
  tone = 'neutral',
  variant = 'subtle',
  children,
  className,
}: BadgeProps): React.JSX.Element {
  const classes = ['ui-badge', `ui-badge-${tone}`, `ui-badge-${variant}`, className ?? '']
    .filter(Boolean)
    .join(' ');
  return <span className={classes}>{children}</span>;
}

const STATUS_TONE: Record<TraceStatus, BadgeTone> = {
  success: 'success',
  error: 'danger',
  running: 'attention',
  cancelled: 'neutral',
  unknown: 'neutral',
};

const STATUS_ICON: Record<TraceStatus, (props: IconProps) => React.JSX.Element> = {
  success: IconSuccess,
  error: IconError,
  running: IconRunning,
  cancelled: IconCancelled,
  unknown: IconWarning,
};

export interface StatusBadgeProps {
  status: TraceStatus;
  locale: Locale;
}

/** REQ-005：StatusBadge。契约 §2.4 status → 语义色映射 + 图标（颜色不单独承载语义）。 */
export function StatusBadge({ status, locale }: StatusBadgeProps): React.JSX.Element {
  const Icon = STATUS_ICON[status];
  const label = t(`status.${status}`, locale);
  return (
    <Badge tone={STATUS_TONE[status]}>
      <Icon size={12} label={label} />
      {label}
    </Badge>
  );
}

const PHASE_ICON: Record<TracePhase, (props: IconProps) => React.JSX.Element> = {
  understand: IconUnderstand,
  plan: IconPlan,
  implement: IconImplement,
  debug: IconDebug,
  verify: IconVerify,
  report: IconReport,
};

export interface PhaseBadgeProps {
  phase: TracePhase;
  locale: Locale;
}

/** REQ-005：PhaseBadge。色 + 图标 + i18n 文字（REQ-004 Scenario：MUST 同时渲染）。 */
export function PhaseBadge({ phase, locale }: PhaseBadgeProps): React.JSX.Element {
  const Icon = PHASE_ICON[phase];
  const label = t(`phase.${phase}`, locale);
  return (
    <span
      className="ui-badge ui-badge-subtle"
      style={{
        color: `var(--phase-${phase})`,
        background: `var(--phase-${phase}-subtle)`,
      }}
    >
      <Icon size={12} label={label} />
      {label}
    </span>
  );
}

const PROVIDER_LETTER: Record<ProviderKey, string> = {
  claude: 'C',
  codex: 'X',
  opencode: 'O',
  codearts: 'A',
  codeagent: 'G',
  codeagent2: '2',
  trae: 'T',
  qoder: 'Q',
  workbuddy: 'W',
};

export interface ProviderBadgeProps {
  provider: ProviderKey;
  showLabel?: boolean;
  locale: Locale;
}

/** REQ-005：ProviderBadge 字母章（契约 §2.6）。底为 -subtle，字为 provider 色。 */
export function ProviderBadge({ provider, showLabel = false, locale }: ProviderBadgeProps): React.JSX.Element {
  const label = t(`provider.${provider}`, locale);
  const badge = (
    <span
      className="ui-provider-badge"
      style={{
        color: `var(--provider-${provider})`,
        background: `var(--provider-${provider}-subtle)`,
      }}
      aria-label={showLabel ? label : undefined}
      role={showLabel ? 'img' : undefined}
    >
      {PROVIDER_LETTER[provider]}
    </span>
  );
  if (!showLabel) {
    return badge;
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
      {badge}
      <span style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-muted)' }}>{label}</span>
    </span>
  );
}
