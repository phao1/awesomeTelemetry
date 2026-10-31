import { describe, expect, it } from 'vitest';
import { observedNetworkCode, transportResult } from './transport-result.js';

describe('independent observed transport outcomes', () => {
  it.each([200, 204, 302])('records normally ended upstream%d without claiming protocol success', statusCode => {
    expect(transportResult({ requestEnded: true, responseEnded: true, statusCode })).toEqual({ version: 1, state: 'completed', error: null, requestEnded: true, responseEnded: true, statusCode });
  });
  it.each([400, 401, 429, 500, 503])('records fully observed HTTP%d independently from file/parse outcomes', statusCode => {
    expect(transportResult({ requestEnded: true, responseEnded: true, statusCode })).toMatchObject({ state: 'http_error', error: 'HTTP_ERROR', statusCode });
  });
  it.each([['UPSTREAM_ERROR', 'ECONNREFUSED', 'network_error'], ['UPSTREAM_ERROR', 'ETIMEDOUT', 'timeout'], ['CLIENT_DISCONNECTED', 'ECONNRESET', 'cancelled'], ['PROXY_STOPPED', null, 'interrupted']] as const)('prioritizes %s/%s over any observed status200', (reason, code, state) => {
    expect(transportResult({ requestEnded: true, responseEnded: false, statusCode: 200, reason, code })).toMatchObject({ state, error: code ?? reason, responseEnded: false, statusCode: 200 });
  });
  it('does not infer missing upstream headers or accept arbitrary exception/payload text as a code', () => {
    expect(observedNetworkCode({ code: 'ECONNREFUSED', message: 'private synthetic payload' })).toBe('ECONNREFUSED');
    expect(observedNetworkCode({ code: 'private synthetic payload' })).toBeNull();
    expect(transportResult({ requestEnded: false, responseEnded: false, reason: 'arbitrary payload', code: 'private synthetic payload' })).toEqual({ version: 1, state: 'network_error', error: 'UPSTREAM_ERROR', requestEnded: false, responseEnded: false, statusCode: null });
    expect(transportResult({ requestEnded: false, responseEnded: true, statusCode: 200 })).toMatchObject({ state: 'interrupted', error: 'TRANSPORT_INCOMPLETE' });
  });
});
