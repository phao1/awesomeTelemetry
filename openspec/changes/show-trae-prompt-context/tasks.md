## 1. Contracts and schema

- [x] 1.1 Add Prompt Context types and endpoint/schema contracts to `openspec/contracts/{data-model,database,api}.md` and `src/core/trace-types.ts`
- [x] 1.2 Add the additive schema v5 `session_prompt_context` table and migration coverage in `server/storage/schema.ts` and `server/storage/schema.test.ts`

## 2. Trae extraction and persistence

- [x] 2.1 Add deterministic reminder parsing, classification, duplicate analysis, model metadata allowlisting, and desensitization in `local-sessions/trae-prompt-context.ts` with colocated tests
- [x] 2.2 Extend `local-sessions/trae.ts` to retain the latest per-session envelope/turn context and upsert it after authoritative session storage
- [x] 2.3 Add Prompt Context writer/query/delete behavior in `server/storage/prompt-context.ts`, `server/storage/writers.ts`, and colocated storage tests

## 3. HTTP and frontend

- [x] 3.1 Add `GET /api/sessions/:key/prompt-context` to `server/server.ts` and contract tests to `server/server.test.ts`
- [x] 3.2 Add the typed client method and a lazy four-state `src/components/PromptContextModal.tsx` with colocated tests
- [x] 3.3 Wire the action through `src/components/SessionToolbar.tsx` and `src/App.tsx`; add aligned zh/en strings and styles

## 4. Verification

- [x] 4.1 Strictly validate the OpenSpec change and run typecheck, unit tests, lint, build, and performance checks
- [x] 4.2 Force-scan Trae and verify the real `6666` session endpoint/UI shows dynamic-only provenance, `glm-5.2__dev`, six reminder sections, and duplicate analysis
