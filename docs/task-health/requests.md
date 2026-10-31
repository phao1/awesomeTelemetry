# Phase E request scopes (2026-11-01)

TR-001 A request starts at a root member genuine user_prompt under TH-004a.1.
Use the shared genuine prompt predicate: exclude system/injected/bookkeeping
metadata and parent→child prompts; child prompts never open task requests.
IDs are `request:` + the unchanged root task record ID. Sort root prompts by
native sequence; valid UTC starts must be nondecreasing. Equal timestamp starts
use root sequence to disambiguate root records; child starts at that timestamp
belong to the latest request. Missing/invalid clocks are unavailable, not guessed.
No genuine prompt => empty list. Pre-prompt and unknown-time records remain in
whole-task only. No original event is rewritten.

TR-002 Window membership is retained record start >= start and < next start;
root equal-time ties use sequence. All confirmed members participate. The final
window has no upper bound; endedAt is the latest retained start in that window.
Request duration is observed wall extent, never summed work. Requests include
bookkeeping activity but bookkeeping never opens one. Known imported TraceLog
turns are not native user_prompt and currently return an empty request list.

TR-003 GET /api/tasks/:id/requests returns TaskRequestList {taskId,revision,items}.
TaskRequest {id,ordinal,title,startedAt,endedAt,nextStartedAt,eventCount,metrics,
alerts}; ordinal starts at1; title is redacted first prompt-title line <=200chars.
TaskMetrics/TaskAlert reuse Phase A/B types. Count tool inputs and error records;
usage sums retained incremental counters with Phase A accounting guards (Codex
output includes reasoning, input excludes cache). Absent counters remain null;
unsupported total accounting remains null; no allocation of session-wide money.
Revision binds DB changes, task membership and the metric policy; <=24 task projections
cached per DB, invalidated on writes. Fixed indexed member/sequence reads with
batch yields, no body/source/raw reads or per-request SQL. No schema change.
25,000-event fixture: cold <250ms target, warm <20ms; existing loop budgets apply.

TR-004 Task records accept request=<stable ID> with existing search/status/member
and pagination. Membership is applied BEFORE offset/count; opaque window binds
request ID and observed boundaries (changed boundaries reject continuation). Invalid/foreign request is BAD_REQUEST. A request excludes unknown
time records. from/to may further narrow the request, never widen it. URL request=
selects detail scope; omitted means whole task and all legacy links remain valid.
Navigation exposes previous/next/select/whole-task; summary and all three readers
use the same request scope. Lists expand lazily on explicit interaction; no fan-out.

TR-005 Comparison URL ar/br select a request for the first task on each side;
optional POST /api/task-comparison ar/br fields use the same IDs. Request metrics
replace that task's summary only; architecture whole-task conclusions are disabled
for request comparisons. Health uses the matching request scope. POST /api/compare accepts optional leftRequest/rightRequest IDs; process pages
use the selected root request window, at most200 metadata records, labelled as
root-only loaded pages. Summary and health still include all members. A/B may
select distinct requests in the same task (single task per side), while identical
request references and overlapping whole-task groups remain invalid.

Request-selected comparison summaries carry optional TaskSummary.requestId; it is
absent from whole-task summaries. Normalized corrected-token comparisons require
request scope on every selected summary, complete counter coverage, non-null
corrected totals and identical provider declarations; otherwise retain TC-003's
unavailable verdict. This guard does not authorize whole-task architecture metrics.
Evidence links preserve the originating request (including different requests in
the same root task). Request summary status is unknown; do not inherit task outcome.


Canonical additive DTOs (src/core/task-types.ts):

```ts
export interface TaskRequest {
  id: string; ordinal: number; title: string; startedAt: string; endedAt: string;
  nextStartedAt: string | null; eventCount: number; metrics: TaskMetrics; alerts: TaskAlert[];
}
export interface TaskRequestList { taskId: string; revision: string; items: TaskRequest[] }
```

TaskSummary adds optional requestId:string; TaskRecordQuery adds optional
request:string. Whole-task response fields and old URL defaults are unchanged.


### Genuine user-input classification (Phase E correction, 2026-11-01)

Request boundaries and TH-004a MUST use the SAME pure `classifyUserPrompt`
classifier (`src/core/user-prompts.ts`), through `isGenuineUserRecord` for event
metadata. Results are question / reply / injection; only question starts a
request or user turn. Parent→child prompts and existing bookkeeping stay excluded.

