# ---- Build stage: install all workspace deps, build client + server ----
FROM node:20-alpine AS build
RUN apk add --no-cache python3 make g++
WORKDIR /app

COPY package.json package-lock.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
RUN npm ci

COPY . .
RUN npm run build

# ---- Runtime stage: production server deps only + built output ----
FROM node:20-alpine AS runtime
RUN apk add --no-cache python3 make g++ curl
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
RUN npm ci --workspace=server --omit=dev

COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/client/dist ./client/dist

# Real data/uploads live in bind-mounted volumes (see docker-compose*.yml) — created here
# and owned by the unprivileged `node` user (built into the base image) so the container
# never runs the app as root, standard hardening for anything internet-facing.
RUN mkdir -p server/data server/uploads && chown -R node:node /app
USER node

EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:4000/api/health || exit 1

CMD ["node", "server/dist/index.js"]
