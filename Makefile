# ============================================================================
# MAKEFILE — AKAMAI EDGE & AWS SYNTHETICS 3-DIMENSIONAL RELEASE GATE
# ============================================================================
# Supports:
#   1. Build, TDD Unit Tests, TypeScript Lint & Lambda Syntax Verification
#   2. 100% Scale-to-Zero Terraform IaC + Amazon CloudFront + S3 + Lambda Deployment
#   3. Ad-Hoc Synthetic Edge Execution & 3-Dim Release Gate Comparison via CLI
#   4. Headless User Administration, Password Reset & Activity Tracking (CLI + API)
# ============================================================================

SHELL := /bin/bash
AWS_REGION ?= us-east-1
TF_DIR := infra/terraform
S3_BUCKET ?= akamai-synthetics-gate-prod
CF_DIST_ID ?= $(shell cd $(TF_DIR) && terraform output -raw cloudfront_distribution_id 2>/dev/null || echo "")
API_URL ?= http://localhost:3000
TARGET ?= www.prod.staging
CANDIDATE ?= www.prod.staging
BASELINE ?= www.prod.prod
BY ?= satishkumardhule@gmail.com

.PHONY: help install dev build test lint verify \
        tf-init tf-validate tf-plan tf-apply tf-destroy \
        sync-ui invalidate-cloudfront deploy-cloudfront deploy-all \
        run-adhoc compare api-health \
        user-list user-add user-reset-password user-disable user-enable user-delete user-auth user-stats user-audit

help:
	@echo "=========================================================================================="
	@echo " Akamai Edge & AWS Synthetics Release Gate — Make CLI Targets"
	@echo "=========================================================================================="
	@echo ""
	@echo " [1] BUILD, TDD & VERIFICATION"
	@echo "   make install                 Install npm dependencies"
	@echo "   make dev                     Start local Express + Vite + MCP server on port 3000"
	@echo "   make build                   Build production SPA bundle into dist/"
	@echo "   make test                    Run all unit tests (src/engine/rules.test.ts)"
	@echo "   make lint                    Run TypeScript strict type-checking (tsc --noEmit)"
	@echo "   make verify                  Run test + lint + build + Lambda/Canary syntax checks"
	@echo ""
	@echo " [2] AWS TERRAFORM & CLOUDFRONT + SCALE-TO-ZERO LAMBDA DEPLOYMENT"
	@echo "   make tf-init                 Initialize Terraform providers in $(TF_DIR)"
	@echo "   make tf-validate             Validate Terraform HCL configuration"
	@echo "   make tf-plan                 Generate Terraform execution plan"
	@echo "   make tf-apply                Provision CloudFront, S3, SSM, DynamoDB, Lambdas & Canaries"
	@echo "   make sync-ui                 Build dist/ and sync SPA to S3 CloudFront origin (/portal-ui/)"
	@echo "   make invalidate-cloudfront   Invalidate CloudFront Distribution cache (/*)"
	@echo "   make deploy-cloudfront       Full pipeline: build + tf-apply + sync-ui + invalidate-cloudfront"
	@echo ""
	@echo " [3] AD-HOC SYNTHETIC EXECUTION & 3-DIM RELEASE GATE (CLI)"
	@echo "   make run-adhoc TARGET=www.prod.staging BY=ops@company.com"
	@echo "   make compare CANDIDATE=www.prod.staging BASELINE=www.prod.prod BY=ops@company.com"
	@echo "   make api-health              Query /api/v1/health from running server or CloudFront"
	@echo ""
	@echo " [4] USER ADMINISTRATION, PASSWORD RESET & TRACKING STATS (HEADLESS CLI & API)"
	@echo "   make user-list               List all users, roles, status & activity metrics"
	@echo "   make user-add EMAIL=ops@company.com PASSWORD=StrongPass#2026 NAME=\"Jane Ops\" ROLE=\"Staff SRE\""
	@echo "   make user-reset-password EMAIL=ops@company.com NEW_PASSWORD=ResetPass#2026"
	@echo "   make user-disable EMAIL=ops@company.com"
	@echo "   make user-enable EMAIL=ops@company.com"
	@echo "   make user-delete EMAIL=ops@company.com"
	@echo "   make user-auth EMAIL=ops@company.com PASSWORD=ResetPass#2026"
	@echo "   make user-stats [EMAIL=...]  Show user tracking stats & audit log"
	@echo "   make user-audit [EMAIL=...]  Show chronological user audit trail"
	@echo "=========================================================================================="

# ----------------------------------------------------------------------------
# 1. BUILD, TDD & VERIFICATION
# ----------------------------------------------------------------------------
install:
	npm install

dev:
	npm run dev

build:
	npm run build

