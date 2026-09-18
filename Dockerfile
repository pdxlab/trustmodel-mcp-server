# Hosted TrustModel MCP server (streamable-HTTP) — TRUS-1712.
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
# bin/ must land before npm ci: package.json declares a preinstall hook
# (node bin/check-node.mjs, the Node >=22.12 floor guard from TRUS-1415).
# Without it npm ci fails with MODULE_NOT_FOUND before installing anything.
COPY bin ./bin
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
COPY bin ./bin
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
EXPOSE 8080
# PORT, TRUSTMODEL_BASE_URL, MCP_ALLOWED_HOSTS, MCP_ALLOWED_ORIGINS via env.
# Auth is per-request (Authorization: Bearer tm-…), never baked into the image.
CMD ["node", "dist/http-server.js"]
