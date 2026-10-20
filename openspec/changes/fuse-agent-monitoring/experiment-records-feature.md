# Fusion 13.2: local manual experiment records

Implemented 2026-10-19 in `/tmp/awesomeTelemetry-telemetryref-npm`, branch
`codex/telemetryref-npm-continuation`. Post-M12 functional increment. Scope:
manual record CRUD, declarations, scan references, user labels and existing
CompareBoard handoff. No source mutation, execution, fees, performance or soak work.

## Frozen contract and delivered files

`openspec/contracts/experiment-records.md` EXP-001..004 defines exact transport
fields, bounds, CAS, IO and UI behavior before implementation. No root contract,
core trace DTO or SQLite schema edits were made for this feature.

- `server/experiments/registry.ts`: bounded asynchronous reads, schema validation,
  exclusive file lock, whole-registry revision CAS, fsync+atomic rename, preserved
  missing-session references and injected single-batch validation of new links.
- `server/experiments/registry.test.ts`:22 tests using actual temporary directories.
- `server/http/experiment-routes.ts`: native Router registration, bounded JSON
  bodies/read deadline, mandatory confirmed:true and unified error envelopes.
- `server/http/experiment-routes.test.ts`:5 real HTTP+temporary-directory tests.
- `src/api/experiment-records.ts`: standalone client and frozen transport types.
- `src/components/ExperimentRecordsPanel.tsx`: bilingual focus-trapped drawer,
  manual declarations/labels,20-record pages,50-match loaded-session search,
  confirmation, draft preservation, stale revision/uncertain outcome recovery,
  owned deadlines/cancellation, selected pair callback and local JSON download.
- `src/components/ExperimentRecordsPanel.test.tsx`:11 component behavior tests,
  using a mocked HTTP transport only (real component and API client logic).
- `src/styles/components/experiment-records.css`: scoped style, imported by panel.

## Validation

- `npx vitest run server/experiments/registry.test.ts src/components/ExperimentRecordsPanel.test.tsx`:33 passed.
- `npx vitest run server/http/experiment-routes.test.ts`:5 passed with temporary
  loopback-listener permission. Sandbox initially returned listen EPERM; no
  production service was started. Fixture now rejects listen errors immediately.
- `npm run typecheck`:passed after unrelated parallel TraceExport type errors
  were resolved by their owner; no off-whitelist repair was made here.
- `npx eslint server/experiments/registry.ts server/experiments/registry.test.ts server/http/experiment-routes.ts server/http/experiment-routes.test.ts src/api/experiment-records.ts src/components/ExperimentRecordsPanel.tsx src/components/ExperimentRecordsPanel.test.tsx`:passed.
- `npm run lint`:passed across the shared worktree.
- No full suite, performance checks, long-lived service, browser, commit, push or PR.

## Integration patch for the parent task (not applied here)

Apply sequentially in the shared integration owner. Do not use listSessions(keys)
for the injected lookup: that path currently performs one SELECT per key. Use the
single explicit-column JSON batch below. All supplied keys are validated and
bounded to16 by the registry before the callback runs.

### server/server.ts

Add imports beside the existing ConnectionProfileStore / Router imports:

```ts
import { ExperimentRegistry } from './experiments/registry.js';
import { registerExperimentRoutes } from './http/experiment-routes.js';
```

Immediately after `const router = new Router();` insert:

```ts
const experimentRegistry = new ExperimentRegistry(
  dirname(opts.userConfigPath ?? (dbPath || join(process.cwd(), '.agent-observe', 'state.sqlite'))),
);
registerExperimentRoutes(router, experimentRegistry, keys => {
  const rows = cachedStmt(db,
    "SELECT id FROM sessions WHERE data_source = 'scan' AND id IN (SELECT value FROM json_each(?))",
  ).all(JSON.stringify(keys)) as Array<{ id: string }>;
  return rows.map(row => row.id);
});
```

In the existing protected-route condition that starts
`if (pathname === '/api/events' || pathname.startsWith('/api/proxy/') ...`, add:

```ts
|| pathname === '/api/experiment-records'
|| pathname.startsWith('/api/experiment-records/')
```

This is REQUIRED for every method, including GET. It reuses existing loopback
remote-address and Host/Origin validation. Existing outer foreground tracking
remains unchanged. Handlers already set no-store and catch into ApiError; do not
add a competing error handler or profile/DB mutation.

### src/components/CompareBoard.tsx

Add `lazy, Suspense` to the existing React import. After imports add:

