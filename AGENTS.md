# AGENTS.md

> This file is read automatically by Codex / Claude Code / Cursor and other
> agents. **Read this file in full before starting any task.**

## Project in one sentence

Agent Observability: a local web UI that reads and analyzes session traces from
9 AI coding assistants, scored across four dimensions: Speed · Accuracy ·
Stability · Cost. **Built from scratch (0-1)**, no historical data migration.

## Authoritative documentation priority

On conflict, **the higher entry wins**:

1. `openspec/contracts/data-model.md` — type definitions
2. `openspec/contracts/database.md` — SQL DDL / indexes / PRAGMAs
3. `openspec/contracts/api.md` — HTTP contract
4. `openspec/contracts/nfr.md` — performance budget (hard requirement, same weight as functional requirements)
5. `openspec/specs/<module>/spec.md` — module behavior requirements
6. `openspec/gotchas.md` — gotcha checklist
7. `openspec/project.md` — overview

**Never write field names, table names, or routes from memory. Look them up in the docs.**

## Four checks before starting work

1. Read `BOOTSTRAP.md` and confirm which milestone (M0-M12) you are on
2. Read the full `openspec/specs/<module>/spec.md` for the task's module
3. Read the `openspec/gotchas.md` entries referenced at the bottom of that spec
4. Confirm the file list you are expected to produce; **do not touch any file outside that list**

## Ten prohibitions (violating any of these means rework)

1. **No `SELECT *`** — always list return columns explicitly, using the column
   constants from `contracts/database.md` §5.2
2. **Never return `raw` / `inputSummary` / `outputSummary` in detail lists** —
   these three columns account for 96% of DB size
3. **No `db.prepare()` inside loops** — reuse via module-level statement cache
4. **No `spawnSync` / `execFileSync` / large-file `readFileSync` on HTTP request
   handling paths**
5. **No per-session SSE events** — merge into `sessions_changed { keys }` in a
   200ms window
6. **No frontend `sessions.map(s => fetch(...))`** — add a server-side
   aggregation endpoint when aggregation is needed
7. **No delete-and-reinsert `upsertEvents`** — must use differential upsert
8. **No silent catch of `scan_state` write failures** — must throw
9. **No regex split of a whole file to parse JSONL** — must stream line by line
10. **No `ORDER BY LENGTH(col)`** — use a redundant length column + index

## Five must-dos

1. **Adopt contract types verbatim.** Do not invent fields the contract lacks;
   do not omit fields the contract has.
2. **Tests live next to source** (`foo.ts` + `foo.test.ts`), never in `__tests__/`.
3. **Convert `undefined` to `null` before writing to the database.**
4. **All external timestamps are ISO 8601 UTC strings.**
5. **All non-2xx responses use the unified `ApiError` envelope from
   `contracts/api.md` §0.3.**

## When in doubt

**Stop and ask, do not guess.** Specifically:

- Field not defined in the contract → stop, list the fields you need and why,
  and wait for an answer
- Two documents conflict → take the higher-priority one per the list above and
  explicitly flag the conflict in your output
- A gotcha is unclear → follow it anyway; do not "optimize" it away. Those were
  all discovered through real debugging
- Tests fail → fix the implementation, never relax the test assertions.
  Assertions are the executable form of the contract

**Never** mock the logic under test or loosen assertions just to make tests pass.

## Tech stack constraints

| Item | Value | Notes |
|------|-------|-------|
| Node | >= 20 | hard requirement |
| TypeScript | ~6.0 | `verbatimModuleSyntax` / `erasableSyntaxOnly` / strict |
| Frontend | React 19.2 + Vite 8 | no router lib; `App.tsx` is the only stateful shell |
| Backend | plain Node `http` | **no Express / Fastify / Koa** |
| DB | better-sqlite3 (WAL) | sync API; be careful not to block the event loop |
| Compression | `node:zlib` | no third-party |
| Tests | Vitest 3 | jsdom env, globals |

**Only 4 runtime dependencies**: `better-sqlite3`, `chokidar`,
`http-mitm-proxy`, `node-forge`.
Frontend may additionally use `@tanstack/react-virtual` (frontend bundle only).
**Do not add any other runtime dependency.** Ask before adding new dependencies.

**devDependency exception (approved)**: `globals` — official ESLint companion
package, zero transitive deps, needed by flat config for Node/browser globals.

## Known deviations

- `@types/better-sqlite3@9.6.0` vs runtime `better-sqlite3@12.x` major version
  mismatch: v12 ships no `.d.ts`, and DefinitelyTyped only publishes up to
  9.6.0 (no 12.x). From M2 on, if typecheck hits a type gap for a v12-only API,
  debug per this entry.

## Directory conventions

```
server/          backend. server.ts is the only HTTP entry point
  http/          send-json (incl. gzip) + error-envelope + route matching
  storage/       schema + writers + query-engine + detail-cache + overview
  realtime/      event-bus + coalescer + sse + frontline
  watch/         fingerprint + scan-gate + watcher + scan-scheduler
  proxy/         mitm + cdp + frida + ca-manager + parsers
  desensitization/
local-sessions/  9 scanners + config + trae-bridge + vite-plugin(dev)
src/             frontend + adapters + core
  generated/     machine-generated, do not hand-edit
config/          *.example.json (real configs are gitignored)
scripts/         generate-local-samples / pack-binary / trae-* / frida-*
perf-diag/       7 performance diagnostic scripts
openspec/        specs (source of truth for this project)
```

## Commit conventions

- One milestone per commit, message format: `M<n>: <module> — <one-liner>`
- Before committing: `npm run typecheck && npm run test && npm run lint` all green
- From M3 on: run `npm run perf:check` before committing and append the results
  to `PERF-BASELINE.md`

## Output format when finishing a task

```
## Delivered
- path/to/file.ts — one-line description
- path/to/file.test.ts — N test cases

## Contract mapping
- implements <module> REQ-001 / REQ-002 / ...
- not implemented: REQ-00X (reason)

## Needs confirmation
- (write "none" if nothing)
```
