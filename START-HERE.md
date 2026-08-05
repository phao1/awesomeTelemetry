# START HERE

The complete development kit for re-building Agent Observability from scratch (0-1).

## Deliverables

| File / dir | Purpose | Who reads it |
|------------|---------|--------------|
| **`AGENTS.md`** | always-on agent rules: ten prohibitions, five must-dos, what to do when in doubt | **keep at repo root; Codex reads it automatically** |
| **`BOOTSTRAP.md`** | M0-M12 thirteen milestones: what to read, what to produce, how to accept | you + agent |
| **`PROMPTS.md`** | ready-to-paste prompt library (incl. model division of labor and context loading strategy) | you |
| `scaffold/` | M0 scaffold, 14 config files; copy into an empty repo | you |
| `openspec/contracts/` | four contracts: types / DDL / API / performance budget | **agent must read the relevant one for every task** |
| `openspec/specs/` | 12 module behavior specs | agent |
| `openspec/gotchas.md` | gotcha checklist; chapter 11 is 19 performance gotchas | **agent must read** |
| `openspec/project.md` | project overview, architecture, provider matrix | you + agent |
| `PERF-FIX-PLAN.md` | the reference implementation's performance fix plan (original derivation, archival) | you (optional) |

## Five steps to get started

```bash
# 1. Create an empty repo, copy the scaffold and specs
mkdir agent-observability && cd agent-observability && git init
cp -r <this-dir>/scaffold/* .
cp -r <this-dir>/scaffold/.gitignore .
cp -r <this-dir>/openspec .
cp <this-dir>/AGENTS.md <this-dir>/BOOTSTRAP.md <this-dir>/PROMPTS.md .

# 2. Install dependencies (on Windows confirm the MSVC toolchain can build better-sqlite3)
npm install

# 3. Create the directory skeleton
mkdir -p server/http server/storage server/realtime server/watch server/proxy server/desensitization
mkdir -p local-sessions src/adapters src/core src/components src/i18n src/generated
mkdir -p scripts perf-diag

# 4. Use the "project startup prompt" from PROMPTS.md §2 to have the agent restate
#    its understanding first; confirm there is no drift

# 5. Start from M0 per BOOTSTRAP.md; every milestone follows the five-step loop in PROMPTS.md §11
```

## Per-milestone loop

```
Check BOOTSTRAP.md for that M's "read / produce / accept"
  → Codex runs PROMPTS.md §3.1 to write tests (all red at this point)
  → DeepSeek runs §3.2 to implement (until all green)
  → Codex runs §6 review (nitpick; report only, no fixes yet)
  → from M3 on, also run §7 performance check
  → commit only when typecheck + test + lint are all green
```

Run the PROMPTS.md §9 anti-drift check every 3 milestones.

## The three most common failure points

1. **M5 adapters** — OpenCode / CodeArts / CodeAgent2 `cacheRead` is
   **cumulative → use max**, other providers are incremental → use sum. The
   reference implementation got this wrong for a long time. Do one provider at a
   time with the dedicated §4 prompts.
2. **M10c AgentOverview** — must issue exactly 1 request. The reference
   implementation sent 524 requests and transferred 299.6MB. Any occurrence of
   `sessions.map(s => fetch(...))` in the code is wrong.
3. **M4 incremental gate** — `scan_state` write failures must throw. The
   reference implementation failed silently, leaving the table at 0 rows,
   re-scanning 800MB every round with no output at all.

## About this project and the "reference implementation"

Every "reference implementation" mentioned in the docs is the pre-existing
project this one was built from. All measured numbers quoted in the docs
(first-screen 5,884ms, 524 requests / 299.6MB, 18,235 SQL statements, etc.)
describe what the project would grow into **without these constraints** — not
where this project starts.

This project is a fresh 0-1 build: schema starts at v1, no historical data
migration, and the performance budget applies from the first line of code.
