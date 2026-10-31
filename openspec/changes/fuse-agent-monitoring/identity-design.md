# Identity/correlation implementation batch

Approved goal: combine network captures with native session/tool/subagent evidence without merging unrelated concurrent Agents. This batch does not replace the existing team run/agent/task model. It adds references to existing scan sessions and proxy requests; original bodies, events, IDs and billing data remain independent.

## Fields and reasons (B1 / B7)

- Native identity: kind, namespace, value, optional native session scope, source JSON/header locator and optional normalized event ID. Keep raw IDs unchanged; filenames, generated event IDs and inferred turn keys are not native identifiers.
- Source manifest: scan/proxy owner, parser version and extraction completeness. Missing identity is distinguishable from empty, unsupported, omitted or not yet collected.
- Association: scan session key + network request ID, direct/candidate/user-confirmed/rejected/revoked state, reason, evidence IDs and timestamps. A separate append-only decision log preserves user actions, including undo/revoke; automatic ingestion never overrides a user decision.
- Separate paged source-identity and linked-request APIs. No original body/raw/summary columns in relation pages; original and native-event details remain on demand. Joined proxies are distinct actual request attempts, not newly created copies billed a second time.

## Conservative matching

Only native session identities with an explicit provider namespace may automatically establish session membership. The proxy extractor recognizes an opt-in client declaration pair x-agent-provider + x-agent-session-id (or metadata.agent_provider + metadata.session_id). Monitoring never injects these fields or changes forwarding. Known client-specific mappings require independent source/real-Agent validation before becoming defaults. Other native request/response/tool/trace IDs are retained as evidence, not silently promoted to session identity. In particular, Claude message.id is not globally unique, as recorded in existing adapter comments.

Auto matching is indexed exact namespace/kind/value matching, not host/model/time/hash matching. A source carrying multiple conflicting native session IDs, or the same provider/session ID appearing in multiple scan owners, is ambiguous: candidates only. New ambiguous evidence must downgrade previous automatic direct links; confirmed/rejected/revoked decisions survive re-ingestion. Every proxy remains a separate attempt even if a server reuses response IDs.

An unassociated request can be manually linked to a selected existing scan session. This is explicitly user-confirmed, not native evidence; the UI must retain that label and allow rejection/revocation. Deleting a session or proxy removes only owned manifests/links/decisions through FK cascades, never the other source or original files.

## Limits and verification

Scan identity collection: at most50000 identities per source, proxy2048; opaque values/scopes at most1024 characters, namespaces128, locators512. Over-limit identifiers are omitted with an explicit completeness reason, never truncated into a matching key. Identity pages default50/max100; association pages default50/max100; at most8 evidence IDs per association. No per-row SQL prepare/fetch, no body columns in lists.

Automatic suggestions are capped at32 per proxy request. Ambiguity is assessed over the entire matching set before applying the cap, so a truncated suggestion page cannot become false direct evidence. Still-matching previous automatic candidates have priority; native source identities remain independently available and users can select other eligible sessions explicitly. Identity pages also stop below500KB uncompressed and return the last actually emitted identity as their cursor.

### Implemented and verified boundary

Schema v12 adds five owned identity/association/audit tables without rewriting original sessions or proxy attempts. Session/proxy identities and associations are read from indexed, metadata-only pages; a50-request session page uses at most5 SELECTs including owner/count/evidence/bulk request metadata, not one query per request. Native identity and session/event/raw/metrics writes commit atomically. A real SQLite trigger failure proves rollback and absence of a saved-success notification.

Storage has16 tests; native extraction7; network extraction6; linked metadata UI7. Context service has18 tests and its Web panel12. Actual HTTP integration also covers interleaved same-host/model requests, two native sessions sharing a protocol response ID, an unassociated request and manual audit. Async original finalization may reorder SQLite numeric request IDs: tests correlate by the preserved client request identity, never insertion-order assumptions.

