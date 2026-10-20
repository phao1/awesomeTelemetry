import { fetchJson } from './client.js';
import type { NativeToolObservationPage } from '../core/native-tool-observations.js';

export async function fetchNativeToolObservations(sessionKey: string, identity: NativeToolObservationPage['identity'], cursor: number, signal: AbortSignal): Promise<NativeToolObservationPage> {
  const query = new URLSearchParams({ ...identity, cursor: String(cursor), limit: '20' });
  const page = await fetchJson<NativeToolObservationPage>('/sessions/' + encodeURIComponent(sessionKey) + '/tool-observations?' + query, { signal });
  if (page.sessionKey !== sessionKey || page.identity.namespace !== identity.namespace || page.identity.value !== identity.value || page.identity.scope !== identity.scope ||
      page.events.length > 20 || page.events.some(event => event.sessionId !== sessionKey || event.sequence <= cursor) ||
      (page.hasMore && (page.events.length === 0 || page.nextCursor !== page.events.at(-1)?.sequence))) throw new Error('INVALID_TOOL_OBSERVATIONS');
  return page;
}
