/** CB-001 development wire contract; archive size is independent of analysis. */
export const CAPTURE_BUNDLE_MAX_FILE_BYTES = 8589934591;
export const CAPTURE_BUNDLE_MAX_PLAN_BYTES = 65536;
export interface CaptureBundleFile { path: string; bytes: number; sha256: string }
export interface CaptureBundlePlan {
  format: 'awesome-telemetry.capture-bundle';
  formatVersion: 1;
  proxyId: number;
  requestId: string;
  generatedAt: string;
  revision: string;
  mode: 'originals' | 'metadata';
  files: CaptureBundleFile[];
  originalBytes: number;
  omissions: string[];
}
export interface CaptureBundleReceipt {
  format: 'awesome-telemetry.capture-bundle-receipt';
  formatVersion: 1;
  revision: string;
  integrity: 'verified_in_transfer';
  files: CaptureBundleFile[];
}
