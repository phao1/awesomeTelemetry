FROM node:24-slim
WORKDIR /app
COPY model-proxy.mjs mock-model.mjs protocol.mjs trace.mjs sidecar.mjs ./
RUN mkdir /out && chown node:node /out
USER node
ENTRYPOINT ["node", "/app/model-proxy.mjs"]
