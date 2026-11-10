# GitHub Copilot Instructions — Akamai Edge & AWS Synthetics Release Gate

1. **Primary Adaptation Entrypoint**: `src/config/template.config.ts` defines all branding, edge networks (Staging & Production suffixes/IPs), AWS infrastructure, properties, and synthetic test suites.
2. **Terraform IaC Synchronization**: `infra/terraform/variables.tf` and `infra/terraform/terraform.tfvars.example` control 100% of AWS provisioning (S3, SSM, DynamoDB, CloudWatch Synthetics Canaries, Bedrock Nova Lite `amazon.nova-lite-v1:0`, CloudWatch Alarms, SNS, ECR, and App Runner).
3. **Plugin Extension Point**: Add custom release gate rules or CI/CD webhook hooks in `src/engine/pluginRegistry.ts`.
4. **Testing**: Run `pnpm exec tsx --test src/engine/rules.test.ts` and `pnpm run lint` to validate changes.
