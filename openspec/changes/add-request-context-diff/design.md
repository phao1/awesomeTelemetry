## Context

See `proposal.md` for product motivation and the capability delta specs for normative behavior.

AwesomeTelemetry already has the necessary capture spine:

1. `server/proxy/mitm-proxy.ts` captures request and response bodies.
2. `server/desensitization/engine.ts` desensitizes bodies before persistence.
3. `proxy_requests` stores the desensitized body separately from optional raw retention.
4. `GET /api/proxy/requests/:id` and `ProxyView` provide explicit request drill-down.
5. Proxy list queries exclude body-heavy columns and use keyset pagination.

The missing layer is semantic interpretation between two requests. Today a developer must open two large JSON documents and manually answer whether the system instructions, conversation history, tools, or request parameters changed.

The design must respect five existing constraints:

- Request and response bodies are sensitive and potentially large.
- Proxy forwarding is an event-loop-sensitive path; diff must never run there.
- Existing `parsed_session_id` is nullable and currently not populated by the MITM writer, so it cannot be treated as universally available.
- The application has a strict no-new-runtime-dependency rule.
- Scan sessions and proxy captures remain separate views; this phase enhances the Proxy view only.

The reference behavior being closed is verifiable in claude-tap's public documentation as of 2026-08-07: it exposes real request context and structural consecutive-request diff, including new/removed messages, system-prompt changes, tool schemas, parameters, and bounded inline highlighting. This design adopts that debugging job, not claude-tap's packaging, launcher matrix, or HTML export.

## Goals / Non-Goals

**Goals:**

- Produce a truthful, deterministic comparison of two captured model-request contexts.
- Make the default action useful for a fresh single proxy run without claiming a proxy run is the same thing as an agent session.
- Support Anthropic Messages, OpenAI Chat Completions, and OpenAI Responses request shapes in phase 1.
- Explain changes by category and link every finding back to the two source requests.
- Preserve local-first privacy and existing list/detail performance budgets.
- Make all unsupported, incomplete, heuristic, and truncated states explicit.
- Provide an implementation sequence that can be executed without inventing fields, routes, thresholds, or UI behavior.

**Non-Goals:**

- Importing `.ctap.json`, claude-tap JSONL, or claude-tap SQLite data (CT-02).
- Launching Claude Code, Codex, Cursor, or other clients through a new client-aware wrapper (CT-03).
- Exporting a self-contained HTML evidence artifact (CT-05).
- Adding providers beyond the three request formats listed above.
- Diffing model responses, tool-call results, whole normalized scan sessions, or two complete AwesomeTelemetry sessions.
- Reconstructing missing request context from terminal transcripts or scan events.
- Claiming that a context reduction proves client compaction occurred.
- Exact tokenization or context-window percentage when the provider did not capture those values.
- Persisting precomputed diff results or normalized snapshots.
- Returning raw, unredacted request bodies through the new endpoint.
- Adding a new top-level application view, router, state library, diff library, or syntax-highlighting dependency.

## Decisions

### D1: Enhance the existing Proxy drawer, not the Session view

Context diff is based on captured API truth. The Proxy view already owns request bodies, capture provenance, and per-request drill-down, while the Session view represents normalized vendor histories. Mixing them would violate frontend REQ-013 and blur two evidence levels.

The new UI is therefore one lazy `Context Diff` tab inside the existing right-side Proxy drawer. A later change may associate a diff finding with a scan session, but phase 1 does not merge the data models or navigation.

**Alternative rejected:** add a seventh top-level view. It increases navigation and state surface without creating a new user job.

**Alternative rejected:** place diff inside `EventInspector`. A scan event is not a proxy request and may have no request-context evidence.

### D2: Add capture-group identity because session identity is not reliable enough

Every successful `ProxyRuntime.start()` creates one opaque UUID using `node:crypto.randomUUID()`. The UUID is passed into the proxy server and written on every row captured by that runtime until stop. A restart creates a new UUID.

`captureGroupId` means only “captured by the same explicit proxy run.” It does not mean agent session, conversation, user, or project. The UI must state this for `capture_group` confidence.

