#!/bin/zsh
# Runs validate.mjs and mutate.mjs in one container holding all three toolchains, then copies the results back.
# The RSI VM mounts no host directories, so --docker bind mounts cannot work there.
set -u
R=$(cd "$(dirname "$0")/../.." && pwd)
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
COPYFILE_DISABLE=1 tar --no-xattrs --no-mac-metadata -C "$R" -cf - rsi-bank scripts/rsi-bank docs/rsi/bank.md | "${C[@]}" exec -i $n tar -C /work --no-same-owner -xf -
"${C[@]}" exec $n node scripts/rsi-bank/mutate.mjs | grep -v '^KILL' || exit 1
"${C[@]}" exec $n node scripts/rsi-bank/validate.mjs || exit 1
"${C[@]}" exec $n tar -C /work -cf - rsi-bank/manifest.json docs/rsi/bank.md | tar -C "$R" -xf -
