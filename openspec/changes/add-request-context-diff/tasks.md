## 1. Contract freeze

- [x] 1.1 Read `AGENTS.md`, this change's `proposal.md`, all four delta specs, and `design.md`; record any conflict before touching implementation.
- [x] 1.2 Update `openspec/contracts/data-model.md` with `RequestContextFormat`, the fixed public diff types from design D10, and additive `ProxyRequest` metadata; add type-level exclusions proving Proxy list items still omit all body/header/system-prompt fields.
- [x] 1.3 Update `openspec/contracts/database.md` to schema v6 with `capture_group_id`, `request_format`, both composite predecessor indexes, explicit proxy columns, migration behavior, and expected no-temp-sort plans; reconcile stale “fresh v1/no migration” wording with current runtime v5.
- [x] 1.4 Update `openspec/contracts/api.md` with the context-diff route, `base` semantics, 200 response, 400/404/409/422/500 behavior, and the two new error codes.
- [x] 1.5 Update `openspec/contracts/nfr.md` with the 100 ms p95 service, 50 ms event-loop p99, 1 MiB response, two-row read, 2 MiB per-source, and forwarding-path isolation assertions.
- [x] 1.6 Copy the data-model contract types verbatim into `src/core/trace-types.ts` and extend `src/core/trace-types.test.ts` with positive enum/shape and negative leakage assertions.
- [ ] 1.7 Run `openspec validate add-request-context-diff --strict` and `npm run typecheck`; do not proceed until both pass.

## 2. Schema v6 and indexed storage

- [x] 2.1 Add `capture_group_id TEXT` and `request_format TEXT NOT NULL DEFAULT 'unknown'` to fresh `proxy_requests` DDL and bump `SCHEMA_VERSION` to 6.
- [x] 2.2 Add an idempotent v5→v6 migration that performs only the two additive column operations, creates the two D10 indexes, and throws visible rebuild guidance on non-duplicate failures.
- [x] 2.3 Add fresh-schema, v5 migration, repeated-init, historical-null/unknown, and newer-version refusal coverage to `server/storage/schema.test.ts`.
- [x] 2.4 Extend `PROXY_LIST_COLS` and the explicit full-row column list with capture group and request format; preserve every existing list exclusion.
- [x] 2.5 Map both fields in full and list proxy results, including `null`/`unknown` for historical rows.
- [x] 2.6 Add cached exact-session and capture-group predecessor queries that each return only required metadata plus the desensitized request body; never select raw columns.
- [x] 2.7 Add pairing-query tests for nearest-earlier behavior, null-safe model equality, known-session conflict data, and a 10,000-row capture group.
- [x] 2.8 Add `EXPLAIN QUERY PLAN` assertions proving both predecessor queries use their composite index and do not contain `USE TEMP B-TREE`.
- [x] 2.9 Run targeted storage/schema tests, then `npm run typecheck && npm run test && npm run lint`.

## 3. Capture correlation and request classification

- [x] 3.1 Generate one UUID per proxy startup attempt, expose it to the newly created proxy only after successful startup, clear it on stop/failure, and generate a different UUID after restart.
- [x] 3.2 Thread `captureGroupId` through `createMitmProxy` and `writeProxyRequest` so every row from one successful run receives the same value.
- [x] 3.3 Extend parser output with the closed `RequestContextFormat` enum; classify body shape rather than hostname alone.
- [x] 3.4 Implement Anthropic Messages classification from valid JSON plus an explicit Anthropic route/path/top-level-system/input-schema signal; ambiguous messages-only bodies on unknown routes return `unknown`.
- [x] 3.5 Implement OpenAI Responses-before-Chat classification so `instructions`/Responses `input` is not mislabelled as Chat; supported Chat uses a messages array.
- [x] 3.6 Persist request format and capture group in the proxy INSERT using the cached prepared statement; do not add full normalization or diff work to capture.
- [x] 3.7 Add controller tests for same-run stability, restart rotation, and failed-start cleanup.
- [x] 3.8 Add parser/writer tests for all three formats, compatible custom hosts, malformed JSON, unknown shapes, and historical defaults.
- [x] 3.9 Re-run existing proxy forwarding, SSE, raw-retention, and parser tests to prove no capture regression.

