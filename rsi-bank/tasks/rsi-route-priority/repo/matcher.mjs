const segments = p => p.replace(/^\/+|\/+$/g, "").split("/");
export function matches(pattern, path) {
  const a = segments(pattern), b = segments(path);
  return a.every((part, i) => part.startsWith(":") || part === b[i]);
}
export function score(pattern) {
  return segments(pattern).length;
}