When a parser can prove a stable provider session ID, `parsedSessionId` remains stronger evidence and wins. This change does not guess session IDs from user text, timestamps, model names, or URLs.

**Alternative rejected:** pair solely by nearest timestamp. Concurrent agents or background traffic can produce incorrect comparisons with no visible boundary.

**Alternative rejected:** require `parsedSessionId` for all automatic diff. Current captures would frequently have no usable predecessor and the first phase would fail its primary workflow.

### D3: Persist lightweight request-format classification, not normalized snapshots

Add `request_format` with this closed first-phase set:

```ts
export type RequestContextFormat =
  | 'anthropic_messages'
  | 'openai_chat'
  | 'openai_responses'
  | 'unknown';
```

The existing parser already parses the request JSON to extract model/system fields. It must classify the shape during that same parse and persist the result. Classification is small metadata; full normalization and diff remain on demand.

Classification rules, evaluated in order:

1. `anthropic_messages`: object has a `messages` array and is supported by at least one explicit signal: Anthropic parser route, `/v1/messages` path, top-level Anthropic `system`, or a tool carrying `input_schema`.
2. `openai_responses`: object has a Responses-style `input` field or `instructions`, or the path identifies `/responses`, and the shape is not Chat Completions.
3. `openai_chat`: object has a `messages` array and is supported by an OpenAI parser route/path or OpenAI-style tool/function shape.
4. `unknown`: invalid JSON, encrypted/absent body, or no supported shape.

An ambiguous messages-only payload on an unknown route/path remains `unknown`;
the classifier does not break a tie by guessing.

Host name alone is insufficient to classify a format because compatible gateways reuse OpenAI or Anthropic shapes on custom hosts.

**Alternative rejected:** persist a normalized JSON snapshot per request. It duplicates the fastest-growing table, creates migration/backfill complexity, and can become stale when normalization evolves.

**Alternative rejected:** classify every candidate during predecessor search. That can deserialize many large rows merely to find one base request.

### D4: Use two explicit indexed pairing queries

For target `T`, automatic base selection is:

1. If `T.parsed_session_id` is non-null, query the highest `id < T.id` with the same `parsed_session_id` and `request_format`, excluding `unknown`.
2. If no result and `T.capture_group_id` is non-null, query the highest `id < T.id` with the same `capture_group_id`, `request_format`, and model under null-safe equality.
3. Reject a capture-group candidate when both target and candidate have non-null, different `parsed_session_id` values.
4. Otherwise report `CONTEXT_DIFF_UNAVAILABLE` / `pairing_unavailable`.

Use these indexes:

```sql
CREATE INDEX IF NOT EXISTS idx_proxy_session_format_id
  ON proxy_requests(parsed_session_id, request_format, id DESC);

CREATE INDEX IF NOT EXISTS idx_proxy_group_format_model_id
  ON proxy_requests(capture_group_id, request_format, model, id DESC);
```

The second query must express null-safe model equality explicitly. Do not broaden to “any model in the same run”; model switches are valid manual comparisons but weak automatic adjacency.

Manual `base=<positive integer>` bypasses automatic identity constraints but returns mismatch warnings. It does not bypass normalization, privacy, source-size, or response-size constraints.

**Alternative rejected:** one dynamic all-purpose SQL statement with optional predicates. Separate stable statements are easier to plan, test, cache, and reason about.

### D5: Normalize only provider request semantics needed for this user job

The internal normalized model is not persisted and is not returned directly. It has these sections:

```ts
type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

interface NormalizedRequestContext {
  format: Exclude<RequestContextFormat, 'unknown'>;
  model: string | null;
  system: NormalizedTextBlock[];
  messages: NormalizedMessage[];
  tools: NormalizedTool[];
  parameters: Record<string, JsonValue>;
  stats: {
    systemChars: number;
    messageChars: number;
    toolChars: number;
    parameterChars: number;
    totalChars: number;
  };
  completeness: ContextCompleteness;
}
```

Normalization mapping is fixed for phase 1:

| Format | System | Messages | Tools | Parameters |
|---|---|---|---|---|
| Anthropic Messages | top-level `system` string or ordered content blocks | top-level `messages` | top-level `tools` | allowlist below |
| OpenAI Chat | leading `system` and `developer` messages, preserving order | remaining `messages` | top-level `tools` and legacy `functions` | allowlist below |
| OpenAI Responses | top-level `instructions` | top-level `input`, preserving typed items | top-level `tools` | allowlist below |

Tool identity:

- Anthropic: `tool.name`.
- OpenAI function tool: `tool.function.name`.
- Other Responses tools: `type` plus explicit provider ID/name when present.
- Duplicate identities receive an occurrence ordinal.

Message identity precedence:

1. Explicit provider item/message/call ID when present.
2. Canonical SHA-256 of role, content type, and normalized content.
3. Occurrence ordinal to distinguish identical repeats.

Only these request parameters are compared in phase 1:

```text
model
temperature
top_p
top_k
max_tokens
max_output_tokens
stop
stream
tool_choice
parallel_tool_calls
response_format
reasoning
reasoning_effort
service_tier
metadata (only scalar values; keys matching secret/token/auth/cookie are excluded)
cache_control
```

Unknown top-level fields are not copied into `parameters`. This prevents request bodies, provider credentials, large vendor blobs, and unstable transport metadata from entering the public diff contract. Adding another parameter later requires a spec update and fixture.

### D6: Canonical JSON equality is ordered for arrays and sorted for object keys

Canonicalization recursively sorts object keys, preserves array order, preserves JSON types, and serializes without whitespace. SHA-256 uses UTF-8 canonical bytes.

Consequences:

- Object key reordering is unchanged.
- Array/message order changes are significant.
- `1`, `"1"`, and `true` are different.
- Duplicate array items remain separate.
- `undefined`, functions, symbols, and non-JSON values never enter the model.

Do not compare `JSON.stringify` output from the original bodies directly; original key order would create false modifications.

### D7: Use deterministic alignment without unbounded quadratic work

Adjacent agent contexts are usually append-heavy. Alignment proceeds by category:

- **System blocks:** source-path/index identity, then content hash.
- **Tools:** normalized tool identity plus occurrence ordinal; equal identity with changed description/schema becomes `modified`.
- **Parameters:** exact allowlisted key.
- **Messages:** explicit stable ID first; then content-hash occurrence identity. Within unmatched ordered gaps, same role/content-kind at the same relative position is paired as `modified`; remaining items are add/remove.

No general unbounded LCS is permitted. This avoids O(n²) memory and event-loop stalls on long histories. Order changes may appear as remove/add evidence; that is acceptable and truthful.

Every change entry carries `beforeIndex`, `afterIndex`, and source paths when available, so the UI does not need to repeat matching logic.

**Alternative rejected:** full-array dynamic-programming LCS. A 2,000 × 2,000 message matrix is incompatible with the request-path event-loop budget.

### D8: Inline text diff is linear and bounded

For a modified text pair at or below 32,768 characters per side:

1. Compare Unicode code points, not UTF-16 code units.
2. Find the longest equal prefix.
3. Find the longest equal suffix without overlapping the prefix.
4. Emit up to four ordered segments: equal prefix, removed middle, added middle, equal suffix.

This gives exact character-boundary evidence with O(n) time and memory. It may conservatively highlight a broad middle region when there are multiple disjoint edits, but it never labels changed text as equal.

For larger text, return no inline segments. Return SHA-256, character length, the first and last bounded excerpts, and `truncatedReason='inline_limit'`.

**Alternative rejected:** add a text-diff dependency. Runtime dependencies are capped and the product does not need optimal edit scripts to answer the debugging question.

### D9: Explicit hard bounds and partial-evidence semantics

Constants are contractual and must live in one exported backend module so tests use the same values:

```ts
MAX_SOURCE_BODY_BYTES = 2 * 1024 * 1024;  // each stored request body
MAX_MESSAGES = 2_000;
MAX_TOOLS = 256;
MAX_PARAMETERS = 64;
MAX_CHANGE_ENTRIES = 1_000;               // total response
MAX_INLINE_TEXT_CHARS = 32_768;            // each side
MAX_EVIDENCE_EXCERPT_CHARS = 4_096;        // each side
MAX_RESPONSE_BYTES = 1 * 1024 * 1024;
HISTORY_SHRINK_RATIO = 0.30;
```

