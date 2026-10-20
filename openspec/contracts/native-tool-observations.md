# Native tool-call observations

Client/server contract for an explicit same-native-ID observation lookup.
It extends the existing native identity model without creating execution IDs.

~~~ts
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
~~~

GET /api/sessions/:key/tool-observations
Required query: namespace (1..128), value (1..1024), scope (1..1024);
opaque original values are never normalized. Optional cursor is a safe integer
>=0 (last returned native event sequence), limit default20/max100, minimum1.
Duplicate, unknown, missing, empty, control-character or invalid numeric query
returns400 BAD_REQUEST. Existing scan owner required, else404 SESSION_NOT_FOUND.
Host/Origin guards and no-store apply. Unified error envelope remains binding.

Only selected scan source's tool_call namespace/value/scope are searched. All
retained matching event references determine eventTotal and uniqueness, including
off-page bindings. Distinct native session owners, multiple known turnKeys or
conflicting tool IDs on a matching event mark ambiguous. A missing/incomplete
source, nonunique selected native session scope, unbound/dangling references or
truncated locator page mark incomplete; missing local references are unresolved.
retained_reference only describes consistent retained references, never runtime
execution, lifecycle completeness, retries, measured duration or task success.
hasInput/hasOutput remain metadata hints, not invented call/result roles.

events are sequence-ordered distinct slim metadata, never body/raw/source IO.
Identity locators are for returned members, <=1000 entries. Fixed-count cached
metadata queries, <=1MiB JSON response. A byte-reduced page advances by the actual
last returned sequence; an oversized single item returns503
EXECUTION_METADATA_LIMIT, not a looping empty page or clipped native ID.
No writes, new index/schema, cross-source usage aggregation or per-row fetch.
Single selected event body/raw uses the unchanged event-detail API.

UI opens only on explicit action, owns5s cancellation and error/retry, keeps
page coverage/state/source visible, allows explicit previous/next metadata pages,
and selects one exact retained event for the existing body inspector. Source
invalidation hides old lookup and body without automatic refetch or replay.
