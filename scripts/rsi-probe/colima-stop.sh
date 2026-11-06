#!/usr/bin/env bash
set -euo pipefail
trap 'code=$?; printf "{\"status\":\"infra_error\",\"exitCode\":%s,\"stage\":\"colima\"}\n" "$code" >&2' ERR
colima stop --profile rsi
printf '%s\n' '{"profile":"rsi","stopped":true}'
