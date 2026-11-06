// Owned by the platform and installed outside the patched workspace.
export default async function* reporter(source) {
  let infrastructure = false;
  for await (const event of source) {
    if (event.type === 'test:fail') {
      let error = event.data.details?.error;
      for (let depth = 0; error && depth < 8; depth++, error = error.cause) {
        if (['EACCES', 'EPERM', 'EIO', 'ENOSPC'].includes(error.code)) infrastructure = true;
      }
    }
    if (event.type === 'test:summary' && event.data.file === undefined) {
      const c = event.data.counts;
      yield `${JSON.stringify({ reporter: 'rsi-node-v1', tests: c.tests, passed: c.passed, failed: c.failed,
        skipped: c.skipped, cancelled: c.cancelled, todo: c.todo, infrastructure })}\n`;
    }
  }
}
