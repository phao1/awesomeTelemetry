## Why

The frontend opens after T-01, but real-machine verification (2026-08-04,
`6eb5f1a`, 38 real sessions) found the **data layer is empty**: 34 of 38
sessions had `eventCount: 0` and file-name titles; OpenCode / CodeArts always
returned 200 + `events: []` + `title: ""` when opened;
`POST /api/proxy/start` returned 404 (defined in `contracts/api.md` §4 but
never registered in `server.ts`).

The user-visible symptom is uniformly "clicked but nothing happened". Until
the data layer is fixed, any UI improvement is just painting over a shell.

Evidence and precise locations: `UI-TASKS.md` §1-§2 (P1-1 / P1-2 / P1-3).

## What Changes

- The index phase streams to extract **real session titles and event counts**,
  skipping injected content like `# AGENTS.md` / `<environment_context>` /
  `<system-reminder>`, no longer faking titles with source file names.
- SQLite-class providers (opencode / codearts / codeagent2) **parse events per
  session in the detail phase**; parse failure returns the
  `SESSION_PARSE_FAILED` error code, **no longer 200 + empty array**.
- Register the four routes `POST /api/proxy/start|stop`,
  `POST /api/frida/start|stop` per the existing `contracts/api.md` §4/§5
  definitions (including the 409 conflict codes).

No BREAKING: all three complete parts of existing contracts that were never
implemented; no existing response shapes change.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

No delta files needed — the requirements this change implements were already
landed directly into the main specs on 2026-08-04
(`specs/session-scanning/spec.md` REQ-021 / REQ-022; `contracts/api.md` §4/§5
were existing definitions). Hence `.openspec.yaml` sets `skip_specs: true`;
this change only carries **implementation and execution tracking**.

> Note: this repo was previously spec-only (see `openspec/README.md`), with
> specs landing first and no deltas. Starting this round `changes/` is used
> for execution tracking; **new requirements from now on** follow the full
> proposal → spec delta → design → tasks → archive flow.

## Impact

| Area | Impact |
|------|--------|
| Code | `local-sessions/scanner-utils.ts`, `local-sessions/opencode.ts` and its dialect reuse, `server/server.ts` route table, `server/proxy/` wiring |
| API | `GET /api/sessions` `title`/`eventCount` change from placeholders to real values; 4 new POST routes; new error code `SESSION_PARSE_FAILED` |
| Data | no schema change. Local dirty DBs are covered by T-02's startup self-healing cleanup |
| Performance | index phase gains streaming reads; budget: single JSONL < 5ms, single SQLite DB < 50ms; `perf:check` no degradation > 20% |
| Dependencies | none new (AUTOPILOT prohibition C) |
