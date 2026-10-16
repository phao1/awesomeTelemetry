# Local support evidence — 2026-10-16

Host: macOS 15.3.1 (24D70). The following versions came from the installed executables' --version; help was read without running a model session, changing configuration, loading captured sessions, or installing trust.

| Target | Installed CLI | Available isolation controls observed in --help | Current network validation |
|---|---|---|---|
| Claude Code | 2.1.50 | --no-session-persistence, --setting-sources, --tools, --strict-mcp-config, --print | Not yet validated with this CLI. Messages HTTP/JSON/SSE and actual HTTPS CONNECT passed controlled synthetic network tests. |
| Codex | 0.162.0-alpha.17.2 | exec --ephemeral, --ignore-user-config, --ignore-rules, --sandbox read-only | Not yet validated with this CLI. Responses JSON/SSE passed protocol fixtures. HTTP vs WebSocket selection for this installed version is still unverified; do not force-disable WebSocket and claim parity. |
| OpenCode | 1.18.15 | run --pure, --dir, --format json | Not yet validated with this CLI. Do not infer isolation or zero persistence from --pure; it only disables external plugins. |
| Other six scanner providers | Not inspected in this batch | Existing scanners retained | Scanner support is not network capture certification. |
| Trae CN Frida | No Windows target validation on this host | Existing implementation only | Remains experimental/unverified; CDP does not establish TTNet decryption. |

## Required real-Agent acceptance

For each exact version/transport: controlled local upstream first; verify request bytes/system/tools, multi-turn output, failure/cancel, native identifiers and explicit evidence links. Then two concurrent Agents on the same model, without identity mixing or duplicated billing. Paid remote calls, new tool side effects, system proxy changes and global CA installation are not implicit test steps. No environment currently warrants marking a real-Agent combination as verified.

Current verified transport floor is local HTTP/1.1 plus trusted HTTPS CONNECT, JSON/SSE for Chat, Responses and Messages, with original file retention/download. HTTP/2, WebSocket, gRPC, certificate pinning, nested proprietary formats and Windows-specific memory capture still require dedicated validation/implementation.

## Process connection evidence — 2026-10-16

Installed CLI versions/help were rechecked without starting a model session.
Codex0.162.0-alpha.17.2 exposes --no-daemon; the launcher probes help before
using it and rejects remote/shared-background attachment instead of silently
losing the process-local proxy scope. Existing user model/auth/approval flags
are not rewritten, and WebSocket is not disabled.

Primary configuration references actually fetched for this batch:
[Codex environment variables](https://learn.chatgpt.com/docs/config-file/environment-variables),
[Codex custom CA trust](https://learn.chatgpt.com/docs/auth#custom-ca-bundles),
[Claude terminal network configuration](https://code.claude.com/docs/en/network-config),
[OpenCode proxy and CA configuration](https://opencode.ai/docs/network/).
Codex uses CODEX_CA_CERTIFICATE with SSL_CERT_FILE fallback; Claude/OpenCode
use NODE_EXTRA_CA_CERTS. OpenCode's local TUI requires a loopback bypass.
Current documentation is configuration evidence, not certification of each
installed version's exact network/daemon behavior.

Verified: app profile CRUD/CAS/atomic bounded files; explicit pinned-revision
terminal launcher; real synthetic external child processes; literal argv/cwd;
preservation of existing public CA files and parent env; digest/collision
rejection; real HTTPS CONNECT/original capture with appended trust; targeted
Unix signals and an actual PTY Ctrl-C delivered once with trust-file cleanup.
Synthetic production UI → saved profile → real shared control → CLI launcher
→ controlled HTTPS origin → original inspection passed, with2 upstream
requests/2 saved captures and no extra request from a stale copied command.
No real Claude/Codex/OpenCode model session was invoked, so the table above
remains unverified for actual Agents. Other tool runtimes/mTLS/pinning/upstream
proxy chaining need separate explicit setup. Windows remains unverified.

Read-only diagnostics are now available through the shared Web/CLI endpoint.
They verify current local listener/public CA evidence and distinguish current
shared traffic from historical/other-port/stopped counts, but deliberately
report target runtime trust as unverified and OS trust as not_checked. One
synthetic production browser HTTP request plus real CLI report/refusal/timeout
tests passed; this does not change any actual Agent verification row above.
