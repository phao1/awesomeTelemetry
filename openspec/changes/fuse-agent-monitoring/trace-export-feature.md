# Local native scan OTLP JSON export — functional handoff

2026-10-19; M11 functional increment, branch `codex/telemetryref-npm-continuation`
in `/tmp/awesomeTelemetry-telemetryref-npm` only. No commit/push/PR/deployment,
new permanent service/browser, real user data upload, performance/soak/full suite.
Main checkout and previously dirty/shared files remain untouched by this task.

## Exact write whitelist

- openspec/contracts/trace-export.md
- openspec/changes/fuse-agent-monitoring/trace-export-feature.md
- src/core/trace-export.ts and trace-export.test.ts
- server/http/trace-export-route.ts and trace-export-route.test.ts
- src/api/trace-export.ts
- src/components/TraceExportPanel.tsx and TraceExportPanel.test.tsx
- src/styles/components/trace-export.css

## Delivered scope

Contract TX-001..004 is frozen before implementation. A standard OTLP
ExportTraceServiceRequest JSON download contains bounded retained native scan
observations. Generated, deterministic export grouping IDs are explicitly distinct
from native IDs; no parent edges, retries, scan/proxy merging or measurement
inference. Original normalized duration is an attribute; spans are observation
points. Invalid timestamps omitted with explicit counts; exact nanosecond integer
encoding preserves1..9 fractional digits and rejects invalid UTC calendars/ranges.
Source completeness remains unknown; page coverage is separate. Body/title/error/
prompt/path/header/token/fee fields are excluded by query and conversion allowlists.

Existing getSessionDetail was reviewed: it reads session system_prompt and ignores
requested limits for <=2000event sessions. Therefore the new helper reuses the
existing SESSION_LIST_COLS/EVENT_SLIM_COLS subset and cachedStmt instead, with
3 cached SELECTs in one read transaction and no schema change/lazy source scan.
No per-row SQL, source/body/identity fetch, external send or new dependency.

Frontend independent client streams a <=512KiB response, validates page identity,
OTLP structure/coverage, then creates one local download. UI is bilingual, lazy
with explicit Download, numeric range, partial/empty/unloaded/count-mismatch
feedback, manual next-range selection (no automatic read),10s deadline, cancel,
explicit retry and stale ownership revocation on range/session/invalidation/
unmount. Locale changes do not fetch. Browser save completion is not claimed.

The external timestamp ISO convention remains unchanged for normalized values;
the isolated wire fixed64 conversion is explicitly authorized in the new contract.
Known docs drift: BOOTSTRAP/trace-model cache-read descriptions defer to the
higher data-model contract; no token logic was touched. AGENTS Vitest3 differs
from installed package Vitest4.1.10; existing installed toolchain used unchanged.

## Module verification

- core conversion:17tests (exact UTC/fixed64 boundaries, all status values,
  unknown durations, invalid timestamps/pagination, empty/unloaded/mismatch,
  allowlist/body exclusion, size/ID/range/collision failures and client validation).
- real SQLite→temporary local HTTP handler:15tests (gzip/attachment/no-store,
  fixed3metadata SELECTs, small-session strict paging, stable distinct IDs,
  unloaded/invalid timestamps,9malformed queries, non-scan/not-found/internal
  failures,512KiB rejection and preservation of event rows).
- React DOM/client workflow:13tests (no eager IO, download/coverage/next range,
  input bounds, failure/retry, cancel,10s timeout,4ownership changes, invalid/
  mismatched/oversized payload, response-stream timeout cancellation and Chinese empty/unloaded feedback).
- `npm run typecheck` and `npm run lint` passed on this shared tree at the
  module handoff; targeted ESLint and `git diff --check` also passed.
- Total45module tests. The first HTTP run was blocked by sandbox `listen EPERM`;
  rerun used approved local execution and all15passed. A test-only Node-env
  annotation initially conflicted with global jsdom setup and was removed;
  real HTTP and SQLite logic remained unchanged. Neither environment failure
  was counted as an implementation pass.

No production route/Host-Origin integration, browser screenshot, collector
compatibility import, new performance budget certification or whole-product
completion is claimed. Those are root integration checks, not these module tests.

## Exact root wiring (not applied here)

### server/server.ts

Import near other HTTP helpers:

```ts
import { handleTraceExport } from './http/trace-export-route.js';
```

Register adjacent to `/api/sessions/:key/execution`:

```ts
router.register('GET', '/api/sessions/:key/trace-export', (req, res, params) => {
  handleTraceExport(req, res, db, params.key ?? '');
});
```

