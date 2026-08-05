> Detailed acceptance criteria: `UI-TASKS.md` T-10 / T-11 / T-12.
> After each task group: `npm run typecheck && npm run test && npm run lint`
> all green → one commit.

## 1. Real titles and event counts in the index phase (T-10, spec REQ-021)

- [x] 1.1 write tests: real-structure JSONL fixture containing `# AGENTS.md` /
  `<environment_context>` / `<system-reminder>` injection blocks; assert the
  extracted title is the user message, not injected content
- [x] 1.2 write tests: empty session without user messages; assert fallback to
  `<provider> session · <time>` and no `.jsonl` in the title
- [x] 1.3 implement JSONL-class streaming extraction: stop at the first user
  message, hard cap 1MB
- [x] 1.4 implement the injection blacklist filter (D2), title truncated to
  120 chars
- [x] 1.5 implement SQLite class: take the session row's own title; when empty,
  take the first user message; `COUNT(*)` for event count
- [x] 1.6 acceptance: delete `agent-observe-data/`, restart, assert on
  `GET /api/sessions?limit=50` that no title ends with `.jsonl`/`.db`, none
  starts with `rollout-`, and all `eventCount` > 0
- [x] 1.7 acceptance: `npm run perf:check` single JSONL < 5ms, single SQLite
  DB < 50ms, overall degradation <= 20%

## 2. SQLite-class provider detail parsing (T-11, spec REQ-022)

- [x] 2.1 write tests: temp SQLite with 3 sessions (real DDL, **no mock** of
  better-sqlite3), assert `events.length > 0` one by one
- [x] 2.2 write tests: corrupt DB returns non-2xx + `SESSION_PARSE_FAILED`
- [x] 2.3 implement: locate the session by "db path + in-row session id" and
  parse its events
- [x] 2.4 reuse the opencode adapter's dialect param to cover codearts /
  codeagent2 (`project.md` §7)
- [x] 2.5 check G4.4: cache.read cumulative uses max, reasoning uses sum
- [x] 2.6 implement the error-code path (D3), register in
  `contracts/api.md` §0.4 error code set
- [x] 2.7 acceptance: `GET /api/sessions/opencode-<real key>` and
  `codearts-<real key>` both have `events.length > 0` and non-empty title

## 3. Proxy / Frida control routes (T-12, contracts/api.md §4 §5)

- [x] 3.1 write tests: start → `status.running=true` → repeat start gives 409
  `PROXY_ALREADY_RUNNING` → stop → repeat stop gives 409 `PROXY_NOT_RUNNING`
- [x] 3.2 implement `POST /api/proxy/start` (body `{ port?: number }`) and
  `POST /api/proxy/stop`
- [x] 3.3 implement `POST /api/frida/start` (body `{ pid?: number }`,
  auto-discover when omitted, failure 409 `FRIDA_TARGET_NOT_FOUND`) and
  `POST /api/frida/stop`
- [x] 3.4 async startup (D4): handler returns immediately, `status` gains a
  `starting` state, readiness via SSE
- [x] 3.5 acceptance: `curl -X POST localhost:4213/api/proxy/start -d
  '{"port":8888}'` returns 2xx; `GET /api/proxy/status` shows running

## 4. Wrap-up

- [x] 4.1 `npm run typecheck && npm run test && npm run lint` all green
- [x] 4.2 `npm run perf:check` results appended to `PERF-BASELINE.md`
- [x] 4.3 update `PROGRESS.md`
- [x] 4.4 output a real-machine verification report: paste the real title
  list from `GET /api/sessions?limit=10`, the opencode/codearts event counts,
  and the real `POST /api/proxy/start` response
- [x] 4.5 `openspec archive fix-session-data-integrity`
