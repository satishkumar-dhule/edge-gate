#!/usr/bin/env bash
# ============================================================================
# AKAMAI SYNTHETIC RELEASE GATE — END-TO-END AWS TERRAFORM DEPLOYMENT SCRIPT
# ============================================================================
# Usage:
#   ./scripts/deploy-aws.sh                  # Provisions S3, Packaged Canary ZIP, DynamoDB, IAM, CloudWatch Synthetics Canaries & ECR
#   ./scripts/deploy-aws.sh --with-apprunner # Also builds & pushes the Docker image to ECR and deploys AWS App Runner Control Plane
# ============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TF_DIR="${ROOT_DIR}/infra/terraform"
AWS_REGION="${AWS_REGION:-us-east-1}"
DEPLOY_APPRUNNER="false"

if [[ "${1:-}" == "--with-apprunner" ]]; then
  DEPLOY_APPRUNNER="true"
fi

echo "==> [1/4] Initializing Terraform in ${TF_DIR} (Region: ${AWS_REGION})..."
terraform -chdir="${TF_DIR}" init

echo "==> [2/4] Validating Terraform configuration..."
terraform -chdir="${TF_DIR}" validate

echo "==> [3/4] Applying AWS Synthetics Canaries, S3, DynamoDB, IAM & ECR..."
terraform -chdir="${TF_DIR}" apply -auto-approve \
  -var="aws_region=${AWS_REGION}" \
  -var="deploy_apprunner_service=false"

if [[ "${DEPLOY_APPRUNNER}" == "true" ]]; then
  ECR_URL="$(terraform -chdir="${TF_DIR}" output -raw ecr_repository_url)"
  ACCOUNT_ID="$(terraform -chdir="${TF_DIR}" output -raw aws_account_id)"
  echo "==> [4/4] Building & pushing Control Plane Docker image to ${ECR_URL}:latest..."
  aws ecr get-login-password --region "${AWS_REGION}" | \
    docker login --username AWS --password-stdin "${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
  docker build -t "${ECR_URL}:latest" "${ROOT_DIR}"
  docker push "${ECR_URL}:latest"

  echo "==> Enabling AWS App Runner Control Plane service..."
  terraform -chdir="${TF_DIR}" apply -auto-approve \
    -var="aws_region=${AWS_REGION}" \
    -var="deploy_apprunner_service=true"
else
  echo "==> [4/4] Infrastructure provisioning complete! (Pass --with-apprunner to build & deploy the container to AWS App Runner)"
fi

echo ""
echo "==> Deployment Outputs:"
terraform -chdir="${TF_DIR}" output
