type Locale = 'zh' | 'en';
export const UNKNOWN = '—';
const valid = (n: number | null | undefined): n is number => n != null && Number.isFinite(n);
export function formatCount(n: number | null | undefined, locale: Locale = 'zh'): string {
  return valid(n) ? n.toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US') : UNKNOWN;
}
export function formatTokens(n: number | null | undefined): string {
  if (!valid(n)) return UNKNOWN;
  const units = [[1e9, 'B'], [1e6, 'M'], [1e3, 'K']] as const;
  for (const [index, [scale, suffix]] of units.entries()) {
    if (Math.abs(n) >= scale) {
      const rounded = Number((n / scale).toFixed(1));
      if (Math.abs(rounded) >= 1000 && index > 0) return `${Number((rounded / 1000).toFixed(1))}${units[index - 1]![1]}`;
      return `${rounded}${suffix}`;
    }
  }
  return String(n);
}
/** Decimal byte units (MB = 1,000,000 bytes); raw bytes remain available to tooltips. */
export function formatBytes(bytes: number | null | undefined): string {
  if (!valid(bytes) || bytes < 0) return UNKNOWN;
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'] as const;
  let value = bytes, unit = 0;
  while (value >= 1000 && unit < units.length - 1) { value /= 1000; unit++; }
  let rounded = Number(value.toFixed(unit ? 1 : 0));
  if (rounded >= 1000 && unit < units.length - 1) { rounded = Number((rounded / 1000).toFixed(1)); unit++; }
  return `${rounded} ${units[unit]}`;
}
/** Percent input is a ratio, so 0.874 = 87.4%. */
export function formatPercent(ratio: number | null | undefined): string {
  return !valid(ratio) ? UNKNOWN : ratio > 0 && ratio < .001 ? '<0.1%' : `${(ratio * 100).toFixed(1)}%`;
}
export function formatDuration(ms: number | null | undefined, locale: Locale = 'zh'): string {
  if (!valid(ms) || ms < 0) return UNKNOWN;
  const seconds = Math.floor(ms / 1000), minutes = Math.floor(seconds / 60), hours = Math.floor(minutes / 60), days = Math.floor(hours / 24);
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}${locale === 'zh' ? '秒' : 's'}`;
  const units = locale === 'zh' ? ['分','秒','小时','天'] : ['m','s','h','d'];
  return days ? `${days}${units[3]} ${hours % 24}${units[2]}` : hours ? `${hours}${units[2]} ${minutes % 60}${units[0]}` : `${minutes}${units[0]} ${seconds % 60}${units[1]}`;
}
function date(value: string | number | Date): Date | null { const d = new Date(value); return Number.isFinite(d.getTime()) ? d : null; }
export function formatAbsoluteTime(value: string | number | Date, locale: Locale = 'zh', now = new Date()): string {
  const d = date(value); if (!d) return UNKNOWN;
  return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', { year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(d);
}
export function formatRelativeTime(value: string | number | Date, locale: Locale = 'zh', now = new Date()): string {
  const d = date(value); if (!d) return UNKNOWN;
  const seconds = (now.getTime() - d.getTime()) / 1000;
  if (seconds < 0) return formatAbsoluteTime(d, locale, now);
  if (seconds < 60) return locale === 'zh' ? '刚刚' : 'Just now';
  if (seconds < 86400) { const hours = seconds >= 3600, n = Math.floor(seconds / (hours ? 3600 : 60)); return locale === 'zh' ? `${n} ${hours ? '小时' : '分钟'}前` : `${n}${hours ? 'h' : 'm'} ago`; }
  if (seconds < 172800) return `${locale === 'zh' ? '昨天' : 'Yesterday'} ${d.toLocaleTimeString(locale === 'zh' ? 'zh-CN' : 'en-GB', {hour:'2-digit',minute:'2-digit',hour12:false})}`;
  if(locale==='en'&&seconds<604800)return `${Math.floor(seconds/86400)}d ago`;
  return d.toLocaleDateString(locale === 'zh' ? 'zh-CN' : 'en-US', {month:'short',day:'numeric'});
}
export function formatCoverage(known: number, total: number, locale: Locale = 'zh'): string { return known >= total ? '' : `${locale === 'zh' ? '部分' : 'Partial'} ${known}/${total}`; }