Behavior at bounds:

- A source body above 2 MiB returns `CONTEXT_DIFF_UNSUPPORTED` with reason `source_too_large`; partial JSON parsing is forbidden.
- More than 2,000 messages retains first 1,000 and last 1,000 plus `omittedCount`; that category is incomplete.
- More than 256 tools retains the first 256 plus `omittedCount`; that category is incomplete.
- More than 64 allowlisted/scalar metadata parameters retains deterministic lexical-first keys plus `omittedCount`.
- More than 1,000 change entries returns the first 1,000 in category/order sequence and an omitted count; `noChange` cannot be true.
- Before sending, serialize once and assert the response is below 1 MiB. If it is still over, progressively remove inline equal segments, then shorten excerpts. If the bounded representation still exceeds the limit, fail with `INTERNAL_ERROR`; never send an oversized response.

All truncation is surfaced in `completeness`; zero changes plus incomplete evidence is not `noChange=true`.

### D10: Public API and data contracts are additive and fixed

Update `ProxyRequest` and therefore `ProxyRequestListItem` with:

```ts
interface ProxyRequest {
  // existing fields unchanged
  captureGroupId: string | null;
  requestFormat: RequestContextFormat;
}
```

Add public diff types to `contracts/data-model.md` and `src/core/trace-types.ts` verbatim:

```ts
export type ContextPairingConfidence = 'exact' | 'capture_group' | 'manual';
export type ContextDiffCategory = 'system' | 'messages' | 'tools' | 'parameters';
export type ContextChangeKind = 'added' | 'removed' | 'modified';
export type ContextDiffSegmentKind = 'equal' | 'added' | 'removed';

export interface ContextCompleteness {
  complete: boolean;
  omittedCount: number;
  reasons: Array<
    | 'item_limit'
    | 'entry_limit'
    | 'inline_limit'
    | 'response_limit'
    | 'source_incomplete'
  >;
}

export interface ContextRequestRef {
  id: number;
  requestId: string;
  startedAt: string;
  hostname: string;
  model: string | null;
  captureMethod: CaptureMethod;
  parserRoute: string | null;
  requestFormat: Exclude<RequestContextFormat, 'unknown'>;
  parsedSessionId: string | null;
  captureGroupId: string | null;
  bodySha256: string;
  bodyBytes: number;
}

export interface ContextDiffSegment {
  kind: ContextDiffSegmentKind;
  text: string;
}

export interface ContextEvidenceValue {
  jsonType: 'string' | 'number' | 'boolean' | 'null' | 'array' | 'object';
  sha256: string;
  charLength: number;
  excerptStart: string;
  excerptEnd: string;
  truncated: boolean;
}

export interface ContextChangeEntry {
  category: ContextDiffCategory;
  kind: ContextChangeKind;
  identity: string;
  label: string;
  beforePath: string | null;
  afterPath: string | null;
  beforeIndex: number | null;
  afterIndex: number | null;
  changedPaths: string[];
  before: ContextEvidenceValue | null;
  after: ContextEvidenceValue | null;
  segments: ContextDiffSegment[] | null;
  truncatedReason: 'inline_limit' | 'response_limit' | null;
}

export interface ContextCategoryDiff {
  category: ContextDiffCategory;
  added: number;
  removed: number;
  modified: number;
  unchanged: number;
  completeness: ContextCompleteness;
  entries: ContextChangeEntry[];
}

export interface ContextGrowth {
  baseChars: number;
  targetChars: number;
  deltaChars: number;
  messageDelta: number;
  toolDelta: number;
  inputTokenDelta: number | null;
  inputTokenDeltaReason: 'captured_usage' | 'usage_missing';
}

export interface ContextIndicator {
  code: 'history_shrink' | 'system_loss' | 'tool_loss' | 'source_incomplete';
  classification: 'observation' | 'suspected_compaction';
  severity: 'info' | 'warning';
  before: number | null;
  after: number | null;
  message: string;
}

export interface RequestContextDiffResponse {
  base: ContextRequestRef;
  target: ContextRequestRef;
  pairing: {
    confidence: ContextPairingConfidence;
    reason: string;
    warnings: string[];
  };
  noChange: boolean;
  growth: ContextGrowth;
  indicators: ContextIndicator[];
  categories: ContextCategoryDiff[];
  completeness: ContextCompleteness;
  generatedAt: string;
  durationMs: number;
}
```

