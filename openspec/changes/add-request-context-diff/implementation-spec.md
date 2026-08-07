# Spec: Phase 1 Request Context Diff

**Author:** Codex planning agent
**Date:** 2026-08-07
**Status:** In Review
**Reviewers:** Project owner

> Handoff index for human and agent review. Normative behavior lives in
> `specs/*/spec.md`; exact technical contracts and fixed limits live in
> `design.md` D1-D15. On conflict, follow `AGENTS.md` document priority and
> stop rather than reconciling silently.

## Context

AwesomeTelemetry already captures desensitized model request/response bodies
and provides a local Proxy request drawer. It does not explain how the context
sent to a model changes between calls. Developers must manually compare large
JSON payloads to find prompt, message, tool-schema, model-parameter, or context
growth differences.

claude-tap's public repository and local viewer guide, checked on 2026-08-07,
identify exact request context and structured adjacent-request diff as core
debugging capabilities. Phase 1 closes that narrow forensic gap using the
existing AwesomeTelemetry MITM store. It deliberately excludes claude-tap
import, client launchers, and portable HTML export.

Success means a developer can open one captured request, activate Context
Diff, and receive a truthful, bounded explanation of what changed from a
trustworthy predecessor. The result must disclose evidence source, pairing
confidence, incompleteness, and truncation rather than showing false certainty.

## Functional Requirements

- FR-1: The system MUST normalize only Anthropic Messages, OpenAI Chat Completions, and OpenAI Responses request bodies into System, Messages, Tools, and Parameters categories; unknown or malformed shapes MUST return unsupported.
- FR-2: The system MUST derive every diff exclusively from stored desensitized `request_body`; it MUST NOT select or use raw body columns or authentication headers.
- FR-3: Every successful proxy run MUST assign one opaque capture-group ID to its captured rows, and a later proxy run MUST use another ID; the product MUST NOT call this an agent session.
- FR-4: Automatic pairing MUST choose nearest earlier same parsed-session/request-format evidence first, then nearest earlier same capture-group/request-format/null-safe-equal-model evidence; it MUST reject conflicting known session IDs.
- FR-5: The system MUST support an explicit manual base request, preserve base→target order, label confidence `manual`, and return identity mismatch warnings.
- FR-6: The system MUST report typed added, removed, and modified evidence plus exact unchanged counts separately for System, Messages, Tools, and Parameters; unchanged items MUST NOT be repeated as response rows.
- FR-7: Equality MUST sort object keys, preserve array/message order and JSON types, use stable IDs or canonical SHA-256 plus occurrence ordinals, and preserve duplicate occurrences.
- FR-8: Modified bounded text MUST include equal/added/removed Unicode-code-point segments; oversized evidence MUST use hashes, lengths, bounded excerpts, omitted counts, and explicit truncation reasons.
- FR-9: The system MUST report measured character growth, message/tool deltas, captured input-token delta when available, and deterministic history/system/tool/source indicators without claiming proven client compaction.
- FR-10: `GET /api/proxy/requests/:id/context-diff` MUST implement omitted/`previous`/positive-ID base semantics and the unified 400/404/409/422/500 errors defined in design D10.
- FR-11: The existing right-side Proxy drawer MUST add a lazy Context Diff tab with confidence, warnings, summary, categories, manual base selection, source links, bilingual copy, keyboard access, caching, and distinct loading/success/unavailable/unsupported/error states.
- FR-12: The system MUST distinguish complete no-change from unsupported, unavailable, incomplete, truncated, and failed evidence; incomplete evidence MUST NOT return `noChange=true` or render unknown numbers as zero.

## Non-Functional Requirements

- NFR-P1: At tier-B scale, context-diff service time MUST be below 100 ms p95.
- NFR-P2: Event-loop delay during context diff MUST remain below 50 ms p99.
- NFR-P3: Uncompressed successful response size MUST remain below 1 MiB.
- NFR-P4: Each source body MUST be capped at 2 MiB; the implementation MUST apply the remaining exact limits from design D9.
- NFR-P5: One diff MUST read exactly one target and at most one base body; it MUST NOT scan or deserialize a whole capture group/session.
- NFR-P6: Semantic normalization/diff MUST NOT run during proxy forwarding, startup, list loading, session detail, SSE handling, or before explicit UI activation.
- NFR-S1: Raw-only secrets, authorization/cookie values, source bodies, and stack traces MUST NOT enter successful output, errors, logs, snapshots, or test diagnostics.
- NFR-R1: Schema v6 migration MUST be additive, idempotent, visible on failure, and backward-readable by the previous binary.
- NFR-A1: All diff controls MUST be keyboard operable with visible focus, and change states MUST use text/icon labels in addition to color.
- NFR-C1: No runtime dependency, top-level view, router, global state library, persisted normalized snapshot, or persisted diff cache MAY be added.

