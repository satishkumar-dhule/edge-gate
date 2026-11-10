# Akamai Synthetic Release Gate & MCP Control Plane — System Design & Architecture

> **Production-Ready Reference Architecture & Deployable Template**  
> **Runtime Stack:** React 19 · TypeScript · Tailwind CSS · Express (`server.ts`) · OpenAPI 3.1.0 · MCP JSON-RPC 2.0  
> **AWS Cloud Stack:** Terraform (`>= 1.5`) · AWS CloudWatch Synthetics (`syn-nodejs-puppeteer-9.1` / `syn-playwright-chromium-v2.4`) · Amazon S3 · Amazon DynamoDB · Amazon Bedrock Nova Lite (`amazon.nova-lite-v1:0`) · Amazon ECR & AWS App Runner

---

## 1. Executive Summary & System Purpose

The **Akamai Synthetic Release Gate & MCP Control Plane** is a full-stack observability, release verification, and synthetic testing platform designed to validate CDN edge configuration changes before and after activation across **Akamai Staging (`.edgekey-staging.net`)** and **Akamai Production (`.edgekey.net`)** networks.

### Core Release Engineering Problems Solved
1. **Pre-Promotion Edge Verification (Staging vs. Production Gate):** Validates candidate Akamai property rules on `.edgekey-staging.net` (`23.56.128.45`) against live `.edgekey.net` (`104.96.22.11`) using DNS IP pinning (`--host-resolver-rules` / `curl --resolve`) before promoting changes to production.
2. **Default Run-over-Run Regression Detection (`Latest Run` vs. `Previous Run`):** Every new synthetic canary execution on a target automatically compares against the immediately preceding run on that same target to surface regressions introduced by recent deployments.
3. **3-Dimension Comparative Inspection:** Evaluates every test case across **Functional HTTP Headers**, **`Set-Cookie` Jars**, and **Multimodal AI Visual DOM Diffs** powered by **Amazon Bedrock Nova Lite (`amazon.nova-lite-v1:0`)**.
4. **Enterprise Fleet Scalability (8 to 50+ Properties):** Condenses navigation and telemetry to scale cleanly from a single property to 50+ global properties (`www`, `store`, `help`, `checkout`, `api`, `auth`, `docs`, `status`, and regional properties) with searchable top-bar switching, 1-click cell-to-inspector deep linking, and persistent browser/remote state.
5. **Dual Execution Mode (Zero-Config Local Seed + Live AWS Production):** Runs out-of-the-box locally with deterministic seed data and transitions seamlessly to live AWS CloudWatch Synthetics, S3, DynamoDB, and Amazon Bedrock Nova Lite when deployed via `terraform apply`.

---

## 2. High-Level System Architecture & Data Flow

