export function evaluate(now, expiresAt, enabled) {
  return enabled || now <= expiresAt;
}
