# ============================================================================
# AKAMAI SYNTHETIC RELEASE GATE & MCP CONTROL PLANE — PRODUCTION DOCKERFILE
# ============================================================================
# Builds the React + Vite frontend (`dist/`) and runs the Express OpenAPI 3.1 +
# MCP JSON-RPC + Amazon Bedrock Nova Lite (`amazon.nova-lite-v1:0`) server on
# port 3000 (ready for AWS App Runner / ECS Fargate / EKS).
# ============================================================================

FROM node:22-alpine AS base
WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm install

# Copy source code and build production frontend assets
COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/v1/health || exit 1

CMD ["npx", "tsx", "server.ts"]
