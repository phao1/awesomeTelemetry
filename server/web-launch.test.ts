import { describe, expect, it, vi } from 'vitest';
import { browserCommand, handoffBrowser, launchedThroughSsh, validateBindHost, webUrl } from './web-launch.js';
import { parseCliArgs } from './cli.js';

describe('Web command and browser handoff', () => {
  it('reuses legacy defaults and arguments through web', () => {
    expect(parseCliArgs(['web', '--port=0', '--no-open'])).toMatchObject({ host: '127.0.0.1', port: 0, open: false });
    expect(parseCliArgs(['web'])).toEqual(parseCliArgs([]));
  });
  it.each([['--host', '--no-open'], ['--host='], ['--host=127.0.0.1;touch'], ['--host=http://localhost'], ['--host=[::1]'], ['--port='], ['--port=1e3'], ['--no-open=false'], ['web', 'extra']])('rejects malformed CLI arguments %j', (...args) => {
    expect(() => parseCliArgs(args)).toThrow();
  });
  it('separates wildcard binds from browser URL and brackets IPv6', () => {
    expect(webUrl('0.0.0.0', 12345)).toBe('http://127.0.0.1:12345/');
    expect(webUrl('::', 12345)).toBe('http://[::1]:12345/');
    expect(webUrl('::1', 12345)).toBe('http://[::1]:12345/');
    expect(validateBindHost('my-host.example')).toBe('my-host.example');
  });
  it('suppresses opening for nonempty inherited SSH variables, including Windows casing', () => {
    expect(launchedThroughSsh({ SSH_CONNECTION: 'client server' })).toBe(true);
    expect(launchedThroughSsh({ ssh_tty: 'pts/1' })).toBe(true);
    expect(launchedThroughSsh({ SSH_TTY: '  ', SSH_CONNECTION: '' })).toBe(false);
    expect(launchedThroughSsh({})).toBe(false);
  });
  it('passes one URL argument without shell interpolation on macOS, Windows and Linux', () => {
    const url = 'http://127.0.0.1:4173/';
    expect(browserCommand(url, 'darwin')).toEqual({ file: '/usr/bin/open', args: [url] });
    expect(browserCommand(url, 'win32')).toEqual({ file: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', url] });
    expect(browserCommand(url, 'linux')).toEqual({ file: 'xdg-open', args: [url] });
    expect(() => browserCommand('file:///tmp/a', 'win32')).toThrow();
    expect(() => browserCommand(url + '?x=&calc.exe', 'win32')).toThrow();
  });
});

describe('browser handoff failure and suppression', () => {
  it('skips both SSH and --no-open, opens once locally, and recovers from launcher errors', async () => {
    const open = vi.fn(async () => {}), warn = vi.fn();
    const url = 'http://127.0.0.1:4173/';
    await handoffBrowser(url, false, {}, open, warn);
    await handoffBrowser(url, true, { SSH_TTY: 'pts/1' }, open, warn);
    expect(open).not.toHaveBeenCalled();
    await handoffBrowser(url, true, {}, open, warn);
    expect(open).toHaveBeenCalledExactlyOnceWith(url);
    open.mockRejectedValueOnce(new Error('launcher unavailable'));
    await expect(handoffBrowser(url, true, {}, open, warn)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('the server is still running'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(url));
  });
});
