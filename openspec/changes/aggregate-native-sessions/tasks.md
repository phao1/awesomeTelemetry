## 1. Trae Native Session Parsing

- [x] 1.1 Bulk-read Trae session and agent metadata into maps keyed by native `session_id`
- [x] 1.2 Resolve message identifiers, group history and fallback content per session, and return one sample per native session
- [x] 1.3 Normalize native session timestamps so empty sessions retain meaningful start/update times

## 2. Source-Scoped Session Lifecycle

- [x] 2.1 Add shared authoritative reconciliation for multi-session database scans, including dependent-row deletion and realtime notifications
- [x] 2.2 Store Trae records with inner-session keys, classify Trae as multi-session for cleanup, and suppress startup placeholders when expanded rows exist
- [x] 2.3 Return pending Trae placeholders from detail requests without decrypting on the HTTP request path

## 3. Regression Coverage

- [x] 3.1 Add Trae parser tests for multiple sessions, duplicate titles, message-id resolution, event isolation, and empty sessions
- [x] 3.2 Add scanner lifecycle tests for placeholder expansion, stale-session reconciliation, restart suppression, and unchanged-source skips
- [x] 3.3 Add server tests proving pending Trae detail requests do not invoke decryption

## 4. Real-Data Acceptance

- [x] 4.1 Validate the OpenSpec change strictly and run targeted scanner/adapter/server tests
- [x] 4.2 Force-rescan the live Trae database and verify API list/detail parity for the four sessions shown in Trae Today
- [x] 4.3 Verify the session cards in the browser and run typecheck, full tests, lint, build, and performance gates
