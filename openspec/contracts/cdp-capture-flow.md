# Internal standard Electron CDP capture contract

M11 increment, 2026-10-20. Supplements proxy-capture REQ-012; development
HTTP DTOs follow data-model.md and api.md §8. No storage schema or production
exposure. Existing root contracts win.

## Protocol evidence

Verified against Chromium's official protocol definitions on 2026-10-20:
- [Network](https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/pdl/domains/Network.pdl): enable, requestWillBeSent, responseReceived, loadingFinished/loadingFailed, getResponseBody.
- [Page](https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/pdl/domains/Page.pdl): enable.

Network requestId is not an individual redirect-hop identity. Commands have
independent numeric IDs; body replies use the matching command's result.body
and result.base64Encoded, not event params. Only explicit IDs/URL evidence
associate records; timestamps never associate events.

## Exported internal interfaces

CdpTarget remains {id:string,title:string,url:string,webSocketDebuggerUrl:string}.
CdpCaptureEntry remains {url:string,body:string}; body is decoded UTF-8 text.
This legacy callback means successful *body acquisition*, not Agent/protocol
execution success. HTTP status >=400 is excluded; no original-byte archive,
request body, streaming deltas, parser, persistence, native identity or timings
are implied. Binary/non-UTF8 bodies fail explicitly rather than corrupt text.

CdpIssueCode is a closed union: invalid_message, resource_limit,
request_timeout, ambiguous_request, loading_failed, http_error, command_error,
command_timeout, connection_error, connection_timeout, disconnected,
invalid_body, callback_error, discovery_error, target_limit.
CdpCaptureIssue = {code:CdpIssueCode, requestId:string|null, commandId:number|null}.
No unbounded upstream error text, body or URL is included in diagnostics.

CdpWebSocket is the native WebSocket subset: onopen/onmessage/onerror/onclose,
send and close. CdpCaptureOptions has optional signal:AbortSignal,
webSocketFactory:(url:string)=>CdpWebSocket,
onIssue:(issue:CdpCaptureIssue)=>void, onDisconnect:()=>void.
connectCdpCapture(target,onCapture,options?) returns Promise<()=>void> as before.
The promise resolves only after both Network.enable and Page.enable ACKs.
Returned stop is synchronous/idempotent and suppresses all late callbacks;
it clears timers/maps/listeners and requests socket close. It does not promise
peer close-handshake completion. Abort owns connecting and active sockets.
Runtime without global WebSocket fails explicitly; no dependency is installed.

CdpDiscoveryOptions has optional signal:AbortSignal and fetch:typeof fetch.
discoverCdpTargets(port=9222,options?) returns Promise<CdpTarget[]> as before.
HTTP errors/malformed/oversize/timeout now reject (never pretend empty success).
The deadline also bounds stalled reads/noncooperative injected fetches; late
responses are cancelled rather than adopted. Pre-aborted calls perform no IO.
Discovery uses only http://127.0.0.1:<port>/json, no redirects; target sockets
must be ws(s)://127.0.0.1 with the same port, no credentials/fragment.
Direct connect also requires a loopback socket URL. Invalid entries are ignored;
invalid array shape or >64 entries fails, no partial target reconciliation.

CdpCaptureSessionOptions extends CdpCaptureOptions with required devOnly:true,
optional port:number and discover:typeof discoverCdpTargets. Constructor takes
options plus onCapture:(entry:CdpCaptureEntry,target:CdpTarget)=>void.
CdpCaptureSession.getTargets():CdpTarget[] returns independent copies of the
currently owned bounded target snapshot without discovery or body acquisition.
CdpCaptureSession.start():Promise<void> starts immediately then polls every
10000ms; repeated start while running joins initial discovery. Construction
performs no IO. start resolves discovery/reconciliation, not all connection ACKs.
stop():Promise<void> aborts discovery/connections, clears owned
poll timers, and waits owned connection setup cleanup. Start while stopping
rejects. getStatus() returns {state:'idle'|'running'|'stopping',discovering:boolean,
targetCount:number,connectedTargetCount:number}. Running means manager enabled,
not proven traffic/Agent connectivity. Enforce devOnly:true at runtime. Session
forwards issue/disconnect hooks; callers own persistence and explicit dev gate.

## Correlation / failure policy

- Numeric command IDs increase once per socket, including enable and bodies.
  A pending-command map captures exact request-state identity, never requestId
  converted to a number. Unknown/duplicate command replies cannot emit captures.
- Require requestWillBeSent URL, matching responseReceived URL/status and
  loadingFinished before body acquisition; these three can arrive out of order
  for a fresh request ID. Missing evidence expires, never uses target URL.
- Ordinary explicit redirects before completion replace the prior hop and
  reset response evidence. Require redirectResponse.url to match prior request
  URL. Redirect after finish/body command, conflicting URLs/responses, repeated
  start without redirect, or reuse of a terminal ID quarantines the ID for the
  rest of this connection. Ambiguous reordered redirect hops are dropped.
  CDP supplies no hop ID to disambiguate arbitrary same-URL redirect replay;
  accepted normal redirect order is assumed, not inferred from clocks.
- loadingFailed, invalid status or HTTP >=400 cannot become successful body
  callbacks. A terminal record retains only its ID. No timeout/eviction permits
  later events to resurrect it. A fresh socket has a separate identity scope.
- Stop/disconnect/abort clears pending ownership. Malformed/oversized frames
  close the connection because dropping an unknown frame could lose a redirect
  or failure. Unknown unrelated event methods are ignored. User callback throws
  are contained; callback_error is reported without retrying delivery.

## Fixed bounds (exported CDP_LIMITS)

connectTimeoutMs=5000, commandTimeoutMs=5000, requestTimeoutMs=30000,
discoveryTimeoutMs=5000, discoveryIntervalMs=10000, maxTargets=16,
maxDiscoveryTargets=64, maxDiscoveryBytes=65536, maxRequests=256,
maxSeenRequestIds=4096, maxPendingCommands=128, maxBodyBytes=1048576,
maxMessageBytes=8388608, maxUrlChars=4096, maxIdChars=256.
Timers unref. Network.enable requests maxTotalBufferSize=16MiB,
maxResourceBufferSize=1MiB, maxPostDataSize=0. Unsupported enable fails visibly.
Application retains metadata only, no body queue, and immediately releases body
results after synchronous callback. Request/pending/seen exhaustion closes the
connection (no unsafe forget-and-reuse). Message cap applies before JSON.parse;
native WebSocket allocates a received frame before the application can check
it, so this does not certify a wire-level hostile-peer memory ceiling.

Manager bounds the union of connecting/connected targets at16, reconciles by
id+socket URL, closes removals/replacements, and prevents overlapping discovery.
Failed discovery preserves existing targets. Target-list overflow above16 is
reported and first16 valid unique IDs selected deterministically. Duplicate
conflicting target IDs reject the snapshot. Late discovery/connect completions
cannot populate stopped/restarted sessions. A disconnected target can reconnect
only on a later discovery cycle. No auto-launch or debug-port discovery scan.
