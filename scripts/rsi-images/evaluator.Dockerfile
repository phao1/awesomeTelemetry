FROM node:24-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
COPY reporters/ /opt/rsi/
RUN chmod -R a=rX /opt/rsi
USER node
ENTRYPOINT ["sleep", "infinity"]
FROM base AS evaluator-node
FROM base AS evaluator-python
USER root
RUN apt-get update && apt-get install -y --no-install-recommends python3 && rm -rf /var/lib/apt/lists/*
USER node
FROM base AS evaluator-go
ENV GOMAXPROCS=1 GOTOOLCHAIN=local GOPROXY=off GOSUMDB=off
USER root
COPY --from=golang:1.23-bookworm /usr/local/go /usr/local/go
ENV PATH="/usr/local/go/bin:${PATH}"
USER node
