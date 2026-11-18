# Console image: the Gateway (Node 24, TypeScript run by type stripping) plus the built SPA.
# Build context is ./console (see docker-compose.yaml).
#
# D-14: the Catalog is compiled here, from the reference repo (aws-emulator) fetched at the commit pinned in
# refs.json, and the Gateway serves it at /__console/catalog/<fingerprint>/*. CI's `catalog:check` validates the
# committed index and manifest at the same pins.

# WEB_SOURCE=build (the default) compiles the SPA here: it needs a large Node heap and a Docker VM with enough RAM
# (see the READMEs for the measured peak). WEB_SOURCE=prebuilt copies a dist built on the host with `pnpm build`,
# passed as the named build context `webdist` (the apps/web folder), and refuses one stamped for another Catalog.
ARG WEB_SOURCE=build

FROM node:24-alpine AS workspace
RUN npm install -g pnpm@10.18.3
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/model/package.json packages/model/
COPY packages/catalog-compiler/package.json packages/catalog-compiler/
COPY packages/api-contract/package.json packages/api-contract/
COPY packages/invoker/package.json packages/invoker/
COPY packages/ui/package.json packages/ui/
COPY apps/gateway/package.json apps/gateway/
COPY apps/web/package.json apps/web/
COPY e2e/package.json e2e/

# Production dependencies of the Gateway only. Workspace packages stay outside node_modules so Node
# can strip their TypeScript types (it refuses to under node_modules).
FROM workspace AS gateway-deps
RUN pnpm install --frozen-lockfile --prod --filter @console/gateway...

# The Catalog: fetch aws-emulator at its pin (sparse, third-party, read-only), then compile it.
FROM workspace AS catalog-build
RUN apk add --no-cache git
RUN pnpm install --frozen-lockfile --filter @console/catalog-compiler...
COPY tsconfig.base.json refs.json ./
COPY scripts/fetch-refs.mjs scripts/
COPY catalog catalog
COPY packages/model packages/model
COPY packages/catalog-compiler packages/catalog-compiler
RUN node scripts/fetch-refs.mjs aws-emulator && node packages/catalog-compiler/src/cli.ts build

# The web build bundles one lazy chunk per AWS SDK client (436); it needs a large Node heap (spike P0.3,
# set by the web package's build script).
FROM workspace AS web-build
RUN pnpm install --frozen-lockfile --filter @console/web...
COPY tsconfig.base.json ./
COPY packages/api-contract packages/api-contract
COPY packages/model packages/model
COPY packages/invoker packages/invoker
COPY packages/ui packages/ui
COPY apps/web apps/web
RUN pnpm --filter @console/web build

FROM workspace AS web-prebuilt
COPY --from=webdist dist apps/web/dist
COPY --from=catalog-build /app/dist/catalog/manifest.json /tmp/manifest.json
RUN node -e 'const fs=require("fs");const want=JSON.parse(fs.readFileSync("/tmp/manifest.json","utf8")).fingerprint;let got="(no stamp)";try{got=fs.readFileSync("apps/web/dist/catalog-fingerprint.txt","utf8").trim()}catch{};if(got!==want){console.error("The prebuilt web dist was built for Catalog "+got+" but this image compiles "+want+". Run `pnpm --dir console build` again.");process.exit(1)}'

FROM web-${WEB_SOURCE} AS web

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
COPY --from=catalog-build /app/dist/catalog dist/catalog
COPY --from=web /app/apps/web/dist apps/web/dist
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
