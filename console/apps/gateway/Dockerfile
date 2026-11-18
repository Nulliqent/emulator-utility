# Console image: the Gateway (Node 24, TypeScript run by type stripping) plus the built SPA.
# Build context is ./console (see docker-compose.yaml).
#
# D-14: until a ticket serves /__console/catalog/*, this image copies only the committed Catalog
# manifest and fetches no reference repos. CI's `catalog:check` validates the manifest at the pins.

FROM node:24-alpine AS workspace
RUN npm install -g pnpm@10.18.3
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/model/package.json packages/model/
COPY packages/catalog-compiler/package.json packages/catalog-compiler/
COPY packages/api-contract/package.json packages/api-contract/
COPY packages/ui/package.json packages/ui/
COPY apps/gateway/package.json apps/gateway/
COPY apps/web/package.json apps/web/
COPY e2e/package.json e2e/

# Production dependencies of the Gateway only. Workspace packages stay outside node_modules so Node
# can strip their TypeScript types (it refuses to under node_modules).
FROM workspace AS gateway-deps
RUN pnpm install --frozen-lockfile --prod --filter @console/gateway...

FROM workspace AS web-build
RUN pnpm install --frozen-lockfile --filter @console/web...
COPY tsconfig.base.json ./
COPY packages/api-contract packages/api-contract
COPY packages/ui packages/ui
COPY apps/web apps/web
RUN pnpm --filter @console/web build

FROM node:24-alpine AS runtime
WORKDIR /app
COPY package.json ./
COPY --from=gateway-deps /app/node_modules node_modules
COPY --from=gateway-deps /app/apps/gateway/node_modules apps/gateway/node_modules
COPY --from=gateway-deps /app/packages/api-contract/node_modules packages/api-contract/node_modules
COPY packages/api-contract/package.json packages/api-contract/
COPY packages/api-contract/src packages/api-contract/src
COPY apps/gateway/package.json apps/gateway/
COPY apps/gateway/src apps/gateway/src
COPY dist/catalog/manifest.json dist/catalog/manifest.json
COPY --from=web-build /app/apps/web/dist apps/web/dist
RUN mkdir /data && chown node:node /data
# The container must listen on all interfaces so the published port reaches it; compose publishes it
# on 127.0.0.1 only. The Gateway refuses a non-loopback bind without CONSOLE_ALLOW_REMOTE_BIND=1.
ENV NODE_ENV=production \
    CONSOLE_HOST=0.0.0.0 \
    CONSOLE_ALLOW_REMOTE_BIND=1 \
    CONSOLE_PORT=9300 \
    CONSOLE_CONFIG_DIR=/data \
    CONSOLE_EMULATOR_HOME=/emulator-home \
    CONSOLE_EMULATOR_URL=https://emulator:9297
USER node
EXPOSE 9300
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 CMD ["node", "apps/gateway/src/healthcheck.ts"]
CMD ["node", "apps/gateway/src/main.ts"]
