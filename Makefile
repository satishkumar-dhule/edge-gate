# ============================================================================
# MAKEFILE — SALESFORCE EDGE & AWS SYNTHETICS 3-DIMENSIONAL RELEASE GATE
# ============================================================================
# Single-Command Full Pipeline (`make`, `make all`, `make deploy`, `make deply`):
#   1. pnpm install + unit tests (node:test) + TypeScript lint + Vite SPA build (dist/)
#   2. 100% Scale-to-Zero Terraform IaC (`terraform init`, `validate`, `apply -auto-approve`)
#      automatically loading `.env` AWS credentials and uploading `dist/` SPA bundle
#      into `s3://salesforce-akamai-synthetics-<account>-us-east-1/portal-ui/`
#   3. Invalidate CloudFront (`/*`), verify live Portal + API, and print CloudFront URL
#   3. Ad-Hoc Synthetic Edge Execution & 3-Dim Release Gate Comparison via CLI
#   4. Headless User Administration, Password Reset & Activity Tracking (CLI + API)
# ============================================================================

SHELL := /bin/bash
AWS_REGION ?= us-east-1
TF_DIR := infra/terraform
S3_BUCKET ?= salesforce-akamai-synthetics-030771555103-us-east-1
TERRAFORM := $(shell test -x /tmp/bin/terraform && echo "/tmp/bin/terraform" || (command -v terraform >/dev/null 2>&1 && echo "terraform" || echo "/tmp/bin/terraform"))
PKG_MGR := $(shell command -v pnpm >/dev/null 2>&1 && echo "pnpm" || echo "npm")
TSX := $(shell command -v pnpm >/dev/null 2>&1 && echo "pnpm exec tsx" || (test -x ./node_modules/.bin/tsx && echo "./node_modules/.bin/tsx" || echo "npx --yes tsx"))
CF_DIST_ID ?= $(shell cd $(TF_DIR) && $(TERRAFORM) output -raw cloudfront_distribution_id 2>/dev/null || echo "")
API_URL ?= http://localhost:3000
TARGET ?= www.prod.staging
CANDIDATE ?= www.prod.staging
BASELINE ?= www.prod.prod
BY ?= user-wbbmbfobdqdu@salesforce.com

.DEFAULT_GOAL := all

.PHONY: all deploy deply deploy-all zero-token-cycle zero-token-watch help install dev build test lint verify verify-bundle \
        tf-init tf-validate tf-plan tf-apply tf-destroy \
        sync-ui sync-chromium invalidate-cloudfront deploy-cloudfront \
        run-adhoc compare api-health \
        user-list user-add user-reset-password user-disable user-enable user-delete user-auth user-stats user-audit

# Default `make` target: runs full install + test + lint + build + terraform apply + S3 SPA sync + CloudFront URL summary
all: deploy-all

deploy: deploy-all

deply: deploy-all

deploy-all:
	$(TSX) scripts/deploy-aws-portal.ts deploy-all

zero-token-cycle:
	$(TSX) scripts/zero-token-cycle.ts

zero-token-watch:
	$(TSX) scripts/zero-token-cycle.ts --watch

help:
	@echo "=========================================================================================="
	@echo " Salesforce Edge & AWS Synthetics Release Gate — Make CLI Targets"
	@echo "=========================================================================================="
	@echo ""
	@echo " [0] ONE-COMMAND FULL PIPELINE (BUILD + TERRAFORM APPLY + S3 SYNC + CLOUDFRONT URL)"
	@echo "   make                         Run full pipeline: test + lint + build + tf-apply + sync-ui + print URL"
	@echo "   make all                     Alias for full end-to-end build + terraform apply + S3 sync deployment"
	@echo "   make deploy                  Alias for full end-to-end build + terraform apply + S3 sync deployment"
	@echo "   make deply                   Alias for make deploy (syncs SPA to S3 & prints CloudFront URL)"
	@echo ""
	@echo " [1] BUILD, TDD & VERIFICATION"
	@echo "   make install                 Install dependencies ($(PKG_MGR))"
	@echo "   make dev                     Start local Express + Vite + MCP server on port 3000"
	@echo "   make build                   Build production SPA bundle into dist/ and verify index.html + assets"
	@echo "   make verify-bundle           Verify compiled dist/ SPA bundle integrity & S3 MIME mappings"
	@echo "   make test                    Run all unit tests"
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
	$(PKG_MGR) install