`unchanged` is an exact summary count. The `entries` array contains changed
items only (added/removed/modified); unchanged evidence is not repeated in the
response because doing so would consume the 1 MiB budget without helping the
debugging decision.

Endpoint:

```text
GET /api/proxy/requests/:id/context-diff
GET /api/proxy/requests/:id/context-diff?base=previous
GET /api/proxy/requests/:id/context-diff?base=<positive integer>
```

Semantics:

- Omitted `base` is identical to `base=previous`.
- Target not found: 404 `PROXY_REQUEST_NOT_FOUND`.
- Manual base not found: 404 `PROXY_REQUEST_NOT_FOUND`, details identify `role='base'`.
- Invalid ID/base or same IDs: 400 `BAD_REQUEST`.
- No eligible automatic predecessor: 409 `CONTEXT_DIFF_UNAVAILABLE`.
- Existing but unknown/malformed/encrypted/missing/oversized source: 422 `CONTEXT_DIFF_UNSUPPORTED`.
- Unexpected failure: 500 `INTERNAL_ERROR`, no stack or body evidence.

Add these stable API error codes to the authoritative full set:

| Code | HTTP | Meaning |
|---|---:|---|
| `CONTEXT_DIFF_UNAVAILABLE` | 409 | target is valid but no trustworthy automatic predecessor exists |
| `CONTEXT_DIFF_UNSUPPORTED` | 422 | target/base source cannot be normalized safely within phase-1 rules |

No request body or raw header is included in `details` for any error.

### D11: Database migration is additive schema v6

Contract DDL changes:

```sql
ALTER TABLE proxy_requests ADD COLUMN capture_group_id TEXT;
ALTER TABLE proxy_requests ADD COLUMN request_format TEXT NOT NULL DEFAULT 'unknown';
```

New databases include both fields in `CREATE TABLE`. Existing databases receive the two idempotent additions and new indexes, then `_meta.schema_version` becomes `6`.

Do not backfill old request formats by reading historical bodies during startup. Historical rows remain `unknown`; users may still manually inspect them. A future explicit maintenance command may backfill outside the request/startup path.

Rollback uses the prior binary. SQLite ignores additive columns and indexes; new proxy rows remain readable through old explicit column lists. If migration fails, startup throws the existing rebuild-guidance error because the DB is a derived local cache.

Update explicit columns:

- `PROXY_LIST_COLS`: add `capture_group_id`, `request_format`.
- Full proxy row columns: add both.
- No list body/header/system-prompt exclusions change.

### D12: Service flow is staged and yields between CPU phases

The route is asynchronous even though SQLite reads and individual normalization steps are synchronous:

```text
validate target/base params
  -> read target metadata/body
  -> choose/read exactly one base
  -> normalize base
  -> yield one event-loop turn
  -> normalize target
  -> yield one event-loop turn
  -> diff system + parameters
  -> yield one event-loop turn
  -> diff messages + tools
  -> build bounded response
  -> sendJson (gzip when applicable)
```

Use `await new Promise(resolve => setTimeout(resolve, 0))` at the marked boundaries. Do not spawn workers or child processes in phase 1. Record `durationMs` with `performance.now()`.

The route reads exactly two rows. It must not call `listProxyRequests`, fetch all capture-group rows, inspect raw columns, or calculate diffs for list items.

### D13: Compaction indicators are deterministic observations

Indicators:

- `history_shrink`: target message characters are at least 30% below a non-zero base and at least one message was removed. Classification is `suspected_compaction`.
- `system_loss`: one or more system blocks removed. Classification is `observation`.
- `tool_loss`: one or more tools removed. Classification is `observation`.
- `source_incomplete`: any source/category/response bound was hit. Classification is `observation`.

Never emit `compaction_occurred`, `client_compacted`, or a client-specific mechanism name. The UI copy must say “疑似上下文压缩 / suspected context compaction” and display the measured shrink.