## Acceptance Criteria

### AC-1: Supported normalization (FR-1)
Given one valid fixture for each of the three supported formats
When each body is normalized
Then System, Messages, Tools, Parameters, source paths, order, and exact format are present
And malformed and unknown fixtures return stable unsupported reasons instead of empty success

### AC-2: Raw-retention privacy (FR-2, NFR-S1)
Given proxy rows whose desensitized body omits a unique sentinel that exists only in raw body/header fields
When automatic and manual context diff plus every error path are exercised
Then the sentinel is absent from HTTP output, errors, captured logs, snapshots, and diagnostics
And query instrumentation proves raw columns were never selected

### AC-3: Capture correlation (FR-3, NFR-R1)
Given three requests captured in one successful proxy run followed by a proxy restart and one new request
When rows are queried
Then the first three share one non-empty capture-group ID and the fourth has another
And historical v5 rows remain readable with null group and `unknown` format

### AC-4: Automatic pairing (FR-4, NFR-P5)
Given candidates covering exact session, same capture group, model mismatch, and conflicting known sessions
When automatic diff is requested
Then exact session wins, valid capture-group evidence is fallback, invalid candidates are rejected, and only the target plus selected base body are read

### AC-5: Manual comparison (FR-5, FR-10)
Given two distinct supported request IDs with format/model/group mismatches
When `base=<id>` is requested
Then HTTP 200 preserves submitted order, confidence is `manual`, and all identity mismatches are warnings
And same/malformed/missing base IDs use their specified unified errors

### AC-6: Semantic changes (FR-6, FR-7)
Given adjacent bodies with an appended message, removed system block, modified tool schema, reordered JSON object keys, reordered messages, duplicate messages, and parameter type change
When they are diffed
Then only added/removed/modified rows are returned, unchanged items are counted, object key order is ignored, array/message order remains significant, duplicates remain independent, and JSON types are preserved

### AC-7: Bounded evidence (FR-8, FR-12, NFR-P3, NFR-P4)
Given inputs at every D9 item, inline, entry, source, and response boundary
When context diff runs
Then output follows the exact retain/omit/reduce rules, includes hashes/excerpts/counts/reasons, stays below 1 MiB, and never claims complete no-change after any bound is hit

### AC-8: Growth and indicators (FR-9)
Given one pair with captured usage, one pair without usage, and message histories just below/at the 30 percent shrink boundary
When diffs are generated
Then token delta has captured/null provenance, character growth remains measured, and suspected compaction appears only at the exact threshold with removals

### AC-9: API envelope and isolation (FR-10, NFR-P1, NFR-P2, NFR-P6)
Given success, unavailable, unsupported, missing, malformed, and internal-failure cases plus a bounded large pair
When the endpoint is called under performance measurement
Then status/code/body match design D10, gzip applies normally, p95/p99 budgets pass, and forwarding-path instrumentation observes no diff work

### AC-10: Lazy UI and confidence (FR-11, NFR-A1)
Given a proxy request drawer on its default Request tab
When the user opens and revisits Context Diff, changes baseline, navigates categories, and uses retry by keyboard
Then no pre-activation request occurs, one request occurs per uncached pair, the 10-entry cache works, confidence/warnings precede findings, and all controls remain keyboard visible

### AC-11: UI state truthfulness (FR-11, FR-12)
Given loading, success, unavailable, unsupported, truncated, token-missing, and backend-failure responses
When each renders in Chinese and English
Then every state is distinct, unavailable values show `—`, partial evidence is labelled, and ordinary request inspection remains usable

### AC-12: Regression and delivery gate (FR-1, FR-12, NFR-R1, NFR-C1)
Given the complete implementation
When OpenSpec strict validation, typecheck, unit tests, lint, build, perf check, real Anthropic capture, OpenAI Responses verification, and raw-sentinel audit run
Then every evidenced task passes, no runtime dependency or out-of-scope file is added, and unverifiable real-E2E work stays unchecked rather than being claimed complete

## Edge Cases