Web has a lazy session capture-link page and a lazy proxy relation tab, with direct/candidate/user-confirmed/rejected/revoked labels, source identity drill-down, paged audit and explicit confirm/reject/revoke. A200ms relation-only SSE invalidation shows stale state without reloading native details or originals. Automatic incremental relation patches/recovery remain B9 work. Request-detail, source-identity and audit reads ignore stale results after a user selects another proxy.

B7 task8.2 is complete for session-level association. This is not a claim of per-model-call/tool-execution mapping or complete B7: most normalized event references remain null, other scanners/client-specific declarations require verification, and call/retry/tool/subagent read models and usage deduplication are still pending. The custom x-agent-provider/session declaration is opt-in evidence, not proof that installed Agent versions emit it.

Required tests: same model/host/time without IDs stays unlinked; two interleaved native sessions stay separate; cross-provider ID collisions stay separate; repeated/late ingestion is idempotent; ambiguity downgrades old automatic links; manual decisions survive; session/proxy deletion does not delete the other source; reopen DB preserves links; EXPLAIN indexes and bulk reads; HTTP unified errors; UI no N+1 and original text is escaped. Actual Agent certification remains separate.

## Association-aware context and prompt selection (B7 task8.5)

Legacy automatic parsed_session_id/captureGroup pairing is replaced, not retained as a fallback. The target needs exactly one active direct/confirmed scan-session owner; the base needs that same unique owner and protocol format. Candidate-only, rejected, revoked or multiply accepted membership cannot authorize automatic comparison. Old exact/capture_group confidence enum entries are readable for historical compatibility only; new automatic results use linked_session and disclose the chosen session key plus a native-call-adjacency warning.

Metadata-only lookup uses one bounded reverse-owner query and two indexed scalar aggregates over eligible session-linked requests: latest earlier observed UTC instant, then highest numeric id at that instant. SQLite julianday compares equivalent ISO spellings consistently; ids only break equal-time ties. Late insertion of an earlier capture must still precede the target; a future-started request must never become its predecessor. This is observed capture order, not evidence that no native model call is missing between them. No schema extension or original/body copy is required.

Exactly one target and at most one base body are then read, using the existing original-backed normalizer and integrity/analysis bounds. Actual SQLite execution tracing counts both body reads even though they now reuse the same prepared statement. The10000-capture lookup fixture asserts3 metadata SELECTs, forward/reverse association indexes, no temporary sorting B-tree, no body columns and median<20ms. Existing end-to-end diff p95<100ms / p99<50ms / response<1MiB assertions remain unchanged; performance fixtures now explicitly establish session membership.

Manual comparison remains available across unknown/different memberships, preserves base→target orientation, labels manual and reports identity/model/protocol mismatches without writing association state. Session capture rows offer explicit request-specific Prompt inspection only when the request has a prompt; no list row fetches its body. The deprecated time-window longest-prompt helper remains an unused candidate utility and must never populate a native session or linked Trace context.

Association invalidation also clears cached context conclusions and hides stale results, offering explicit refresh without automatic body reads or reparse. Results from before invalidation or an older user selection cannot restore stale evidence. This does not replace the pending B9 incremental live-patch/reconnect implementation.

Verified2026-10-16: task8.5 complete. Isolated production-build browser with controlled local captures verified A/base1→A/target3 skips B/request2 despite shared gateway/model/run and B's longer prompt; both system sides remain A's own values. Revoking target3's membership invalidated the open comparison without an automatic request, explicit refresh returned unavailable, and manual base1→target3 stayed possible without restoring the revoked association. An independently unlinked request4 also showed unavailable then allowed a labelled manual comparison. Session→selected Prompt opened request1's own original preview, not B's long prompt. Upstream count remained exactly4 across all analysis; no request replay. Temporary servers/tabs were closed. Screenshot/log locations and gate results are in implementation.md.
