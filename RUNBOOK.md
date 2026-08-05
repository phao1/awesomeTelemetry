# RUNBOOK.md — milestone execution manual

> This file was missing when the long unattended run started on 2026-08-04 and
> was rebuilt by the agent from the rules embedded in that day's goal
> instructions. If an original version exists, it takes precedence.

## 1. General rules

- Every milestone is independently acceptable and independently committable
  (commit message format per AGENTS.md).
- Complete the four checks in AGENTS.md before starting work.
- Documentation priority follows AGENTS.md.

## 2. Common checks

- Before committing: `npm run typecheck && npm run test && npm run lint` all green.
- From M3 on: run `npm run perf:check` before committing and append the results
  to PERF-BASELINE.md.
- Acceptance criteria follow the "Accept" column of the corresponding
  milestone in BOOTSTRAP.md.

## 3. Five-phase flow inside a milestone

1. **State restore**: confirm the previous milestone commit is complete and the
   worktree is clean; confirm the file list this milestone must produce; read
   the BOOTSTRAP row plus the relevant spec/contracts/gotchas.
2. **Tests first**: write tests before implementation (same directory as the
   source, `foo.test.ts`); tests are the executable form of the contract. Tests
   must use real dependencies; mocking fs / child_process / better-sqlite3 is
   forbidden.
3. **Implementation**: implement each spec REQ one by one; adopt types verbatim
   from the contract; convert `undefined` to `null` before writing to the DB;
   when stuck, follow AUTOPILOT.md §3/§4.
4. **Acceptance**: run the milestone's acceptance items (tests, EXPLAIN QUERY
   PLAN, performance assertions, etc.); on failure fix the implementation, never
   the test assertions.
5. **Wrap-up**: commit once the full gate is green (`M<n>: <module> — <one-liner>`)
   and update PROGRESS.md.

## 4. End-to-end smoke test (add-palette-and-a11y 5.3/5.4)

- Script: `node scripts/smoke-e2e.mjs [--port=4215]`.
- **Port requirement**: the script occupies one local loopback port (default
  4215). CI must allow `127.0.0.1` outbound/loopback, or run it separately with
  `--port=<free-port>`.
- Coverage: GET / 200 → list titles are not file names and eventCount > 0 →
  opening a session shows events → agent/proxy/frida endpoints 200 → compare
  200 with events.
- Note: the script really starts `bin/agent-observe.js` and reads real local
  session data; in an isolated CI environment without real data, first generate
  samples with `scripts/generate-local-samples.mjs`.