In the existing main request handler's protected native-session route regex,
append `|trace-export` inside the noncapturing alternatives, preserving siblings
added by concurrent tasks. E.g. current `(?:identities|capture-links|execution|
parents|family|tool-observations)` becomes the same alternatives plus
`|trace-export`. This is REQUIRED: handler deliberately delegates loopback
connection, Host/Origin checks and foreground marking to existing server policy.
The handler handles query/errors itself using existing ApiError codes; no new
error-envelope/client.ts/trace-types.ts edit is needed.

### UI (existing SessionCaptureLinksPanel entry; shared App only supplies eligibility)

In TraceLinksPanel.tsx, add lazy declaration:

```ts
const TraceExportPanel = lazy(() => import('./TraceExportPanel.js').then(module => ({ default: module.TraceExportPanel })));
```

Extend SessionCaptureLinksPanel props with `traceExportEnabled?: boolean`,
default false, and add `const [traceExportOpen, setTraceExportOpen] = useState(false)`.
Place this independent entry beside family/tools (outside linked-capture expansion):

```tsx
{traceExportEnabled && <>
  <button className="btn" type="button" aria-expanded={traceExportOpen}
    onClick={() => setTraceExportOpen(value => !value)}>
    {locale === 'zh' ? '标准 Trace 导出' : 'Standard Trace export'}
  </button>
  {traceExportOpen && <Suspense fallback={<Skeleton count={1} />}>
    <TraceExportPanel sessionKey={sessionKey} locale={locale} invalidateKey={invalidateKey} />
  </Suspense>}
</>}
```

The component renders its own scope disclosure; opening it does zero API reads.
Parent close unmounts and cancels. Existing sessionKey-keyed parent and
traceLinksVersion invalidation already cover session/SSE/reset changes.
In src/App.tsx's existing SessionCaptureLinksPanel invocation within session-canvas,
supply `traceExportEnabled={!offlineSamples && detail.session.dataSource === 'scan'}`.
App is outside this task whitelist; root must include that one-line change in its
own integration whitelist before editing. This prevents exporting local fallback
samples or suggesting proxy/cross-source export. Do not fetch eligibility per row.
Alternative root-owned placement may mount the same props under that exact
scan/non-offline eligibility; retain lazy entry and invalidation ownership.

### Styles

Append after existing `@import './components/workbench.css';` in
src/styles/components.css, retaining other independent new imports:

```css
@import './components/trace-export.css';
```

No component-level CSS import; root owns the aggregation entry.

### Required integration checks

- production GET succeeds only under existing loopback/Host/Origin guard;
  nonlocal Host/Origin are rejected and ApiError preserved.
- existing session entry opens without a fetch; explicit one-page export
  downloads, partial count and empty/unloaded messages visible in both locales.
- source change/cancel/unmount suppresses late result; non-scan/offline hidden.
- shared typecheck/lint and root-selected integration tests/build/synthetic
  screenshot; do not repeat full regression/performance/soak for this task.

## Remaining original13.1 scope

Leave original13.1 unchecked: this delivers native scan metadata only. Cross-source
native/propagated ID preservation, linked proxy spans, faithful full-original
packaging and end-to-end collector/import interoperability remain unimplemented.
Generated observational spans must not be relabelled complete instrumented traces.
No original loss: source rows/files are unchanged and existing raw/body download
workflows remain independent. Fee/performance/reliability/real replay stay deferred.

## Root integration outcome

Root connected the production GET, existing loopback/Host-Origin guard, explicit
lazy session entry, non-offline scan eligibility in App and scoped stylesheet.
Parent production integration tests cover200/404/Host-Origin and original-row
preservation. The combined suite passed290files/3499tests,1skipped; typecheck,
lint, build, package-artifact verification and diff whitespace checks passed.
The initial combined run caught literal CSS pixels in new modules; root fixed
them using existing tokens without weakening assertions.

The actual browser opened the export entry and scope/range controls. During the
download click+download-event wait, cua_repl transport closed; the exact click
outcome/download path is uncertain. One subsequent read-only state check also
failed immediately, so no click retry or raw-CDP fallback was attempted.
Browser download completion and collector import remain unverified.

An independent production HTTP GET on the isolated synthetic demo saved100
observation spans at /tmp/awesomeTelemetry-functional-delivery/scan-metadata-page-0.otlp.json;
page.partial=true,next_offset=100, no original body/native-ID leakage. This is
HTTP evidence, not a browser download receipt. Acceptance/SHA256 record:
/tmp/awesomeTelemetry-functional-delivery/acceptance-receipt.json.
Original13.1 moves from unimplemented to partial, not closed.
