# Storage (delta)

## MODIFIED Requirements

### Requirement: Differential event writes
`upsertEvents()` MUST use a differential strategy:
1. read the existing `(id, sequence, content_hash)` set
2. skip a row only when `id`, `sequence`, **and** the content hash of every
   mutable column (kind, phase, title, started_at, duration_ms, status, actor,
   tool, input_summary, output_summary, tokens_json, error, model) all match
3. `INSERT ... ON CONFLICT(session_id, id) DO UPDATE` every other row,
   refreshing the `content_hash`
4. delete stale ids absent from the new data (also deleting matching
   `event_raw` rows)
5. wrap everything in a single `db.transaction()`

MUST NOT use "DELETE all, then INSERT".

The `content_hash` column SHALL be added by an idempotent `ADD COLUMN`
(non-null default `''`) at schema init — `SCHEMA_VERSION` stays at 4 (already
claimed by calibrate-tokens; the column is an in-version additive) — and SHALL
be computed server-side from the normalized event content so adapter upgrades
propagate re-parsed bodies instead of being skipped. Fresh DBs get the column
from the DDL directly; existing v4 DBs get it from the ensure step.

#### Scenario: appending one event
- **GIVEN** a session with 347 existing events and 1 new source row
- **WHEN** `upsertEvents` runs
- **THEN** only 1 INSERT is produced, < 20ms
- **AND** v4's behavior was 1 DELETE + 347 INSERT / 181.91ms; this is the
  regression guard

#### Scenario: content change overwrites stale row
- **GIVEN** an existing event whose `duration_ms` was 0 and whose input/output
  were empty, and a re-parse now derives `duration_ms = 181819` and fills
  `input_summary` / `output_summary`
- **WHEN** `upsertEvents` runs with the same `id` and `sequence`
- **THEN** the row is updated with the new duration and bodies
- **AND** `content_hash` is refreshed

#### Scenario: unchanged event is skipped
- **GIVEN** an existing event re-parsed with identical content
- **WHEN** `upsertEvents` runs
- **THEN** no UPDATE is issued for that row
