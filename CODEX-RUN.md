# CODEX-RUN.md — long-run startup prompt

> Usage: `codex exec -s workspace-write -a never "$(cat CODEX-RUN.md)"`
> or interactively: `codex -s workspace-write -a never`, then paste the full
> text between the `---` markers below.

---

You are starting an **unattended long run** doing SDD development on OpenSpec.
The goal is to take Agent Observability from "starts but clicking does nothing
and the UI is rough" to "the agent observability tool developers most want to
open".

## 0. Conflict resolution (read this first, or you'll stop at the first
ambiguity)

There are **two** rule sets that would make you stop and wait for a human.
This is an **unattended long run**; nobody is around to answer, so both are
resolved as follows:

**① `AGENTS.md`'s "when in doubt → stop and ask, don't guess"**

> During this run, `AUTOPILOT.md` §4 **overrides** AGENTS.md's "stop and ask".

**② The `openspec-apply-change` skill's guardrails**

That skill says "Pause if: task is unclear / on errors, blockers, or unclear
requirements - don't guess" and "pause and ask before implementing". That is
designed for **interactive** use. During this run:

> **Do not pause and ask.** Use the skill's workflow in full (`openspec
> status` → `openspec instructions apply` → read contextFiles → implement task
> by task → check off → continue), replacing "pause and ask" with the
> disposition below.

**The unified disposition for both**: when a human decision is needed → record
it in `DECISIONS-PENDING.md` (D-### five-item format: id / problem
description / approaches tried / why they failed / suggested next step) →
continue with a temporary approach → mark the code with
`// TODO(D-<id>):` → **do not stop and wait**.

The only case truly allowed to stop: AUTOPILOT.md §3's "the same issue still
fails after 3 fixes **and blocks follow-up work**".

Everything else in `AGENTS.md` (documentation priority, ten prohibitions, five
must-dos) **remains fully in effect**.

## 0.5 Drive with the OpenSpec skills

This repo has 6 OpenSpec skills installed (`.codex/skills/`). **Use them
first** — they are more reliable than hand-rolled flows:
`openspec instructions apply --change <id> --json` directly returns
contextFiles, progress, and state-dependent dynamic instructions.

| skill | Use |
|-------|-----|
| `openspec-apply-change` | **the main driver this run**: implement a change's tasks |
| `openspec-archive-change` | archive a change when all its tasks are done |
| `openspec-explore` | inspect existing specs / changes |
| `openspec-propose` | for next-round requirements (unused this run; the four changes are ready) |

**Note**: do **not** add `--force` to `openspec update` / `openspec init` —
it would delete `openspec/project.md` as "legacy", and that file is item 7 in
AGENTS.md's authoritative list.

## 1. Read these first (in order, don't skip)

1. `AGENTS.md` — documentation priority, ten prohibitions, five must-dos
2. `AUTOPILOT.md` — three absolute prohibitions, what to do when stuck,
   termination report format
3. `UI-TASKS.md` §1-§2 — **real-machine evidence and precise locations** for
   the 6 defects this round fixes
4. `openspec/contracts/design-tokens.md` — visual numeric contract (new,
   authoritative)
5. `openspec/specs/design-system/spec.md` — icons/components/four states/
   shortcuts (new)
6. `openspec/specs/frontend/spec.md` — rewritten; REQ-015 onward are the new
   page design
7. `openspec/specs/session-scanning/spec.md` REQ-021 / REQ-022 — the two new
   backend requirements

**Never write field names, table names, routes, or color values from memory.
Look them up in the contracts.**

## 2. What to execute

Four OpenSpec changes, **strictly in order**; only start the next after the
previous is archived:

```
1. fix-session-data-integrity    24 tasks   backend: real titles / SQLite detail / proxy·frida routes
2. add-design-system             31 tasks   token layer / 47 icons / 25 base components
3. redesign-frontend-views       50 tasks   shared store / four states / AppShell / five views redone
4. add-palette-and-a11y          30 tasks   ⌘K / shortcuts / URL state / a11y / contract assertions close-out
```

Order cannot change: doing UI while data is empty is painting over a shell;
without a token layer, dark mode cannot be added.