### D14: Frontend composition and state ownership

Keep `ProxyView` as the selected-request owner. Extract the growing drawer content rather than turning `ProxyView.tsx` into a second stateful application shell:

```text
ProxyView
  -> ProxyDetailDrawer (existing request tabs)
       -> RequestContextDiffPanel (new lazy state)
            -> ContextDiffSummary
            -> ContextDiffCategoryTabs
            -> ContextChangeList
            -> ContextBasePicker
```

State key is `${targetId}:${baseModeOrId}`. A small component-local Map may cache at most 10 diff responses; evict oldest insertion. Do not add a global store.

Initial tab remains `request`. Diff fetch begins only on first `context-diff` activation. Automatic unavailable/unsupported responses are presentation states, not empty successful responses.

Base picker behavior:

- Show compatible requests from the already-loaded Proxy list first.
- Allow numeric ID entry for rows outside the current page.
- Exclude the target ID.
- Show capture group, format, model, and time as metadata when available.
- Do not fetch every proxy page to populate the picker.

Source actions close or retarget the current drawer to the base/target request through the existing request-detail API. They do not open raw bodies automatically.

Use existing `Tabs`, `Badge`, `Drawer`, `Skeleton`, `EmptyState`, and `ErrorState`. Changed rows need icon/text labels (`+ Added`, `− Removed`, `± Modified`) in addition to color; category summaries label the unchanged count as `= Unchanged`. Add zh/en strings under `proxy.contextDiff.*`.

### D15: Contract-first implementation and exact file boundary

Implementation must modify only the following expected files unless a requirement cannot be met. If another file is required, stop and report the exact requirement and reason before editing it.

**Contracts and change tracking**

```text
openspec/contracts/data-model.md
openspec/contracts/database.md
openspec/contracts/api.md
openspec/contracts/nfr.md
openspec/changes/add-request-context-diff/tasks.md
```

**Shared types**

```text
src/core/trace-types.ts
src/core/trace-types.test.ts
```

**Proxy/storage/backend**

```text
server/storage/schema.ts
server/storage/schema.test.ts
server/storage/columns.ts
server/storage/query-engine.ts
server/storage/query-engine.test.ts
server/proxy/controller.ts
server/proxy/controller.test.ts              # create if absent
server/proxy/mitm-proxy.ts
server/proxy/proxy-writer.ts
server/proxy/proxy-writer.test.ts
server/proxy/parser-router.ts
server/proxy/parser-router.test.ts
server/proxy/parsers/anthropic.ts
server/proxy/parsers/anthropic.test.ts        # create if absent
server/proxy/parsers/openai.ts
server/proxy/parsers/openai.test.ts           # create if absent
server/proxy/context-normalizer.ts             # new
server/proxy/context-normalizer.test.ts        # new
server/proxy/context-diff.ts                   # new
server/proxy/context-diff.test.ts              # new
server/proxy/context-diff-service.ts           # new
server/proxy/context-diff-service.test.ts      # new
server/server.ts
server/server.test.ts
server/server.perf.test.ts
```

**Frontend**

```text
src/api/client.ts
src/components/ProxyView.tsx
src/components/ProxyView.test.tsx
src/components/RequestContextDiffPanel.tsx      # new
src/components/RequestContextDiffPanel.test.tsx # new
src/i18n.ts
src/styles.css
```

Do not edit `src/generated/`, add a package, add a route library, or refactor unrelated Proxy/Frida behavior.

## Acceptance and Test Design

The capability specs are the normative acceptance source. The following test map prevents under-implementation:

