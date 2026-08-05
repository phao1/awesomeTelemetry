# PROMPTS.md — codex + DeepSeek development prompts

> Copy-paste directly. `<angle brackets>` are placeholders you replace.

## 0. Suggested model division of labor

| Task type | Which model | Why |
|-----------|-------------|-----|
| milestone planning, cross-file refactors, review | **Codex** (strong model) | needs global consistency judgment |
| single-file implementation (given a tight spec) | **DeepSeek v4 Flash** | good enough with a tight spec, fast and cheap |
| writing test cases | **Codex** | tests are the executable form of the contract; loose tests are useless |
| fixing bugs, triaging typecheck errors | DeepSeek first; switch to Codex when stuck | |
| modules involving gotchas (adapters / trae / watch) | **Codex** | these are where "looks right but is actually wrong" traps cluster |

**Key principle: let Codex write tests and DeepSeek write implementations.**
With correct tests, DeepSeek's implementation has a convergence target; the
other way around, both drift.

## 1. Context loading strategy

3,200 lines of specs can't be stuffed in every time. Three layers:

| Layer | Content | When to load |
|-------|---------|--------------|
| **Resident** | `AGENTS.md` (~150 lines) | every time. Codex auto-reads the root AGENTS.md |
| **Contracts** | the 1-2 `contracts/*.md` files the task needs | at the start of every task |
| **Module** | the module's `specs/<m>/spec.md` + relevant gotchas chapters | at the start of every task |

Keep a single task's context at **AGENTS.md + 1 contract + 1 module spec ≈
600-900 lines** — an amount DeepSeek also handles reliably.

**Do not** feed all 12 specs at once — attention gets diluted and it starts
"synthesizing impressions from everywhere" and inventing field names.

---

## 2. Project startup prompt (use once)

```
This is a 0-1 TypeScript project. The repo already has complete specs under
openspec/.

Do three things first; write no business code:

1. Read in full and restate the key points of these files (5 lines or fewer
   each):
   - AGENTS.md
   - BOOTSTRAP.md
   - openspec/README.md
   - openspec/project.md

2. List the complete file inventory the M0 scaffold must produce, with each
   file's purpose.

3. Point out any contradictions, ambiguities, or missing information you find
   in these documents. If there are none, say "none" explicitly. Don't invent
   problems to look diligent.

Stop after these three; wait for my confirmation before starting M0.
```

> Step 3 is the key. Exposing understanding gaps up front is far cheaper than
> discovering them after it writes 12 files.

---

## 3. Milestone implementation prompt (main template)

Use once per milestone. **Run Codex's "tests first" pass, then let DeepSeek
fill in the implementation.**

### 3.1 Phase A — have Codex write tests

```
Task: tests-first for <M4 watch incremental gate>.

Must read (in full, no skimming):
- AGENTS.md
- openspec/specs/session-scanning/spec.md REQ-001 / REQ-002 / REQ-003 / REQ-008
- openspec/contracts/data-model.md §8 scan state
- openspec/gotchas.md G11.5 / G11.15 / G11.18

This step writes **tests only, no implementation**. Output:
- server/watch/fingerprint.test.ts
- server/watch/scan-gate.test.ts
- server/watch/jsonl-reader.test.ts

Requirements:
1. at least one case per REQ, with the REQ number in the case name, e.g.
   it('REQ-001 no-change rescan produces zero SQL writes', ...)
2. every "Acceptance" line of M4 in BOOTSTRAP.md has a matching case
3. tests must genuinely fail — no expect(true).toBe(true) placeholders
4. where fixtures are needed, create real small files under __fixtures__/;
   don't mock fs
5. running tests now should all fail (the implementation doesn't exist yet);
   that's expected

When done, list: how many cases per test file and which REQ each maps to.
```

### 3.2 Phase B — have DeepSeek write the implementation

