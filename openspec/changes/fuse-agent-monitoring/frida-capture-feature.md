# Frida capture implementation

M11 increment on M12 npm baseline. Worktree /tmp/awesomeTelemetry-telemetryref-npm,
branch codex/telemetryref-npm-continuation. No main-checkout edits.

## Exclusive file whitelist (frozen before new files)
- openspec/contracts/frida-capture-flow.md
- openspec/changes/fuse-agent-monitoring/frida-capture-feature.md
- server/proxy/frida-capture.ts, server/proxy/frida-capture.test.ts
- server/proxy/controller.ts, server/proxy/controller.test.ts (Frida only)
- server/storage/frida-captures.ts, server/storage/frida-captures.test.ts
- server/http/frida-capture-routes.ts, server/http/frida-capture-routes.test.ts
- src/api/frida-captures.ts
- src/components/FridaView.tsx, src/components/FridaView.test.tsx
- src/components/FridaCaptureInspector.tsx, src/components/FridaCaptureInspector.test.tsx
- src/styles/components/frida-captures.css

No shared server/schema/client/DTO/root-contract/style-entry edits. No dependencies,
commit, full suite/perf/browser, permanent service, actual Frida install/attach or
real data. Parent owns final server wiring. Existing scripts inspected as text only.

## Verification boundary
The packaged monitor has TODO hook and emits {"note":"monitor skeleton"}; it is
not a working Trae hook. Probe script emits AI_AGENT_FOUND/AI_AGENT_NOT_FOUND.
Controlled transport tests cannot certify a Trae version, hook or Windows runtime.

## Delivered / validation (2026-10-20 Asia/Singapore)

- FC-001: incremental UTF-8/UTF-16LE stdout and HEX decoding; complete frame only,
  cross-chunk marker/tail preservation, bounded noise/frame/JSON, explicit malformed,
  incomplete, oversized and skeleton errors. Probe checks exact existing markers,
  kills owned probe after marker and waits for close. Timeout never releases an
  unclosed process as a successful probe.
- FC-002: cached SQLite insert, stable time+id keyset pages (500-char SQL preview),
  strict bounds, guarded full single record, independent HTTP registration and
  unified errors. Native DTO/DDL unchanged; unknown metadata stays null.
- FC-003: generation/child ownership, committed INSERT before saved notification,
  failed parse/write never success, stop waits for discovery/child close, duplicate
  old events ignored. A pending stop blocks restart; timeout retains ownership.
- FC-004: explicit saved-row drawer, single selected API call, 5s owned
  timeout/cancel/retry and late hiding, original inert JSON, 64KiB initial text,
  explicit expansion,8..28 font, width slider, bilingual text, independent token CSS.
  Existing controls/acknowledgement/stop confirmation retained. Explicit50-row
  pages and40-row render window; no polling or per-row detail fetch.

Final adjacent run: **6 files,70 tests passed** (1.26s), no full suite/perf/build.

| Test file | Passed | Coverage |
|---|---:|---|
| server/proxy/frida-capture.test.ts |20|byte splits, UTF8/16LE HEX, malformed/incomplete/oversized frames, bounded noise, injected transport, actual skeleton file validation, marker probe and timeout-close ownership|
| server/storage/frida-captures.test.ts |4|real in-memory SQLite DTO/null/UTC, preview, tie-safe indexed pages, strict limits|
| server/http/frida-capture-routes.test.ts |12|real temporary loopback HTTP to real SQLite, full/preview/400/404/503 envelopes|
| server/proxy/controller.test.ts |16|5 new real-parser/SQLite lifecycle cases +11 unchanged ProxyRuntime regressions|
| src/components/FridaView.test.tsx |13|11 existing controls + explicit drawer and bounded paged rows|
| src/components/FridaCaptureInspector.test.tsx |5|real API client with injected fetch transport; inert/Unicode bounds/font/retry/timeout/cancel/stale/unmount|

Final targeted ESLint and strict TypeScript checks for all13 owned TS/TSX files
passed. TypeScript CLI uses --ignoreConfig, strict/noUncheckedIndexedAccess/
verbatimModuleSyntax/erasableSyntaxOnly, ES2022, bundler resolution and
node,vitest/globals,vite/client declarations. `git diff --check` passed for tracked
owned edits; ProxyRuntime class plus helper was byte-compared to HEAD, unchanged.

The first loopback test attempt was sandbox-blocked (listen EPERM); temporary
loopback permission rerun passed. Test setup now rejects listen errors immediately.
An earlier project-wide typecheck observed concurrently added
src/core/linked-trace-export.test.ts importing server modules outside app project
(TS6307); those parent-owned files were not edited. The final scoped check is not
a statement that the parent's entire concurrently edited project typechecks.

## Exact parent server wiring

Only parent edits server/server.ts; these are the required code changes:

```ts
import { registerFridaCaptureRoutes } from './http/frida-capture-routes.js';

const fridaRuntime = new FridaRuntime(payload => {
  eventBus.emit('frida_status', payload);
}, {
  db,
  notify: payload => eventBus.emit('frida_capture', payload),
  onError: () => console.error('Frida capture failed; no saved-capture success was reported'),
});

// Replace the old inline GET /api/frida/captures block, do not register both.
registerFridaCaptureRoutes(router, db);

router.register('POST', '/api/frida/stop', async (req, res) => {
  sendJson(res, 200, await fridaRuntime.stop(), req);
});

// In the existing shutdown Promise.all, await Frida ownership alongside Proxy
// before releasing SQLite. Remove the previous unawaited fridaRuntime.stop().
await Promise.all([proxyStopped, fridaRuntime.stop(), (async () => {
  await fileWatcher.close();
  await Promise.all(activeHandlers);
  await startupRecovery?.catch(() => {});
  while (scanInProgress) await new Promise(resolve => setTimeout(resolve, 5));
  await Promise.allSettled(scanTasks);
  await httpClosed;
})()]);
```

The cleanup IIFE above is the existing shutdown block, not a second cleanup.
The current parent server was read and already contains constructor deps, route registration, async
HTTP stop and shutdown Promise.all wiring. This task did not edit server.ts.
FridaView imports its own inspector/CSS; no global style or shared client edit.

## Contract mapping / unresolved validation

Implemented proxy-capture REQ-013 controlled decoding/persistence, REQ-014 bounded
existing-marker probe logic, REQ-015 continuous monitor transport; storage
REQ-004/005 explicit cached columns; frontend REQ-021/022 and REQ-012 selected
saved details, bounded four-state reads/font controls. These map to FC-001..004.

Unimplemented/UNVERIFIED: actual Trae-version hook and Windows/Frida/Trae capture
acceptance. Packaged script remains skeleton and is deliberately refused before
spawn; its dummy JSON is also refused by decoder. No scripts executed, software
installed, process attached, system settings changed, actual capture data written,
service persisted, browser used, dependency added, commit/push/PR/release performed.
Existing probe script uses a broad ai_agent module-name match; an exact marker is
its declared result, not independent proof of a particular ai_agent.dll version.

Parent should reconcile frontend REQ-021's stale "detail/persistence undelivered"
wording to FC-001..004 while retaining real-device limitations. This task's
separate contract freezes pagination tie-break/errors/limits without altering root
contracts. Needs confirmation: none for the authorized implementation scope.