## 4. Provider-neutral normalization

- [x] 4.1 Create `server/proxy/context-normalizer.ts` with the exact constants, JSON types, normalized model, result/error reasons, and canonical SHA-256 helper from design D5/D6/D9.
- [x] 4.2 Implement source validation: desensitized body required, UTF-8 byte size ≤2 MiB, valid JSON object, stored format not `unknown`, and stored/body classification agreement.
- [x] 4.3 Normalize Anthropic top-level system string/blocks, ordered messages/content blocks, tools, and allowlisted parameters with source paths.
- [x] 4.4 Normalize OpenAI Chat leading system/developer messages separately, remaining ordered history, tools plus legacy functions, and allowlisted parameters.
- [x] 4.5 Normalize OpenAI Responses instructions, ordered typed input items, tools, and allowlisted parameters.
- [x] 4.6 Implement metadata scalar filtering and exclude any key matching secret/token/auth/cookie; unknown top-level fields must not enter parameters.
- [x] 4.7 Implement stable IDs, canonical object-key sorting, array-order preservation, JSON-type preservation, and occurrence ordinals for duplicate messages/tools.
- [x] 4.8 Apply 2,000-message, 256-tool, and 64-parameter bounds exactly; preserve first/last message strategy and completeness/omitted counts.
- [x] 4.9 Add pure tests for each field mapping, mixed content blocks, developer messages, legacy functions, Responses typed input, duplicates, object reorder, array reorder, type changes, limits, malformed/unknown/encrypted/missing/oversized sources.
- [x] 4.10 Add fixtures containing raw-only sentinel secrets and assert the normalizer accepts only the desensitized body supplied by the service.

## 5. Semantic diff and pairing service

- [x] 5.1 Create `server/proxy/context-diff.ts` with category-level alignment for system, messages, tools, and parameters; no general quadratic LCS implementation is allowed.
- [x] 5.2 Implement message matching precedence (stable ID, canonical hash, occurrence) and ordered unmatched-gap modification fallback.
- [x] 5.3 Implement tool matching by normalized identity/occurrence and recursive changed-path reporting for description/schema changes.
- [x] 5.4 Implement parameter diff by exact allowlisted key and typed canonical equality.
- [x] 5.5 Implement Unicode-code-point common-prefix/suffix inline segments with the 32,768-character limit and 4,096-character bounded excerpts.
- [x] 5.6 Implement category and global counts/completeness, changed-item-only entries, exact unchanged counts, 1,000-entry cap, and final response-size reduction order; incomplete evidence must force `noChange=false`.
- [x] 5.7 Implement character/message/tool growth, captured input-token delta or `usage_missing`, and deterministic indicators at the exact 30% shrink threshold.
- [x] 5.8 Create `server/proxy/context-diff-service.ts` to validate IDs, load exactly two rows, apply exact→capture-group pairing precedence, generate manual mismatch warnings, normalize both sources, yield between CPU stages, and return duration/provenance.
- [x] 5.9 Map all expected service outcomes to stable internal error classes without including source bodies, headers, secrets, or stacks.
- [x] 5.10 Add diff tests for append, removal, modification, reorder, duplicates, tool schema paths, parameter types, system/tool loss, exact threshold boundaries, partial evidence, no-change, response reduction, and Unicode.
- [x] 5.11 Add service tests for exact precedence, capture-group fallback, model mismatch, conflicting known sessions, manual cross-format warnings, same-ID rejection, missing rows, and unsupported reasons.
- [x] 5.12 Instrument test DB reads to prove one target plus at most one base body is loaded and raw columns are never selected.

## 6. HTTP contract and performance

