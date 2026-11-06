#!/usr/bin/env bash
set -euo pipefail
trap 'code=$?; printf "{\"status\":\"infra_error\",\"exitCode\":%s,\"stage\":\"colima\"}\n" "$code" >&2' ERR
command -v colima >/dev/null || { echo '{"error":"Install colima and docker CLI first"}' >&2; exit 1; }
# --mount none disables Colima's default HOME + /tmp mounts. All data moves through docker cp.
colima start --profile rsi --vm-type vz --cpu 4 --memory 4 --disk 30 --mount none
colima status --profile rsi
printf '%s\n' '{"profile":"rsi","context":"colima-rsi","cpu":4,"memoryGiB":4,"next":"Inspect colima list and colima ssh --profile rsi -- mount; reject any HOME mount"}'
