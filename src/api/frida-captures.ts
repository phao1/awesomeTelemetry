import { fetchJson } from './client.js';
import type { FridaCapture } from '../core/trace-types.js';
export interface FridaCapturePage { items: FridaCapture[]; nextCursor: string | null; hasMore: boolean }
export async function fetchFridaCapture(id: number, signal: AbortSignal): Promise<FridaCapture> {
  const result = await fetchJson<FridaCapture>('/frida/captures/' + id, { signal });
  if (result.id !== id || typeof result.jsonData !== 'string' || new TextEncoder().encode(result.jsonData).length > 262144 || typeof result.capturedAt !== 'string' || typeof result.captureType !== 'string' || !Number.isSafeInteger(result.pid)) throw new Error('FRIDA_RESPONSE_INVALID');
  return result;
}
export async function fetchFridaCapturePage(cursor: string, signal: AbortSignal): Promise<FridaCapturePage> {
  const page = await fetchJson<FridaCapturePage>('/frida/captures?' + new URLSearchParams({ cursor, limit: '50' }), { signal });
  if (!Array.isArray(page.items) || page.items.length > 50 || typeof page.hasMore !== 'boolean' || (page.hasMore && (page.items.length === 0 || typeof page.nextCursor !== 'string' || page.nextCursor === cursor))) throw new Error('FRIDA_RESPONSE_INVALID');
  return page;
}