```
Task: implement <M4 watch incremental gate> so all existing tests pass.

Must read:
- AGENTS.md (especially the "ten prohibitions")
- openspec/specs/session-scanning/spec.md REQ-001 / REQ-002 / REQ-003 / REQ-008
- openspec/contracts/data-model.md §8
- the existing test files: server/watch/*.test.ts

Output (create only these files; touch nothing else):
- server/watch/fingerprint.ts
- server/watch/scan-gate.ts
- server/watch/jsonl-reader.ts

Hard constraints:
1. adopt types verbatim from contracts/data-model.md §8's ScanState and
   FileFingerprint
2. do not modify any .test.ts file. Tests failing → fix the implementation
3. no new npm dependencies
4. scan_state write failures must throw; no silent catch
5. WAL-source fingerprints must cover both the main file and the -wal file

When done, wrap up per AGENTS.md's output format and paste the npm test
results.
```

> When switching milestones, replace the three spots in the brackets: module
> name, must-read list, output file list. BOOTSTRAP.md already has all three
> per milestone.

---

## 4. Adapter-specific prompt (M5 is most error-prone)

Adapters have the highest gotcha density in the whole project; they deserve
their own template. **One provider at a time.**

```
Task: implement one file: src/adapters/<opencode>.ts.

Must read:
- AGENTS.md
- openspec/specs/adapters/spec.md in full
- openspec/contracts/data-model.md §1 §2 §4 §5
- openspec/gotchas.md chapter 4 (token calculation) and chapter 9
  (provider-specific)

This provider's special rules (confirm you understand each before acting):
- cacheRead semantics are <cumulative>, session-level aggregation uses
  <Math.max()>
- reasoning semantics are incremental, use sum
- total = input + output + reasoning + cacheRead, no cacheWrite
- <other provider-specific rules, copied from specs/adapters REQ-00X>

Output:
- src/adapters/opencode.ts
- src/adapters/opencode.test.ts
- src/adapters/__fixtures__/opencode-minimal.json

Tests must cover these 6:
1. full TraceRecord snapshot of a minimal fixture
2. cacheRead uses max, not sum (build 3 events with cacheRead 100/200/150;
   assert the session level is 200, not 450)
3. the total formula includes reasoning
4. status normalization: completed→success / paused→running /
   canceled→cancelled / unknown→unknown
5. duplicate event ids within a session get a :{sequence} suffix
6. title truncated to 200 chars; raw returned separately from
   inputSummary/outputSummary

Self-check when done: read assertion 2 aloud and confirm it tests max, not
sum. This one was wrong for a long time in the reference implementation and
is this project's most easily-tripped pitfall.
```

> ⚠️ Translation note: the "<cumulative> / Math.max()" wording above is
> **stale**. Per the 2026-08-03 calibration (contracts/data-model.md §2,
> openspec/gotchas.md G4.4, specs/adapters/spec.md REQ-002), OpenCode-family
> `cacheRead` is **incremental per step and aggregates with sum**. Contract
> wins per AGENTS.md priority; update this template when the spec is revised.

---

## 5. Frontend prompt (M10, split by subtask)

```
Task: implement <M10c detail & aggregation>.

Must read:
- AGENTS.md
- openspec/specs/frontend/spec.md REQ-003 / REQ-004 / REQ-005 / REQ-008 /
  REQ-009
- openspec/contracts/api.md §1 §2
- openspec/gotchas.md chapter 7 + G11.9

Output:
- src/components/EventInspector.tsx
- src/components/AgentOverview.tsx
- matching tests

Two red lines; violating either means rework:
1. AgentOverview may issue only 1 request (GET /api/agent-overview).
   Any occurrence of sessions.map(s => fetch(...)) is wrong.
2. EventInspector fetches the event body only on click
   (GET /api/sessions/:key/events/:id, 200ms debounce), not with the detail.

When done, answer one question: if the user's DB has 5,000 sessions, how many
requests does your AgentOverview issue? The answer must be 1.
```

---

## 6. Review prompt (before every milestone merge, with Codex)

```
Do a strict review of the just-completed <M4>. Your role now is the nitpicker,
not the finisher.

Check each of AGENTS.md's "ten prohibitions" one by one, and for each give:
- verdict (pass / violated / not applicable)
- if violated, file:line and a fix suggestion

Then check these four:
1. were any test assertions loosened or cases deleted? Confirm via git diff
2. was any real logic mocked? Especially fs, child_process, better-sqlite3
3. were dependencies outside AGENTS.md's allowed list introduced? Check the
   package.json diff
4. are there REQs in openspec/specs/<module>/spec.md left unimplemented?
   Check each number

Finally run npm run typecheck && npm run test && npm run lint and paste the
results.

Do not modify code to make the review pass — report problems only first.
```

