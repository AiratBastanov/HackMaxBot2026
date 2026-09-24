FROM node:22.23.2-bookworm@sha256:dd5847a04b0deee391fa145f1f4c6d214196668b6bcc7988ebed67249f226844 AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
COPY tests ./tests
COPY scripts ./scripts
RUN npm run typecheck && npm run build && npm test && npm run test:flow && npm run test:data
RUN node --input-type=module -e "import {stage4Fixture} from './dist/src/culture/stage4-fixture.js'; import {writeFileSync} from 'node:fs'; writeFileSync('/app/synthetic-catalog.json',JSON.stringify(stage4Fixture()));"
RUN npm prune --omit=dev --ignore-scripts --no-audit --no-fund

FROM node:22.23.2-bookworm-slim@sha256:48e4b67d85f87bd551df43704e24d252f56cc5f8e9718841aace50f19948f0f9 AS runtime
ARG SOURCE_VERSION=local-unreviewed
LABEL org.opencontainers.image.title="Культурный план: локальный исследовательский прототип" \
      org.opencontainers.image.version="0.1.0" \
      org.opencontainers.image.revision="${SOURCE_VERSION}"
ENV NODE_ENV=production
WORKDIR /app
RUN mkdir -p /app/runtime && chown node:node /app/runtime
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/dist/src ./dist/src
COPY --from=build /app/dist/scripts ./dist/scripts
COPY --from=build /app/dist/tests/fixtures.js ./dist/tests/fixtures.js
COPY --from=build /app/synthetic-catalog.json ./synthetic-catalog.json
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/healthz',{signal:AbortSignal.timeout(2000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "dist/src/index.js"]
