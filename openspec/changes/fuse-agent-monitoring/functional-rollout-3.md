# Functional continuation 3 — development CDP entry

2026-10-20, M11 increment on the existing M12 npm baseline. The user requests
all remaining functionality first and defers reliability/soak work until manual
acceptance. Proposal already authorizes necessary contract extensions. Work stays
in this isolated checkout. Previous task is terminal/interrupted, not a live owner.

## Exact file whitelist

- This record, npm-continuation.md (progress only).
- openspec/contracts/{data-model,api,nfr,cdp-capture-flow}.md.
- openspec/specs/{proxy-capture,frontend}/spec.md.
- src/core/trace-types.ts.
- server/proxy/cdp-session.ts and cdp-session.test.ts.
- server/http/error-envelope.ts (three documented CDP error codes only).
- server/server.ts and server/server.test.ts (health dev-only manifest and404 checks only).
- local-sessions/vite-plugin.ts and vite-plugin.test.ts; vite.config.ts.
- src/api/cdp.ts; src/components/CdpPanel.tsx and CdpPanel.test.tsx.
- src/components/ProxyView.tsx.
- src/i18n.ts (Frida scope/history copy only, both locales; browser found stale claims).

## Intended functional result

Explicit dev-only CDP controls, target snapshot and selected decoded-response
inspection, reachable from Proxy without a new global view. Vite intercepts only
the documented CDP paths before its existing backend proxy. Production remains
unmodified and returns ROUTE_NOT_FOUND. No automatic debugging-port discovery or
start; no browser/Agent launched by implementation or tests.

The bounded in-memory development response inspector retains accepted text until
dev-server shutdown, rejects new records when full and discloses missing wire
bytes/request/timing/native identity. It does not write fabricated MITM rows or
certify TTNet, real Electron, original archives, production persistence or Agent
success. Stop keeps diagnostic records readable. Body reads are explicit only.

New public types and endpoints must be frozen in authoritative contracts before
implementation. Test the actual middleware via real loopback HTTP and synthetic
CDP transport, plus component flows; no real target/protocol work is mocked away.
Keep reliability/soak, actual Windows hooks, fees and side-effecting replay deferred.
Do not close composite12.4 or the full goal from this increment alone.

## Delivered and verified

- Development routes use the real CdpCaptureSession; getTargets copies its owned
  snapshot. Vite intercepts CDP before the backend proxy. No constructor/read
  performs discovery; explicit start alone connects, stop waits owned cleanup.
- Selected decoded response storage is bounded64 records/8MiB, metadata64KiB,
  detail2MiB including JSON escaping. Reject and count additional records without
  eviction. Bodies remain dev-server memory only, separate from native/MITM DB.
- Proxy has a collapsed bilingual CDP panel; explicit snapshot refresh, controls,
  selected right drawer,64KiB default text preview and8..28px controls. Unknown,
  empty, production404, failure, command uncertainty and cancelled/late results
  are visible. No automatic IO on open/locale, polling, model or tool execution.
- Production health declares all6 unavailable path patterns; real production
  route test verifies404 for all6 concrete routes/methods. No production CDP
  owner/listener or new runtime dependency was introduced.
- 6 new integration cases exercise real local HTTP plus the actual manager and
  correlator with a substituted remote wire, including pending-discovery stop,
  selected body, capacity rejection and actual Vite-before-proxy integration.
 5 new component cases cover lazy ownership, inert Chinese/script text, both
  locales, explicit commands, production guidance, cancel/timeout and late reads.
  Existing54 CDP protocol/session cases also passed. These are not actual
  Electron target or original-wire certification.

First full run found the new panel sharing the generic tools class, violating
the existing disclosure-count assertion. Implementation now uses the existing
run section styling; the assertion was not changed. Follow-up52 Proxy/CDP UI
tests passed. The HTTP harness was also corrected to reject listen errors; the
sandbox cannot bind loopback ports, so actual integration/full tests ran with
approved local networking. No mock replaced parser/manager/retention logic.

Final full regression:301 files,3689 passed/1 existing skipped,102.91s.
TypeScript+frontend+CLI build, full lint, OpenSpec strict, diff check and package
artifact verification passed. After the subsequent bilingual Frida copy-only
repair,24 i18n/Frida/detail cases and build/lint were rerun and passed. Logs:
/tmp/awesomeTelemetry-cdp-dev-{regression,build,lint,frida-copy}.log.

## Browser evidence and manual preview

The existing synthetic4188 backend was confirmed live (3 sessions/111 events).
New Vite preview PID76300/exec session96601 listens on127.0.0.1:5188, started
with AWESOME_TELEMETRY_API_ORIGIN=http://127.0.0.1:4188. All actual scanner
and capture ownership remains with the existing synthetic backend configuration;
this Vite plugin does not scan native sources or start any target on boot.

Normal cua_repl tab1 (this chat) visibly opened Proxy→Development CDP, then
explicit snapshot refresh showed idle,0 owned/connected targets,0 responses.
No start was clicked. Screenshot /tmp/awesomeTelemetry-cdp-dev-preview.png.
This replaces the previous browser-connectivity blocker for this surface only.

Browser Frida→existing SYNTHETIC-FUNCTIONAL-2 capture#1 visibly opened its
right drawer: PID123, retained UTC time, unknown model/native session/count,
exact JSON with Chinese and literal<script> text, font and width controls.
No creation, mutation or real Frida start. Found and fixed stale bilingual copy
claiming detail/persistence was absent; it now correctly distinguishes saved
record support from the bundled skeleton hook and unverified Windows target.
Screenshot /tmp/awesomeTelemetry-frida-detail-preview.png. Tab is marked as a
deliverable. No browser download was attempted or old unknown download retried.

## Remaining functional scope / goal audit

This goal turn made progress: changed authoritative source/contracts, implemented
a previously missing product caller, passed actual HTTP/manager/UI checks and
resolved two concrete browser verification gaps. It is not a completion claim.

Composite ledger remains41 closed/32 partial/3 not implemented. In particular,
12.2 official hook integration and the real12.5 target-version Frida hook are
still missing; CDP remains development-only with decoded in-memory inspection,
not an original archive or real Electron certification.13.1 still needs full
original-evidence packaging/collector interoperability;13.2 manual records are
not actual controlled execution. Real replay/optimization effectiveness remain
within their previously deferred boundaries. Other incomplete functional clauses
in the71/76-item ledgers still require individual audit, not a new percentage
based only on this increment. Continue functional work; reliability/soak/storage
separation follow only after the user's functional acceptance. No goal-complete,
archive, commit, push, publish or merge into the dirty main checkout occurred.