- A message consisting entirely of one or more XML-style blocks, with only
  whitespace outside those blocks, is injection regardless of tag name. Nested
  blocks, attributes (including quoted >) and self-closing blocks are supported.
  The known-tag list below is documentation/test coverage, NOT an allowlist.
- A tag-only message containing an outer `send_user_message_question_reply`
  block is reply: user input continuing the CURRENT request, never a new turn.
  It can end a preceding explicit requested wait of that member; an ordinary
  injection or goal continuation cannot. Without a preceding explicit request,
  no wait is fabricated. A subsequent genuine question still ends a wait.
- `# AGENTS.md instructions for` and Markdown skill/system/developer instruction
  headers at the start are injection. The known truncated skill-instruction
  fragment ending in </system-reminder> remains injection. Ordinary prose that
  merely discusses instructions/tags is not injection.
- Retained event titles are first-line/200-character projections. The same
  classifier's retained-prefix mode treats an unfinished leading XML-style block
  as injection (or reply for the reply wrapper). This handles multiline/truncated
  platform envelopes without fetching bodies/source files. A completed block
  followed by outside ordinary text remains a question. Plain prose BEFORE a
  tag remains a question, even if a tag later has no closing match.
- Examples: `<unknown_platform><data/></unknown_platform> <another/>` is injection;
  `<codex_internal_context source="goal">continue</codex_internal_context>` is
  injection; `<send_user_message_question_reply>yes</send_user_message_question_reply>`
  is reply; `请解释 <environment_context>...</environment_context>` and
  `<example>data</example> then fix the bug` are questions.

Known envelope tags (normative test catalogue; generic rule also covers new tags):
`external_codex_apps_open_page`, `codex_apps_open_page`, `codex_apps_context`,
`app-context`, `app_context`, `environment_context`, `multi_agent_role`,
`multi_agent_mode`, `codex_internal_context`, `in-app-browser-context`,
`user_instructions`, `turn_aborted`, `subagent_notification`,
`send_user_message_question_reply`, `system-reminder`, `system`, `skills`,
`skill_instructions`, `tools`, `developer_instructions`, `turn_context`, `world_state`.

The d01f-shaped 15-message regression has exactly8 questions at positions
3,4,5,6,9,10,11,14; positions7,12,15 are replies, the remaining positions injection.
Repeated goal continuations never add requests or restart readiness. Reply
boundaries restart model readiness at the reply timestamp within the SAME user
turn (split a reused round key deterministically by reply record ID if needed),
so requested waiting is not counted as model thinking. Replies are input markers,
not production, and injections neither extend semantic E2E nor user-turn end.

Request titles MUST come from the first line of the opening question only,
redacted and truncated to200; replies/injections never replace that title.

Request revision also binds USER_PROMPT_POLICY_VERSION=1 so the corrected
classification cannot share a revision with the earlier permissive projection.

Health uses calc4 / rules3, with old reports preserved and excluded from reuse.


### Attached-file request titles (presentation only)

A genuine Codex prompt starting `# Files mentioned by the user:` stays a genuine
question. Request ID, boundaries, timing, events, user-turn classification and
health versions MUST NOT change for this title correction. Prefer the first
nonempty prose line in the outer `## My request for Codex:` (also `## My request:`)
section, skipping fenced file/code content. Ignore request-like headings inside
fenced content. Redact before truncating to200 characters, as for ordinary titles.
Without a request prose line, return `附带文件的提问（N 个文件）` for the known
number of file sections; if the count is unavailable use `附带文件的提问`. Never
use a file body, path or file-section heading as the fallback title.

TR-003 exception: only these already-selected genuine root prompts may read their
retained input_summary inside ONE cached indexed batch SELECT using a pure SQLite
function. The function returns only the redacted <=200-character title, never
inputSummary/outputSummary/raw or file text. No source reads, per-request SQL,
schema/adapter/raw event changes or frontend body requests. Existing revision
cache applies; revision additionally binds REQUEST_TITLE_VERSION=1.


Request metadata is optional UI enrichment: validate list/row/nested metrics
shape at the transport boundary. Loading, timeout, unavailable/invalid response
and a valid empty list hide request selectors and show a local status/retry.
The remaining task/comparison page and explicit whole-task navigation stay usable.
Never silently convert a selected request into whole-task metrics. Request-health
generation requires an ID present in the successfully validated current list.