```text
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│                        SINGLE SOURCE OF TRUTH: src/config/template.config.ts                    │
│     Properties (www, store, help, ...) × Envs (prod, uat) × Edge Networks (staging, prod)       │
└───────────────────────────────┬─────────────────────────────────────────┬───────────────────────┘
                                │                                         │
                                ▼                                         ▼
┌───────────────────────────────────────────────────────┐ ┌───────────────────────────────────────┐
│        TERRAFORM AWS INFRASTRUCTURE (infra/terraform) │ │   EXPRESS OPENAPI 3.1 & MCP SERVER    │
│  • data.archive_file.canary_zip (packages runner.js)  │ │              (server.ts)              │
│  • aws_s3_bucket + aws_s3_object.canary_bundle        │ │  • GET  /api/v1/openapi.json (OAS 3.1)│
│  • aws_dynamodb_table (PK: target, SK: runKey + GSI)  │ │  • GET  /api/v1/health & /config      │
│  • aws_iam_role (Synthetics + S3 + DDB + Bedrock)     │ │  • GET  /api/v1/runs & /properties    │
│  • aws_synthetics_canary (Property × Env × Network)   │ │  • POST /api/v1/runs/trigger          │
│  • aws_ecr_repository + aws_apprunner_service         │ │  • POST /api/v1/comparisons/evaluate  │
└───────────────────────────────┬───────────────────────┘ │  • POST /api/v1/judge/nova-lite       │
                                │                         │  • POST /api/v1/mcp/rpc (JSON-RPC 2.0)│
                                ▼                         └───────────────────┬───────────────────┘
┌───────────────────────────────────────────────────────┐                     │
│   AWS CLOUDWATCH SYNTHETICS CANARY RUNNER             │                     │
│   (aws-synthetics/canary-har-runner.js)               │                     │
│  1. Chromium --host-resolver-rules=MAP <host> <edgeIp>│                     │
│  2. Injects Akamai Pragma debug headers               │                     │
│  3. Captures Status, Headers, Set-Cookie & 1440x900   │                     │
│  4. Writes manifest.json to S3 + item to DynamoDB     │                     │
└───────────────────────────────┬───────────────────────┘                     │
                                │                                             │
                                ▼                                             ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│             3-DIMENSION RELEASE GATE ENGINE & AMAZON BEDROCK NOVA LITE JUDGE                    │
│  • Dimension 1 (Headers): HTTP status, TTL-normalized Cache-Control, x-check-cacheable, Location│
│  • Dimension 2 (Cookies): Unprefixed Set-Cookie attribute diffing + Accepted Cookie Baselines   │
│  • Dimension 3 (Visual AI): Pixel-zero cost gate (<0.1%) -> AWS Bedrock amazon.nova-lite-v1:0   │
└───────────────────────────────────────────────┬─────────────────────────────────────────────────┘
                                                │
                                                ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│                       REACT 19 CONTROL CENTER UI (src/App.tsx)                                  │
│  • Searchable 50-Property Top-Bar Switcher     • 1-Click Cell-to-Inspector Diff Matrix          │
│  • AWS Synthetics Run Telemetry & Pass Stats   • Interactive Swagger UI & Terraform IaC Viewer  │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Repository Structure & Deep Module Boundaries

The codebase follows **Deep Modules**, **Single Source of Truth (DRY)**, **KISS**, and **Test-Driven Development (TDD)** principles. Pure domain logic is strictly decoupled from I/O and React view components.

```text
├── ARCHITECTURE.md                         # Comprehensive system design & architecture guide
├── Dockerfile                              # Multi-stage Node 22 Alpine production container
├── .env.example                            # Environment & edge network configuration template
├── server.ts                               # Full-stack Express OpenAPI 3.1, MCP & Vite server
├── scripts/
│   └── deploy-aws.sh                       # 1-command Terraform apply + optional ECR/App Runner deploy
├── infra/
│   └── terraform/
│       ├── main.tf                         # S3, Archive ZIP, DynamoDB, IAM, Canaries, ECR & App Runner
│       ├── variables.tf                    # Configurable AWS region, networks, Bedrock model & properties
│       ├── outputs.tf                      # Provisioned ARNs, bucket names, canary map & service URLs
│       └── terraform.tfvars.example        # Sample variable overrides for staging/prod deployments
├── aws-synthetics/
│   ├── canary-har-runner.js                # CloudWatch Synthetics Puppeteer/Chromium edge runner
│   └── bedrock-nova-lite-judge.ts          # Amazon Bedrock Nova Lite (amazon.nova-lite-v1:0) judge
└── src/
    ├── config/
    │   └── template.config.ts              # Single source of truth for topology, networks & AWS config
    ├── engine/
    │   ├── types.ts                        # Domain data structures (RunRecord, ComparisonReport, etc.)
    │   ├── rules.ts                        # Pure 3-dimension diff, normalization & verdict engine
    │   ├── awsBlueprint.ts                 # Pure OpenAPI 3.1, Terraform HCL, Canary & Nova Lite generators
    │   └── rules.test.ts                   # 18 automated unit tests (node:test) covering all engines
    ├── adapters/
    │   └── syntheticsAdapter.ts            # localStorage persistence, remote-api client & 50-prop scaler
    ├── data/
    │   └── mockStore.ts                    # Deterministic seed generator for Latest & Previous runs
    └── components/
        ├── ControlCenterViews.tsx          # Swagger UI, Terraform IaC viewer, Test Suites, Settings & About
        └── TestInspector.tsx               # Reusable 3-dimension Diff & Single-Run Inspector