- [x] 6.1 Register `GET /api/proxy/requests/:id/context-diff` before the generic `:id` route can consume it; parse omitted/`previous`/positive-integer base exactly.
- [x] 6.2 Map service outcomes to unified 400/404/409/422/500 envelopes and send successful responses through existing gzip-aware `sendJson`.
- [x] 6.3 Extend `src/api/client.ts` with a typed lazy context-diff method; preserve structured API codes for frontend state selection.
- [x] 6.4 Add server contract tests for automatic success, manual success, invalid target/base, same ID, missing target/base, unavailable pairing, all unsupported reasons, internal sanitization, and gzip.
- [x] 6.5 Add negative contract tests proving diff output and every error omit raw-only sentinels, authorization values, source bodies, and stack traces.
- [x] 6.6 Add performance fixtures at item/body/entry bounds and assert response <1 MiB, service p95 <100 ms, and event-loop p99 <50 ms.
- [x] 6.7 Add a regression assertion that proxy capture/forwarding does not import or call context normalization/diff modules.
- [x] 6.8 Run targeted API/performance tests, then the full typecheck/test/lint gate.

## 7. Proxy drawer experience

- [x] 7.1 Extract/create the drawer components listed in design D14 without changing the top-level view, routing, or `App.tsx` state model.
- [x] 7.2 Add Context Diff as a fifth tab while keeping Request as the initial tab and making zero diff requests before first activation.
- [x] 7.3 Implement component-local 10-entry pair cache keyed by target/base, one request per uncached pair, and no polling or automatic retry.
- [x] 7.4 Render pairing confidence/warnings before summaries; never label capture group as session and never hide manual mismatch warnings.
- [x] 7.5 Render growth, token availability, indicators, and four category counts with `—` for unavailable values.
- [x] 7.6 Render category navigation, unchanged summary counts, and added/removed/modified entries with text/icon plus color, inline segments, changed paths, excerpts, hashes, and partial-evidence labels.
- [x] 7.7 Implement automatic-unavailable guidance, compatible loaded-row picker, numeric request-ID entry, target exclusion, explicit manual selection, and base/target source-detail actions.
- [x] 7.8 Implement separate loading, success, unavailable, unsupported, and error+retry states without breaking ordinary request inspection.
- [x] 7.9 Add A-/A+/R long-text controls, visible keyboard focus, and keyboard-operable category/entry/base controls using existing design-system atoms.
- [x] 7.10 Add complete Chinese and English `proxy.contextDiff.*` strings and aligned CSS; do not add a dependency or hand-edit generated sources.
- [x] 7.11 Add frontend tests for lazy loading, exact request count, cache eviction, all states, confidence copy, null rendering, truncation, manual base, source actions, locale, and keyboard access.
- [x] 7.12 Re-run existing ProxyView start/stop/list/detail/empty/error tests to prove no regression.

## 8. Final verification and evidence

- [x] 8.1 Run `openspec validate add-request-context-diff --strict` with no warnings.
- [x] 8.2 Run `npm run typecheck && npm run test && npm run lint && npm run build && npm run perf:check`; fix implementation, never relax assertions.
- [x] 8.3 Audit the implementation diff against design D15; revert unrelated edits and stop for confirmation if any required file lies outside the whitelist.
- [x] 8.4 Audit package files and prove no runtime dependency was added.
- [x] 8.5 Audit SQL and frontend patterns for all AGENTS.md prohibitions: no `SELECT *`, body leakage, prepare-in-loop, sync child process, per-session SSE, N+1 fetch, delete/reinsert, silent scan-state catch, whole-file regex split, or `ORDER BY LENGTH`.
- [x] 8.6 Start production locally at `127.0.0.1`, capture two adjacent Anthropic Messages calls in one proxy run, and record source IDs plus a non-empty automatic diff result.
- [x] 8.7 Capture or real-fixture verify two OpenAI Responses calls; if real E2E is unavailable, leave this task unchecked and report the exact limitation.
- [x] 8.8 Enable raw retention in an isolated test capture with a unique raw-only sentinel and prove the context-diff HTTP payload cannot find the sentinel.
- [x] 8.9 Record real endpoint duration, response bytes, event-loop p99, and regression results in the project performance evidence required by `contracts/nfr.md`.
- [x] 8.10 Mark only evidenced tasks complete and report Delivered / Contract mapping / not implemented / Needs confirmation exactly as required by `AGENTS.md`.
