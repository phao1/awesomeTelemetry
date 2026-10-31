# Spec: TraceLog import

## Purpose
Explicit local import of TraceLog exports without replaying Agent operations.

## Requirements
### REQ-001: Bounded evidence import
SHALL accept UTF-8 {session,turns} JSON and gzip tar regular traces/*.json in a
bounded worker. Reject invalid/truncated/unsafe/over-limit input with ApiError.
No project source import or execution. Limits follow contracts/nfr.md.

### REQ-002: Independent durable provenance
SHALL retain exact JSON originals outside SQLite and metadata/byte indexes
inside. SHA256 deduplicates repeat imports. All selected members commit once
atomically after validation/copy; failures preserve prior data. No fabricated
output/execution/charge/trace link. Missing fields remain null; timings/tokens
are exporter-reported, not native measurements or normalized billing.

### REQ-003: Lazy local inspection
SHALL offer an existing Proxy drawer: upload, paged metadata, selected-turn
system/messages/tools/output/raw and original download. No polling/list bodies/
per-row fetch. Owned cancellation/stale suppression, explicit refresh after
uncertain outcomes, bilingual inert text, readable keyboard-accessible controls.

Workbench clarification: the existing lazy right drawer groups optional upload,
bounded20-row session discovery and selected Turn evidence with accurate page
ranges. Each read has independent5s ownership/retry; changing identity hides old
content immediately. List refresh, locale, field or font changes MUST NOT refetch
unrelated Turn bodies. A cancelled/timed-out120s upload releases local waiting
even if transport ignores abort; late success is suppressed and another upload
stays blocked until explicit list refresh succeeds. Cancellation is not rollback.
Preview is at most64KiB UTF-8 bytes without splitting surrogate pairs; full field
expansion remains explicit. Original downloads and reported values stay intact.

## Gotchas
G7.1/G7.2/G7.4; G8.1/G8.3; G11.1/G11.2/G11.4/G11.9.

## Phase D additions
### REQ-004: Local OTLP receiver
Implement TD-001..004/006: default off, loopback, one-time optional token, gzip,
JSON-only, bounded redacted mapping and explicit rejection statistics.
### REQ-005: Vendor file imports
Implement TD-005/006 with automatic detection, streamed JSONL, no network/replay.
### REQ-006: Task integration
Use bounded native session/event storage and independent telemetry tree metadata;
retain members, timestamps, usage, source and missing values in task/health/compare/export.
Document environment variables and SDK support boundaries; test own-export roundtrip.