## 3. Work loop (inside each change)

Prefer the `openspec-apply-change` skill (§0.5); its internal steps are
equivalent to this loop:

```
openspec status --change <id> --json           # see which artifacts / tasks remain
openspec instructions apply --change <id> --json  # get contextFiles + dynamic instructions
read proposal.md → design.md → tasks.md   # design.md holds the key decision rationales; don't skip it
pick the next unchecked task group
  → write tests first (colocated foo.test.ts; tests are the executable form of the contract)
  → then implement, checking each spec REQ
  → npm run typecheck && npm run test && npm run lint   all green
  → flip the corresponding [ ] to [x] in tasks.md
  → git commit (message format per AGENTS.md)
repeat until all tasks of the change are checked
  → openspec validate <id> --strict
  → output the phase's real-machine verification report (see §5)
  → openspec archive <id>
  → move to the next change
```

**One commit per task group.** Don't pile up a big batch before committing —
you can't roll back precisely when something breaks.

## 4. Hard rules (violating any invalidates this run's output)

From `AUTOPILOT.md` §1 and `AGENTS.md`:

1. **Do not modify tests that already pass.** Once green, a test is a
   contract. Loosening assertions, deleting cases, or adding `.skip` all
   count as violations. Only exception: you can cite the `openspec/` contract
   text proving the assertion contradicts the contract, and you must first
   record a D-### entry in `DECISIONS-PENDING.md`.
2. **Do not mock `fs` / `child_process` / `better-sqlite3`.** A test that can
   only pass via mocks means this stage can't verify it; record it in the
   pending list and skip.
3. **Do not introduce new dependencies** (except `@types/*`). Icons, tooltips,
   virtual scrolling, drag, routing, and shortcuts are **all hand-written**.
   This is a hard constraint, not a suggestion.
4. The ten AGENTS.md prohibitions apply one by one, especially:
   - no frontend `sessions.map(s => fetch(...))` (G11.9)
   - no `spawnSync` / large-file `readFileSync` on HTTP request paths
   - no `SELECT *`
5. **New rule 11**: no empty `catch {}` or comment-only catch. Seven confirmed
   locations this round; they are exactly the root of "clicked but nothing
   happened".

## 5. Output a real-machine verification report at the end of every change

Don't let "tests all green" masquerade as "the product works" — last round
had 246 green tests but the browser opened a 404. Before archiving each
change, **really start it once** (`npm run build && npm start`) and paste real
output:

- **change 1**: the real title list from `GET /api/sessions?limit=10`
  (proving titles are no longer file names), opencode/codearts session event
  counts, and the real `POST /api/proxy/start` response
- **change 2**: the T1-T7 assertion results from `npm run test`, CSS gzip
  size, icon set size
- **change 3**: walkthrough conclusions for the five views, behavior when
  clicking a session after killing the backend, DOM node count for a 9,590-
  event session
- **change 4**: keyboard full-flow walkthrough, 200% zoom conclusion,
  first-screen performance numbers

## 6. When stuck

If the 3rd fix for the same issue still fails:

- roll back to the last compilable state
- record a D-### entry in `DECISIONS-PENDING.md` (five-item format: id /
  problem description / approaches tried / why they failed / suggested next
  step)
- doesn't block follow-up → skip and continue
- blocks follow-up → stop the run, commit what is complete, output a
  termination report

## 7. At the end

Stop on the most recent **complete commit**; never leave a half-finished piece
on the mainline. Per AUTOPILOT.md §8, output a termination report:

```
## Long-run termination report (<date time>)

### Completed
- per change: complete / partial (list concrete output and acceptance results)

### Commits
- <commit hash> <one-liner>

### Pending list
- D-###: one line + status

### Things I am not sure about
- be honest and complete; writing "none" requires confidence

### Suggested next steps
- which change, which task group to continue from
```

## 8. Quality over progress

Better to do less than to fake it. **One solid change beats four changes whose
tests were turned green by editing them.**

Start now: first `openspec list` to confirm all four changes exist, then
`openspec status --change fix-session-data-integrity`, and begin task group 1.
