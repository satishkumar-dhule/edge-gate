---
name: adapt-organization
description: Rebrand and adapt the Release Gate repository to a new organization's domain, CDN edge networks, AWS account, and properties.
---

# Skill: Adapt Organization (`/skills/adapt-organization/SKILL.md`)

## When to Trigger
Use this skill when the user asks to adapt, rebrand, or configure this cloned repository for their company, domain, CDN (Akamai, CloudFront, Fastly, Cloudflare), or AWS environment.

## Step-by-Step Procedure
1. **Update `src/config/template.config.ts`**:
   - Set `branding.logoMark`, `branding.controlPlaneTitle`, `branding.defaultDomain`, and `branding.defaultOperator`.
   - Set `networks.staging.edgeSuffix` & `defaultEdgeIp` and `networks.prod.edgeSuffix` & `defaultEdgeIp`.
   - Set `infrastructure.awsRegion`, `s3Bucket`, `dynamodbTable`, and `visualJudgeModel` (default: `amazon.nova-lite-v1:0`).
   - Update `properties` and `testSuite`.
2. **Sync `infra/terraform/terraform.tfvars.example`**:
   - Update `project_name`, `default_domain`, `staging_edge_suffix`, `staging_edge_ip`, `prod_edge_suffix`, `prod_edge_ip`, `s3_artifact_bucket`, `properties`, and `test_suite`.
3. **Verify**:
   - Run `npx --yes tsx --test src/engine/rules.test.ts && npm run lint && npm run build`.
