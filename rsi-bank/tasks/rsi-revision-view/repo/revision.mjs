export function newer(next, old) {
  return !old || next.revision >= old.revision;
}