- EC-1: Target request does not exist → 404 `PROXY_REQUEST_NOT_FOUND`.
- EC-2: Manual base does not exist → 404 `PROXY_REQUEST_NOT_FOUND` with `role=base` details and no body evidence.
- EC-3: Base is malformed, non-positive, or equals target → 400 `BAD_REQUEST`.
- EC-4: No trustworthy automatic predecessor → 409 `CONTEXT_DIFF_UNAVAILABLE`, reason `pairing_unavailable`.
- EC-5: Body is null, malformed, encrypted, `unknown`, or stored format disagrees with body → 422 `CONTEXT_DIFF_UNSUPPORTED` with stable reason.
- EC-6: Desensitized body is absent while raw body exists → unsupported; never use raw fallback.
- EC-7: Either source exceeds 2 MiB → unsupported `source_too_large`; never parse partial JSON.
- EC-8: Known session IDs conflict inside one capture group → do not pair automatically.
- EC-9: Models or formats differ in manual mode → compare compatible categories and return warnings/completeness, not silent coercion.
- EC-10: Duplicate messages/tools → occurrence ordinals preserve independent entries.
- EC-11: Object key order changes only → unchanged; array/message order changes → significant evidence.
- EC-12: Any item/entry/inline/response limit is reached → mark incomplete and prevent `noChange=true`.
- EC-13: Migration is partially impossible → abort startup with rebuild guidance; do not continue silently.
- EC-14: Unexpected parser/diff failure → 500 `INTERNAL_ERROR` without stack, body, headers, or partial diff.
- EC-15: Backend becomes unreachable after drawer opens → error+retry within five seconds; ordinary request tabs still work.

## API Contracts

### GET /api/proxy/requests/:id/context-diff

Query:

```ts
interface RequestContextDiffQuery {
  base?: 'previous' | `${number}`; // omitted equals previous; numeric value MUST be a positive integer
}
```

Success:

```ts
interface RequestContextDiffResponse {
  base: ContextRequestRef;
  target: ContextRequestRef;
  pairing: {
    confidence: 'exact' | 'capture_group' | 'manual';
    reason: string;
    warnings: string[];
  };
  noChange: boolean;
  growth: ContextGrowth;
  indicators: ContextIndicator[];
  categories: ContextCategoryDiff[];
  completeness: ContextCompleteness;
  generatedAt: string; // ISO 8601 UTC
  durationMs: number;
}
```

The complete nested interfaces and enum values MUST be copied verbatim from
`design.md` D10 into `contracts/data-model.md` and `src/core/trace-types.ts`.

Errors:

| HTTP | Code | Trigger |
|---:|---|---|
| 400 | `BAD_REQUEST` | invalid target/base or same request |
| 404 | `PROXY_REQUEST_NOT_FOUND` | target or manual base missing |
| 409 | `CONTEXT_DIFF_UNAVAILABLE` | no trustworthy automatic predecessor |
| 422 | `CONTEXT_DIFF_UNSUPPORTED` | source cannot be normalized safely |
| 500 | `INTERNAL_ERROR` | unclassified failure, sanitized |

All non-2xx bodies MUST use the existing `ApiError` envelope from
`contracts/api.md` §0.3. No source body/header/stack is allowed in `details`.

## Data Models

### Persistent proxy additions

| Field | Type | Constraints |
|---|---|---|
| `capture_group_id` | SQLite TEXT nullable | UUID for one successful proxy run; historical rows null; correlation only |
| `request_format` | SQLite TEXT not null | default `unknown`; closed phase-1 enum |

Indexes:

| Index | Columns | Purpose |
|---|---|---|
| `idx_proxy_session_format_id` | `parsed_session_id, request_format, id DESC` | exact predecessor |
| `idx_proxy_group_format_model_id` | `capture_group_id, request_format, model, id DESC` | capture-group predecessor |

### Transient/public entities

| Entity | Persistence | Constraints |
|---|---|---|
| `NormalizedRequestContext` | none | internal only; built from desensitized body; bounded by D9 |
| `ContextRequestRef` | response only | provenance, no source body/header |
| `ContextChangeEntry` | response only | typed category/kind, source paths, bounded evidence |
| `ContextCategoryDiff` | response only | counts, entries, completeness |
| `RequestContextDiffResponse` | response only | below 1 MiB, generated on demand, never cached in DB |

No soft/hard deletion behavior changes: proxy retention and clear behavior
continue to delete whole proxy rows; no separate diff rows exist.

## Out of Scope

- OS-1: claude-tap `.ctap.json`, JSONL, or SQLite import — separate CT-02 change.
- OS-2: Client-aware launch/configuration for Claude, Codex, Cursor, or others — separate CT-03 change.
- OS-3: Portable or self-contained HTML evidence export — separate CT-05 change.
- OS-4: Provider formats beyond Anthropic Messages, OpenAI Chat, and OpenAI Responses — require fixtures and spec update.
- OS-5: Model-response, tool-result, complete scan-session, or cross-session diff — different evidence and UI contracts.
- OS-6: Exact tokenizer or context-window utilization estimates — unavailable without authoritative provider/model evidence.
- OS-7: Persisted normalized snapshots, diff cache, startup backfill, or migration-time body parsing — storage/performance cost exceeds phase-1 need.
- OS-8: New top-level view, router, global state library, runtime dependency, or syntax highlighter — existing Proxy drawer and atoms are sufficient.
- OS-9: Claiming observed history shrink proves client compaction — only suspected/observed language is permitted.
- OS-10: Automatic pairing by timestamp alone or across conflicting known session IDs — false evidence risk is unacceptable.
