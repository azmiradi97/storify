FROM node:20-alpine AS deps
RUN corepack enable && corepack prepare pnpm@10 --activate

WORKDIR /app

# Copy workspace manifests first (better layer caching)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/database/package.json ./packages/database/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/

# Install all dependencies (dev included — needed for build)
RUN pnpm install --frozen-lockfile

# ─── Build stage ─────────────────────────────────────────────────────────────
FROM deps AS builder

# Copy source
COPY packages ./packages
COPY apps ./apps

# Generate Prisma clients for master + tenant schemas
RUN pnpm --filter @hesba/database db:generate

# Build the React frontend (output → apps/web/dist)
RUN pnpm --filter @hesba/web build

# Compile the API to JS (output → apps/api/dist) and rewrite `@/` path aliases
# to relative paths so plain `node` can resolve them at runtime.
RUN pnpm --filter @hesba/api build

# ─── Production image ─────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
RUN apk add --no-cache openssl tini && corepack enable && corepack prepare pnpm@10 --activate

# prisma + tsx are needed at startup (migrate deploy / db:seed) but live in
# pnpm's .pnpm store as symlinks that Docker COPY can't follow across stages.
# Install them globally — reliable and adds only ~20 MB.
RUN npm install -g prisma@5 tsx@4 --no-fund --no-audit 2>/dev/null

WORKDIR /app

# Workspace manifests (needed so pnpm can resolve workspace:* references)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/database/package.json ./packages/database/
COPY apps/api/package.json ./apps/api/

# Production-only deps. db:seed and migrate-deploy invoke the prisma CLI, but
# we'll grab the prisma binary from the builder stage rather than re-installing
# it as a runtime dep.
RUN pnpm install --frozen-lockfile --prod --ignore-scripts

# Prisma generated clients (gitignored — must come from the builder stage)
COPY --from=builder /app/packages/database/src ./packages/database/src
COPY --from=builder /app/packages/database/prisma ./packages/database/prisma

# Tenant SQL migrations — runTenantMigrations() reads these at runtime
COPY --from=builder /app/packages/database/migrations ./packages/database/migrations

# Compiled API code (no source, no tsconfig — plain Node serves dist/index.js)
COPY --from=builder /app/apps/api/dist ./apps/api/dist

# Built frontend (served statically by the API in production)
COPY --from=builder /app/apps/web/dist ./apps/web/dist

# Run as an unprivileged user (least privilege — shrinks RCE blast radius).
# node_modules stays root-owned and world-readable; the runtime server writes
# nothing locally, and startup tooling (pnpm/prisma/tsx) only needs a writable
# HOME plus a scratch cache dir.
RUN addgroup -g 1001 -S nodejs \
 && adduser -S nodejs -u 1001 -G nodejs -h /home/nodejs \
 && mkdir -p /home/nodejs /app/node_modules/.cache \
 && chown -R nodejs:nodejs /home/nodejs /app/node_modules/.cache
USER nodejs
ENV HOME=/home/nodejs

ENV NODE_ENV=production
EXPOSE 3000

# tini reaps zombies and forwards SIGTERM cleanly to Node so graceful-shutdown
# handlers fire during rolling deploys.
ENTRYPOINT ["/sbin/tini", "--"]

# Startup order:
#   1. prisma migrate deploy — applies any pending master-schema migrations
#   2. db:seed                — idempotent (upsert on slug)
#   3. node dist/index.js     — runs compiled JS; no tsx, no on-the-fly transpile
CMD ["sh", "-c", "prisma migrate deploy --schema=packages/database/prisma/schema.prisma && cd packages/database && tsx src/seeds/master.seed.ts && cd /app && exec env API_PORT=${PORT:-3000} tsx apps/api/dist/index.js"]
