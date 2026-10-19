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

## Gotchas
G7.1/G7.2/G7.4; G8.1/G8.3; G11.1/G11.2/G11.4/G11.9.
