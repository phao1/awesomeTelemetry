# Spec: Trae CN Decryption

> Decryption of Trae CN's (ByteDance AI IDE) three-layer encryption. This is
> the most time-consuming reverse-engineering result in this project. Source
> files: `local-sessions/trae.ts` + `src/adapters/trae.ts` +
> `scripts/trae-extract-key.py` + `scripts/frida-*.js` +
> `skills/decrypt-trae-cn.md`

> **v5 change**: the decryption chain itself (the reverse-engineering result)
> is fully preserved; only its **invocation model** changed — see
> "v5 execution model changes". Reason: the CPU profile measured 4
> `spawnSync` calls blocking the event loop for 6,074ms total, 37.5% of CPU.

## Purpose

Trae CN protects data with three layers of encryption: SQLCipher database +
TTNet network encryption + client-assembled system prompt. This module defines
the complete decryption chain so both scan and proxy can obtain Trae session
data.

## Encryption overview

| Layer | Encryption | Location | Decryption method |
|-------|-----------|----------|-------------------|
| **Database** | SQLCipher (AES-256) | `%APPDATA%\Trae CN\ModularData\ai-agent\database.db` | memory scan to extract key + sqlcipher3 |
| **Network** | TTNet body_encryptor_ (ECDH+AES-GCM) | sscronet.dll + ai_agent.dll (ring crate) | MITM trio (config-class requests) / Frida heap scan (AI chat) |
| **Application** | server template + client assembly | ai_agent.dll memory | Frida heap memory scan |

## Requirements

### Layer 1: SQLCipher database decryption

### REQ-001: Key extraction
`scripts/trae-extract-key.py --save` SHALL traverse the Trae process memory
using the Windows APIs (`OpenProcess` + `ReadProcessMemory` +
`VirtualQueryEx`), search for the `PRAGMA key = x'...'` string pattern, and
extract the 64-character hex key.

#### Scenario: key saved
- **GIVEN** Trae CN is running and key extraction succeeds
- **WHEN** `--save` runs
- **THEN** the key is stored in
  `%APPDATA%\agent-observe\trae-db-key.txt` (64 hex chars, no `x''` wrapper)

#### Scenario: key format change (known pitfall)
- **GIVEN** some Trae versions changed the key format and `PRAGMA key`
  plaintext is not in memory
- **THEN** the script fails; use Frida to search ai_agent.dll for the
  `PRAGMA key` compiled string (source `connection.rs`)

### REQ-002: DB copy + WAL checkpoint
Before decrypting/querying SHALL:
1. copy `database.db` + `-wal` + `-shm` to a temp dir (the originals are
   locked by the Trae process)
2. open with `PRAGMA key = "x'<hex>'"`
3. **must run `PRAGMA wal_checkpoint(FULL)`**, otherwise uncheckpointed WAL
   data is invisible

#### Scenario: WAL data invisible
- **GIVEN** the user just sent a new message in Trae, written to the WAL but
  not checkpointed
- **WHEN** querying directly after copying the DB (no checkpoint)
- **THEN** the new message cannot be found (a real bug hit)

### REQ-003: DB schema queries
The scanner SHALL query and join multiple tables: sessions (chat_session),
turns (chat_turn), messages (chat_message + chat_message_general), tasks
(chat_message_task), history (history_v2), server history
(server_history_info), tool calls (toolcall).

### REQ-004: second-level timestamps → milliseconds
All `created_at`/`updated_at` fields are **second-level** Unix timestamps.
SHALL `× 1000` before passing to `new Date()`.

#### Scenario: second-level timestamp
- **GIVEN** `chat_session.created_at = 1753300000`
- **WHEN** `new Date(1753300000)` directly
- **THEN** yields a 1970 date (wrong); must use `new Date(1753300000 * 1000)`

### REQ-005: Token data spread across two tables
Token data lives in two tables:
- `history_v2.token_usage` (INTEGER) = message-size token count (**not** the
  output token count)
