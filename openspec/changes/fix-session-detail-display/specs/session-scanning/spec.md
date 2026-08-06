# Session Scanning (delta)

## MODIFIED Requirements

### Requirement: Real titles and event counts in the index phase

`SessionIndexEntry` produced in the index phase SHALL carry a **readable real
title** and the **real `eventCount`**; MUST NOT fake titles with source file
names, MUST NOT fake unknown event counts with `0`.

| Source type | Title source | Event-count source |
|-------------|--------------|--------------------|
| JSONL class (claude / codex / codeagent / qoder / workbuddy) | first **user-role** message's first 120 chars from streaming scan | stream-count the **message rows of the whole file**, capped at 16 MB / 100k lines; beyond the cap the count is marked approximate |
| SQLite class (opencode / codearts / codeagent2) | the session row's own title column; if empty, that session's first user message | lightweight `COUNT(*)` of **kept parts** per session (non-marker `part` rows: pure `step-start`/`step-finish` excluded, same semantics as the detail adapter); `messageCount` = message rows |
| Trae (SQLCipher) | `null` + `pending` until decryption is ready, then backfill | same |

Constraints:

1. **MUST NOT run the full adapter parse pipeline or read JSON bodies.**
   JSONL-class streams line by line, parses only the row envelope, counts
   message rows, and stops when the whole file is read or the cap is hit;
   SQLite-class uses `COUNT` aggregates only.
2. Titles MUST skip injected content: system prompts, `<environment_context>`,
   `# AGENTS.md …`, `<system-reminder>`, and IDE-injected context blocks. Take
   the **first thing the user actually said**.
3. Budget: a single JSONL file < 5ms + 1ms per additional MB read; all
   sessions of one SQLite DB < 50ms (inheriting the T-03 budget).
4. When no title is obtainable (empty session, system-only messages) SHALL
   fall back to `<provider> session · <localized start time>`, MUST NOT fall
   back to the file name.

#### Scenario: first-screen list is recognizable
- **GIVEN** a clean DB never opened, containing claude / codex / opencode
  sources
- **WHEN** calling `GET /api/sessions?limit=50`
- **THEN** every `title` MUST NOT end with `.jsonl` / `.db`
- **AND** every `title` MUST NOT start with `rollout-`
- **AND** `eventCount` MUST > 0 (except genuinely empty sessions)

#### Scenario: list event count matches opened detail
- **GIVEN** a codex JSONL session with 2350 message rows and a CodeArts
  session with 25 messages whose detail phase keeps 50 parts (pure
  `step-start`/`step-finish` markers excluded, token-carrying steps kept)
- **WHEN** the index phase runs before any detail is loaded
- **THEN** the codex entry shows `eventCount` 2350 and `messageCount` 2350
- **AND** the codearts entry shows `eventCount` 50 and `messageCount` 25
- **AND** opening the session does not change either count

### Requirement: Lazy detail loading
`GET /api/sessions/:key` SHALL trigger one synchronous `scanAndStoreDetail`
when `sessions.detail_loaded = 0`, then set `detail_loaded = 1` and write into
the LRU cache.

Later index-phase upserts MUST NOT reset an already-loaded session's
`detail_loaded` back to 0; the flag flips only when the source is deleted or a
forced rescan/cleanup requires a reparse.

#### Scenario: watcher rescan does not force a reparse
- **GIVEN** a session with `detail_loaded = 1` whose source file is untouched
- **WHEN** the periodic watcher re-runs the index phase
- **THEN** `detail_loaded` remains 1
- **AND** the next `GET /api/sessions/:key` returns from the detail cache
  without calling `scanAndStoreDetail`
