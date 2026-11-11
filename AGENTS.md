# AGENTS.md — Universal Multi-Agent Instructions (Cursor, Copilot, Gemini CLI, Codex, Windsurf)

## Architectural Boundaries & Module Map

| Module | File Path | Responsibility |
| :--- | :--- | :--- |
| **Master Config** | `src/config/template.config.ts` | Single source of truth for branding, CDN edge IPs/suffixes, AWS resources, properties, and test suites. |
| **3-Dim Gate Engine** | `src/engine/rules.ts` | Pure functions for Functional Headers, Set-Cookie parity, Visual Diff cost-gating, `hostMap` Location normalization, and zero-secret `curl --resolve` generation. |
| **Plugin Registry** | `src/engine/pluginRegistry.ts` | Modular pre-compare, per-dimension, and post-verdict plugins + AI adaptation prompt generator. |
| **AWS & IaC Blueprint** | `src/engine/awsBlueprint.ts` | Pure generators for Terraform HCL, Synthetics Canary script, Bedrock Nova Lite judge, and OpenAPI 3.1 spec. |
| **Terraform Stack** | `infra/terraform/*.tf` | 100% Config-as-Code provisioning for S3, SSM, DynamoDB, Synthetics Canaries, Bedrock Nova Lite IAM, Alarms, SNS, ECR, and App Runner. |
| **Canary Runner** | `aws-synthetics/canary-har-runner.js` | Playwright/Puppeteer CloudWatch Synthetics handler reading env-injected `SUITE_CHECKS_JSON` and `HOST_MAP_JSON`. |
| **Visual AI Judge** | `aws-synthetics/bedrock-nova-lite-judge.ts` | Amazon Bedrock Nova Lite (`amazon.nova-lite-v1:0`) multimodal visual diff evaluator via `ConverseCommand`. |
| **Express + MCP API** | `server.ts` | REST API (`/api/v1/*`), OpenAPI 3.1 (`/api/v1/openapi.json`), and MCP JSON-RPC 2.0 server (`/api/v1/mcp/rpc`). |

## Core Invariants Never to Break
1. **Single-Source-of-Truth Config**: Never hardcode hostnames or edge IPs inside React components or Canary scripts; always resolve through `src/config/template.config.ts` or Terraform-injected environment variables.
2. **Zero-Secret Reproduction**: Never expose secrets (`Authorization`, `Cookie`, `x-api-key`) in generated `curl --resolve` commands or webhook payloads.
3. **Cost-Gated AI Visual Judge**: Always keep AWS Bedrock Nova Lite (`amazon.nova-lite-v1:0`) behind the `0.1%` pixel-diff cost gate so identical screenshots cost `$0`.
4. **TDD Verification**: Always run `pnpm exec tsx --test src/engine/rules.test.ts` and `pnpm run lint` after modifying any file.
