import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CDP_LIMITS, connectCdpCapture, discoverCdpTargets } from './cdp-capture';
import type { CdpCaptureOptions, CdpTarget, CdpWebSocket } from './cdp-capture';

class Socket implements CdpWebSocket {
  onopen: CdpWebSocket['onopen'] = null;
  onmessage: CdpWebSocket['onmessage'] = null;
  onerror: CdpWebSocket['onerror'] = null;
  onclose: CdpWebSocket['onclose'] = null;
  sent: { id: number; method: string; params?: Record<string, unknown> }[] = [];
  close = vi.fn();
  send(data: string) { this.sent.push(JSON.parse(data)); }
  open() { this.onopen?.call(this as unknown as WebSocket, {} as Event); }
  message(value: unknown) { this.raw(JSON.stringify(value)); }
  raw(data: unknown) { this.onmessage?.call(this as unknown as WebSocket, { data } as MessageEvent); }
  event(method: string, params: Record<string, unknown>) { this.message({ method: `Network.${method}`, params }); }
  ack() { for (const { id } of this.sent.slice(0, 2)) this.message({ id, result: {} }); }
  request(id: string, url = `https://fixture.invalid/${id}`) { this.event('requestWillBeSent', { requestId: id, request: { url } }); }
  response(id: string, url = `https://fixture.invalid/${id}`, status = 200) { this.event('responseReceived', { requestId: id, response: { url, status } }); }
  finish(id: string) { this.event('loadingFinished', { requestId: id }); }
  complete(id: string) { this.request(id); this.response(id); this.finish(id); }
  body(id: number, body = 'payload', base64Encoded = false) { this.message({ id, result: { body, base64Encoded } }); }
}
const target: CdpTarget = { id: 'fixture', title: 'Fixture', url: 'https://fixture.invalid', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/fixture' };
function setup(options: CdpCaptureOptions = {}) {
  const socket = new Socket();
  const capture = vi.fn();
  const issue = vi.fn();
  const ready = connectCdpCapture(target, capture, { webSocketFactory: () => socket, onIssue: issue, ...options });
  return { socket, capture, issue, ready };
}
async function connected(options: CdpCaptureOptions = {}) {
  const test = setup(options);
  test.socket.open(); test.socket.ack();
  return { ...test, stop: await test.ready };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('CDP protocol correlation', () => {
  it('waits for both enable ACKs and assigns unique monotonic command ids', async () => {
    const t = setup();
    const settled = vi.fn(); void t.ready.then(settled);
    t.socket.open();
    expect(t.socket.sent.map(({ id, method }) => ({ id, method }))).toEqual([
      { id: 1, method: 'Network.enable' }, { id: 2, method: 'Page.enable' },
    ]);
    t.socket.complete('1');
    t.socket.message({ id: 2, result: {} });
    await Promise.resolve(); expect(settled).not.toHaveBeenCalled();
    expect(t.socket.sent).toHaveLength(2);
    t.socket.message({ id: 1, result: {} });
    const stop = await t.ready;
    t.socket.complete('2');
    expect(t.socket.sent.slice(2).map((c) => [c.id, c.params?.requestId])).toEqual([[3, '1'], [4, '2']]);
    // Body replies may arrive in the opposite order to their requests.
    t.socket.body(4, 'second'); t.socket.body(3, 'first');
    t.socket.body(3, 'duplicate'); t.socket.body(999, 'unknown');
    expect(t.capture.mock.calls).toEqual([[{ url: 'https://fixture.invalid/2', body: 'second' }], [{ url: 'https://fixture.invalid/1', body: 'first' }]]);
    stop(); expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    ['request', 'response', 'finish'], ['request', 'finish', 'response'],
    ['response', 'request', 'finish'], ['response', 'finish', 'request'],
    ['finish', 'request', 'response'], ['finish', 'response', 'request'],
  ] as const)('correlates explicit IDs in order %s/%s/%s', async (...order) => {
    const t = await connected();
    for (const event of order) t.socket[event]('id');
    expect(t.socket.sent[2]?.params).toEqual({ requestId: 'id' });
    t.socket.body(3, Buffer.from('你好 🌍').toString('base64'), true);
    expect(t.capture).toHaveBeenCalledWith({ url: 'https://fixture.invalid/id', body: '你好 🌍' });
    t.stop();
  });

  it('accepts empty response bodies without fabricating content', async () => {
    const t = await connected(); t.socket.complete('empty'); t.socket.body(3, '');
    expect(t.capture).toHaveBeenCalledWith({ url: 'https://fixture.invalid/empty', body: '' }); t.stop();
  });

  it.each([
    { body: '%%%', base64Encoded: true }, { body: '/w==', base64Encoded: true },
    { body: 'YQ', base64Encoded: true }, { body: 'value' },
    { body: 42, base64Encoded: false },
    { body: 'x'.repeat(CDP_LIMITS.maxBodyBytes + 1), base64Encoded: false },
  ])('rejects invalid or oversized body $base64Encoded', async (result) => {
    const t = await connected(); t.socket.complete('id');
    t.socket.message({ id: 3, result });
    expect(t.capture).not.toHaveBeenCalled();
    expect(t.issue).toHaveBeenCalledWith({ code: 'invalid_body', requestId: 'id', commandId: 3 }); t.stop();
  });

  it('uses the last explicitly observed normal redirect hop', async () => {
    const t = await connected();
    t.socket.request('redirect', 'https://fixture.invalid/old');
    t.socket.event('requestWillBeSent', { requestId: 'redirect', request: { url: 'https://fixture.invalid/new' }, redirectResponse: { url: 'https://fixture.invalid/old', status: 302 } });
    t.socket.response('redirect', 'https://fixture.invalid/new'); t.socket.finish('redirect'); t.socket.body(3);
    expect(t.capture).toHaveBeenCalledWith({ url: 'https://fixture.invalid/new', body: 'payload' }); t.stop();
  });

  it('quarantines reused IDs and ignores the previous hop late body result', async () => {
    const t = await connected(); t.socket.complete('same');
    t.socket.event('requestWillBeSent', { requestId: 'same', request: { url: 'https://fixture.invalid/new' }, redirectResponse: { url: 'https://fixture.invalid/same' } });
    t.socket.body(3, 'old'); t.socket.complete('same'); t.socket.body(4, 'new');
    expect(t.capture).not.toHaveBeenCalled(); expect(t.socket.sent).toHaveLength(3);
    expect(t.issue).toHaveBeenCalledWith({ code: 'ambiguous_request', requestId: 'same', commandId: 3 }); t.stop();
  });

  it('quarantines repeated starts, mismatched response URLs and missing redirect ancestry', async () => {
    const t = await connected();
    t.socket.request('duplicate'); t.socket.request('duplicate'); t.socket.response('duplicate'); t.socket.finish('duplicate');
    t.socket.request('mismatch'); t.socket.response('mismatch', 'https://fixture.invalid/different'); t.socket.finish('mismatch');
    t.socket.event('requestWillBeSent', { requestId: 'orphan', request: { url: 'https://fixture.invalid/new' }, redirectResponse: { url: 'https://fixture.invalid/old' } });
    t.socket.response('orphan', 'https://fixture.invalid/new'); t.socket.finish('orphan');
    expect(t.socket.sent).toHaveLength(2); expect(t.capture).not.toHaveBeenCalled();
    expect(t.issue).toHaveBeenCalledTimes(3); t.stop();
  });

  it('does not resurrect a completed ID or a failed request', async () => {
    const t = await connected(); t.socket.complete('done'); t.socket.body(3);
    t.socket.complete('done');
    t.socket.complete('failed'); t.socket.event('loadingFailed', { requestId: 'failed', errorText: 'fixture' }); t.socket.body(4);
    t.socket.event('loadingFailed', { requestId: 'early' }); t.socket.complete('early');
    expect(t.capture).toHaveBeenCalledTimes(1); expect(t.socket.sent).toHaveLength(4); t.stop();
  });

  it('requires URL/status evidence, reports HTTP failures, and expires missing events', async () => {
    const t = await connected();
    t.socket.finish('orphan'); t.socket.request('partial'); t.socket.finish('partial');
    t.socket.request('http'); t.socket.response('http', undefined, 500); t.socket.finish('http');
    t.socket.request('invalid'); t.socket.event('responseReceived', { requestId: 'invalid', response: { url: 'https://fixture.invalid/invalid' } });
    await vi.advanceTimersByTimeAsync(CDP_LIMITS.requestTimeoutMs);
    t.socket.complete('orphan'); t.socket.complete('partial');
    expect(t.capture).not.toHaveBeenCalled(); expect(t.socket.sent).toHaveLength(2);
    expect(t.issue.mock.calls.map(([i]) => i.code)).toEqual(['http_error', 'invalid_message', 'request_timeout', 'request_timeout']); t.stop();
  });

  it('distinguishes body command errors/timeouts and suppresses late replies', async () => {
    const t = await connected(); t.socket.complete('error');
    t.socket.message({ id: 3, error: { code: -32000, message: 'No resource' } });
    t.socket.complete('timeout'); await vi.advanceTimersByTimeAsync(CDP_LIMITS.commandTimeoutMs); t.socket.body(4);
    expect(t.capture).not.toHaveBeenCalled();
    expect(t.issue.mock.calls.map(([i]) => i.code)).toEqual(['command_error', 'command_timeout']); t.stop();
  });

  it.each(['connection', 'enable', 'error', 'close'] as const)('rejects startup on %s failure and releases timers/listeners', async (mode) => {
    const t = setup(); const rejection = expect(t.ready).rejects.toThrow();
    if (mode !== 'connection') t.socket.open();
    if (mode === 'error') t.socket.message({ id: 1, error: { code: -1 } });
    else if (mode === 'close') t.socket.onclose?.call(t.socket as unknown as WebSocket, {} as CloseEvent);
    else await vi.advanceTimersByTimeAsync(5000);
    await rejection; expect(t.socket.close).toHaveBeenCalledOnce(); expect(t.socket.onmessage).toBeNull(); expect(vi.getTimerCount()).toBe(0);
  });

  it('aborts connecting sockets and makes active stop idempotent against saved late callbacks', async () => {
    const controller = new AbortController(); const t = setup({ signal: controller.signal });
    const rejection = expect(t.ready).rejects.toThrow('CDP stopped'); controller.abort(); await rejection;
    const live = await connected(); live.socket.complete('id'); const late = live.socket.onmessage;
    live.stop(); live.stop(); late?.call(live.socket as unknown as WebSocket, { data: JSON.stringify({ id: 3, result: { body: 'late', base64Encoded: false } }) } as MessageEvent);
    expect(live.capture).not.toHaveBeenCalled(); expect(live.socket.close).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });

  it('cleans active disconnect and isolates consumer callback failures', async () => {
    const socket = new Socket(); const issue = vi.fn(); const disconnected = vi.fn();
    const ready = connectCdpCapture(target, () => { throw new Error('consumer'); }, { webSocketFactory: () => socket, onIssue: issue, onDisconnect: disconnected });
    socket.open(); socket.ack(); await ready; socket.complete('id'); socket.body(3);
    expect(issue).toHaveBeenCalledWith({ code: 'callback_error', requestId: 'id', commandId: 3 });
    socket.onclose?.call(socket as unknown as WebSocket, {} as CloseEvent);
    expect(disconnected).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['{bad', 'null', '[]', 'x'.repeat(CDP_LIMITS.maxMessageBytes + 1)])('closes malformed or oversized frames without success', async (wire) => {
    const t = await connected(); t.socket.raw(wire);
    expect(t.socket.close).toHaveBeenCalledOnce(); expect(t.capture).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });

  it('ignores unrelated events and duplicate ACKs, but handles synchronous send failure', async () => {
    const t = setup(); t.socket.open();
    t.socket.message({ id: 1, result: {} }); t.socket.message({ id: 1, result: {} });
    t.socket.message({ method: 'Page.loadEventFired', params: {} });
    t.socket.complete('waiting'); expect(t.socket.sent).toHaveLength(2);
    t.socket.message({ id: 2, result: {} }); const stop = await t.ready;
    t.socket.body(3); expect(t.capture).toHaveBeenCalledOnce(); stop();
    const broken = setup(); const failed = expect(broken.ready).rejects.toThrow('connection_error');
    broken.socket.send = () => { throw new Error('closed wire'); };
    broken.socket.open(); await failed; expect(broken.socket.close).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });

  it('stops from a capture callback without dispatching other queued results', async () => {
    const socket = new Socket(); const controller = new AbortController(); const capture = vi.fn(() => controller.abort());
    const ready = connectCdpCapture(target, capture, { signal: controller.signal, webSocketFactory: () => socket });
    socket.open(); socket.ack(); await ready; socket.complete('first'); socket.complete('second');
    socket.body(3); socket.body(4); expect(capture).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
    const factory = vi.fn(); await expect(connectCdpCapture(target, vi.fn(), { signal: controller.signal, webSocketFactory: factory })).rejects.toThrow('CDP stopped'); expect(factory).not.toHaveBeenCalled();
  });

  it.each(['requests', 'commands', 'seen'] as const)('bounds %s ownership without unsafe eviction', async (mode) => {
    const t = await connected();
    const count = mode === 'requests' ? CDP_LIMITS.maxRequests : mode === 'commands' ? CDP_LIMITS.maxPendingCommands : CDP_LIMITS.maxSeenRequestIds;
    for (let i = 0; i <= count; i++) {
      t.socket.request(String(i));
      if (mode === 'commands') { t.socket.response(String(i)); t.socket.finish(String(i)); }
      if (mode === 'seen') t.socket.event('loadingFailed', { requestId: String(i) });
    }
    expect(t.socket.close).toHaveBeenCalledOnce();
    expect(t.issue).toHaveBeenLastCalledWith({ code: 'resource_limit', requestId: null, commandId: null }); expect(vi.getTimerCount()).toBe(0);
  });
});

describe('bounded loopback target discovery', () => {
  it('validates targets and uses the fixed loopback URL without following redirects', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify([target, { ...target, id: 'remote', webSocketDebuggerUrl: 'ws://remote.invalid:9222/page' }, {}, { ...target, id: 'port', webSocketDebuggerUrl: 'ws://127.0.0.1:8000/page' }])));
    expect(await discoverCdpTargets(9222, { fetch: fetcher })).toEqual([target]);
    expect(fetcher).toHaveBeenCalledWith('http://127.0.0.1:9222/json', expect.objectContaining({ redirect: 'error', signal: expect.any(AbortSignal) })); expect(vi.getTimerCount()).toBe(0);
  });
  it.each([new Response('fail', { status: 503 }), new Response('{}'), new Response('['), new Response('x'.repeat(CDP_LIMITS.maxDiscoveryBytes + 1)), new Response(JSON.stringify(Array.from({ length: 65 }, () => target)))])('rejects invalid discovery rather than reporting no targets', async (response) => {
    await expect(discoverCdpTargets(9222, { fetch: vi.fn<typeof fetch>().mockResolvedValue(response) })).rejects.toThrow(); expect(vi.getTimerCount()).toBe(0);
  });
  it('bounds a stalled body read and cancels its stream without waiting for a peer', async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ cancel }));
    const result = discoverCdpTargets(9222, { fetch: vi.fn<typeof fetch>().mockResolvedValue(response) });
    const failed = expect(result).rejects.toThrow('CDP discovery aborted');
    await vi.advanceTimersByTimeAsync(CDP_LIMITS.discoveryTimeoutMs); await failed;
    expect(cancel).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });

  it('does not transfer a late response after deadline, and skips pre-aborted discovery', async () => {
    let release!: (response: Response) => void;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    const result = discoverCdpTargets(9222, { fetch: fetcher }); const failed = expect(result).rejects.toThrow('CDP discovery aborted');
    await vi.advanceTimersByTimeAsync(CDP_LIMITS.discoveryTimeoutMs); await failed;
    const cancel = vi.fn(); release(new Response(new ReadableStream({ cancel })));
    await Promise.resolve(); await Promise.resolve(); expect(cancel).toHaveBeenCalledOnce();
    const controller = new AbortController(); controller.abort();
    await expect(discoverCdpTargets(9222, { fetch: fetcher, signal: controller.signal })).rejects.toThrow('aborted'); expect(fetcher).toHaveBeenCalledOnce();
  });

  it('aborts discovery at its deadline and rejects remote socket URLs before creation', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))));
    const result = discoverCdpTargets(9222, { fetch: fetcher }); const failed = expect(result).rejects.toThrow('aborted');
    await vi.advanceTimersByTimeAsync(CDP_LIMITS.discoveryTimeoutMs); await failed;
    const factory = vi.fn(); await expect(connectCdpCapture({ ...target, webSocketDebuggerUrl: 'ws://remote.invalid:9222' }, vi.fn(), { webSocketFactory: factory })).rejects.toThrow('Invalid CDP socket URL'); expect(factory).not.toHaveBeenCalled();
  });
});
