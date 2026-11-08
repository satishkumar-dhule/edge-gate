# CLAUDE.md — AI Agent Adaptation & Engineering Playbook

This repository is a production-grade **Akamai Edge & AWS Synthetics 3-Dimensional Release Gate** template.
It is built around **Deep Modules (DRY / KISS / TDD)** so an AI coding agent or engineer can adapt the entire stack to a new organization after `git clone` by editing just **2 declarative configuration files**.

---

## Fast-Track: How to Adapt This Repo After `git clone`

1. **Frontend & Backend Master Topology (`src/config/template.config.ts`)**:
   - Edit `DEFAULT_TEMPLATE_CONFIG.branding` (Control Plane title, logo mark, primary domain `enterprise.akamai-edge.net`, operator role).
   - Edit `DEFAULT_TEMPLATE_CONFIG.networks` (Staging edge suffix `.edgesuite-staging.net` / IP `23.54.18.92` and Production edge suffix `.edgesuite.net` / IP `104.86.112.44`).
   - Edit `DEFAULT_TEMPLATE_CONFIG.properties` (Applications and per-environment `hostMap` hostname mappings).
   - Edit `DEFAULT_TEMPLATE_CONFIG.testSuite` (Synthetic URLs, expected HTTP statuses, visual gates, and `critical` flags).

2. **AWS Infrastructure-as-Code (`infra/terraform/terraform.tfvars.example` -> `terraform.tfvars`)**:
   - Every AWS resource (S3 artifact bucket, S3 suite CSV/JSON objects, SSM Parameter Store keys, DynamoDB table + seeded rules, CloudWatch Synthetics Canaries, Bedrock Nova Lite `amazon.nova-lite-v1:0` IAM policy, CloudWatch Alarms, SNS alerts, ECR, App Runner, and `.env.terraform`) is 100% driven by Terraform variables.
   - Copy `infra/terraform/terraform.tfvars.example` to `infra/terraform/terraform.tfvars` and customize variables, or export the auto-generated HCL directly from the UI (**MCP & AWS Backend -> Terraform IaC**).

3. **Custom Release Gate Plugins (`src/engine/pluginRegistry.ts`)**:
   - Add or customize modular plugins in `BUILTIN_GATE_PLUGINS` and `evaluatePluginPipeline()` without modifying the core 3-dimension diff rules in `src/engine/rules.ts`.

---

## Mandatory Verification Commands

```bash
# 1. Run pure domain, plugin, & AWS/Terraform blueprint unit tests (node:test)
npx --yes tsx --test src/engine/rules.test.ts

# 2. Verify CloudWatch Synthetics Canary script syntax
node --check aws-synthetics/canary-har-runner.js

# 3. Type-check the entire TypeScript codebase
npm run lint

# 4. Compile production Vite bundle
npm run build
```

---

## Available AI Skills in `/skills/`
- `/skills/adapt-organization/SKILL.md` — Rebrand and configure edge networks, domains, and properties in one pass.
- `/skills/add-property-and-suite/SKILL.md` — Add new Akamai properties, environment `hostMap` rules, and synthetic checks.
- `/skills/create-gate-plugin/SKILL.md` — Create a new Release Gate Evaluator Plugin with unit test coverage.
- `/skills/deploy-aws-terraform/SKILL.md` — Provision the complete AWS Synthetics + Bedrock Nova Lite stack via Terraform.