```

---

## 4. Deep Dive: Core Engines & Algorithms

### 4.1 Edge Network DNS Resolution & Pragma Injection
When validating an Akamai configuration on Staging before promoting to Production, the canonical hostname (e.g., `www.company.com` or `uat-www.company.com`) must remain intact for TLS SNI and Akamai Host header matching, while the underlying TCP connection is routed to the target Edge IP:
- **Akamai Staging Network (`.edgekey-staging.net`):** Default Edge IP `23.56.128.45`
- **Akamai Production Network (`.edgekey.net`):** Default Edge IP `104.96.22.11`
- **CloudWatch Synthetics Mechanism:** Configures Chromium launch options with `--host-resolver-rules=MAP ${hostname} ${edgeIp}` and injects Akamai Pragma headers:
  ```http
  Pragma: akamai-x-cache-on, akamai-x-cache-remote-on, akamai-x-check-cacheable, akamai-x-get-cache-key, akamai-x-get-true-cache-key, akamai-x-get-request-id
  ```
- **Local CLI Reproduction (`generateReproduceCurl`):** Every test result generates a zero-secret `curl` command using `--resolve "<host>:443:<edgeIp>"` so engineers can reproduce edge behavior in seconds.

### 4.2 Three-Dimension Comparison & Verdict Engine (`src/engine/rules.ts`)

| Dimension | Evaluated Artifacts | Normalization & Noise Reduction Rules | Severity & Acceptance |
| :--- | :--- | :--- | :--- |
| **1. Functional Headers** | `http-status`, `location`, `cache-control`, `x-check-cacheable`, `content-type`, `x-cache`, `x-sfdc-content-source` | • `Cache-Control`: Positive `max-age` / `s-maxage` values normalize to `max-age=N` so minor TTL countdowns do not trigger false alarms.<br>• `Location`: Cross-environment redirects map back to canonical hostnames (`mapToCanonicalUrl`).<br>• Ephemeral request IDs (`x-akamai-request-id`) are excluded. | • Status mismatch (`200` vs `500`) = `critical`<br>• Header mismatch = `minor` / `major`<br>• Operators can click **Accept Diff** to create an `AcceptedRule`. |
| **2. Edge & Session Cookies** | `Set-Cookie` response headers (`edge_region`, `edge_cache_bypass`, `ak_bmsc`, `session_tier`) | • Cookie keys are normalized without prefixes (`normalizeCookieKey`).<br>• Compares value, `Path`, `SameSite`, `Secure`, and `HttpOnly` attributes. | • Clicking **Accept Cookie** adds the cookie name to `acceptedCookies`.<br>• When all cookie diffs on a test are accepted, the table badge transitions from count `2` to green `OK`. |
| **3. Visual Image AI (`amazon.nova-lite-v1:0`)** | $1440 \times 900$ full-viewport PNG screenshots stored in S3 | • **Cost Gate (`pixel-zero`):** If pixel delta is $\le 0.1\%$, AI invocation is skipped and verdict is immediately `same`.<br>• **AI Judge (`ai-judged`):** Invokes **Amazon Bedrock Nova Lite (`amazon.nova-lite-v1:0`)** via `ConverseCommand` to distinguish benign anti-aliasing from structural layout shifts. | • Benign rendering noise = `same`<br>• Spacing/contrast shift (e.g., `T03` 14px hero offset) = `minor`<br>• Missing/broken layout = `different`<br>• Supports **Accept Visual Diff**. |

### 4.3 Headline Release Gate Verdict Matrix (`calculateHeadlineVerdict`)
- **`NO-GO`**: Any unaccepted functional header or status difference on a Network comparison (`Staging` vs `Production`), or any `different` visual verdict.
- **`REVIEW`**: Any candidate test failing (`pass === false`) even if both sides fail identically ("Red on both sides is never GO"), or unaccepted `minor` visual/cookie diffs on a Network comparison.
- **`PARTIAL`**: Subset/filtered comparisons that do not evaluate the full test suite.
- **`GO`**: All tests pass on the candidate target and all functional/cookie/visual dimensions match (or have been explicitly accepted with **Ignore Accepted** enabled).

### 4.4 Environmental Anomaly Clustering (`groupFailureSignatures`)
When an upstream origin outage or WAF block occurs (e.g., $>50\%$ of tests in a run fail with the same normalized signature such as `HTTP N Forbidden: WAF blocked request id "<STR>"`), `groupFailureSignatures()` automatically flags `looksEnvironmental: true` so operators immediately recognize an environmental block rather than debugging individual pages.

---

## 5. AWS Terraform IaC Architecture (`infra/terraform/`)

The Terraform configuration in `infra/terraform/` is engineered so a freshly cloned repository can be deployed with zero manual pre-steps (`terraform init && terraform apply`).

### Provisioned AWS Resources
1. **`aws_s3_bucket.synthetics_artifacts`** (+ `versioning`, `server_side_encryption_configuration`, `public_access_block`):
   - Bucket name automatically suffixed with `${account_id}-${aws_region}` via `data.aws_caller_identity.current` to prevent global S3 naming collisions.
   - Stores Canary ZIP bundles (`canary-code/canary-har-runner.zip`), per-run manifests (`runs/<target>/<runKey>/manifest.json`), and $1440 \times 900$ PNG screenshots.
2. **`data.archive_file.canary_zip` & `aws_s3_object.canary_bundle`**:
   - Automatically packages `aws-synthetics/canary-har-runner.js` into the exact internal archive path required by AWS CloudWatch Synthetics (`nodejs/node_modules/canary-har-runner.js`) and uploads it to S3 with content-hash versioning before Canaries are created.
3. **`aws_dynamodb_table.release_gate_runs`**:
   - `PAY_PER_REQUEST` billing mode with Partition Key `target` (`S`), Sort Key `runKey` (`S`), Global Secondary Index `AppIdIndex` (`appId` + `runKey`), and Point-in-Time Recovery enabled.
4. **`aws_iam_role.synthetics_canary_role` & `aws_iam_role_policy.synthetics_bedrock_s3_policy`**:
   - Least-privilege execution role assumable by `synthetics.amazonaws.com`, `lambda.amazonaws.com`, and `tasks.apprunner.amazonaws.com`.
   - Grants read/write access to the S3 artifact bucket, DynamoDB run store, CloudWatch Logs/Metrics, and `bedrock:InvokeModel` / `bedrock:Converse` on `arn:aws:bedrock:${var.aws_region}::foundation-model/amazon.nova-lite-v1:0`.
5. **`aws_synthetics_canary.property_gate` (`for_each` Matrix — Ad-Hoc Run-Once Mode)**:
   - Dynamically flattens `var.properties × envs × ["staging", "prod"]`.
   - Configured with `schedule { expression = "rate(0 minutes)" }` and `start_canary = false` so canaries incur **$0.00/month** when idle and execute only on demand via `StartCanary`.
   - Sanitizes Canary names to obey CloudWatch Synthetics' strict 21-character `^[0-9a-z_\-]+$` constraint without trailing hyphens (`akg-<app>-<env>-<stg|prd>`).
   - Injects environment variables (`TARGET_ID`, `EDGE_RESOLVE_IP`, `EDGE_HOST_SUFFIX`, `AKAMAI_PRAGMA_HEADERS`, `S3_ARTIFACT_BUCKET`, `DYNAMODB_RUNS_TABLE`, `BEDROCK_NOVA_LITE_MODEL_ID`).
6. **`aws_lambda_function.control_plane_api`, `aws_lambda_function.adhoc_edge_runner` & `aws_apigatewayv2_api.control_plane_http_api` ($0/Idle Scale-to-Zero Compute)**:
   - Provisions ARM64 Graviton2 Node.js 20 Lambda functions (`aws-lambda/control-plane-handler.js` and `aws-lambda/adhoc-edge-runner.js`) fronted by an Amazon API Gateway v2 HTTP API (`$default` stage) and direct Lambda Function URL.
7. **`aws_cloudfront_distribution.portal_cdn` & `aws_cloudfront_origin_access_control.portal_oac` (Global CloudFront Edge Distribution)**:
   - Deploys the entire application as an **Amazon CloudFront Distribution** (`http2and3`, `PriceClass_100`):
     - **Default Origin (`/*`)**: Serves the compiled Vite React SPA from S3 (`/portal-ui`) secured via SigV4 Origin Access Control (`aws_cloudfront_origin_access_control.portal_oac` + `aws_s3_bucket_policy.allow_cloudfront_oac`), with SPA fallback routing (`403`/`404` -> `/index.html`).
     - **Ordered API Origin (`/api/*`)**: Routes all `/api/v1/*` and `/api/synthetics/*` requests (`GET, POST, PUT, PATCH, DELETE, OPTIONS`) directly to the Scale-to-Zero API Gateway v2 HTTP API / Control Plane Lambda with `min_ttl = 0`, `default_ttl = 0`, `max_ttl = 0` and `Authorization`, `Content-Type`, and `X-Operator-Email` headers forwarded.

---

## 6. OpenAPI 3.1.0, Headless User API & Model Context Protocol (MCP) Specification

The Express backend (`server.ts`) and AWS Lambda handler (`aws-lambda/control-plane-handler.js`) serve both the interactive web application and a versioned REST + Headless User Management/Tracking + MCP API. The live OpenAPI 3.1.0 document is available at `GET /api/v1/openapi.json`.

### 6.1 REST API Endpoints
| Method | Path | Tag | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/openapi.json` | `System & Config` | Returns the complete OpenAPI 3.1.0 JSON specification. |
| `GET` | `/api/v1/health` | `System & Config` | Returns Control Plane health, CloudFront + Lambda topology, AWS region, S3 bucket, DynamoDB table, Staging/Prod edge IPs, user summary counters, and Bedrock Nova Lite model status. |
| `GET` | `/api/v1/config` | `System & Config` | Returns active `TemplateConfig` (networks, infrastructure, pragma headers, and test suite). |
| `GET` | `/api/v1/properties` | `System & Config` | Lists all configured Akamai properties (`www`, `store`, `help`, etc.) and environments. |
| `GET` | `/api/v1/runs` | `AWS Synthetics Runs` | Queries ingested synthetic runs with optional `?appId=`, `?target=`, or `?network=` filters. |
| `POST` | `/api/v1/runs/trigger` | `AWS Synthetics Runs` | Triggers a new synthetic run on `targetId`, automatically computes a Run-over-Run comparison against the previous run, and records operator activity telemetry. |
| `POST` | `/api/v1/comparisons/evaluate` | `3-Dim Release Gate` | Evaluates 3-dimension diffs (`headers`, `cookies`, `image_ai`) and headline verdict (`GO` / `NO-GO` / `REVIEW`) between `candidateTarget` and `baselineTarget` and tracks operator usage. |
| `POST` | `/api/v1/judge/nova-lite` | `Bedrock Nova Lite Judge` | Invokes Amazon Bedrock Nova Lite (`amazon.nova-lite-v1:0`) visual regression evaluation behind the `0.1%` pixel-diff cost gate. |
| `POST` | `/api/v1/mcp/rpc` | `MCP JSON-RPC` | Model Context Protocol JSON-RPC 2.0 endpoint for IDE agents and CI/CD pipelines. |
| `GET` | `/api/v1/users` | `User Management & Tracking (CLI)` | Headless CLI/API endpoint listing all registered operators, roles, statuses, and activity counters (no password hashes exposed). |
| `POST` | `/api/v1/users` | `User Management & Tracking (CLI)` | Headless CLI/API endpoint creating a new user with PBKDF2-HMAC-SHA256 salted password hashing (`make user-add`). |
| `POST` | `/api/v1/users/reset-password` | `User Management & Tracking (CLI)` | Headless CLI/API endpoint rotating a user's password with a fresh cryptographic salt and incrementing `passwordResetCount` (`make user-reset-password`). |
| `POST` | `/api/v1/users/status` | `User Management & Tracking (CLI)` | Headless CLI/API endpoint enabling/disabling a user account or updating role (`make user-disable` / `make user-enable`). |
| `DELETE` | `/api/v1/users/:email` | `User Management & Tracking (CLI)` | Headless CLI/API endpoint deleting a user (`make user-delete`). |
| `POST` | `/api/v1/users/authenticate` | `User Management & Tracking (CLI)` | Verifies operator credentials, issues a session token, and increments login telemetry (`make user-auth`). |
| `GET` | `/api/v1/users/stats` | `User Management & Tracking (CLI)` | Returns aggregated user activity tracking telemetry (runs triggered, comparisons evaluated, Bedrock Nova Lite judge calls, MCP calls, password resets) and the audit log (`make user-stats`). |

### 6.2 MCP Server Tools (`POST /api/v1/mcp/rpc`)
- **`evaluate_visual_diff_nova_lite`**: Invokes `amazon.nova-lite-v1:0` on Side-A vs Side-B S3 DOM snapshots and returns semantic verdict, confidence score, and localized bounding-box descriptions.
- **`compare_akamai_runs`**: Computes the 3-dimension diff report between any two targets or run keys.
- **`run_aws_synthetics_suite`**: Dispatches an AWS CloudWatch Synthetics Canary or Ad-Hoc Lambda run with DNS edge pinning and Pragma headers.
- **`list_akamai_properties`**: Lists all configured properties, environments, and Staging/Prod targets.
- **`get_user_stats`**: Returns headless operator activity statistics and recent audit trail events.

---

## 7. Makefile, CLI User Management & CloudFront Deployment Runbook

All operational workflows — including building, testing, deploying the **CloudFront Distribution + Scale-to-Zero AWS Lambda stack**, running ad-hoc synthetics, and managing users/passwords/stats (headlessly via CLI & API with zero UI screens) — are standardized in the root `Makefile` and `scripts/user-admin-cli.ts`.

### 7.1 Build, Test & Verify
```bash
# Run all 21 TDD unit tests + TypeScript lint + production Vite SPA build
make verify
# Or via pnpm:
pnpm test && pnpm run lint && pnpm run build
```

### 7.2 Deploy CloudFront Distribution + Scale-to-Zero Lambda on AWS
```bash
# Full end-to-end deployment:
# 1. Builds Vite SPA (dist/)
# 2. Runs terraform apply (S3 + OAC + CloudFront Distribution + Scale-to-Zero Lambda + API Gateway v2 + DynamoDB + Run-Once Canaries)
# 3. Uploads dist/ to s3://<bucket>/portal-ui/ and invalidates CloudFront cache
make deploy-cloudfront
```

### 7.3 Headless User Management, Password Reset & Activity Tracking (CLI Only — No UI Screens)
```bash
# List all registered users & activity counters
make user-list

# Add a new operator user (PBKDF2-HMAC-SHA256 salted password hash)
make user-add EMAIL=alice.sre@company.com NAME="Alice SRE" ROLE="Staff Edge SRE" PASSWORD="StrongPassword#2026!"

# Reset a user's password
make user-reset-password EMAIL=alice.sre@company.com NEW_PASSWORD="RotatedPassword#2026!"

# Authenticate user credentials via CLI
make user-auth EMAIL=alice.sre@company.com PASSWORD="RotatedPassword#2026!"

# Disable / Enable / Delete a user
make user-disable EMAIL=alice.sre@company.com
make user-enable  EMAIL=alice.sre@company.com
make user-delete  EMAIL=alice.sre@company.com

# View per-user tracking stats & audit trail
make user-stats
make user-audit EMAIL=alice.sre@company.com
```

