# Spec: Session Merge

> Merges multiple related trace sessions into one logical session. Source
> files: `server/storage/session-merge.ts`

## Purpose

Some agent workflows produce multiple related sessions (main session +
subagents, or shells + real sessions) that the UI needs to display merged.

## Requirements

### REQ-001: Config driven
Merging is driven by `config/session-groups.json` (gitignored,
machine-specific):

```json
{ "groups": [{ "id": "...", "primaryKey": "...", "title": "...", "sourceAgent": "...", "mergedKeys": ["..."], "reason": "..." }] }
```

When rebuilding, MUST provide a `config/session-groups.example.json` template.

### REQ-002: Two merge modes
1. **CodeArts SDD** — main session + subagent sessions
   (spec-requirement-agent / spec-design-agent / spec-task-agent)
2. **Trae shells** — 0-event sessions + real sessions

### REQ-003: Config load and cache
`loadSessionGroups(configRoot)` SHALL invalidate cache based on mtime.

### REQ-004: Reverse lookup
`buildGroupLookup(configRoot)` SHALL return the reverse mapping from traceId to
group.

### REQ-005: Index merge
`mergeSessionIndex(sessions)` SHALL replace same-group sessions with a single
entry: `eventCount` summed, `startedAt` earliest, `updatedAt` latest,
`mergeGroupId` set to the group id. The returned list MUST retain
`startedAt DESC` ordering; merged rows MUST NOT be appended after older
standalone sessions.

### REQ-006: Detail merge
`mergeSessionDetail(primaryKey, getSessionDetail)` SHALL merge member
sessions' events, reorder by `startedAt`, **re-number `sequence`**, and sum
token totals.

#### Scenario: sequence renumbering
- **GIVEN** two sessions each with sequence 1..N
- **WHEN** merged
- **THEN** the merged sequence MUST be continuous 1..M, otherwise the Gantt
  tree order breaks

### REQ-007: Merge and pagination interaction
Merged-group detail pagination MUST apply offset/limit over the full merged
event sequence; MUST NOT paginate each member session separately and then
concatenate.

### REQ-008: Primary key determination
`getMergeGroup(key)` SHALL determine whether a key is some group's primaryKey.

### REQ-009: Merge effect on incremental updates
When any member session changes, `queueSessionChange` MUST report the
**primaryKey**, not the changed session's own key.

## Gotchas
- G10.3: merging is manual config driven, not auto-detected
- `session-groups.json` is gitignored machine-specific config
- merged sequence must be renumbered
- G11.14 (new): merge-group SSE notifications must emit the primaryKey,
  otherwise the frontend invalidates a key that doesn't exist in its list
