# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3000
CMD ["node", "server.js"]

FROM node:22-bookworm-slim AS scheduler
WORKDIR /app
COPY --chown=node:node scripts/run-scheduled-sync.mjs scripts/sync-scheduler.mjs ./scripts/
USER node
CMD ["node", "scripts/sync-scheduler.mjs"]

FROM node:22-bookworm-slim AS migrator
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node scripts/migrate-postgres.mjs ./scripts/
COPY --chown=node:node migrations/postgres ./migrations/postgres
USER node
CMD ["node", "scripts/migrate-postgres.mjs"]
