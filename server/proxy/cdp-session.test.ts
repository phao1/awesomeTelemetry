import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CDP_LIMITS } from './cdp-capture';
import type { CdpTarget, CdpWebSocket } from './cdp-capture';
import { CdpCaptureSession } from './cdp-session';
import type { CdpCaptureSessionOptions } from './cdp-session';

// Only the wire is substituted: the manager uses the real connect/correlation code.
class Socket implements CdpWebSocket {
  onopen: CdpWebSocket['onopen'] = null;
  onmessage: CdpWebSocket['onmessage'] = null;
  onerror: CdpWebSocket['onerror'] = null;
  onclose: CdpWebSocket['onclose'] = null;
  sent: { id: number; method: string }[] = [];
  close = vi.fn();
  send(data: string) { this.sent.push(JSON.parse(data)); }
  message(value: unknown) { this.onmessage?.call(this as unknown as WebSocket, { data: JSON.stringify(value) } as MessageEvent); }
  ready() {
    this.onopen?.call(this as unknown as WebSocket, {} as Event);
    for (const { id } of this.sent.slice(0, 2)) this.message({ id, result: {} });
  }
  capture() {
    const requestId = 'fixture-request'; const url = 'https://fixture.invalid/body';
    this.message({ method: 'Network.requestWillBeSent', params: { requestId, request: { url } } });
    this.message({ method: 'Network.responseReceived', params: { requestId, response: { url, status: 200 } } });
    this.message({ method: 'Network.loadingFinished', params: { requestId } });
    this.message({ id: 3, result: { body: 'fixture-body', base64Encoded: false } });
  }
}
const target = (id: string): CdpTarget => ({ id, title: id, url: 'https://fixture.invalid', webSocketDebuggerUrl: `ws://127.0.0.1:9222/devtools/page/${id}` });
function harness(options: Partial<CdpCaptureSessionOptions> = {}) {
  const sockets: Socket[] = [];
  const discover = vi.fn<NonNullable<CdpCaptureSessionOptions['discover']>>().mockResolvedValue([target('a')]);
  const capture = vi.fn(); const issue = vi.fn();
  const session = new CdpCaptureSession({
    devOnly: true, discover, onIssue: issue,
    webSocketFactory: () => { const socket = new Socket(); sockets.push(socket); return socket; },
    ...options,
  }, capture);
  return { session, sockets, discover, capture, issue };
}
async function settle() { for (let i = 0; i < 8; i++) await Promise.resolve(); }
beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('explicit dev-only CDP session', () => {
  it('does no constructor IO, joins repeated start, and exposes connected only after ACKs', async () => {
    const t = harness(); expect(t.discover).not.toHaveBeenCalled();
    expect(t.session.getStatus()).toEqual({ state: 'idle', discovering: false, targetCount: 0, connectedTargetCount: 0 });
    const starting = t.session.start(); expect(t.session.start()).toBe(starting); await starting;
    expect(t.discover).toHaveBeenCalledOnce(); expect(t.sockets).toHaveLength(1);
    expect(t.session.getStatus().connectedTargetCount).toBe(0);
    t.sockets[0]!.ready(); await settle();
    expect(t.session.getStatus().connectedTargetCount).toBe(1);
    t.sockets[0]!.capture(); expect(t.capture).toHaveBeenCalledWith({ url: 'https://fixture.invalid/body', body: 'fixture-body' }, target('a'));
    await t.session.stop(); expect(t.session.getStatus().state).toBe('idle'); expect(vi.getTimerCount()).toBe(0);
  });

  it('discovers every 10 seconds and reconciles add/remove/socket replacement', async () => {
    const t = harness(); await t.session.start(); t.sockets[0]!.ready(); await settle();
    t.discover.mockResolvedValue([target('a'), target('b')]);
    await vi.advanceTimersByTimeAsync(9999); expect(t.discover).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(t.discover).toHaveBeenCalledTimes(2); expect(t.sockets).toHaveLength(2);
    t.sockets[1]!.ready(); await settle();
    t.discover.mockResolvedValue([{ ...target('b'), webSocketDebuggerUrl: target('replacement').webSocketDebuggerUrl }]);
    await vi.advanceTimersByTimeAsync(10000);
    expect(t.sockets[0]!.close).toHaveBeenCalledOnce(); expect(t.sockets[1]!.close).toHaveBeenCalledOnce(); expect(t.sockets).toHaveLength(3);
    await t.session.stop(); expect(t.sockets[2]!.close).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });

  it('does not overlap discovery; stop finishes even when the injected discovery ignores abort', async () => {
    let release!: (targets: CdpTarget[]) => void;
    const discover = vi.fn<NonNullable<CdpCaptureSessionOptions['discover']>>().mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    const t = harness({ discover }); const starting = t.session.start(); await settle();
    expect(t.session.start()).toBe(starting); expect(discover).toHaveBeenCalledOnce();
    const stopping = t.session.stop(); expect(t.session.stop()).toBe(stopping);
    await expect(t.session.start()).rejects.toThrow('stopping'); await stopping; await starting;
    release([target('late')]); await settle(); expect(t.sockets).toHaveLength(0); expect(vi.getTimerCount()).toBe(0);
  });

  it('times out discovery without overlapping it or adopting a late snapshot', async () => {
    let release!: (targets: CdpTarget[]) => void;
    const discover = vi.fn<NonNullable<CdpCaptureSessionOptions['discover']>>().mockImplementationOnce(() => new Promise((resolve) => { release = resolve; })).mockResolvedValue([]);
    const t = harness({ discover }); const starting = t.session.start(); await settle();
    await vi.advanceTimersByTimeAsync(CDP_LIMITS.discoveryTimeoutMs); await starting;
    expect(t.issue).toHaveBeenCalledWith({ code: 'discovery_error', requestId: null, commandId: null });
    release([target('late')]); await settle(); expect(t.sockets).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(5000); expect(discover).toHaveBeenCalledTimes(2); await t.session.stop();
  });

  it('preserves connected targets on discovery errors and rejects conflicting duplicate ids', async () => {
    const t = harness(); await t.session.start(); t.sockets[0]!.ready(); await settle();
    t.discover.mockRejectedValueOnce(new Error('fixture offline'));
    await vi.advanceTimersByTimeAsync(10000); expect(t.sockets[0]!.close).not.toHaveBeenCalled();
    t.discover.mockResolvedValueOnce([target('a'), { ...target('a'), webSocketDebuggerUrl: target('conflict').webSocketDebuggerUrl }]);
    await vi.advanceTimersByTimeAsync(10000); expect(t.sockets[0]!.close).not.toHaveBeenCalled(); expect(t.issue).toHaveBeenCalledTimes(2);
    await t.session.stop();
  });

  it('bounds connecting plus connected targets and deduplicates exact target repeats', async () => {
    const t = harness();
    t.discover.mockResolvedValue([target('0'), ...Array.from({ length: 20 }, (_, i) => target(String(i)))]);
    await t.session.start(); expect(t.sockets).toHaveLength(CDP_LIMITS.maxTargets); expect(t.session.getStatus().targetCount).toBe(16);
    expect(t.issue).toHaveBeenCalledWith({ code: 'target_limit', requestId: null, commandId: null });
    await t.session.stop(); expect(t.sockets.every((socket) => socket.close.mock.calls.length === 1)).toBe(true); expect(vi.getTimerCount()).toBe(0);
  });

  it('cleans connecting and late ACK/capture callbacks across stop/restart', async () => {
    const t = harness(); await t.session.start();
    const lateOpen = t.sockets[0]!.onopen; const lateMessage = t.sockets[0]!.onmessage;
    await t.session.stop(); await t.session.start();
    lateOpen?.call(t.sockets[0] as unknown as WebSocket, {} as Event);
    lateMessage?.call(t.sockets[0] as unknown as WebSocket, { data: JSON.stringify({ id: 1, result: {} }) } as MessageEvent);
    expect(t.session.getStatus().connectedTargetCount).toBe(0); expect(t.sockets[0]!.sent).toHaveLength(0);
    t.sockets[1]!.ready(); await settle(); t.sockets[1]!.capture(); expect(t.capture).toHaveBeenCalledOnce(); await t.session.stop();
  });

  it('reconnects a disconnected target only on a later discovery cycle', async () => {
    const t = harness(); await t.session.start(); t.sockets[0]!.ready(); await settle();
    t.sockets[0]!.onclose?.call(t.sockets[0] as unknown as WebSocket, {} as CloseEvent);
    expect(t.session.getStatus().targetCount).toBe(0); expect(t.sockets).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(10000); expect(t.sockets).toHaveLength(2); await t.session.stop();
  });

  it('contains a rejected enable/factory and retries on the next cycle', async () => {
    const t = harness(); await t.session.start(); t.sockets[0]!.onopen?.call(t.sockets[0] as unknown as WebSocket, {} as Event);
    t.sockets[0]!.message({ id: 1, error: { code: -1 } }); await settle();
    expect(t.session.getStatus().targetCount).toBe(0);
    await vi.advanceTimersByTimeAsync(10000); expect(t.sockets).toHaveLength(2); await t.session.stop();
    const broken = harness({ webSocketFactory: () => { throw new Error('unavailable'); } }); await broken.session.start(); await settle();
    expect(broken.session.getStatus().targetCount).toBe(0); expect(broken.issue).toHaveBeenCalledWith({ code: 'connection_error', requestId: null, commandId: null }); await broken.session.stop();
  });

  it('requires the dev-only precondition and honors the external abort signal', async () => {
    expect(() => new CdpCaptureSession({ devOnly: false } as unknown as CdpCaptureSessionOptions, vi.fn())).toThrow('dev-only');
    const controller = new AbortController(); const t = harness({ signal: controller.signal });
    await t.session.start(); t.sockets[0]!.ready(); await settle(); controller.abort(); await t.session.stop();
    expect(t.sockets[0]!.close).toHaveBeenCalledOnce(); await expect(t.session.start()).rejects.toThrow('aborted'); expect(vi.getTimerCount()).toBe(0);
  });
});
