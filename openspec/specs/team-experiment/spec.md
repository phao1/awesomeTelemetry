# Task mode experiments

Implement TEAM-EXP-001..004 in contracts/team-experiment.md. This increment
compares task configurations with declared single_loop/subagents/agent_team
modes; the existing native task reader remains the source of original evidence.

REQ-001: pinned task and named independent acceptance, isolated paired parallel
or sequential execution, own exact per-variant prompts, cancellation and atomic
partial reports. Malformed capture never suppresses independent acceptance.
REQ-002: bounded strict reports and collaboration traces, explicit coverage,
native references, declared vs observed structure and safe missing values.
REQ-003: per-case flips and quality-first repeat-aware transparent guidance,
existing metrics and measured paired E2E, coordination diagnostics without
causal or monetary claims. Synthetic and changed-configuration scope visible.
REQ-004: task-centred structured setup, four synthetic scenarios, local paired
fixture execution, report/plan export and report import; shared replay cursor,
single colored row/member, sticky compact header and document-scrolled details.
REQ-005: research-backed Chinese documentation explaining current native team
implementation, mode distinctions, source/feedback limitations and driver use.

Gotchas: G4.1/G4.4/G4.5/G4.6, G7.1/G7.2/G7.3/G7.6,
G11.1/G11.6/G11.9, G12.1/G12.4. No new runtime dependencies or DB migration.
Acceptance: actual temp-Git/process parallel-barrier/cancel/independent evaluator
tests; invalid/missing/cyclic report tests; deterministic recommendation and
replay tests; typecheck/lint/build/full regression/perf, live browser review with
monitoring/proxy/frida confirmed stopped. No model credentials needed for demo.
