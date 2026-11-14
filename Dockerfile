# ============================================================================
# AKAMAI SYNTHETIC RELEASE GATE & MCP CONTROL PLANE — PRODUCTION DOCKERFILE
# ============================================================================
# Builds the React + Vite frontend (`dist/`) and runs the Express OpenAPI 3.1 +
# MCP JSON-RPC + Amazon Bedrock Nova Lite (`amazon.nova-lite-v1:0`) server on
# port 3000 (ready for AWS App Runner / ECS Fargate / EKS).
# ============================================================================

FROM node:22-bookworm-slim AS base
WORKDIR /app

# Install Chromium runtime dependencies for live on-demand Playwright capture
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    wget \
  && rm -rf /var/lib/apt/lists/*

# Install pnpm via Corepack and install dependencies
RUN corepack enable && corepack prepare pnpm@12.18.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile && \
    npx playwright install chromium

# Copy source code and build production frontend assets
COPY . .
RUN pnpm run build

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/api/v1/health || exit 1

CMD ["pnpm", "exec", "tsx", "server.ts"]
