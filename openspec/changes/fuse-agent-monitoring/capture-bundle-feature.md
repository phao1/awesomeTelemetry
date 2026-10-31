# Original capture evidence bundle — functional continuation 4

2026-10-20, M11 increment on M12 npm baseline; user continues all remaining
functionality first. Previous goal turn is progress (CDP product caller and
browser verification), not a wait. Original13.1/full-source scope stays open.
Necessary contract extensions are already authorized by proposal.md.

## Exact file whitelist

- This record and npm-continuation.md (current functional evidence).
- openspec/contracts/{capture-bundle,data-model,api,nfr}.md.
- openspec/specs/{storage,frontend}/spec.md.
- src/core/capture-bundle.ts (wire types/constant bounds only).
- server/proxy/capture-bundle.ts (tested through real production route integration).
- server/http/capture-bundle-routes.ts and capture-bundle-routes.test.ts.
- server/http/error-envelope.ts (the3 documented bundle error codes only).
- server/server.ts (snapshot helper, route registration and shutdown ownership).
- src/components/CaptureBundleControl.tsx and CaptureBundleControl.test.tsx.
- src/components/ProxyView.tsx (selected-detail entry only).
- src/i18n.ts (Frida scope in both locales only; retain explicit unclosed Windows workflow).

## Scope

Explicit per-capture bundle combines retained evidence JSON and existing encoded
original files without parser/size-based clipping, cloud upload, source mutation,
model/tool replay, source redaction or extra disk spool. Preview is metadata-only;
native browser download streams the tar directly without a large JavaScript Blob.
Archive manifest and final verified-transfer receipt preserve byte counts/SHA256,
captured-prefix statuses, absent refs and bounded metadata-page coverage. This is
not a full-session/native/raw-log archive or OTLP collector interoperability.
Existing individual JSON/body downloads remain available. Stop/deletion/changed
source invalidation applies before and during asynchronous access. Test actual
HTTP/files and extract the result with the system tar reader; no logic mocks.
Long-running reliability, storage separation, physical-full and actual-platform
certification remain deferred until functional acceptance. No commit/publish.

## Result and contract mapping

Implemented CB-001..005, storage REQ-030 and frontend REQ-042: explicit bounded
manifest preparation; identity/revision binding; production local tar attachment;
fresh source/ref/deletion guards before/during IO; byte/sha verification followed
by a final receipt; at most2 owned original readers/transfer and2 transfers;
shutdown/cancel cleanup; selected bilingual native-download UI. No new schema,
dependency, source replay, JS full-body buffer or archive spool. Existing JSON
export now shares its synchronous snapshot helper and keeps its old behavior.
Missing refs and partial capture statuses are explicit, with no placeholder body.
Metadata mode opens no originals and remains available after original deletion.

Seven new real HTTP/SQLite/filesystem cases independently list/extract with the
system tar reader and compare every receipt SHA256 and original bytes, including
encoded UTF8/binary and an actual100MiB file beyond analysis limits. They cover
missing refs, partial prefixes, metadata revision changes, actual confirmed HTTP
deletion, missing/symlink/altered files and canonical/local guards. A corrupted
transfer has no final receipt and does not masquerade as complete. Existing10
JSON-export cases passed without changing their assertions or semantics.
Five new component cases cover lazy preparation, exact native link, no body/Blob
fetch, mode/source invalidation, wrong owner/path/oversized plans, cancellation,
5s timeout, late results, server error/explicit retry and locale stability.

Focused17 HTTP/export cases and57 UI/i18n cases passed. Full regression303 files,
3701 passed/1 existing skipped,103.93s. Build (including TypeScript), full lint,
strict OpenSpec, diff check and package artifact verification passed. Final
typecheck/changed-test lint also passed after freezing the date-only test clock.
The first full run found a test incorrectly comparing revisions generated at
different instants; freezing only Date preserves the original equality assertion.
The pre-existing Frida assertion also required the platform workflow limitation:
scope copy now correctly distinguishes implemented frame storage/detail from
the incomplete Windows capture-to-persistence workflow. Assertions were retained.

Logs: /tmp/awesomeTelemetry-bundle-{http,http-final,ui,typecheck,build,lint,regression}.log.
No performance/soak/storage-separation work was added or declared complete.

## Running preview and browser evidence

Verified the exact old synthetic backend PID85346/command/cwd, fixture marker,
merged all-disabled provider config and experiment file SHA before replacement.
Stopped that owned process and confirmed its port release. Started only the
compiled CLI against the SAME isolated DB/config/capture directory; no seeding
script or real scanner/Frida/CDP/Agent ran. New backend PID82679, exec65781,
127.0.0.1:4188; startup schema20/3 sessions/111 events. Existing Vite PID76300,
exec96601 remains at127.0.0.1:5188 and proxies that backend. Source work remains
in /tmp/awesomeTelemetry-telemetryref-npm; dirty main checkout untouched.

Browser tab1 at http://127.0.0.1:5188/#/proxy opened existing synthetic request#1
→maintenance→original bundle→Prepare. Actual plan displayed its2 metadata files,
originalBytes0 and explicit request_reference_missing/response_reference_missing;
this old fixture has no body files and was not embellished with fake originals.
Actual larger-original transfer is independently verified by the isolated tests.
Clicked the NEW tar download once. UI reported requested/saving unknown; tab has
no download receipt capability and the expected Downloads file was not found.
Saving remains unconfirmed; no repeated browser download or old JSON-download
retry. A later page reload restored live SSE against the replaced backend and
only re-prepared a fresh metadata plan for review, without another download.
Screenshot /tmp/awesomeTelemetry-capture-bundle-preview.png; tab marked deliverable.

Existing isolated experiment-records.json remained byte-identical:
SHA256489d569475d7a3b9a0f94ea706a2d8c62453a94ed43e2e06db97e853249e912b.
Native/synthetic record counts remained3 sessions/111 events/1 proxy/1 Frida;
no demo data, experiment or capture source was added/deleted by this rollout.

## Remaining goal audit

This turn is progress: original packaging moved from separate manual files to
a functional, tested and visible selected-capture archive. It does not close the
entire13.1 requirement, native/raw-source session export or OTLP collector
interoperability. Official hook integration, actual Windows target hook and
other unclosed functional clauses still require work. Composite ledger remains
41 closed/32 partial/3 not implemented, distinct from the stale30/71 tasks.md.
Full goal stays active; user functional acceptance precedes reliability/soak.
No goal completion, archive, commit, merge, push or publication occurred.
