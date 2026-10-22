# Install this reviewed file separately as /etc/asteroid-explorer/Dockerfile.
# The deployment controller uses that trusted copy, not uploaded build instructions.
FROM node:24-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205

ENV NODE_ENV=production HOME=/tmp
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --fund=false && npm cache clean --force
COPY server.mjs index.html ./
COPY lib/ ./lib/
COPY src/ ./src/
COPY data/main-belt-startup.json ./data/main-belt-startup.json
COPY config/startup-sample-core-bodies.json ./config/startup-sample-core-bodies.json

USER 10002:10002
EXPOSE 4173
HEALTHCHECK --interval=15s --timeout=4s --start-period=20s --retries=4 \
    CMD ["node", "--input-type=module", "-e", "const r=await fetch('http://127.0.0.1:4173/healthz',{signal:AbortSignal.timeout(2500)});const b=await r.json();if(!r.ok||b.ok!==true)process.exit(1)"]
CMD ["node", "server.mjs"]
