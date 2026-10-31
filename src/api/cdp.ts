import { fetchJson } from './client.js';
import type { CdpDevCaptureDetail, CdpDevCapturePage, CdpDevCaptureSummary, CdpDevStatus, CdpDevTarget } from '../core/trace-types.js';

const invalid = () => new Error('CDP_RESPONSE_INVALID');
const integer = (value: number, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= 0 && value <= max;
const bytes = (value: string) => new TextEncoder().encode(value).length;
function summary(value: CdpDevCaptureSummary): boolean {
  return value !== null && typeof value === 'object' && integer(value.id) && value.id > 0 &&
    typeof value.targetId === 'string' && value.targetId.length <= 256 && typeof value.url === 'string' && value.url.length <= 4096 &&
    typeof value.capturedAt === 'string' && /^\d{4}-\d\d-\d\dT/.test(value.capturedAt) && value.capturedAt.endsWith('Z') && Number.isFinite(Date.parse(value.capturedAt)) && integer(value.bodyBytes, 1048576);
}
export async function readCdpStatus(signal: AbortSignal, action?: 'start' | 'stop', port = 9222): Promise<CdpDevStatus> {
  const value = await fetchJson<CdpDevStatus>('/cdp/' + (action ?? 'status'), action ? { signal, method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(action === 'start' ? { port } : {}) } : { signal });
  if (!value || !['idle', 'running', 'stopping'].includes(value.state) || typeof value.discovering !== 'boolean' ||
    !integer(value.targetCount, 16) || !integer(value.connectedTargetCount, value.targetCount)) throw invalid();
  return value;
}
export async function readCdpTargets(signal: AbortSignal): Promise<CdpDevTarget[]> {
  const value = await fetchJson<{ items: CdpDevTarget[] }>('/cdp/targets', { signal });
  if (!value || !Array.isArray(value.items) || value.items.length > 16 || value.items.some(target => !target ||
    !['id', 'title', 'url', 'webSocketDebuggerUrl'].every(key => typeof target[key as keyof CdpDevTarget] === 'string' && target[key as keyof CdpDevTarget].length <= 4096))) throw invalid();
  return value.items;
}
export async function readCdpCaptures(signal: AbortSignal): Promise<CdpDevCapturePage> {
  const value = await fetchJson<CdpDevCapturePage>('/cdp/captures', { signal });
  if (!value || !Array.isArray(value.items) || value.items.length > 64 || !value.items.every(item => summary(item) && !('body' in item)) ||
    new Set(value.items.map(item => item.id)).size !== value.items.length || bytes(JSON.stringify(value)) > 65536 || !integer(value.totalBytes, 8388608) ||
    !integer(value.rejectedCount) || (value.lastIssue !== null && (typeof value.lastIssue !== 'string' || !/^[a-z_]{1,64}$/.test(value.lastIssue)))) throw invalid();
  return value;
}
export async function readCdpCapture(id: number, signal: AbortSignal): Promise<CdpDevCaptureDetail> {
  const value = await fetchJson<CdpDevCaptureDetail>('/cdp/captures/' + id, { signal });
  if (!value || !summary(value) || value.id !== id || typeof value.body !== 'string' || bytes(value.body) !== value.bodyBytes || bytes(JSON.stringify(value)) > 2097152) throw invalid();
  return value;
}
