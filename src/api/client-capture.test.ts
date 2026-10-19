import { afterEach, expect, it, vi } from 'vitest';
import { api } from './client.js';
afterEach(() => vi.unstubAllGlobals());
it('preserves capture routes/payloads and forwards owned read/control/CA signals', async () => {
  const fetcher = vi.fn(async () => new Response('{}', { status: 200 }));vi.stubGlobal('fetch', fetcher);const controller = new AbortController();
  await api.proxyRequests({ cursor: 'opaque page' }, controller.signal);await api.proxyStatus(controller.signal);
  await api.proxyStart(undefined, controller.signal);await api.proxyStop(controller.signal);await api.proxyRequest(7, controller.signal);await api.caCert(controller.signal);
  expect(fetcher.mock.calls).toEqual([
    ['/api/proxy/requests?limit=50&cursor=opaque+page', expect.objectContaining({ signal: controller.signal, cache: 'no-store' })],
    ['/api/proxy/status', expect.objectContaining({ signal: controller.signal })],
    ['/api/proxy/start', expect.objectContaining({ signal: controller.signal, method: 'POST', body: '{}' })],
    ['/api/proxy/stop', expect.objectContaining({ signal: controller.signal, method: 'POST' })],
    ['/api/proxy/requests/7', expect.objectContaining({ signal: controller.signal })],
    ['/api/ca-cert', expect.objectContaining({ signal: controller.signal })],
  ]);
});
