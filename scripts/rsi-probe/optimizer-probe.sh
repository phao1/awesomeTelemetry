#!/usr/bin/env bash
# No host auth, source mounts, real keys or network at runtime. Inspect CLI capability only.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p out
if [[ -z "${RSI_CODEX_VERSION:-}" ]]; then
  printf '%s\n' '{"status":"needs_decision","reason":"Set RSI_CODEX_VERSION to an explicit npm @openai/codex version"}' | tee out/optimizer-report.json
  exit 1
fi
[[ "$RSI_CODEX_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-+][a-zA-Z0-9.-]+)?$ ]] || { echo '{"error":"RSI_CODEX_VERSION must be a pinned version"}' >&2; exit 1; }
name="rsi-optimizer-probe-$$"
cleanup() { docker --context colima-rsi rm -f "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT
trap 'code=$?; printf "{\"status\":\"infra_error\",\"exitCode\":%s,\"reason\":\"optimizer command failed; inspect logs\"}\n" "$code" | tee out/optimizer-report.json >&2' ERR
# Source-free build context: Dockerfile via stdin, dependency acquisition only at build time.
if ! docker --context colima-rsi build --build-arg "CODEX_VERSION=$RSI_CODEX_VERSION" -t rsi-optimizer:p0 - >out/optimizer-build.log 2>&1 <<'DOCKER'
FROM node:24-slim
ARG CODEX_VERSION
RUN npm install -g "@openai/codex@${CODEX_VERSION}"
USER node
ENTRYPOINT ["sleep", "infinity"]
DOCKER
then
  printf '%s\n' '{"status":"infra_error","reason":"Codex image build failed; inspect optimizer-build.log"}' | tee out/optimizer-report.json
  exit 1
fi
docker --context colima-rsi create --name "$name" --network none --cap-drop ALL --security-opt no-new-privileges --memory 512m --pids-limit 128 rsi-optimizer:p0 >/dev/null
docker --context colima-rsi start "$name" >/dev/null
if ! docker --context colima-rsi exec "$name" sh -c 'codex --version && codex --help && codex login --help && codex exec --help' >out/optimizer-help.log 2>&1; then
  printf '%s\n' '{"status":"infra_error","reason":"CLI could not run in Linux arm64; inspect optimizer-help.log"}' | tee out/optimizer-report.json
  exit 1
fi
docker --context colima-rsi stats --no-stream --format '{{json .}}' "$name" >out/optimizer-stats.json
node --input-type=module <<'JS' | tee out/optimizer-report.json
import { readFile } from 'node:fs/promises';
const help = await readFile('out/optimizer-help.log', 'utf8');
const stats = JSON.parse(await readFile('out/optimizer-stats.json', 'utf8'));
const memory = /^([\d.]+)\s*(B|KiB|MiB|GiB)/.exec(stats.MemUsage);
const idleMemoryBytes = memory ? Number(memory[1]) * ({B:1,KiB:1024,MiB:1024**2,GiB:1024**3})[memory[2]] : null;
console.log(JSON.stringify({ status: 'needs_decision', linuxCliRuns: true, idleMemoryBytes,
  apiKey: { helpSupportsStdinKey: help.includes('--with-api-key'), authenticated: false,
    decision: 'Use temporary token via a Codex-compatible Responses proxy; real key remains in proxy. P0 chat proxy is OpenCode-only.' },
  subscription: { helpSupportsDeviceAuth: help.includes('--device-auth'), authenticated: false,
    decision: 'Choose a fresh interactive/device login with container-only credentials and vendor-domain egress allowlist. Never copy host auth. Verify plan/account access and token accounting from fresh session logs.' },
  sealedData: { hostMounts: false, network: 'none', hostAuthRead: false },
  limitation: 'CLI startup/help tested. Authenticated inference and subscription authorization require user account decision; not claimed as verified.'
}, null, 2));
JS
