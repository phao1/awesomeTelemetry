export function evaluate(base, attempt, cap, remaining) {
  return Math.max(base * 2 ** (attempt + 1), cap, remaining);
}
