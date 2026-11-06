export function reserve(s, id, qty) {
  s.available -= qty;
  s.holds.set(id, qty);
}
export function release(s, id) {
  s.available += s.holds.get(id) ?? 0;
}
