FROM node:24-slim
WORKDIR /app
COPY proxy/ ./proxy/
RUN mkdir /out && chown node:node /out
USER node
ENTRYPOINT ["node", "/app/proxy/model-proxy.mjs"]
