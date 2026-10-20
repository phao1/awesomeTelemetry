import type { IdentityCompleteness, TraceEventSlim, TraceSourceIdentity } from './trace-types.js';

export interface NativeToolObservationPage {
  sessionKey: string;
  identity: { namespace: string; value: string; scope: string };
  state: 'retained_reference' | 'incomplete' | 'ambiguous' | 'unresolved';
  events: TraceEventSlim[];
  eventTotal: number;
  identities: TraceSourceIdentity[];
  completeness: IdentityCompleteness;
  nextCursor: number | null;
  hasMore: boolean;
}
