FROM node:24-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
USER node
ENTRYPOINT ["sleep", "infinity"]
