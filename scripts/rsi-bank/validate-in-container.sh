#!/bin/zsh
# Runs validate.mjs and mutate.mjs in one container holding all three toolchains, then copies the results back.
# The RSI VM mounts no host directories, so --docker bind mounts cannot work there.
set -euo pipefail
R=$(cd "$(dirname "$0")/../.." && pwd)
bank=rsi-bank
if (( $# )); then
  [[ $# == 2 && $1 == --bank && ( $2 == rsi-bank || $2 == rsi-bank-hard ) ]] || { print -u2 'Usage: validate-in-container.sh [--bank rsi-bank|rsi-bank-hard]'; exit 2; }
  bank=$2
fi
doc=docs/rsi/bank.md
[[ $bank == rsi-bank-hard ]] && doc=rsi-bank-hard/DESIGN.md
C=(docker --context "${RSI_DOCKER_CONTEXT:-colima-rsi}")
"${C[@]}" build -t rsi-bank-validate:p3 - <<'DOCKER'
FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends git python3 ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=golang:1.23-bookworm /usr/local/go /usr/local/go
ENV PATH=/usr/local/go/bin:$PATH GOFLAGS=-mod=mod GOPROXY=off GOCACHE=/tmp/gocache
DOCKER
n=rsi-bank-validate-$$
"${C[@]}" create --name $n --network none --cap-drop ALL --security-opt no-new-privileges --memory 3g -w /work rsi-bank-validate:p3 sleep infinity >/dev/null
trap '"${C[@]}" rm -f $n >/dev/null' EXIT
"${C[@]}" start $n >/dev/null
"${C[@]}" exec $n mkdir -p /work/docs/rsi
# Without these flags macOS tar adds ._* files, which fail the task inventory check.
COPYFILE_DISABLE=1 tar --no-xattrs --no-mac-metadata -C "$R" -cf - "$bank" scripts/rsi-bank "$doc" | "${C[@]}" exec -i $n tar -C /work --no-same-owner -xf -
"${C[@]}" exec $n node scripts/rsi-bank/mutate.mjs --bank "$bank" | grep -v '^KILL' || exit 1
"${C[@]}" exec $n node scripts/rsi-bank/validate.mjs --bank "$bank" || exit 1
"${C[@]}" exec $n tar -C /work -cf - "$bank/manifest.json" "$doc" | tar -C "$R" -xf -