---

## 7. Performance acceptance prompt (every milestone after M3)

```
Run a performance baseline check.

1. run Step 1 (EXPLAIN QUERY PLAN) and Step 2 (server-side segment timing)
   under perf-diag/
2. fill in measured values row by row against the budget table in
   openspec/contracts/nfr.md §2
3. for anything over budget, give: measured / budget / overage multiple /
   located cause
4. append the results to PERF-BASELINE.md

Constraints:
- measure only, don't optimize. Report problems first; I decide whether to
  fix now
- every conclusion must have a number. Judgments without numbers are marked
  "unverified guess" in a separate section
- don't say "maybe" or "suggest"; report only "measured X is Yms, budget Zms,
  overage Nx"
```

---

## 8. Stuck prompt

```
You're stuck on <describe the sticking point>. Stop trying new approaches.

Answer in this order:
1. What exactly are you solving? One sentence; don't restate code
2. What have you tried, and why did each fail?
3. What assumptions do you currently hold about the system's behavior? Which
   is the least verified?
4. What is the smallest experiment that verifies that assumption?

Run the step-4 experiment first and tell me the result. Don't keep changing
code before the assumption is verified.
```

> This questioning was validated during the reference implementation's
> performance diagnosis: one A/B experiment with background prewarm disabled
> pinned the problem from "everything feels slow" to a single 1240x point.
> **A controlled experiment yields far more information than continuing to
> read code.**

---

## 9. Anti-drift check list

Run every 2-3 milestones to prevent accumulated drift:

```
Do a cross-module consistency review; write no code.

1. List every type name defined in openspec/contracts/data-model.md, then grep
   the codebase for:
   - types defined but never used anywhere
   - types in the code but absent from the contract
   - the same concept under two different names

2. List every endpoint in openspec/contracts/api.md and compare against
   server/server.ts, finding: unimplemented, extra, or path/param mismatches

3. Grep the whole repo for these four patterns and list every hit:
   - "SELECT \*"
   - "spawnSync" / "execFileSync"
   - ".map(" followed by "fetch("
   - "catch" blocks that are empty or console-only

Output a table: problem | location | severity | suggestion. Don't auto-fix.
```

---

## 10. Common failure modes and countermeasures

| Failure mode | Symptom | Countermeasure |
|--------------|---------|----------------|
| inventing field names | used `sessionKey` while the contract says `sessionId` | re-paste the relevant contract section per task; grep type names during review |
| quietly editing tests | tests all green but assertions loosened | Review prompt item 1; inspect `git diff *.test.ts` every time |
| mocking real logic | integration tests green, manual run fails | explicitly ban mocking fs / child_process / sqlite |
| sneaking in dependencies | package.json gains lodash / express | AGENTS.md pins 4 deps; review checks the diff |
| doing too much at once | one prompt asks for 3 modules, all half-finished | strictly per milestone, one at a time; adapters one provider at a time |
| "optimizing away" gotchas | "I removed that weird /2, it's cleaner" | AGENTS.md makes clear: follow gotchas, don't optimize them |
| context overload | contradictions appear in the back half | keep single tasks within 900 lines; start fresh sessions for long ones |
| ignoring performance | features all correct but 5s first screen | nfr.md assertions in CI; run the performance check per milestone |

---

## 11. One-page cheat sheet

```
Starting a milestone:
  1. look up that M's "read / output / accept" in BOOTSTRAP.md
  2. Codex runs §3.1 to write tests
  3. DeepSeek runs §3.2 to write the implementation
  4. Codex runs §6 review
  5. after M3, also run §7 performance check
  6. commit only when all green; message `M<n>: <module> — <one-liner>`

Every 3 milestones: run the §9 anti-drift check

Stuck: use §8; run the experiment before changing code
```
