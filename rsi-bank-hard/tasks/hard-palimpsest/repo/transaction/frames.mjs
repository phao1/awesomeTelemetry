export function capture(tx) {
  return { writes: new Map(tx.writes) };
}
export function restore(tx, frame) {
  tx.writes = new Map(frame.writes);
}
