const FOREGROUND_WINDOW_MS = 750;

let lastForegroundAt = 0;

/** REQ-007：每个 /api/* 请求进入时调用。 */
export function markForegroundRequest(): void {
  lastForegroundAt = Date.now();
}

/** REQ-007：750ms 内有前台请求时为 true，供后台预热让路。 */
export function isForegroundBusy(): boolean {
  return Date.now() - lastForegroundAt < FOREGROUND_WINDOW_MS;
}