dev:
	$(PKG_MGR) run dev

build:
	$(TSX) scripts/deploy-aws-portal.ts build

verify-bundle:
	$(TSX) scripts/deploy-aws-portal.ts verify-bundle

test:
	$(PKG_MGR) test

lint:
	$(PKG_MGR) run lint

verify: test lint build
	node --check aws-synthetics/canary-har-runner.js
	node --check aws-lambda/control-plane-handler.js
	node --check aws-lambda/adhoc-edge-runner.js
	node --check aws-lambda/chromium-screenshot-runner.js
	node --check aws-lambda/sparticuz-screenshot-runner.mjs
	@echo "[VERIFY OK] All unit tests, TypeScript checks, Vite SPA bundle, and AWS Lambda/Canary handlers passed."

# ----------------------------------------------------------------------------
# 2. AWS TERRAFORM & CLOUDFRONT + SCALE-TO-ZERO LAMBDA DEPLOYMENT
# ----------------------------------------------------------------------------
tf-init:
	$(TSX) scripts/deploy-aws-portal.ts tf-init

tf-validate:
	$(TSX) scripts/deploy-aws-portal.ts tf-validate

tf-plan:
	$(TSX) scripts/deploy-aws-portal.ts tf-plan

tf-apply:
	$(TSX) scripts/deploy-aws-portal.ts tf-apply

tf-destroy:
	cd $(TF_DIR) && $(TERRAFORM) destroy -auto-approve

sync-ui:
	$(TSX) scripts/deploy-aws-portal.ts sync-ui

sync-chromium:
	$(TSX) scripts/deploy-aws-portal.ts sync-chromium

invalidate-cloudfront:
	$(TSX) scripts/deploy-aws-portal.ts invalidate-cloudfront

test-e2e:
	$(TSX) scripts/verify-cloudfront-e2e.ts

verify-cloudfront: test-e2e

deploy-cloudfront: deploy-all
	@echo "================================================================================"
	@echo " CloudFront + Scale-to-Zero AWS Lambda + S3 SPA Portal + E2E Suite Complete!"
	@echo "================================================================================"

# ----------------------------------------------------------------------------
# 3. AD-HOC SYNTHETIC EXECUTION & 3-DIM RELEASE GATE (CLI)
# ----------------------------------------------------------------------------
run-adhoc:
	$(TSX) scripts/user-admin-cli.ts run-adhoc --target="$(TARGET)" --by="$(BY)"

compare:
	$(TSX) scripts/user-admin-cli.ts compare --candidate="$(CANDIDATE)" --baseline="$(BASELINE)" --by="$(BY)"

api-health:
	curl -sS "$(API_URL)/api/v1/health" | $(TSX) -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.stringify(JSON.parse(d),null,2)))"

# ----------------------------------------------------------------------------
# 4. USER ADMINISTRATION, PASSWORD RESET & TRACKING STATS (CLI-ONLY, NO UI)
# ----------------------------------------------------------------------------
user-list:
	$(TSX) scripts/user-admin-cli.ts list

user-add:
	$(TSX) scripts/user-admin-cli.ts add \
		--email="$(EMAIL)" \
		--password="$(PASSWORD)" \
		--name="$(NAME)" \
		--role="$(ROLE)" \
		--account="$(ACCOUNT)" \
		--by="$(BY)"

user-reset-password:
	$(TSX) scripts/user-admin-cli.ts reset-password \
		--email="$(EMAIL)" \
		--new-password="$(NEW_PASSWORD)$(PASSWORD)" \
		--by="$(BY)"

user-disable:
	$(TSX) scripts/user-admin-cli.ts status --email="$(EMAIL)" --status="disabled" --by="$(BY)"

user-enable:
	$(TSX) scripts/user-admin-cli.ts status --email="$(EMAIL)" --status="active" --by="$(BY)"

user-delete:
	$(TSX) scripts/user-admin-cli.ts delete --email="$(EMAIL)" --by="$(BY)"

user-auth:
	$(TSX) scripts/user-admin-cli.ts auth --email="$(EMAIL)" --password="$(PASSWORD)"

user-stats:
	$(TSX) scripts/user-admin-cli.ts stats --email="$(EMAIL)"

user-audit:
	$(TSX) scripts/user-admin-cli.ts audit --email="$(EMAIL)"
