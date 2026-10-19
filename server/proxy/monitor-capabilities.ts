import { PROVIDER_KEYS, type MonitorCapabilityReport, type MonitorTransportCapability } from '../../src/core/trace-types.js';

const controlled: readonly MonitorTransportCapability[] = ['http1_json_sse', 'https_connect', 'compressed_semantics', 'live_identity_sse'];

/** Implementation evidence only. No installation, process, config, CA or network probe. */
export function getMonitorCapabilities(): MonitorCapabilityReport {
  return {
    manifestVersion: 1,
    generatedAt: new Date().toISOString(),
    platform: process.platform,
    scope: 'terminal_child_and_descendants',
    listener: 'shared_not_process_filtered',
    agents: PROVIDER_KEYS.map(provider => ({
      provider,
      processRecipe: provider === 'claude' || provider === 'codex' || provider === 'opencode' ? provider : null,
      nativeScanner: 'implemented', installedVersion: null, runtimeVerification: 'unverified',
    })),
    transports: [
      ...controlled.map(id => ({ id, level: 'controlled_test' as const, testedPlatforms: ['darwin'] })),
      { id: 'agent_websocket', level: 'controlled_test', testedPlatforms: ['darwin'] },
      { id: 'http2_grpc', level: 'unverified', testedPlatforms: [] },
      { id: 'mtls_pinning', level: 'unverified', testedPlatforms: [] },
      { id: 'electron_cdp', level: 'dev_only', testedPlatforms: [] },
      { id: 'trae_cn_frida', level: 'experimental', testedPlatforms: [] },
    ],
  };
}