```tsx
const ExperimentRecordsPanel = lazy(() => import('./ExperimentRecordsPanel.js')
  .then(module => ({ default: module.ExperimentRecordsPanel })));
```

Inside CompareBoard beside `leftOpen/rightOpen` state add:

```tsx
const [experimentsOpen, setExperimentsOpen] = useState(false);
```

Immediately after the existing `<CompareSelectorBar ... />` insert:

```tsx
<button type="button" className="btn" onClick={() => setExperimentsOpen(true)}>
  {locale === 'zh' ? '手工实验记录' : 'Manual experiment records'}
</button>
{experimentsOpen && <ErrorBoundary
  label={locale === 'zh' ? '手工实验记录' : 'Manual experiment records'}
  fallback={() => <div role="alert">
    <p>{locale === 'zh' ? '面板加载失败，请关闭后重试。' : 'Panel loading failed. Close and retry.'}</p>
    <button type="button" className="btn" onClick={() => setExperimentsOpen(false)}>
      {locale === 'zh' ? '关闭' : 'Close'}
    </button>
  </div>}
>
  <Suspense fallback={<p role="status">
    {locale === 'zh' ? '正在加载手工实验面板…' : 'Loading manual experiment panel…'}
  </p>}>
    <ExperimentRecordsPanel sessions={sessions} locale={locale}
      onClose={() => setExperimentsOpen(false)}
      onCompare={(left, right) => {
        if (left === leftKey && right === rightKey) onCompare(left, right);
        else { onLeftChange(left); onRightChange(right); }
      }}
    />
  </Suspense>
</ErrorBoundary>}
```

Existing CompareBoard effect calls its onCompare when a changed pair arrives.
Do not call it immediately as well for changed pairs: that would be aborted by
the effect cleanup and duplicate the compare read. Same-pair explicit comparison
calls the existing callback directly. Panel only supplies available distinct scan
refs and closes itself through onClose after the callback. No App.tsx change.

## Integration acceptance still owned by parent

- Add shared-server tests for loopback Host/Origin rejection and batch lookup,
  with userConfigPath in a real temporary app-owned directory.
- Verify CompareBoard lazy entry and pair handoff produce one existing comparison
  request, then run the parent's authorized combined adjacent checks.
- Task13.2 remains unintegrated until the two shared files above are connected;
  do not mark overall fusion, original run quality, or controlled equivalence done.
- Missing refs mean unavailable in the loaded/filtered index, not confirmed deletion.
- No automatic experimental execution, quality scoring, revision history/import,
  database migration, or power-loss durability certification is implemented.

## Root integration outcome

Root connected the registry to the production Router and existing local/Host/
Origin guard for every method. The batch lookup is one cached explicit-column
SELECT with json_each. CompareBoard offers the independent lazy entry and sends
changed/same selected pairs through exactly one existing comparison read.
Root tests use real production HTTP/temporary config and actual panel/CompareBoard
logic: CAS/CRUD, rejected new references, retained unavailable refs and source
preservation pass. New CSS was aligned to existing design tokens after the full
suite caught literal pixels; no assertion was relaxed.

Combined regression:290files,3499passed/1skipped; typecheck/lint/build/package
artifact verification/diff whitespace checks passed. The synthetic demo at4188
now retains one clearly named SYNTHETIC manual record (revision1), created and
reread through the production HTTP endpoint with no model/tool execution.
ID and acceptance receipt: /tmp/awesomeTelemetry-functional-delivery/acceptance-receipt.json.

Browser transport failed during the preceding export acceptance and remained
unavailable on one read-only check. Manual-panel real-browser create/edit/compare
acceptance is blocked, not passed; component/HTTP evidence is distinct. No raw
CDP fallback, automatic write retry or simulated screenshot was used.
Original13.2 moves to partial pending browser/product acceptance, not closed.

### Later read-only browser follow-up

Normal cua_repl/iab access subsequently worked. The existing SYNTHETIC record's
declarations, two native run references and mixed/unrated labels rendered correctly.
Loaded-index filtering reduced candidates to1/0 and clearing restored3 without
removing existing refs. Selecting both retained runs enabled Compare; clicking
loaded the exact existing pair, closed the panel and displayed L107/107,R2/2.
The actual app-owned registry remained revision1 with1record, same ID/labels.
No creation/update/deletion/save/download or service/source change was performed.
Browser CRUD/confirmation/error/cancel/stale-write coverage is still not claimed.
Evidence: /tmp/awesomeTelemetry-functional-delivery/readonly-ui-acceptance.json.
