# Standard Electron CDP capture — M11 increment / M12 npm baseline

## Exclusive file whitelist (frozen before new files)

- openspec/changes/fuse-agent-monitoring/cdp-capture-feature.md
- openspec/contracts/cdp-capture-flow.md
- server/proxy/cdp-capture.ts
- server/proxy/cdp-capture.test.ts
- server/proxy/cdp-session.ts
- server/proxy/cdp-session.test.ts

Only work in /tmp/awesomeTelemetry-telemetryref-npm. No controller, root DTO,
DB/schema, API, server entry, UI or shared stylesheet edits. No dependency,
commit, push, PR, publish, real browser/Electron launch, debugging port, user
traffic or machine configuration changes. Tests inject protocol transport;
they exercise the actual correlator and manager, not a replacement algorithm.

## Scope and integration boundary

Freeze the internal contract in cdp-capture-flow.md before implementation.
Implement proxy-capture REQ-012 helpers and explicit dev-only session ownership.
There are currently no callers of connectCdpCapture/discoverCdpTargets in
server/, local-sessions/ or src/. local-sessions/vite-plugin.ts does not exist.
The API §8/gotcha G10.2 wording claiming existing dev wiring is stale; retain
its authoritative dev-only boundary, and report missing wiring explicitly.
Parent owns any future dev integration. Do not expose production routes.
Controlled module tests are not a product UI or real Electron acceptance.
TTNet uses a different network stack; CDP does not decrypt it (G6.2/G6.5).

## Validation

- cdp-capture.test.ts: 44 controlled protocol/discovery cases.
- cdp-session.test.ts: 10 manager cases using the actual correlator and injected wire.
- Combined with monitor-capabilities.test.ts: 3 files, 58 tests passed.
- Existing server/server.test.ts production dev-only404 case: 1 passed,
  73 unrelated cases skipped. First sandbox attempt hit listen EPERM; the
  approved rerun passed using only the existing temporary HTTP fixture,
  without a browser, Electron or CDP debugging listener. Total scoped59 passed.
- Scoped tsc (Node ES2023, strict, noUncheckedIndexedAccess,
  verbatimModuleSyntax, erasableSyntaxOnly, isolatedModules) passed on all four TS files.
- ESLint passed on the same four files; no new runtime dependency.
- The first test launch selected Node environment but the shared setup requires
  window; tests were corrected to use the repository's existing jsdom environment.
  No shared setup/test assertions were changed or weakened.
- No full suite, perf run, browser/desktop interaction, paid model call, permanent
  service, real debugging port or real Agent traffic was used.

## Parent integration handoff

Existing signatures remain source compatible:

```ts
discoverCdpTargets(port = 9222, options?: CdpDiscoveryOptions): Promise<CdpTarget[]>
connectCdpCapture(target, onCapture, options?: CdpCaptureOptions): Promise<() => void>
```

New explicit dev owner (constructor has no IO):

```ts
const session = new CdpCaptureSession(
  { devOnly: true, port: 9222, onIssue: handleIssue },
  (entry, target) => handleBody(entry, target),
);
// Only in an explicitly authorized dev action:
await session.start();
const status = session.getStatus();
// During explicit stop / owning dev server shutdown:
await session.stop();
```

start resolves the initial discovery/reconciliation, not all target ACKs.
getStatus().connectedTargetCount counts only targets with both successful ACKs.
Discovery failure emits discovery_error while preserving existing connections;
running means enabled discovery, not proven traffic. getStatus is metadata only.
Options allow signal and injected webSocketFactory; discover is injectable for
controlled manager tests. No caller should invoke start automatically at import,
production startup or merely opening a view. Parent must own the dev gate,
explicit user intent, issues, lifecycle and any separately contracted persistence.

Body callback remains exactly {url, body} (UTF-8 text), with target passed as a
second argument by the manager. This is bounded body acquisition, not a durable
original archive, usage parser, native-session association or Agent success.
No new route/DTO/schema/UI was introduced. Keep production CDP404 behavior.

## Remaining acceptance / explicit limitations

- Product invocation remains absent: no existing helper imports/calls, and no
  local-sessions/vite-plugin.ts. API §8/G10.2 describe intended dev wiring, not
  verified current implementation. Parent integration is a separate owned step.
- Standard Electron version/network compatibility and actual dev UI workflow
  remain unverified; controlled protocol tests do not certify either.
- Trae TTNet remains unsupported by Chromium Network; no decryption claim.
- Binary/non-UTF8 or >1MiB bodies, requests missing evidence after30s, and
  ambiguous/reused IDs are reported/dropped. This helper does not stream SSE.
- Stop detaches ownership and requests socket close; no claim of peer close
  handshake completion. WebSocket receives a frame before the application cap,
  so the8MiB check is not a hostile-peer wire-level allocation guarantee.
- Same-URL arbitrary redirect-hop replay cannot be disambiguated by CDP's
  network requestId alone. Normal explicit redirect order is required; obvious
  conflicts/late body results are quarantined without timestamp matching.
