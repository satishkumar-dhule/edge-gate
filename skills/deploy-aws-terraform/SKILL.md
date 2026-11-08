---
name: deploy-aws-terraform
description: Provision the 100% Terraform-managed AWS stack (S3, SSM, DynamoDB, CloudWatch Synthetics Canaries, Bedrock Nova Lite IAM, Alarms, App Runner).
---

# Skill: Deploy to AWS via Terraform (`/skills/deploy-aws-terraform/SKILL.md`)

## Step-by-Step Procedure
1. Copy `infra/terraform/terraform.tfvars.example` to `infra/terraform/terraform.tfvars`.
2. Set `s3_artifact_bucket` to a globally unique S3 bucket name and set `aws_region`.
3. Run:
   ```bash
   cd infra/terraform
   terraform init
   terraform validate
   terraform plan -out=tfplan
   terraform apply tfplan
   ```
4. Terraform automatically provisions S3 + suite CSV/JSON files, SSM parameters, DynamoDB table + seeded rules, CloudWatch Synthetics Canaries (ZIP-packaged from `aws-synthetics/canary-har-runner.js`), Bedrock Nova Lite (`amazon.nova-lite-v1:0`) IAM permissions, CloudWatch Alarms, SNS topic, and generates `.env.terraform` in the project root.
