# Context is a git archive of OPENCODE_SRC at the pinned commit; no .git/node_modules.
FROM oven/bun:1.4.4 AS build
USER root
RUN apt-get update && apt-get install -y --no-install-recommends git python3 make g++ ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /source
COPY . .
RUN test "$(bun -p 'require("./package.json").version')" = 2.1.3
RUN bun install --frozen-lockfile
# Native compatible provider is bundled (core/src/provider.ts), no npm.add on startup.
ENV OPENCODE_VERSION=2.1.3 OPENCODE_CHANNEL=latest
RUN bun run --cwd packages/cli script/build.ts --single --skip-install --skip-web-ui
RUN mkdir -p /artifact && cp packages/cli/dist/cli-linux-arm64/bin/opencode /artifact/opencode && cp packages/core/src/models-dev/snapshot.txt /artifact/models.json

FROM node:24-slim
RUN apt-get update && apt-get install -y --no-install-recommends git curl iproute2 ca-certificates bash && rm -rf /var/lib/apt/lists/*
COPY --from=build /artifact/opencode /usr/local/bin/opencode
COPY --from=build /artifact/models.json /opt/models.json
ENV OPENCODE_DISABLE_AUTOUPDATE=1 OPENCODE_DISABLE_MODELS_FETCH=1 OPENCODE_MODELS_PATH=/opt/models.json OPENCODE_DISABLE_PROJECT_CONFIG=1 OPENCODE_DISABLE_CLAUDE_CODE=1 OPENCODE_DISABLE_FFF=1 OPENCODE_DISABLE_FILEWATCHER=1
# No OTEL_EXPORTER_OTLP_* environment is passed: util/observability/otlp.ts disables exporters without endpoint.
RUN mkdir -p /home/node/.config/opencode /data && chown -R node:node /home/node /data
USER node
ENTRYPOINT ["sleep", "infinity"]
