# syntax=docker/dockerfile:1
FROM node:24-slim AS compile
WORKDIR /source
COPY source/ ./
# All candidate execution, including syntax checks, stays offline.
RUN --network=none node --check agent.mjs && chmod -R a=rX /source

FROM node:24-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=compile /source/ /opt/mini-agent/
RUN mkdir -p /data && chown node:node /data
USER node
ENTRYPOINT ["sleep", "infinity"]
FROM runtime AS target-node
FROM runtime AS target-python
USER root
RUN apt-get update && apt-get install -y --no-install-recommends python3 && rm -rf /var/lib/apt/lists/*
USER node
FROM runtime AS target-go
ENV GOMAXPROCS=1 GOTOOLCHAIN=local GOPROXY=off GOSUMDB=off
COPY --from=golang:1.23-bookworm /usr/local/go /usr/local/go
ENV PATH="/usr/local/go/bin:${PATH}"
