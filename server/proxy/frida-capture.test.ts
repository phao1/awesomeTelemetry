import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { FridaOutputDecoder, parseFridaOutput, FRIDA_FRAME_BYTES, discoverFridaTarget, runFridaMonitor, validateFridaMonitorScript } from './frida-capture.js';
import { resolve } from 'node:path';
function child() { const process = new EventEmitter() as ChildProcess; process.stdout = new PassThrough(); process.stderr = new PassThrough(); process.kill = vi.fn(() => true); return process; }
const frame = (text: string) => '[NEW CHAT DATA]' + text + '[END]';
describe('Frida incremental framing', () => {
  it.each(['utf8', 'utf16le'] as const)('preserves Unicode and frames across every byte in %s stdout', encoding => {
    const data = vi.fn(), errors = vi.fn(), decoder = new FridaOutputDecoder(data, errors);
    const bytes = Buffer.from(frame('{"text":"中文😀 [END] inside"}') + frame('[1,2]'), encoding);
    for (const byte of bytes) decoder.push(Buffer.from([byte]));
    decoder.finish(); expect(errors).not.toHaveBeenCalled(); expect(data.mock.calls.map(call => call[0].jsonData)).toEqual(['{"text":"中文😀 [END] inside"}', '[1,2]']);
  });
  it.each(['utf8', 'utf16le'] as const)('decodes complete HEX %s payload, including split marker and tail', encoding => {
    const data = vi.fn(), errors = vi.fn(), decoder = new FridaOutputDecoder(data, errors);
    const wire = frame('[HEX]' + Buffer.from('{"text":"中😀"}', encoding).toString('hex'));
    decoder.push(Buffer.from(wire + '[NEW CHAT DA')); expect(data).toHaveBeenCalledTimes(1);
    decoder.push(Buffer.from('TA]{"next":true}[END]')); decoder.finish(); expect(data).toHaveBeenCalledTimes(2); expect(errors).not.toHaveBeenCalled();
  });
  it.each(['{"x":', '[HEX]abc', '[HEX]gg', '[HEX]ff', 'null', '{broken}', '{"note":"monitor skeleton"}'])('rejects malformed/skeleton payload %s', body => { expect(() => parseFridaOutput(frame(body))).toThrow(); });
  it('never emits incomplete frames, detects nested new frame, preserves subsequent valid frames', () => {
    const data = vi.fn(), errors = vi.fn(), decoder = new FridaOutputDecoder(data, errors);
    decoder.push(Buffer.from('[NEW CHAT DATA]{"a":1}')); expect(data).not.toHaveBeenCalled();
    decoder.push(Buffer.from(frame('{"b":2}') + '[NEW CHAT DATA]{')); decoder.finish();
    expect(data).toHaveBeenCalledTimes(1); expect(errors.mock.calls.map(call => call[0].code)).toEqual(['FRIDA_FRAME_INCOMPLETE', 'FRIDA_FRAME_INCOMPLETE']);
  });
  it('bounds frame and noise buffers, rejecting oversized input and recovering at new frame', () => {
    const data = vi.fn(), errors = vi.fn(), decoder = new FridaOutputDecoder(data, errors);
    decoder.push(Buffer.from('noise'.repeat(FRIDA_FRAME_BYTES))); expect(decoder.bufferedCharacters).toBeLessThan(16);
    decoder.push(Buffer.from('[NEW CHAT DATA]' + 'x'.repeat(FRIDA_FRAME_BYTES + 100))); expect(decoder.bufferedCharacters).toBeLessThan(16);
    decoder.push(Buffer.from(frame('{"ok":true}'))); decoder.finish(); expect(data).toHaveBeenCalledTimes(1); expect(errors).toHaveBeenCalled();
  });
  it('rejects invalid streaming Unicode and never replaces bytes with replacement characters', () => {
    const data = vi.fn(), errors = vi.fn(), decoder = new FridaOutputDecoder(data, errors);
    decoder.push(Buffer.concat([Buffer.from('[NEW CHAT DATA]{"x":"'), Buffer.from([0xff]), Buffer.from('"}[END]')])); decoder.finish();
    expect(data).not.toHaveBeenCalled(); expect(errors).toHaveBeenCalled();
  });
  it('uses real decoder with injected subprocess stream and flushes incomplete close', () => {
    const process = child(), data = vi.fn(), errors = vi.fn(), spawn = vi.fn(() => process);
    runFridaMonitor(42, '/synthetic.js', data, errors, spawn);
    process.stdout!.emit('data', Buffer.from(frame('{"a":1}') + '[NEW CHAT DATA]{')); process.emit('close', 0);
    expect(spawn).toHaveBeenCalledWith('frida', ['-p', '42', '-l', '/synthetic.js']); expect(data.mock.calls[0]?.[0].pid).toBe(42); expect(errors).toHaveBeenCalled();
  });
  it('rejects actual packaged skeleton without running it', async () => { await expect(validateFridaMonitorScript(resolve('scripts/frida-chat-monitor-v2.js'))).rejects.toThrow('FRIDA_SCRIPT_UNIMPLEMENTED'); });
});
describe('Frida target discovery protocol', () => {
  it('probes actual tasklist candidates and accepts only exact AI_AGENT_FOUND marker', async () => {
    const spawn = vi.fn((_command: string, args: string[]) => { const process = child(); queueMicrotask(() => { process.stdout!.emit('data', Buffer.from(args[0] === '/FI' ? '"Trae CN.exe","12","Console"\r\n"Trae CN.exe","34","Console"' : args[1] === '12' ? '[AI_AGENT_NOT_FOUND]\n' : '[AI_AGENT_FOUND]\n')); process.emit('close', 0); }); return process; });
    await expect(discoverFridaTarget({ platform: 'win32', spawnProcess: spawn })).resolves.toBe(34); expect(spawn).toHaveBeenCalledTimes(3);
  });
  it('rejects misleading probe strings and unsupported platforms', async () => {
    const spawn = vi.fn((_command: string, args: string[]) => { const process = child(); queueMicrotask(() => { process.stdout!.emit('data', Buffer.from(args[0] === '/FI' ? '"Trae CN.exe","12"' : 'script says [AI_AGENT_FOUND]')); process.emit('close', 0); }); return process; });
    await expect(discoverFridaTarget({ platform: 'win32', spawnProcess: spawn })).rejects.toThrow('FRIDA_TARGET_NOT_FOUND');
    await expect(discoverFridaTarget({ platform: 'darwin', spawnProcess: spawn })).rejects.toThrow('Windows');
  });
});

it('probe timeout kills and retains ownership until the actual close event', async () => {
  vi.useFakeTimers();
  try {
    const process = child(), result = discoverFridaTarget({ platform: 'win32', spawnProcess: () => process, timeoutMs: 10 });
    const rejected = result.catch(error => error as Error), settled = vi.fn(); void rejected.then(settled);
    await vi.advanceTimersByTimeAsync(10); expect(process.kill).toHaveBeenCalledTimes(1); expect(settled).not.toHaveBeenCalled();
    process.emit('close', null); expect(await rejected).toBeInstanceOf(Error);
  } finally { vi.useRealTimers(); }
});

it('ignores one-byte noise but reports a one-byte partial start marker at EOF', () => {
  const data = vi.fn(), errors = vi.fn();
  const noise = new FridaOutputDecoder(data, errors); noise.push(Buffer.from('x')); noise.finish(); expect(errors).not.toHaveBeenCalled();
  const partial = new FridaOutputDecoder(data, errors); partial.push(Buffer.from('[')); partial.finish(); expect(errors.mock.calls[0]?.[0].code).toBe('FRIDA_FRAME_INCOMPLETE'); expect(data).not.toHaveBeenCalled();
});