test:
	npx --yes tsx --test src/engine/rules.test.ts

lint:
	npm run lint

verify: test lint build
	node --check aws-synthetics/canary-har-runner.js
	node --check aws-lambda/control-plane-handler.js
	node --check aws-lambda/adhoc-edge-runner.js
	@echo "[VERIFY OK] All unit tests, TypeScript checks, Vite build, and AWS Lambda/Canary handlers passed."

# ----------------------------------------------------------------------------
# 2. AWS TERRAFORM & CLOUDFRONT + SCALE-TO-ZERO LAMBDA DEPLOYMENT
# ----------------------------------------------------------------------------
tf-init:
	cd $(TF_DIR) && terraform init

tf-validate:
	cd $(TF_DIR) && terraform validate

tf-plan:
	cd $(TF_DIR) && terraform plan -out=tfplan

tf-apply:
	cd $(TF_DIR) && terraform apply -auto-approve

tf-destroy:
	cd $(TF_DIR) && terraform destroy -auto-approve

sync-ui: build
	@BUCKET=$$(cd $(TF_DIR) && terraform output -raw s3_artifact_bucket_name 2>/dev/null || echo "$(S3_BUCKET)"); \
	echo "Syncing dist/ to s3://$$BUCKET/portal-ui/ ..."; \
	aws s3 sync dist/ "s3://$$BUCKET/portal-ui/" --delete --region $(AWS_REGION)

invalidate-cloudfront:
	@DIST_ID=$$(cd $(TF_DIR) && terraform output -raw cloudfront_distribution_id 2>/dev/null || echo "$(CF_DIST_ID)"); \
	if [ -n "$$DIST_ID" ] && [ "$$DIST_ID" != "disabled" ]; then \
		echo "Creating CloudFront invalidation on distribution $$DIST_ID ..."; \
		aws cloudfront create-invalidation --distribution-id "$$DIST_ID" --paths "/*"; \
	else \
		echo "No active CloudFront distribution ID found; skipping invalidation."; \
	fi

deploy-cloudfront: build tf-init tf-validate tf-apply sync-ui invalidate-cloudfront
	@CF_URL=$$(cd $(TF_DIR) && terraform output -raw cloudfront_portal_url 2>/dev/null || echo ""); \
	echo "================================================================================"; \
	echo " CloudFront + Scale-to-Zero AWS Lambda Deployment Complete!"; \
	echo " Portal URL: $$CF_URL"; \
	echo "================================================================================"

# ----------------------------------------------------------------------------
# 3. AD-HOC SYNTHETIC EXECUTION & 3-DIM RELEASE GATE (CLI)
# ----------------------------------------------------------------------------
run-adhoc:
	npx --yes tsx scripts/user-admin-cli.ts run-adhoc --target="$(TARGET)" --by="$(BY)"

compare:
	npx --yes tsx scripts/user-admin-cli.ts compare --candidate="$(CANDIDATE)" --baseline="$(BASELINE)" --by="$(BY)"

api-health:
	curl -sS "$(API_URL)/api/v1/health" | npx --yes tsx -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.stringify(JSON.parse(d),null,2)))"

# ----------------------------------------------------------------------------
# 4. USER ADMINISTRATION, PASSWORD RESET & TRACKING STATS (CLI-ONLY, NO UI)
# ----------------------------------------------------------------------------
user-list:
	npx --yes tsx scripts/user-admin-cli.ts list

user-add:
	npx --yes tsx scripts/user-admin-cli.ts add \
		--email="$(EMAIL)" \
		--password="$(PASSWORD)" \
		--name="$(NAME)" \
		--role="$(ROLE)" \
		--account="$(ACCOUNT)" \
		--by="$(BY)"

user-reset-password:
	npx --yes tsx scripts/user-admin-cli.ts reset-password \
		--email="$(EMAIL)" \
		--new-password="$(NEW_PASSWORD)$(PASSWORD)" \
		--by="$(BY)"

user-disable:
	npx --yes tsx scripts/user-admin-cli.ts status --email="$(EMAIL)" --status="disabled" --by="$(BY)"

user-enable:
	npx --yes tsx scripts/user-admin-cli.ts status --email="$(EMAIL)" --status="active" --by="$(BY)"

user-delete:
	npx --yes tsx scripts/user-admin-cli.ts delete --email="$(EMAIL)" --by="$(BY)"

user-auth:
	npx --yes tsx scripts/user-admin-cli.ts auth --email="$(EMAIL)" --password="$(PASSWORD)"

user-stats:
	npx --yes tsx scripts/user-admin-cli.ts stats --email="$(EMAIL)"

user-audit:
	npx --yes tsx scripts/user-admin-cli.ts audit --email="$(EMAIL)"
