import { describe, expect, it } from 'vitest';
import { isolationArgs, runProcess } from './docker.js';
describe('bounded asynchronous processes', () => {
  it('keeps argv literal without shell expansion', async () => {
    const value = '$(touch /tmp/rsi-must-not-exist); `false`';
    const r = await runProcess(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', value]);
    expect(r.code).toBe(0); expect(r.stdout.toString()).toBe(value);
  });
  it('kills a timed out process', async () => {
    const r = await runProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeoutMs: 50 });
    expect(r.timedOut).toBe(true); expect(r.code).not.toBe(0);
  });
  it('cancels a live process', async () => {
    const controller = new AbortController(); const promise = runProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { signal: controller.signal });
    controller.abort(); expect((await promise).cancelled).toBe(true);
  });
  it('bounds combined stdout and stderr', async () => {
    const r = await runProcess(process.execPath, ['-e', 'process.stdout.write("x".repeat(1000000))'], { maxOutputBytes: 100 });
    expect(r.overflow).toBe(true); expect(r.stdout.length + r.stderr.length).toBeLessThanOrEqual(100);
  });
  it('does not start an already cancelled command and propagates startup failure', async () => {
    expect((await runProcess('does-not-exist', [], { signal: AbortSignal.abort() })).cancelled).toBe(true);
    await expect(runProcess('/does/not/exist', [])).rejects.toThrow('Cannot start');
  });
  it('requires isolated unprivileged containers with finite limits and no mounts', () => {
    const argv = isolationArgs('internal', 'task', 'name');
    for (const flag of ['--cap-drop', 'ALL', 'no-new-privileges', '--memory', '--cpus', '--pids-limit']) expect(argv).toContain(flag);
    expect(argv).not.toContain('-v'); expect(argv).not.toContain('--mount'); expect(argv).not.toContain('-w');
  });
});
