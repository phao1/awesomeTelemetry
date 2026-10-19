import { afterEach, expect, it, vi } from 'vitest';
import { api } from './client.js';

afterEach(() => vi.unstubAllGlobals());
it('forwards an owned overview signal and preserves the default and explicit source routes', async () => {
  const fetcher = vi.fn(async () => new Response('{"rows":[],"stamp":"2026-10-18T00:00:00.000Z","cached":false}', { status: 200 }));
  vi.stubGlobal('fetch', fetcher);
  const controller = new AbortController();
  await api.agentOverview(undefined, controller.signal);
  await api.agentOverview('proxy', controller.signal);
  expect(fetcher.mock.calls).toEqual([
    ['/api/agent-overview?dataSource=scan', expect.objectContaining({ signal: controller.signal })],
    ['/api/agent-overview?dataSource=proxy', expect.objectContaining({ signal: controller.signal })],
  ]);
});
