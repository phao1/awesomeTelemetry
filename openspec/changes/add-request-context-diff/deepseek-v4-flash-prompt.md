# deepseek-v4-flash implementation prompt — add-request-context-diff

Copy the block below into the implementation task. Do not shorten it before the first implementation run.

```text
Implement the existing OpenSpec change:
openspec/changes/add-request-context-diff/

This phase adds AwesomeTelemetry's first claude-tap-strength feature: evidence-grade adjacent request-context diff. Do not redesign the feature and do not implement other claude-tap capabilities.

## Read first, in this exact order

1. AGENTS.md — authoritative document priority, ten prohibitions, five must-dos, file-output rules
2. BOOTSTRAP.md — confirm M0-M12 are already complete; this is a post-M12 additive change
3. openspec/changes/add-request-context-diff/proposal.md — product boundary
4. openspec/changes/add-request-context-diff/implementation-spec.md — handoff index and FR/NFR/AC/edge-case map
5. openspec/changes/add-request-context-diff/specs/request-context-diff/spec.md — normative feature behavior
6. openspec/changes/add-request-context-diff/specs/{proxy-capture,storage,frontend}/spec.md — module deltas
7. openspec/changes/add-request-context-diff/design.md — fixed decisions D1-D15, exact public types, constants, API, schema, algorithms, file whitelist
8. openspec/changes/add-request-context-diff/tasks.md — execution checklist and acceptance evidence
9. openspec/contracts/{data-model,database,api,nfr}.md and relevant main specs/gotchas before each module edit

Fields, tables, routes, enum values, limits, error codes, and UI states must come from these files. Do not invent alternatives from memory.

## Execution mode

Work in batches in the exact order tasks.md §1→§8. Do not skip contract freeze and do not start UI before backend/API contracts and tests pass.

At the end of each numbered task group:

- run the targeted tests for that group;
- run npm run typecheck && npm run test && npm run lint;
- mark a checkbox [x] only when evidence exists;
- report any unresolved conflict before moving on.

Do not commit or push unless the user separately asks.

## Twelve phase-specific red lines

1. Diff only the stored desensitized request_body. Never select or use raw_request_body/raw_response_body as fallback. Never return auth headers, cookies, raw bodies, stack traces, or source JSON in errors.
2. No semantic normalization/diff on proxy forwarding, startup, list, SSE, or session-detail paths. Diff only after explicit Context Diff activation.
3. Automatic pairing order is exact parsed session first, then same capture group + request format + null-safe-equal model. Do not pair by timestamp alone and do not cross conflicting known session IDs.
4. captureGroupId means one proxy run, not one agent session. UI copy must not call it session.
5. Supported formats are exactly anthropic_messages, openai_chat, openai_responses. Everything else is unknown/422. No generic “best effort success.”
6. Use the exact D9 constants. No unbounded LCS/edit-distance, no extra package, and no raising limits because a fixture fails.
7. Canonical equality sorts object keys, preserves arrays and JSON types, and distinguishes duplicate occurrences. Do not compare raw JSON.stringify key order.
8. Incomplete/truncated evidence can never return noChange=true. Unknown/unavailable numbers render —, never 0.
9. Compaction is only suspected when the exact 30% history-shrink rule plus removed messages is met. Never claim a client compaction mechanism definitely ran.
10. Proxy list must continue excluding request/response/raw bodies, systemPrompt, and requestHeaders. Add only captureGroupId/requestFormat metadata.
11. Read exactly target + one base body. No loading an entire capture group/session and no frontend N+1 fetch.
12. Touch only design.md D15's file whitelist. If another file is truly required, stop and report requirement ID, file, and reason before editing.

## Scope intentionally excluded

- claude-tap import/SQLite/ctap JSON
- agent client launcher or automatic client configuration
- portable/self-contained HTML export
- new provider/client matrix
- response diff, session diff, or scan/proxy data merge
- new top-level view or router
- persisted normalized snapshots/diff cache
- exact tokenizer/context-window estimation
- package dependency additions

Do not implement any excluded item “while you are here.”

## Required stop conditions

Stop and ask before continuing if:

- authoritative contracts conflict and priority does not resolve it;
- a required public field/route/error/table is absent from the specs;
- implementation requires a file outside D15;
- a security/privacy requirement appears impossible with existing desensitized storage;
- a breaking API/schema change beyond additive v6 is required;
- a performance budget cannot be measured or met with the fixed bounds.

Do not guess through these conditions. Provide the exact requirement, options, recommendation, and blocked tasks.

## Definition of done

- openspec validate add-request-context-diff --strict passes
- npm run typecheck, test, lint, build, perf:check all pass
- all API/error/privacy/query-plan/performance/frontend acceptance tests exist
- no runtime dependency added
- real Anthropic adjacent capture is verified
- OpenAI Responses real capture is verified, or task 8.7 stays unchecked with an honest limitation
- raw-only sentinel cannot be found in diff output
- tasks.md reflects evidence, not optimism

Final response format:

## Delivered
- absolute/path — one-line result

## Contract mapping
- implements capability/requirement names and scenarios
- not implemented: explicit unchecked tasks and reasons

## Verification
- exact commands and pass counts
- real HTTP/capture evidence, response bytes, duration, event-loop p99

## Needs confirmation
- none, or precise blockers only
```