- `server_history_info`: `token_usage` = real total (input+output),
  `item_token_usage` = OUTPUT/completion tokens (calibrated 2026-08-03:
  `input = token_usage - item_token_usage`, no more /2)
- linked to `history_v2` via `agent_run_id`
- `history_v2.content_source` distinguishes row types: `llm_default`=LLM
  response, `user_input`=user message, `Read`/`Glob`/`Write` etc.=tool results
- `extra_info.input_token` (inside the messages JSON's raw_messages) is
  incremental input token (small, 10-600), not total input

#### Scenario: token_usage split (calibrated 2026-08-03, no more /2)
- **GIVEN** `server_history_info.token_usage = 200`, `item_token_usage = 120`
- **WHEN** the adapter processes it
- **THEN** `output = 120`, `input = 200 - 120 = 80`; when `item_token_usage`
  is missing, `output = token_usage`

#### Scenario: non-LLM row token_usage
- **GIVEN** a non-LLM row has a numeric `token_usage`
- **WHEN** the adapter processes it
- **THEN** skip it (it is message size, already counted in the LLM input
  context); only rows with `content_source === 'llm_default'` count into
  outputTokens

### REQ-006: Python bridge integration
`local-sessions/trae.ts` SHALL call sqlcipher3 via an embedded Python bridge
script, copy the DB to a temp dir, decrypt and query, and return JSON to Node
for processing.

### REQ-007: Windows Python encoding
When calling Python, SHALL set `PYTHONIOENCODING=utf-8` in env to avoid
cp936/gbk Chinese mojibake.

### REQ-008: 30s polling (not file watching)
The Trae DB uses WAL mode; chokidar file watching cannot detect changes. SHALL
use 30s timed polling.

#### Scenario: polling also needs the fingerprint gate
- **GIVEN** the 30s poll fires
- **WHEN** deciding whether to re-decrypt
- **THEN** MUST compute and concatenate fingerprints of `database.db` **and
  `database.db-wal`**
- **AND** watching only the main DB always reports unchanged (the main file's
  mtime never changes in WAL mode), causing a wasted decrypt every round

---

## v5 execution model changes (performance, not reverse-engineering)

> The following three items change no decryption logic, only when and how it is
> invoked. Basis: `PERF-DIAGNOSIS.md` Step 5 CPU profile.

### REQ-008a: no spawnSync
The Python bridge MUST use `spawn` + Promise, MUST NOT use `spawnSync` /
`execFileSync`.

`PYTHONIOENCODING=utf-8` is equally required in the async version (see
REQ-007).

```ts
export function runPythonBridge(script: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('python', [script, ...args], {
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      windowsHide: true,
    });
    let out = '', err = '';
    child.stdout.setEncoding('utf-8');
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += String(d); });
    child.on('error', reject);
    child.on('close', code =>
      code === 0 ? resolve(out) : reject(new Error(`trae bridge exit ${code}: ${err.slice(0, 500)}`)));
  });
}
```

#### Scenario: cost of a single spawnSync
- **GIVEN** one `spawnSync` calling Python to decrypt
- **THEN** the event loop is blocked 1,070-2,251ms (measured four times:
  2,250.8 / 1,919.5 / 1,070.1 / 834.3ms)
- **AND** all HTTP requests queue during that time; the user experiences "the
  whole app froze"

### REQ-008b: decrypt result caching
`readTraeSessions(dbPath)` MUST cache decrypt results keyed by the
concatenated fingerprint of the main DB and `-wal`, TTL 30s (aligned with the
poll interval). When the fingerprint is unchanged and within TTL, MUST NOT
spawn any process.

### REQ-008c: decryption never on the request path
`GET /api/sessions/:key` MUST NOT trigger decryption while handling a Trae
session.

#### Scenario: detail not ready
- **GIVEN** the user opens a Trae session whose decrypt result is not yet
  available
- **THEN** MUST immediately return existing index data + `pending: true`
- **AND** decryption completes in the background via 30s polling; SSE
  `sessions_changed` then notifies the frontend to refetch
- **AND** the frontend MUST NOT poll-wait

### REQ-008d: explicit key-missing error
When the key does not exist, the scanner MUST return HTTP 412 with error code
`TRAE_KEY_MISSING`, and the message must include the extraction command
`python scripts/trae-extract-key.py --save`. MUST NOT silently skip the Trae
provider.

### REQ-009: duplicate session detection
Trae creates multiple `chat_session` records for the same task (different
`session_id`, identical `session_title`, created seconds apart). This is
Trae's own behavior; observability reflects it as-is and each session_id
generates its own sessionKey.

### REQ-010: message_id vs session_id
Both are 24-char hex ObjectIds; the format alone cannot distinguish them.
Debugging method: if the ID is not found in `chat_session`, reverse-lookup
with `SELECT session_id FROM chat_message WHERE message_id=?`.

---

### Layer 2: TTNet network traffic decryption

### REQ-011: process architecture
The system SHALL understand Trae's process architecture:
- main process (Trae CN.exe, Electron) — CDP connectable
- ai_agent process (ai_agent.dll, Rust 233MB) — **plaintext lives here**, the
  AI engine
- network service process (sscronet.dll + aha_net.dll) — network layer,
  encryption happens here
- renderer process — CDP connectable but no AI requests

### REQ-012: MITM trio (config-class requests)
Intercepting config-class requests needs three steps (all required):
1. **main.js patch** — bypass the `isBusinessUser` guard:
   `get isBusinessUser(){return !0}`
2. **Windows system proxy** (sscronet reads the registry, not env vars):
   `reg add ... ProxyServer=127.0.0.1:7779 /v ProxyEnable=1`
3. **install the CA cert into the user-level root store**:
   `certutil -addstore -user root proxy-ca-cert.pem`

#### Scenario: Trae must restart
- **GIVEN** system proxy set and CA installed
- **WHEN** Trae is not restarted
- **THEN** sscronet does not take effect (it reads config only when the Cronet
  engine is created)

#### Scenario: readability split
- **GIVEN** a config-class request (batch_get_detail_param etc.)
- **THEN** both request and response bodies are plaintext ✅
- **GIVEN** an AI chat request (/api/agent/v3/llm_utils_chat)
- **THEN** the response body is plaintext ✅ but the **request body is
  encrypted** ❌ (TTNet body_encryptor_)

### REQ-013: DLL patch (partially effective)
The sscronet.dll file can be patched directly to disable the encryption-decision
functions. **The two DLLs must be patched separately** (different code):
- main dir `<install>/sscronet.dll` (9,093,520 bytes)
- ai-agent subdir `<install>/resources/app/modules/ai-agent/sscronet.dll`
  (9,081,232 bytes)

Patch points include: the encryption-decision function, the smbyttnet header,
and the body_encryptor_ check.

#### Scenario: patch limitations
- **GIVEN** sscronet.dll patched and the smbyttnet header gone
- **WHEN** inspecting the AI chat request body
- **THEN** **the request body is still encrypted** (encryption actually
  happens in ai_agent.dll's ring crate 0.17.8, not sscronet.dll)

### REQ-014: Frida heap memory scan (recommended)
The AI chat plaintext JSON exists in the ai_agent.dll process heap (before
encryption). SHALL:
1. `discoverFridaTarget()` — find Trae CN.exe PIDs via tasklist, probe each
   for `ai_agent.dll` with Frida
2. spawn `frida -p <PID> -l frida-chat-monitor-v2.js`
3. scan for the `"raw_messages"` byte pattern (more precise than
   `"messages"`), dump ~32KB around it
4. Frida outputs hex (`[HEX]` marker); Node decodes with
   `Buffer.from(bytes).toString('utf8')`
5. store in `frida_captures`, emit the `frida_capture` event

#### Scenario: ai_agent.dll loads on demand
- **GIVEN** Trae just started and the user has not used AI chat
- **THEN** ai_agent.dll is not loaded; discover finds nothing; it appears only
  after the user's first chat

#### Scenario: Rust heap fragmentation
- **GIVEN** a one-shot heap scan
- **WHEN** a large JSON (16KB+) is corrupted by in-heap binary data
- **THEN** JSON.parse fails; monitor mode (continuous listening) is more
  reliable than scan

### REQ-015: UTF-16LE handling
Frida captures of Electron app strings must handle UTF-16LE. The v2 script
outputs raw hex and lets Node decode UTF-8, avoiding Frida-side manual decode
offset errors for 3-byte Chinese characters ("锟斤拷" mojibake).

### REQ-016: CDP is useless for Trae
CDP can only see Electron main-process requests; sscronet is an independent
native DLL, so CDP captures no AI chat requests (verified 0 events). CDP is
only valid for standard Electron apps.

### REQ-017: proven-dead approaches (do not retry)
The following were all verified to produce 0 events, **do not retry**:
- CDP Network domain
- EVP_AEAD_CTX_seal hook (RVA 0x7b8d9b0 and 6 candidate functions)
- all I/O-layer hooks (send/WSASend/WSARecv/NtWriteFile/ReadFile/
  ConnectNamedPipe/CreateFileW)
- Cronet exported-API hooks
- WINHTTP hooks
- custom_model.base_url injection (Huawei HIS transparent proxy returns 504)
- `--proxy-server` / `--ignore-certificate-errors` / `NODE_EXTRA_CA_CERTS`
  (only affect Electron, not sscronet)

---

### Layer 3: System prompt capture

### REQ-018: three-layer assembly architecture
The system prompt is "server template + client assembly":
- **Layer 1**: messages[0] role=system (~8,721 chars, static, server template
  cache, key `master_agent`)
- **Layer 2**: tools[] (16 tool definitions, varies with agent_type)
- **Layer 3**: user message `<system-reminder>` dynamic context (7 component
  classes: terminal state / workspace rules / environment context /
  important-instruction-reminders / Skill checks / language settings / user
  input)

`role:system` appears 0 times in network requests from the client (it becomes
part of the user message after assembly).

### REQ-019: capture-monitor.py is the best capture method
1. Frida attach to the ai_agent.dll host process
2. scan rw- memory regions to establish a baseline
3. every 2 seconds check for newly appeared/changed regions
4. **the user sends a message in the Trae IDE** → ai_agent.dll assembles the
   complete API request in memory
5. detect a new region containing prompt markers → capture automatically
6. extract the system prompt (from "You are" up to `"role":"user"`)

#### Scenario: monitoring must start first
- **GIVEN** the monitor script has not started
- **WHEN** the user sends a message
- **THEN** the complete request that was once in memory has been overwritten
  and cannot be captured; **monitoring must start before sending the message**

### REQ-020: large-JSON partial reconstruction
Complete chat JSON of 16KB+ is often corrupted by in-heap binary data. Full
system prompt extraction combines:
1. the injection structure captured by Frida (order and format of the 7
   system-reminder component classes)
2. the AGENTS.md path extracted from the partial capture
3. reading the actual on-disk file to rebuild

### REQ-021: Trae CLI alternative
`trae-cli --print --output-format json` directly returns the complete system
prompt (the CLI version is a trimmed solo_coder agent, different from the
IDE). CLI data dir: `%LOCALAPPDATA%\trae-cli\`.

---

## Gotchas (deepest pitfalls in this module; read every entry)

### Database layer
- **G6.1**: the SQLCipher key needs Python extraction; the scanner must check
  the key exists first
- **WAL checkpoint**: after copying the DB you must
  `PRAGMA wal_checkpoint(FULL)`, otherwise new messages are invisible (really
  hit)
- **second-level timestamps**: `created_at` etc. are second-level; must ×1000,
  otherwise shows 1970
- **Python encoding**: Windows Python calls via `execFileSync` must set
  `PYTHONIOENCODING=utf-8`
- **key format change**: on 2026-07-23 some versions had no `PRAGMA key`
  plaintext in memory; use Frida to search the `connection.rs` compiled string
- **G5.2**: WAL-mode file watching is unreliable; must use 30s polling
- **duplicate sessions**: Trae itself creates multiple chat_session rows for
  one task; not an observability bug
- **message_id and session_id share the format**: both are 24-char hex
  ObjectIds; reverse-lookup when debugging

### Token computation (most error-prone)
- **G4.2**: `server_history_info.token_usage` needs /2 calibration
- **G4.3**: non-LLM rows' numeric `token_usage` is message size, skip; only
  `content_source === 'llm_default'` counts into outputTokens
- **token spread across two tables**: `history_v2.token_usage` is message size,
  not output; real input/output live in `server_history_info`
- **`extra_info.input_token` is incremental** (10-600), not total input

### Network layer
- **G6.2**: TTNet bodies cannot be MITM-decrypted (encryption is in the
  ai_agent.dll ring crate, not sscronet)
- **MITM trio, all three required**: main.js patch + Windows registry proxy +
  CA cert
- **Trae must restart**: sscronet reads proxy config and trust roots only when
  the Cronet engine is created
- **sscronet reads the registry, not env vars**: `HTTPS_PROXY`/`HTTP_PROXY`
  are ineffective
- **the two sscronet.dll files differ**: patch them separately; RVA offsets
  differ
- **smbyttnet header and body encryption are separate code paths**: patching
  removes the header but the body stays encrypted
- **startup trap**: starting Trae with `--proxy-server` while the MITM service
  is down makes even login fail; start and log in without the proxy first

### Frida layer
- **G6.3**: Rust heap fragmentation; monitor mode is more reliable than scan
- **G6.4**: Electron/UTF-16LE special handling; the v2 script outputs hex and
  lets Node decode
- **ai_agent.dll loads on demand**: appears only after the user's first AI
  chat; the PID changes across restarts
- **Frida injection rejected**: when Trae runs as admin, Frida needs admin
  privileges
- **G6.5**: CDP is useless for Trae (do not retry)
- **all I/O hooks produce 0 events**: do not retry send/WSASend/NtWriteFile
  etc.
- **large-JSON partial**: 16KB+ JSON is often corrupted by heap binary data;
  rebuild by combining on-disk files

### Performance (v5)
- **G11.6**: `spawnSync` is absolutely forbidden in single-threaded Node; one
  call eats 1.5-2.3s of the event loop
- **G11.15**: Trae change fingerprints must cover the `-wal` file; watching
  only the main DB always reports unchanged
- **G11.16**: decryption must never appear on the HTTP request path; return
  `pending: true` when not ready and let SSE fill it in

### Huawei network environment
- **custom_model.base_url injection is blocked by HIS**: returns 504; not
  viable on Huawei corporate networks
- **Frida is unaffected by HIS**: the only viable approach under Huawei
  networks
- **G3.1**: dev URLs must be 127.0.0.1

### System prompt
- **must start monitoring before sending messages**: otherwise the complete
  request in memory has already been overwritten
- **role:system appears 0 times client-side**: it becomes part of the user
  message after assembly
- **CLI ≠ IDE**: the CLI prompt is a trimmed version

## File list

| File | Purpose |
|------|---------|
| `scripts/trae-extract-key.py` | SQLCipher key extraction (Windows API memory scan) |
| `local-sessions/trae.ts` | Trae DB scanner (Python bridge + sqlcipher3) |
| `src/adapters/trae.ts` | Trae data adapter (token calibration + phase mapping) |
| `scripts/frida-chat-monitor-v2.js` | Frida heap scan (primary, hex output) |
| `scripts/frida-check-module.js` | detect whether ai_agent.dll is loaded |
| `scripts/frida-capture-full.js` | full Frida request capture |
| `scripts/frida-capture-plaintext.js` | sscronet DLL patch script |
| `scripts/capture-proxy.mjs` | HTTP capture proxy (Custom Model approach, dead under Huawei networks) |
| `skills/decrypt-trae-cn.md` | full three-layer decryption skill (team reuse) |
| `skills/capture-agent-system-prompt.md` | system prompt capture guide |
