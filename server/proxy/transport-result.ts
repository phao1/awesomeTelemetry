import type { CaptureTransportResult } from '../../src/core/trace-types.js';

const NATIVE_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ECONNABORTED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE',
  'ETIMEDOUT', 'ESOCKETTIMEDOUT', 'ERR_TLS_HANDSHAKE_TIMEOUT', 'ERR_STREAM_PREMATURE_CLOSE', 'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'ERR_TLS_CERT_ALTNAME_INVALID']);
export function observedNetworkCode(error: unknown): string | null {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : null;
  return typeof code === 'string' && NATIVE_CODES.has(code) ? code : null;
}
export function transportResult(input: { requestEnded: boolean; responseEnded: boolean; statusCode?: number; reason?: string; code?: string | null }): CaptureTransportResult {
  const statusCode = input.statusCode ?? null;
  const error = input.code !== undefined && input.code !== null && NATIVE_CODES.has(input.code) ? input.code : null;
  let state: CaptureTransportResult['state'], reason: string | null;
  if (input.reason === 'CLIENT_DISCONNECTED') { state = 'cancelled'; reason = error ?? input.reason; }
  else if (input.reason === 'PROXY_STOPPED') { state = 'interrupted'; reason = input.reason; }
  else if (input.reason !== undefined) {
    state = error === 'ETIMEDOUT' || error === 'ESOCKETTIMEDOUT' || error === 'ERR_TLS_HANDSHAKE_TIMEOUT' ? 'timeout' : 'network_error';
    reason = error ?? (input.reason === 'UPSTREAM_ABORTED' ? input.reason : 'UPSTREAM_ERROR');
  } else if (!input.requestEnded || !input.responseEnded) { state = 'interrupted'; reason = 'TRANSPORT_INCOMPLETE'; }
  else if (statusCode !== null && statusCode >= 400) { state = 'http_error'; reason = 'HTTP_ERROR'; }
  else { state = 'completed'; reason = null; }
  return { version: 1, state, error: reason, requestEnded: input.requestEnded, responseEnded: input.responseEnded, statusCode };
}
