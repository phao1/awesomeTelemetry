import { afterEach, describe, expect, it, vi } from 'vitest';
import { PROVIDER_KEYS } from '../../src/core/trace-types.js';
import { getMonitorCapabilities } from './monitor-capabilities.js';

afterEach(() => vi.useRealTimers());
describe('bounded monitoring implementation manifest', () => {
  it('reports nine scanner implementations and only the three implemented process recipes, not installations', () => {
    const report = getMonitorCapabilities();
    expect(report.agents.map(row => row.provider)).toEqual(PROVIDER_KEYS);
    expect(report.agents).toEqual(PROVIDER_KEYS.map(provider => ({ provider, processRecipe: ['claude', 'codex', 'opencode'].includes(provider) ? provider : null,
      nativeScanner: 'implemented', installedVersion: null, runtimeVerification: 'unverified' })));
    expect(report).toMatchObject({ manifestVersion: 1, platform: process.platform, scope: 'terminal_child_and_descendants', listener: 'shared_not_process_filtered' });
    expect(Buffer.byteLength(JSON.stringify(report), 'utf8')).toBeLessThanOrEqual(65536);
  });
  it('keeps controlled macOS transport evidence distinct from unsupported, unverified, dev-only and experimental paths', () => {
    expect(getMonitorCapabilities().transports).toEqual([
      ...['http1_json_sse', 'https_connect', 'compressed_semantics', 'live_identity_sse'].map(id => ({ id, level: 'controlled_test', testedPlatforms: ['darwin'] })),
      { id: 'agent_websocket', level: 'controlled_test', testedPlatforms: ['darwin'] },
      { id: 'http2_grpc', level: 'unverified', testedPlatforms: [] },
      { id: 'mtls_pinning', level: 'unverified', testedPlatforms: [] },
      { id: 'electron_cdp', level: 'dev_only', testedPlatforms: [] },
      { id: 'trae_cn_frida', level: 'experimental', testedPlatforms: [] },
    ]);
  });
  it('uses current UTC generation time rather than a historical support-matrix timestamp', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-16T01:02:03.456Z'));
    expect(getMonitorCapabilities().generatedAt).toBe('2026-10-16T01:02:03.456Z');
    vi.advanceTimersByTime(1234);
    expect(getMonitorCapabilities().generatedAt).toBe('2026-10-16T01:02:04.690Z');
  });
  it('does not let one consumer mutate future capability evidence', () => {
    const first = getMonitorCapabilities();
    first.agents.pop(); first.transports[0]!.testedPlatforms.push('win32'); first.transports.pop();
    const second = getMonitorCapabilities();
    expect(second.agents).toHaveLength(9); expect(second.transports).toHaveLength(9);
    expect(second.transports[0]!.testedPlatforms).toEqual(['darwin']);
    expect(second.agents.every(row => row.runtimeVerification === 'unverified')).toBe(true);
  });
});
