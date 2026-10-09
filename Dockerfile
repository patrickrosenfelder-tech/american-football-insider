# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS build
WORKDIR /app
# Toolchain only needed if sqlite3's prebuilt binary is unavailable
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080 DB_PATH=/tmp/nfl-data.db
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/client/dist ./client/dist
COPY package.json ./
COPY src ./src
# Node serves the versioned training artifact; Python is never needed at request time.
COPY --from=build /app/scripts/model/model_v2.json ./scripts/model/model_v2.json
COPY --from=build /app/scripts/model/predictions_current.json ./scripts/model/predictions_current.json
EXPOSE 8080
CMD ["node", "src/app.js"]
