# Frida saved-notification UI continuation

M11 functional increment on the M12 npm baseline, only in the existing isolated
/tmp/awesomeTelemetry-telemetryref-npm checkout. Latest user asks all functional
tasks first; no new permission/real execution is granted by goal continuation.

## Exact file whitelist before implementation

- This feature record and functional-rollout-2.md (evidence only).
- src/App.tsx and src/App.test.tsx.
- src/components/FridaView.tsx and src/components/FridaView.test.tsx.
- openspec/specs/frontend/spec.md and realtime/spec.md (behavior clarification).

No backend/DTO/API/schema/monitor script/dependency/config/fixture change.
Reuse BusEvents.frida_capture/frida_status from data-model §10 verbatim and
the one existing App EventSource. No second subscription or per-notice fetch.
No real Frida/CDP/Agent start, model call, source write, commit or publication.

## Frozen behavior

App retains <=20 unique positive safe capture IDs in arrival order; drops any
optional model/session text from this UI projection. Duplicate save IDs do not
grow it. Malformed events are ignored without creating false saved evidence.
The last well-formed runtime notification is explicitly a received notification,
not a current control snapshot, installation/readiness or successful capture.
No notification supplies a missing capturedAt/pid/model/native field.

Frida view shows retained new-save ID buttons separately from paged history.
An explicit ID selection alone opens the existing owned bounded detail reader.
Notify/render/locale/disconnect changes never fetch history or any body and never
start/stop a target. Controls keep the existing explicit status-read/acknowledgement
and uncertain-command semantics. Disconnection marks notification freshness
unknown. Reconnect reset clears retained notices and remounts the selected Frida
snapshot, closing stale selected detail and aborting owned reads; bounded status
and first history page reload only when that view is mounted.

Maps realtime REQ-006/010, frontend REQ-021/022/023 and FC-004. No new wire fields.
Tests use the real App/FridaView and existing injected EventSource/fetch transport.

## Result

Implemented shared-SSE listeners with strict positive-safe ID/runtime validation,
bounded20-ID deduplication, separate save buttons and explicit runtime-notice
labels. Reset clears notices and remounts only an active Frida view, cancelling
old detail ownership; notification delivery/locale/disconnect never reads bodies
or starts/stops a target. Existing uncertain-command flow remains authoritative.

Three new tests cover64-notice bursts, duplicate/malformed input, dropped optional
text, one shared EventSource, no hidden-view reads, exact selected detail, reset
abort/late suppression, and locale/freshness changes preserving uncertain state.
Focused App/FridaView40 passed. Initial reset test navigated only by changing hash
before mounting, while this App's module-level initial hash was already captured;
the test now actually clicks the Frida tab, retaining all lifecycle assertions.

Final full suite299 files/3678 passed,1 skipped. Typecheck, full ESLint, frontend
and CLI build, package verification and diff check passed. Logs:
/tmp/awesomeTelemetry-frida-live-focused.log, frida-live-regression.log,
frida-live-typecheck.log, frida-live-build.log and frida-live-lint.log.
All25 protected original npm-worktree file hashes remain unchanged.

No fixture write, demo restart, actual notification injection into a running
target, browser action/download, commit or publication. PID85346 stays owned on
4188 and can serve the newly built frontend on a future reload. Browser transport
was previously closed; new browser acceptance is still unverified. The existing
HTTP artifacts remain separate from browser receipts and were not recreated.
This closes a concrete missing UI subscription, not the composite10.1/10.5 or
real-platform acceptance;76-item ledger remains41 closed/35 open.
