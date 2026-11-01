/** A shared zero-based 1/2/5 × 10^n axis. Keep data geometry and tick labels on the same scale. */
export function niceAxis(maximum: number, intervals = 4): { max: number; step: number; ticks: number[] } {
  const count = Math.max(1, Math.floor(intervals));
  const raw = (Number.isFinite(maximum) && maximum > 0 ? maximum : 1) / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  const fraction = raw / power;
  const step = (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * power;
  const ticks = Array.from({ length: count + 1 }, (_, i) => Number((i * step).toPrecision(12)));
  return { max: ticks[count]!, step, ticks };
}
