# AUTOPILOT.md — unattended continuous development rules

> This file was missing when the long unattended run started on 2026-08-04 and
> was rebuilt by the agent from the rules embedded in that day's goal
> instructions. If the user later provides an original version, it takes
> precedence (on conflict, follow the AGENTS.md documentation priority).

## 1. Three absolute prohibitions (violating any invalidates the whole run)

A. Do not modify tests that already pass. Once a test is green it is a contract;
   if a later change makes it red, fix the implementation, not the test.
   Loosening assertions, deleting cases, or adding `.skip` all count as
   violations.
B. Do not mock fs / child_process / better-sqlite3 to make tests pass. A test
   that can only pass with mocks means the current stage cannot verify it;
   record it in the pending list and skip it.
C. Do not introduce new dependencies (except `@types/*`).

## 2. Time boxing

- Keep the pace per milestone estimate in BOOTSTRAP.md; M2-M8 are the backend
  mainline, protect them first.
- Maximum 3 fix attempts per issue (see §3); do not burn the whole night on one
  problem.
- At the halfway point, reaching M8 is normal progress; before stopping, land on
  the most recent complete commit — never leave a half-finished milestone on the
  mainline.

## 3. When stuck

If the 3rd fix attempt for the same issue still fails:

- Roll back to the last compilable state of that milestone
- Record it in DECISIONS-PENDING.md in the five-item format:
  1. ID (D-###)
  2. problem description
  3. approaches tried
  4. why they failed
  5. suggested next step
- If it does not block follow-up work → skip it and continue
- If it blocks follow-up work → stop the run, commit what is complete, and
  output a termination report

## 4. When a human decision is needed

Do not stop and wait. Record it in DECISIONS-PENDING.md, continue with a
temporary approach, and mark the code with `// TODO(D-<id>):`.

## 5. Pre-authorized decisions (execute directly, no need to record)

- P-1: handling order for the @types/better-sqlite3 version mismatch (per
  AGENTS.md "Known deviations")
- P-2: missing real vendor data → build synthetic fixtures
- P-3: Frida/Trae cannot be verified on macOS → trim in M11, keep only
  desensitization and proxy pure logic
- P-4: machine differences in performance budgets (record the local baseline)
- P-5: frontend styling uses the most plain implementation

## 6. Quality over progress

Better to do less than to fake it. Three solid milestones beat eight milestones
whose tests were turned green by editing them.

## 7. At the end

Stop on the most recent complete commit and output a termination report; mark
unfinished milestones honestly.

## 8. Termination report format

```
## Long-run termination report (<date time>)

### Completed
- milestone by milestone: M<n> complete / partial (list concrete output and acceptance results)

### Commits
- <commit hash> M<n>: ...

### Pending list
- D-###: one line + status

### Things I am not sure about
- Be honest and complete; writing "none" requires confidence

### Suggested next steps
- which milestone, which step to continue from
```
