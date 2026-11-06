# syntax=docker/dockerfile:1
FROM oven/bun:1.4.4 AS dependencies
USER root
RUN apt-get update && apt-get install -y --no-install-recommends git python3 make g++ ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /source
# Only platform-filtered dependency metadata; never .npmrc, bunfig.toml or source.
COPY deps/ ./
ENV BUN_CONFIG_NO_CLEAR_TERMINAL=1 npm_config_registry=https://registry.npmjs.org
RUN bun install --frozen-lockfile --ignore-scripts --registry https://registry.npmjs.org

FROM dependencies AS compile
COPY source/ ./
ENV OPENCODE_VERSION=2.1.3 OPENCODE_CHANNEL=latest HUSKY=0
# OpenCode's fix-node-pty runs candidate code and patches the installed native package.
# esbuild/native optional artifacts must already have arrived through the lockfile.
RUN --network=none bun run --cwd packages/core fix-node-pty
RUN --network=none bun run --cwd packages/cli script/build.ts --single --skip-install --skip-web-ui
RUN --network=none mkdir -p /artifact && cp packages/cli/dist/cli-linux-*/bin/opencode /artifact/opencode && cp packages/core/src/models-dev/snapshot.txt /artifact/models.json

FROM node:24-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=compile /artifact/opencode /usr/local/bin/opencode
COPY --from=compile /artifact/models.json /opt/models.json
ENV OPENCODE_DISABLE_AUTOUPDATE=1 OPENCODE_DISABLE_MODELS_FETCH=1 OPENCODE_MODELS_PATH=/opt/models.json OPENCODE_DISABLE_PROJECT_CONFIG=1 OPENCODE_DISABLE_CLAUDE_CODE=1 OPENCODE_DISABLE_FFF=1 OPENCODE_DISABLE_FILEWATCHER=1
RUN mkdir -p /home/node/.config/opencode /data && chown -R node:node /home/node /data
USER node
ENTRYPOINT ["sleep", "infinity"]
FROM runtime AS target-node
FROM runtime AS target-python
USER root
RUN apt-get update && apt-get install -y --no-install-recommends python3 && rm -rf /var/lib/apt/lists/*
USER node
FROM runtime AS target-go
ENV GOMAXPROCS=1 GOTOOLCHAIN=local GOPROXY=off GOSUMDB=off
USER root
COPY --from=golang:1.23-bookworm /usr/local/go /usr/local/go
ENV PATH="/usr/local/go/bin:${PATH}"
USER node
