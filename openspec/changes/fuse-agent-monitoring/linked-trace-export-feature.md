# Linked trace export feature ownership

M11 functional increment on the M12 npm baseline. Work only in
`/tmp/awesomeTelemetry-telemetryref-npm`. Exact exclusive whitelist:

- openspec/contracts/linked-trace-export.md
- openspec/changes/fuse-agent-monitoring/linked-trace-export-feature.md
- src/core/linked-trace-export.ts
- src/core/linked-trace-export.test.ts
- server/http/linked-trace-export-route.ts
- server/http/linked-trace-export-route.test.ts
- src/api/linked-trace-export.ts
- src/components/LinkedTraceExportPanel.tsx
- src/components/LinkedTraceExportPanel.test.tsx
- src/styles/components/linked-trace-export.css

Shared roots, v1 files and TraceLinksPanel are owned by the parent integrator.
No source-data changes, collector upload, real execution, dependency installation,
full/performance run, permanent server, browser operation, commit or publication.

## Status
Contract frozen before implementation. Implementation and targeted validation
are complete; exact integration snippets and evidence are recorded below. Old task13.1 remains partial: this is bounded cross-source
metadata export, not a full collector or authenticated causal execution trace.

## Documentation conflicts
BOOTSTRAP's adapter cache max example is superseded by its explicit correction;
gotchas G5.1 schema v4 is stale relative to current database contract. Frontend
G7.6/7.7/7.8 references differ from gotchas chapter numbering; apply frontend's
explicit no duplicate index/no silent errors/no eager full reads requirements.
Installed Vitest is4.1.10 versus AGENTS'3 baseline; use existing installation,
without dependency changes.

## Implemented / validation (2026-10-20 Asia/Singapore)

LTX-001..005 implemented across the exact10-file whitelist. New tests:
- core conversion/complete wire validator:25 cases.
- real SQLite and temporary HTTP route:23 cases.
- real React component plus real API stream/validator:17 cases (only fetch and
  browser download transport stubbed, never the converter/client/component).

65 new cases passed. Unchanged v1 core/component regression adds30 passed cases,
95 targeted cases total across the two commands. Targeted TypeScript6 strict
check (including src/vite-env.d.ts) and ESLint passed for all7 new TS/TSX files.
The initial HTTP run was blocked by sandbox listen EPERM; an approved isolated
rerun passed, including the added50-capture fixed-query case. Tests close every
server and use synthetic in-memory databases; no real-data/browser operations.
TypeScript's explicit-file CLI requires --ignoreConfig and the existing Vite
ambient declaration for CSS; final exact-option check passed. No assertions
were loosened, full test/build/perf/long-soak was not run here.

Evidence:1 or50 accepted captures issue exactly11 SELECTs inside one outer BEGIN/
COMMIT; query_only=ON works with unchanged total_changes(). Nested reader
savepoints retain the same snapshot. HTTP payloads preserve gzip/no-store/safe
attachment and fail503 for bounded-identity/byte overflow, without clipping.
Two synthetic same-model sessions and multi-owner membership preserve independent
scan IDs and identical network IDs. Native v1 still emits its original single
scope and no native identity attributes.

## Exact parent wiring (shared files are NOT edited by this task)

Public API:

```ts
handleLinkedTraceExport(req: IncomingMessage, res: ServerResponse,
  db: Database, sessionKey: string): void;
LinkedTraceExportPanel(props: {
  sessionKey: string; locale: Locale; invalidateKey?: string | number;
});
```

In server/server.ts, beside the existing v1 import and route:

```ts
import { handleLinkedTraceExport } from './http/linked-trace-export-route.js';

router.register('GET', '/api/sessions/:key/linked-trace-export', (req, res, params) => {
  handleLinkedTraceExport(req, res, db, params.key ?? '');
});
```

Extend the existing local connection/Host/Origin guarded session-route regex to:

```ts
/^\/api\/sessions\/[^/]+\/(?:identities|capture-links|execution|parents|family|tool-observations|trace-export|linked-trace-export)$/.test(pathname)
```

Keep the existing outer markForegroundRequest() invocation for every request;
never dispatch the handler before the local guard. Integration must assert
untrusted Host/Origin rejection and unchanged v1 behavior. No new transport
controller, parsing service or source/DB write is required.

In TraceLinksPanel.tsx, reuse its existing lazy/Suspense/Skeleton imports:

```tsx
const LinkedTraceExportPanel = lazy(() => import('./LinkedTraceExportPanel.js')
  .then(module => ({ default: module.LinkedTraceExportPanel })));
// Inside SessionCaptureLinksPanel:
const [linkedExportOpen, setLinkedExportOpen] = useState(false);
// Render beside the v1 entry, inside the existing traceExportEnabled guard:
<div className="family-entry">
  <button className="btn" type="button" aria-expanded={linkedExportOpen}
    onClick={() => setLinkedExportOpen(open => !open)}>
    {locale === 'zh' ? '跨来源 Trace 导出' : 'Cross-source Trace export'}
  </button>
</div>
{linkedExportOpen && <Suspense fallback={<Skeleton count={1} />}>
  <LinkedTraceExportPanel sessionKey={sessionKey} locale={locale}
    invalidateKey={invalidateKey} />
</Suspense>}
```

Keep `traceExportEnabled` limited to eligible non-offline scan sessions. Existing
session/association invalidation must feed invalidateKey. Closing removes the
panel and aborts its read. CSS is imported by the new component itself; do not
add a global stylesheet import. No locale dictionary/shared client change.

Parent-owned server/TraceLinksPanel wiring appeared during this task and matches
these interfaces; this task did not edit those shared files or claim its full
integration tests. Parent owns final shared guard/UI/build verification.

## Remaining boundary

Old compound task13.1 remains partial. This module exports bounded retained
metadata and source-located identities, not full original content, a collector,
propagated parent/retry links, unique ownership, billing reconciliation, measured
Agent execution, full-history completeness or platform/soak certification.
Existing independent original downloads/evidence remain available and unchanged.
No confirmation is needed for this module's delivered scope.
