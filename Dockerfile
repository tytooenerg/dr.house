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
RUN apk add --no-cache python3 make g++
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
RUN npm ci --workspace=server --omit=dev

COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/client/dist ./client/dist

EXPOSE 4000
CMD ["node", "server/dist/index.js"]
