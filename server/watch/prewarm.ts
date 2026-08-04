const BUSY_WAIT_MS = 250;

export interface PrewarmOptions<T> {
  sessions: T[];
  /** REQ-014：750ms 内有前台请求时为 true。 */
  isForegroundBusy: () => boolean;
  loadSession: (session: T) => void | Promise<void>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * REQ-014：后台预热。每个会话前检查 isForegroundBusy()，
 * 忙时 await 250ms 循环等待；每个会话之间 await setTimeout(0) 让出事件循环。
 */
export async function backgroundPrewarm<T>(opts: PrewarmOptions<T>): Promise<number> {
  let warmed = 0;
  for (const session of opts.sessions) {
    while (opts.isForegroundBusy()) {
      await sleep(BUSY_WAIT_MS);
    }
    await opts.loadSession(session);
    warmed += 1;
    await sleep(0);
  }
  return warmed;
}