| Area | Required tests |
|---|---|
| Type contract | closed enums; Proxy list still excludes all body/header/system fields; response shape compiles verbatim |
| Schema | fresh v6 creation; v5→v6 migration; migration idempotence; newer-version refusal; old rows map null/unknown |
| Query plans | both predecessor queries use composite indexes and contain no temp B-tree |
| Parser classification | Anthropic Messages; OpenAI Chat; OpenAI Responses; malformed JSON; unknown shape |
| Normalization | every format and category; content blocks; developer messages; legacy functions; typed Responses input; allowlist/exclusion |
| Canonicalization | object key reorder unchanged; array order significant; JSON types distinct; duplicate occurrence stability |
| Pairing | exact precedence; capture-group fallback; conflict refusal; manual warnings; no predecessor; same-ID rejection |
| Semantic diff | append; removal; modification; tool schema path; parameter type; system loss; message reorder |
| Bounds | 2 MiB source limit; item caps; entry cap; inline cap; final 1 MiB response cap |
| Privacy | raw-only secret fixture never appears in output/error/log capture; raw columns are not selected |
| API | success; omitted/previous base; manual base; all 400/404/409/422/500 envelopes; gzip |
| Performance | 10k-row predecessor lookup; p95 service <100ms; event-loop p99 <50ms; response <1 MiB |
| Frontend | no request before tab; one request on activation; cache; summary; manual picker; four states; truncation; locale; keyboard |
| Regression | ordinary request detail and Proxy list still work; proxy start/stop and streaming tests unchanged |

Real acceptance is required after automated gates:

1. Start the production server and proxy at `127.0.0.1`.
2. Capture at least two adjacent Anthropic Messages requests in one proxy run.
3. Verify automatic `capture_group` diff shows a real message or context addition and source IDs.
4. Capture or fixture-verify at least two OpenAI Responses requests and repeat.
5. Verify an unsupported body returns 422 without breaking ordinary request detail.
6. Verify raw-retention on with a unique raw-only sentinel; the sentinel must not appear in context-diff HTTP output.
7. Record real endpoint time, response bytes, and event-loop p99 in `PERF-BASELINE.md` if the project gate requires it.

“Tests pass” alone is not evidence for the two real capture checks. If an environment cannot produce one format, report that exact format as unverified; do not mark its real-E2E task complete.

## Risks / Trade-offs

- **[A capture group can contain unrelated traffic]** → Same format/model plus nearest order is only medium confidence, known-session conflicts are rejected, and UI disclosure is mandatory.
- **[Provider request shapes evolve]** → Closed format classifiers, strict fixtures, explicit unsupported state, and no generic success fallback.
- **[Desensitization is conservative rather than perfect]** → Diff never reads raw columns; UI labels evidence as locally captured/desensitized, not guaranteed secret-free; no export is added.
- **[Large JSON can block Node]** → 2 MiB source cap, item/entry bounds, linear algorithms, staged event-loop yields, and performance tests.
- **[Coarse linear text diff over-highlights a middle region]** → It remains exact evidence, documents the trade-off, and avoids a dependency or unbounded edit-distance algorithm.
- **[Historical rows show unknown format]** → No startup backfill; users retain ordinary request inspection and new captures gain the feature immediately.
- **[OpenAI-compatible gateways use unusual shapes]** → Classification is body-based and unknown shapes fail visibly; add fixtures/spec updates before broadening.
- **[Schema docs currently contain stale fresh-v1 language while runtime is v5]** → Contract update must reconcile the authoritative database document with actual schema migration history before code changes. Do not preserve the stale statement when adding v6.
- **[Response truncation could hide a later change]** → Omitted counts and completeness prevent a false no-change conclusion; source request links remain available.

## Migration Plan

1. Update the four authoritative contracts first, including schema v6, public types, route, errors, and budgets.
2. Add shared types and type-level negative assertions.
3. Add idempotent v5→v6 migration and indexes; verify query plans before feature logic.
4. Add capture-group and request-format writes; existing capture behavior remains valid with the new metadata.
5. Add normalization, bounded diff, and pairing service with pure tests.
6. Add the HTTP route and API/performance contract tests.
7. Add the lazy Proxy drawer tab and frontend tests.
8. Run all quality gates and real capture acceptance.

Rollback:

- Stop the new binary and run the previous one.
- Additive columns/indexes remain unused; no data rewrite is required.
- Existing rows and APIs retain their old fields because no field or endpoint was removed.
- If the migration itself fails, abort startup and instruct the user to rebuild the derived local DB; do not continue in a half-migrated state.

## Open Questions

None. Any change to supported formats, automatic pairing identity, public fields, thresholds, source-body policy, or file boundary requires updating this OpenSpec change before implementation.
