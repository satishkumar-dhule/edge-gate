# Akamai Synthetic Release Gate & MCP Control Plane

Enterprise release-gating portal, 3-dimension diff engine (**Functional HTTP Headers**, **Cookies**, **Amazon Bedrock Nova Lite `amazon.nova-lite-v1:0` Visual AI**), **OpenAPI 3.1 / Swagger UI** server, **Model Context Protocol (MCP)** endpoint, and clone-and-apply **AWS Terraform + CloudWatch Synthetics** infrastructure bundle.

For full system design, data flow diagrams, domain rules, and AWS deployment architecture, see **[`ARCHITECTURE.md`](./ARCHITECTURE.md)**.

## Quick Start

```bash
# 1. Install dependencies & run unit tests
pnpm install
pnpm exec tsx --test src/engine/rules.test.ts

# 2. Start full-stack server (React Portal + Express OpenAPI 3.1 + MCP Server on port 3000)
pnpm run dev
```

## Deploy to AWS (`terraform apply`)

```bash
# Provision S3, Packaged Canary ZIP, DynamoDB, IAM, CloudWatch Synthetics Canaries & ECR:
./scripts/deploy-aws.sh

# Or build & push the Control Plane Docker image to ECR and deploy AWS App Runner:
./scripts/deploy-aws.sh --with-apprunner
```
