# Frida capture flow (additive internal contract)

Root data-model §7 FridaCapture and database §3.8 win; no native fields or schema
changes. §5.2 currently has no Frida column constant: this module owns explicit
FRIDA_METADATA_COLS/FRIDA_DETAIL_COLS mirroring §3.8, using existing cachedStmt.
API §5 supplies list/detail routes; this freezes their previously unspecified bounds.

FC-001: Incremental decoder accepts complete [NEW CHAT DATA] JSON [END] frames,
or [NEW CHAT DATA][HEX] even-length byte hex [END] (spaces/newlines allowed,
no offset/hexdump interpretation). Stdout UTF-8 or BOM/initial ASCII-NUL UTF-16LE;
HEX bytes UTF-8 or BOM/initial JSON ASCII-NUL UTF-16LE, fatal malformed Unicode.
JSON object/array only, original JSON text preserved, no inferred native fields.
Frame wire <=1MiB, JSON UTF-8 <=256KiB. Invalid/nested/incomplete/over-limit frames
report typed errors, never save prefixes. Keep marker suffix and incomplete tail;
noise has bounded storage. [END] inside JSON strings is text. Exact packaged
monitor-skeleton object is rejected. Process-close flush reports partial frame.

FC-002: insertFridaCapture(db,capture,captureSessionId) accepts the existing
FridaCaptureData shape (pid/model/sessionId/jsonData). Store captureType='chat',
UTC capturedAt, captureSessionId=local run UUID (not native session identity),
messageCount/tokens=null. model/sessionId remain null absent explicit supplied
metadata; parser invents none. Metadata strings <=1024 UTF-8 bytes. JSON <=256KiB.
No replacement/upsert/dedupe by text; separate complete observations are records.
List uses limit default50/max500, strict decimal parameters; cursor is opaque
JSON [capturedAt,id] to retain equal-time ties (legacy ISO time accepted). SQL
substr(json_data,1,500) preview, bounded retained tokens, metadata <=1024B each. Detail guarded
by SQLite byte-length checks before loading body/tokens, <=256KiB JSON, tokens
<=4096B. Entire response <=2MiB; oversized legacy rows fail explicitly, never
silently truncate full detail. Missing ID404 ROUTE_NOT_FOUND; invalid input400
BAD_REQUEST; unavailable/over-limit503 INTERNAL_ERROR with static reason details.
All errors use ApiError. Parent registers registerFridaCaptureRoutes(router,db),
replacing old list route; parent marks foreground at HTTP entry as before.

FC-003: FridaRuntime(emit, deps={}) preserves constructor call shape. deps adds db,
notify(BusEvents.frida_capture), onError(Error), discover, monitor, validateScript,
uuid and stopTimeoutMs. Production db mandatory before starting. Defaults use
actual storage/parser/process logic; injectable subprocess transport is for tests.
After synchronous committed INSERT, notify id plus only known model/sessionId.
Write/parse failure emits diagnostic via onError, terminates owned child, never
saved success. Run generation rejects late callbacks. Duplicate terminal events
settle once. stop() now returns Promise<FridaStatus>; parent MUST await both HTTP
stop and shutdown. Stop during discovery invalidates start; stop retains child
ownership until close; timeout rejects, restart blocked, retry stop permitted.
A spawn is process runtime status only, not hook readiness. Default script
validation rejects the known packaged skeleton before spawn. Discovery checks up
to32 tasklist PIDs, one bounded probe per PID (5s,64KiB), exact line marker;
Probe stdout markers terminate the owned child; close is awaited before continuation. Timeout kills but retains ownership until close; runtime stop can time out visibly while that cleanup remains pending. No hook guesses or script changes.

FC-004: Selected detail opens focus-trapped resizable existing Drawer, explicit
single GET with5s owned timeout/cancel/retry; stale/unmounted/changed-ID results
hidden even if transport ignores AbortSignal. Locale changes do not refetch.
Text inert, initial UTF-8 <=64KiB, explicit expansion to bounded retained JSON,
font8..28px. List remains separate and paged50 at a time; no body fan-out or polling.
New copy bilingual/local to owned components; independent CSS uses design tokens.
