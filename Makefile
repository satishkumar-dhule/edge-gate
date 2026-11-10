# ============================================================================
# MAKEFILE — SALESFORCE EDGE & AWS SYNTHETICS 3-DIMENSIONAL RELEASE GATE
# ============================================================================
# Single-Command Full Pipeline (`make` or `make all` or `make deploy`):
#   1. npm install + unit tests (node:test) + TypeScript lint + Vite SPA build (dist/)
#   2. 100% Scale-to-Zero Terraform IaC (`terraform init`, `validate`, `apply -auto-approve`)
#      automatically loading `.env` AWS credentials and uploading `dist/` SPA bundle
#      into `s3://salesforce-akamai-synthetics-<account>-us-east-1/portal-ui/`
#   3. Ad-Hoc Synthetic Edge Execution & 3-Dim Release Gate Comparison via CLI
#   4. Headless User Administration, Password Reset & Activity Tracking (CLI + API)
# ============================================================================

SHELL := /bin/bash
AWS_REGION ?= us-east-1
TF_DIR := infra/terraform
S3_BUCKET ?= salesforce-akamai-synthetics-030771555103-us-east-1
CF_DIST_ID ?= $(shell cd $(TF_DIR) && /tmp/bin/terraform output -raw cloudfront_distribution_id 2>/dev/null || echo "")
API_URL ?= http://localhost:3000
TARGET ?= www.prod.staging
CANDIDATE ?= www.prod.staging
BASELINE ?= www.prod.prod
BY ?= user-wbbmbfobdqdu@salesforce.com

.DEFAULT_GOAL := all

.PHONY: all deploy deploy-all help install dev build test lint verify verify-bundle \
        tf-init tf-validate tf-plan tf-apply tf-destroy \
        sync-ui invalidate-cloudfront deploy-cloudfront \
        run-adhoc compare api-health \
        user-list user-add user-reset-password user-disable user-enable user-delete user-auth user-stats user-audit

# Default `make` target: runs full npm install + test + lint + build + terraform apply + S3 SPA sync
all: deploy-all

deploy: deploy-all

deploy-all:
	npx --yes tsx scripts/deploy-aws-portal.ts deploy-all

help:
	@echo "=========================================================================================="
	@echo " Salesforce Edge & AWS Synthetics Release Gate — Make CLI Targets"
	@echo "=========================================================================================="
	@echo ""
	@echo " [0] ONE-COMMAND FULL PIPELINE (NPM + BUILD + TERRAFORM APPLY + S3/CLOUDFRONT PORTAL)"
	@echo "   make                         Run full pipeline: install + test + lint + build + tf-apply + sync-ui"
	@echo "   make all                     Alias for full end-to-end npm + terraform apply deployment"
	@echo "   make deploy                  Alias for full end-to-end npm + terraform apply deployment"
	@echo ""
	@echo " [1] BUILD, TDD & VERIFICATION"
	@echo "   make install                 Install npm dependencies"
	@echo "   make dev                     Start local Express + Vite + MCP server on port 3000"
	@echo "   make build                   Build production SPA bundle into dist/ and verify index.html + assets"
	@echo "   make verify-bundle           Verify compiled dist/ SPA bundle integrity & S3 MIME mappings"
	@echo "   make test                    Run all unit tests (src/engine/rules.test.ts)"
	@echo "   make lint                    Run TypeScript strict type-checking (tsc --noEmit)"
	@echo "   make verify                  Run test + lint + build + Lambda/Canary syntax checks"
	@echo ""
	@echo " [2] AWS TERRAFORM & CLOUDFRONT + SCALE-TO-ZERO LAMBDA DEPLOYMENT"
	@echo "   make tf-init                 Initialize Terraform providers in $(TF_DIR) (loads .env)"
	@echo "   make tf-validate             Validate Terraform HCL configuration"
	@echo "   make tf-plan                 Build SPA and generate Terraform execution plan (loads .env)"
	@echo "   make tf-apply                Build SPA and apply CloudFront, S3 SPA bundle, SSM, DynamoDB & Lambdas"
	@echo "   make sync-ui                 Build dist/ and sync SPA to S3 CloudFront origin (/portal-ui/)"
	@echo "   make invalidate-cloudfront   Invalidate CloudFront Distribution cache (/*)"
	@echo "   make deploy-cloudfront       Full pipeline: build + tf-apply + sync-ui + invalidate-cloudfront"
	@echo ""
	@echo " [3] AD-HOC SYNTHETIC EXECUTION & 3-DIM RELEASE GATE (CLI)"
	@echo "   make run-adhoc TARGET=www.prod.staging BY=user-zyjydpqcvgpx@salesforce.com"
	@echo "   make compare CANDIDATE=www.prod.staging BASELINE=www.prod.prod BY=user-zyjydpqcvgpx@salesforce.com"
	@echo "   make api-health              Query /api/v1/health from running server or CloudFront"
	@echo ""
	@echo " [4] USER ADMINISTRATION, PASSWORD RESET & TRACKING STATS (HEADLESS CLI & API)"
	@echo "   make user-list               List all users, roles, status & activity metrics"
	@echo "   make user-add EMAIL=ops@salesforce.com PASSWORD=StrongPass#2026 NAME=\"Jane Ops\" ROLE=\"Staff SRE\""
	@echo "   make user-reset-password EMAIL=ops@salesforce.com NEW_PASSWORD=ResetPass#2026"
	@echo "   make user-disable EMAIL=ops@salesforce.com"
	@echo "   make user-enable EMAIL=ops@salesforce.com"
	@echo "   make user-delete EMAIL=ops@salesforce.com"
	@echo "   make user-auth EMAIL=ops@salesforce.com PASSWORD=ResetPass#2026"
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
	npx --yes tsx scripts/deploy-aws-portal.ts build

verify-bundle:
	npx --yes tsx scripts/deploy-aws-portal.ts verify-bundle

test:
	npx --yes tsx --test src/engine/rules.test.ts

lint:
	npm run lint

verify: test lint build
	node --check aws-synthetics/canary-har-runner.js
	node --check aws-lambda/control-plane-handler.js
	node --check aws-lambda/adhoc-edge-runner.js
	@echo "[VERIFY OK] All unit tests, TypeScript checks, Vite SPA bundle, and AWS Lambda/Canary handlers passed."

# ----------------------------------------------------------------------------
# 2. AWS TERRAFORM & CLOUDFRONT + SCALE-TO-ZERO LAMBDA DEPLOYMENT
# ----------------------------------------------------------------------------
tf-init:
	npx --yes tsx scripts/deploy-aws-portal.ts tf-init

tf-validate:
	npx --yes tsx scripts/deploy-aws-portal.ts tf-validate

tf-plan:
	npx --yes tsx scripts/deploy-aws-portal.ts tf-plan

tf-apply:
	npx --yes tsx scripts/deploy-aws-portal.ts tf-apply

tf-destroy:
	cd $(TF_DIR) && terraform destroy -auto-approve

sync-ui:
	npx --yes tsx scripts/deploy-aws-portal.ts sync-ui

invalidate-cloudfront:
	npx --yes tsx scripts/deploy-aws-portal.ts invalidate-cloudfront

test-e2e:
	npx --yes tsx scripts/verify-cloudfront-e2e.ts

verify-cloudfront: test-e2e

deploy-cloudfront: deploy-all
	@echo "================================================================================"
	@echo " CloudFront + Scale-to-Zero AWS Lambda + S3 SPA Portal + E2E Suite Complete!"
	@echo "================================================================================"

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
