export function evaluate(query) {
  return Object.fromEntries(new URLSearchParams(query));
}
