## Why

Trae currently decrypts the whole SQLCipher database into one observability session, so unrelated native conversations are flattened into one card even though `chat_session.session_id` already defines their real boundaries. The same provider-native boundary rule must apply consistently across all supported assistants so one card always means one conversation.

## What Changes

- Define one cross-provider aggregation rule: events sharing a provider-native session identity are stored in one card, while different native session identities are never merged.
- Split a decrypted Trae database into one `TraceRecord` and stable session key per `chat_session.session_id`.
- Keep Trae startup non-blocking: the encrypted file may create a pending placeholder, but a successful background decrypt replaces it with the real session cards.
- Reconcile removed or superseded source sessions so stale file-level placeholders and deleted native sessions do not remain visible.
- Preserve the existing JSONL one-file-per-session and readable SQLite row-per-session behavior for Codex, Claude, OpenCode, CodeArts, CodeAgent2, and other providers.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `session-scanning`: Require every scanner to materialize provider-native conversation boundaries and define the encrypted-source placeholder replacement lifecycle.
- `trae-decryption`: Require decrypted Trae rows to be grouped by real `chat_session.session_id`, producing one card per native conversation.

## Impact

- Scanner and adapter path: `local-sessions/trae.ts`, shared scanner utilities, and their colocated tests.
- Storage lifecycle: source-scoped reconciliation of generated session rows; no database schema or HTTP API shape change.
- UI: no new rendering logic is required because the session list already renders one card per stored session row.
- Runtime dependencies: none.
