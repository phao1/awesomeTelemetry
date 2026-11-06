FROM node:24-slim
RUN apt-get update && apt-get install -y --no-install-recommends git curl ca-certificates procps util-linux && rm -rf /var/lib/apt/lists/*
RUN npm install -g opencode-ai@1.19.5
RUN mkdir -p /data /home/node/.config/opencode /home/node/.codex /home/node/.claude && chown -R node:node /data /home/node
ENV OPENCODE_DISABLE_AUTOUPDATE=1 OPENCODE_DISABLE_MODELS_FETCH=1 OPENCODE_DISABLE_PROJECT_CONFIG=1
USER node
ENTRYPOINT ["sleep", "infinity"]
