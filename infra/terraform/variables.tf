# ============================================================================
# TERRAFORM VARIABLES — AKAMAI SYNTHETIC RELEASE GATE (100% CONFIG-AS-CODE)
# ============================================================================
# Every operational, network, Akamai edge, CloudWatch Synthetics, Bedrock Nova
# Lite, DynamoDB, S3, SSM, Alarm, and Control Plane setting is controlled here.
# ============================================================================

# ----------------------------------------------------------------------------
# 1. AWS CORE, ENVIRONMENT & TAGGING
# ----------------------------------------------------------------------------
variable "aws_region" {
  type        = string
  default     = "us-east-1"
  description = "AWS region for CloudWatch Synthetics, S3, DynamoDB, SSM, App Runner, and Bedrock Nova Lite"
}

variable "environment" {
  type        = string
  default     = "prod"
  description = "Deployment stage identifier (e.g., dev, stage, prod)"
}

variable "project_name" {
  type        = string
  default     = "salesforce-edge-release-gate"
  description = "Canonical project name used across IAM, S3, DynamoDB, SSM, ECR, and CloudWatch resources"
}

variable "operator_email" {
  type        = string
  default     = "user-baluuezlosgz@salesforce.com"
  description = "Default Principal Edge SRE operator identity seeded into Control Plane config"
}

variable "operator_role" {
  type        = string
  default     = "Lead Edge Release Engineer"
  description = "Default operator role seeded into Control Plane config"
}

variable "akamai_account_context" {
  type        = string
  default     = "SFDC-EDGE-373211957869 (AWS 373211957869 · Akamai Prod + Staging)"
  description = "Akamai Control Center account context identifier"
}

variable "default_tags" {
  type = map(string)
  default = {
    Project      = "salesforce-edge-release-gate"
    ManagedBy    = "terraform"
    ControlPlane = "salesforce-edge-synthetics-mcp"
  }
  description = "Base tags applied to all provisioned AWS resources"
}

# ----------------------------------------------------------------------------
# 2. S3 ARTIFACT BUCKET & LIFECYCLE POLICY
# ----------------------------------------------------------------------------
variable "s3_artifact_bucket" {
  type        = string
  default     = "salesforce-akamai-synthetics"
  description = "Base name for S3 bucket storing HARs, headers, cookies, screenshots, and suite configs (account ID & region are suffixed automatically)"
}

variable "s3_force_destroy" {
  type        = bool
  default     = true
  description = "Allow terraform destroy to clean up synthetic artifacts in the S3 bucket"
}

variable "artifact_retention_days" {
  type        = number
  default     = 90
  description = "Number of days to retain synthetic run screenshots, HARs, and manifests in S3 before expiration"
}

variable "noncurrent_version_retention_days" {
  type        = number
  default     = 30
  description = "Number of days to retain noncurrent S3 object versions"
}

# ----------------------------------------------------------------------------
# 3. DYNAMODB TABLE & STATE SEEDING
# ----------------------------------------------------------------------------
variable "dynamodb_table_name" {
  type        = string
  default     = "salesforce-synthetics-gate-state"
  description = "DynamoDB table storing run metadata, comparison verdicts, and accepted diff rules"
}

variable "dynamodb_billing_mode" {
  type        = string
  default     = "PAY_PER_REQUEST"
  description = "DynamoDB billing mode (PAY_PER_REQUEST or PROVISIONED)"
}

variable "enable_point_in_time_recovery" {
  type        = bool
  default     = true
  description = "Enable DynamoDB Point-in-Time Recovery (PITR)"
}

variable "seed_accepted_rules_in_dynamodb" {
  type        = bool
  default     = true
  description = "Automatically seed initial accepted diff rules and baseline config items into DynamoDB via Terraform"
}

# ----------------------------------------------------------------------------
# 4. AWS SYSTEMS MANAGER (SSM) PARAMETER STORE & LOCAL .ENV GENERATION
# ----------------------------------------------------------------------------
variable "ssm_parameter_prefix" {
  type        = string
  default     = "/akamai-release-gate"
  description = "SSM Parameter Store prefix where full JSON topology, edge IPs, and model configs are published"
}

variable "generate_local_dotenv" {
  type        = bool
  default     = true
  description = "Generate .env.terraform in the project root on terraform apply with all resolved AWS resource names and config"
}

# ----------------------------------------------------------------------------
# 5. AMAZON BEDROCK NOVA LITE AI VISUAL JUDGE CONFIGURATION
# ----------------------------------------------------------------------------
variable "bedrock_nova_lite_model_id" {
  type        = string
  default     = "amazon.nova-lite-v1:0"
  description = "Amazon Bedrock foundation model ID for multimodal visual diff evaluation (AWS Nova Lite)"
}

variable "visual_judge_provider_label" {
  type        = string
  default     = "Amazon Bedrock (AWS Nova Lite)"
  description = "Display label for the AI visual judge provider"
}

variable "visual_judge_pixel_cost_gate_pct" {
  type        = number
  default     = 0.1
  description = "Pixel delta percentage below which screenshots are marked pixel-identical without invoking Bedrock Nova Lite"
}

variable "visual_judge_minor_threshold_pct" {
  type        = number
  default     = 5.0
  description = "Pixel delta percentage threshold separating minor layout shifts from major visual regressions"
}

variable "visual_judge_temperature" {
  type        = number
  default     = 0.0
  description = "Deterministic inference temperature for Amazon Bedrock Nova Lite Converse API"
}

variable "visual_judge_max_tokens" {
  type        = number
  default     = 600
  description = "Max output tokens for Amazon Bedrock Nova Lite visual analysis JSON response"
}

# ----------------------------------------------------------------------------
# 6. AKAMAI STAGING & PRODUCTION EDGE NETWORK CONFIGURATION
# ----------------------------------------------------------------------------
variable "default_domain" {
  type        = string
  default     = "salesforce.com"
  description = "Default canonical root domain for properties"
}

variable "staging_edge_suffix" {
  type        = string
  default     = ".edgekey-staging.net"
  description = "Akamai Staging Edge hostname suffix"
}

variable "staging_edge_ip" {
  type        = string
  default     = "23.48.201.18"
  description = "Default Akamai Staging Edge IP used for DNS pinning (--host-resolver-rules / curl --resolve)"
}

variable "prod_edge_suffix" {
  type        = string
  default     = ".edgekey.net"
  description = "Akamai Production Edge hostname suffix"
}

variable "prod_edge_ip" {
  type        = string
  default     = "23.212.251.15"
  description = "Default Akamai Production Edge IP used for DNS pinning (--host-resolver-rules / curl --resolve)"
}

variable "akamai_pragma_headers" {
  type = list(string)
  default = [
    "akamai-x-cache-on",
    "akamai-x-cache-remote-on",
    "akamai-x-check-cacheable",
    "akamai-x-get-cache-key",
    "akamai-x-get-true-cache-key",
    "akamai-x-get-request-id"
  ]
  description = "Akamai Pragma debug headers injected into every synthetic check"
}

variable "canary_user_agent" {
  type        = string
  default     = "Akamai-Synthetics-Runner/2.4 (ReleaseGate; AWS-CloudWatch-Synthetics)"
  description = "User-Agent header sent by CloudWatch Synthetics Canaries and cURL reproduction commands"
}

variable "restricted_headers" {
  type        = list(string)
  default     = ["Authorization", "Cookie"]
  description = "Headers redacted from raw CloudWatch Synthetics HAR logs for security compliance"
}

# ----------------------------------------------------------------------------
# 7. AD-HOC CLOUDWATCH SYNTHETICS CANARY EXECUTION & VIEWPORT SETTINGS
# ----------------------------------------------------------------------------
variable "deploy_synthetics_canaries" {
  type        = bool
  default     = false
  description = "When false (default for scale-to-zero AWS Lambda Ad-Hoc Runner mode or AWS Organizations SCPs restricting synthetics:CreateCanary), synthetic probing runs on-demand via the Ad-Hoc Edge Runner AWS Lambda function"
}

variable "synthetics_runtime_version" {
  type        = string
  default     = "syn-nodejs-puppeteer-9.1"
  description = "AWS CloudWatch Synthetics runtime version"
}

variable "start_canaries_on_apply" {
  type        = bool
  default     = false
  description = "Keep false for Ad-Hoc / Scale-to-Zero mode ($0 idle cost). Canaries only execute on-demand when triggered via StartCanary"
}

variable "canary_schedule_expression" {
  type        = string
  default     = "rate(0 minutes)"
  description = "CloudWatch Synthetics schedule expression: rate(0 minutes) enforces Run-Once / Ad-Hoc on-demand execution with zero recurring background runs"
}

variable "canary_timeout_seconds" {
  type        = number
  default     = 120
  description = "Maximum execution timeout in seconds for each CloudWatch Synthetics canary run"
}

variable "canary_memory_mb" {
  type        = number
  default     = 2048
  description = "Lambda memory allocation in MB for each CloudWatch Synthetics canary (minimum 960, recommended 2048 for Chromium)"
}

variable "canary_active_tracing" {
  type        = bool
  default     = true
  description = "Enable AWS X-Ray active tracing on CloudWatch Synthetics canaries"
}

variable "canary_success_retention_days" {
  type        = number
  default     = 31
  description = "Retention period in days for successful canary run data in CloudWatch Synthetics"
}

variable "canary_failure_retention_days" {
  type        = number
  default     = 31
  description = "Retention period in days for failed canary run data in CloudWatch Synthetics"
}

variable "viewport_width" {
  type        = number
  default     = 1440
  description = "Headless Chromium viewport width in pixels for DOM screenshot capture"
}

variable "viewport_height" {
  type        = number
  default     = 900
  description = "Headless Chromium viewport height in pixels for DOM screenshot capture"
}

variable "navigation_timeout_ms" {
  type        = number
  default     = 30000
  description = "Per-URL page.goto navigation timeout in milliseconds"
}

# ----------------------------------------------------------------------------
# 8. CLOUDWATCH LOGS, ALARMS & SNS ALERTING
# ----------------------------------------------------------------------------
variable "log_retention_days" {
  type        = number
  default     = 30
  description = "CloudWatch Log Group retention in days for Lambda and Canary execution logs"
}

variable "alarm_success_threshold_pct" {
  type        = number
  default     = 100
  description = "CloudWatch Alarm threshold for Canary SuccessPercent (triggers alarm if below threshold)"
}

variable "alarm_evaluation_periods" {
  type        = number
  default     = 1
  description = "Number of evaluation periods before triggering CloudWatch Synthetics failure alarm"
}

variable "alarm_notification_email" {
  type        = string
  default     = ""
  description = "Optional email address to subscribe to the SNS Release Gate Alert topic (leave empty to skip email subscription)"
}

# ----------------------------------------------------------------------------
# 9. SCALE-TO-ZERO AWS LAMBDA, API GATEWAY V2 & OPTIONAL APP RUNNER
# ----------------------------------------------------------------------------
variable "deploy_serverless_lambda" {
  type        = bool
  default     = true
  description = "Provision Scale-to-Zero ($0/idle) AWS Lambda functions for the Control Plane API/MCP and Ad-Hoc Edge Runner"
}

variable "lambda_runtime" {
  type        = string
  default     = "nodejs20.x"
  description = "AWS Lambda Node.js runtime version for scale-to-zero Control Plane and Ad-Hoc Edge Runner functions"
}

variable "lambda_architecture" {
  type        = string
  default     = "arm64"
  description = "AWS Lambda CPU architecture (arm64 Graviton2 provides 20% lower cost and faster cold starts)"
}

variable "control_plane_lambda_memory_mb" {
  type        = number
  default     = 512
  description = "Memory in MB for the scale-to-zero Control Plane REST/OpenAPI/MCP AWS Lambda function"
}

variable "control_plane_lambda_timeout_seconds" {
  type        = number
  default     = 30
  description = "Timeout in seconds for the Control Plane AWS Lambda function"
}

variable "adhoc_runner_lambda_memory_mb" {
  type        = number
  default     = 1024
  description = "Memory in MB for the Ad-Hoc On-Demand Akamai Edge Synthetic Runner AWS Lambda function"
}

variable "adhoc_runner_lambda_timeout_seconds" {
  type        = number
  default     = 60
  description = "Timeout in seconds for the Ad-Hoc On-Demand Akamai Edge Synthetic Runner AWS Lambda function"
}

variable "enable_lambda_function_url" {
  type        = bool
  default     = true
  description = "Provision a direct HTTPS AWS Lambda Function URL for the Control Plane API/MCP Lambda ($0 fixed cost)"
}

variable "enable_apigateway_http_api" {
  type        = bool
  default     = true
  description = "Provision an Amazon API Gateway v2 HTTP API ($default stage) fronting the Control Plane Lambda ($0 fixed cost when idle)"
}

variable "deploy_cloudfront_distribution" {
  type        = bool
  default     = true
  description = "Provision an Amazon CloudFront Distribution fronting both the S3 React SPA (/*) via Origin Access Control (OAC) and the Scale-to-Zero Control Plane Lambda API (/api/*)"
}

variable "cloudfront_price_class" {
  type        = string
  default     = "PriceClass_100"
  description = "CloudFront distribution price class (PriceClass_100, PriceClass_200, or PriceClass_All)"
}

variable "cloudfront_spa_origin_path" {
  type        = string
  default     = "/portal-ui"
  description = "S3 prefix path where the compiled Vite SPA bundle (dist/) is uploaded and served by CloudFront"
}

variable "initial_operator_users" {
  type = list(object({
    email        = string
    display_name = string
    role         = string
  }))
  default = [
    {
      email        = "user-baluuezlosgz@salesforce.com"
      display_name = "Lead Edge Release Engineer (AWS 373211957869)"
      role         = "admin"
    },
    {
      email        = "release-automation@salesforce.com"
      display_name = "Salesforce Edge CI/CD Pipeline"
      role         = "operator"
    },
    {
      email        = "trust-security@salesforce.com"
      display_name = "Salesforce Trust & Security QA"
      role         = "viewer"
    }
  ]
  description = "Seeded operator user accounts provisioned into DynamoDB for headless CLI/API user management and activity tracking"
}

variable "ecr_repository_name" {
  type        = string
  default     = "salesforce-edge-release-gate"
  description = "Amazon ECR repository name (optional, only used if container deployment is enabled)"
}

variable "deploy_apprunner_service" {
  type        = bool
  default     = false
  description = "Keep false for $0/idle Ad-Hoc Lambda mode. Only set to true if you explicitly want an always-running container"
}

variable "container_image_tag" {
  type        = string
  default     = "latest"
  description = "Docker image tag in ECR for optional container deployment"
}

variable "apprunner_cpu" {
  type        = string
  default     = "1024"
  description = "AWS App Runner vCPU allocation (only used when deploy_apprunner_service = true)"
}

variable "apprunner_memory" {
  type        = string
  default     = "2048"
  description = "AWS App Runner memory allocation in MB (only used when deploy_apprunner_service = true)"
}

variable "apprunner_port" {
  type        = string
  default     = "3000"
  description = "Port exposed by the Express + Vite/SPA Control Plane"
}

variable "apprunner_health_check_path" {
  type        = string
  default     = "/api/v1/health"
  description = "HTTP health check endpoint path"
}

variable "mcp_endpoint_uri" {
  type        = string
  default     = "/api/v1/mcp/rpc"
  description = "Logical Model Context Protocol (MCP) server URI exposed to AI coding agents"
}

variable "mcp_npm_package" {
  type        = string
  default     = "@salesforce-edge/akamai-release-gate-mcp"
  description = "NPM package identifier for the MCP stdio/HTTP bridge"
}

# ----------------------------------------------------------------------------
# 10. FULL PROPERTY & ENVIRONMENT TOPOLOGY (INCLUDING HOST MAPS & EDGE OVERRIDES)
# ----------------------------------------------------------------------------
variable "properties" {
  type = list(object({
    id               = string
    name             = string
    suite_path       = optional(string)
    default_networks = optional(list(string), ["prod", "staging"])
    headers          = optional(map(string), {})
    envs = list(object({
      id              = string
      name            = optional(string)
      networks        = optional(list(string), ["prod", "staging"])
      host_map        = optional(map(string), {})
      staging_edge_ip = optional(string)
      prod_edge_ip    = optional(string)
    }))
  }))
  default = [
    {
      id               = "www"
      name             = "Salesforce Global Marketing & Digital Experience (www.salesforce.com)"
      suite_path       = "config/suites/www.csv"
      default_networks = ["prod", "staging"]
      headers          = { "x-sfdc-edge-gate" = "release-verify" }
      envs = [
        {
          id       = "prod"
          name     = "PROD"
          networks = ["prod", "staging"]
          host_map = { "www.salesforce.com" = "www.salesforce.com" }
        },
        {
          id       = "uat"
          name     = "UAT"
          networks = ["prod", "staging"]
          host_map = { "www.salesforce.com" = "www-uat1.salesforce.com" }
        }
      ]
    },
    {
      id               = "login"
      name             = "Salesforce Core Identity & OAuth Gateway (login.salesforce.com)"
      suite_path       = "config/suites/login.csv"
      default_networks = ["prod", "staging"]
      envs = [
        {
          id       = "prod"
          name     = "PROD"
          networks = ["prod", "staging"]
          host_map = { "login.salesforce.com" = "login.salesforce.com" }
        },
        {
          id       = "uat"
          name     = "UAT"
          networks = ["prod", "staging"]
          host_map = { "login.salesforce.com" = "test.salesforce.com" }
        }
      ]
    },
    {
      id               = "developer"
      name             = "Salesforce Developers & API Portal (developer.salesforce.com)"
      suite_path       = "config/suites/developer.csv"
      default_networks = ["prod", "staging"]
      envs = [
        {
          id       = "prod"
          name     = "PROD"
          networks = ["prod", "staging"]
          host_map = { "developer.salesforce.com" = "developer.salesforce.com" }
        },
        {
          id       = "uat"
          name     = "UAT"
          networks = ["prod", "staging"]
          host_map = { "developer.salesforce.com" = "developer-uat.salesforce.com" }
        }
      ]
    },
    {
      id               = "help"
      name             = "Salesforce Help & Customer Trailblazer Support (help.salesforce.com)"
      suite_path       = "config/suites/help.csv"
      default_networks = ["prod", "staging"]
      envs = [
        {
          id       = "prod"
          name     = "PROD"
          networks = ["prod", "staging"]
          host_map = { "help.salesforce.com" = "help.salesforce.com" }
        },
        {
          id       = "uat"
          name     = "UAT"
          networks = ["prod", "staging"]
          host_map = { "help.salesforce.com" = "help-uat.salesforce.com" }
        }
      ]
    },
    {
      id               = "trailhead"
      name             = "Salesforce Trailhead Learning & Certification (trailhead.salesforce.com)"
      suite_path       = "config/suites/trailhead.csv"
      default_networks = ["prod", "staging"]
      envs = [
        {
          id       = "prod"
          name     = "PROD"
          networks = ["prod", "staging"]
          host_map = { "trailhead.salesforce.com" = "trailhead.salesforce.com" }
        },
        {
          id       = "uat"
          name     = "UAT"
          networks = ["prod", "staging"]
          host_map = { "trailhead.salesforce.com" = "trailhead-uat.salesforce.com" }
        }
      ]
    },
    {
      id               = "status"
      name             = "Salesforce Trust & Real-Time Cloud Status (status.salesforce.com)"
      suite_path       = "config/suites/status.csv"
      default_networks = ["prod", "staging"]
      envs = [
        {
          id       = "prod"
          name     = "PROD"
          networks = ["prod", "staging"]
          host_map = { "status.salesforce.com" = "status.salesforce.com" }
        }
      ]
    },
    {
      id               = "appexchange"
      name             = "Salesforce AppExchange Enterprise Marketplace (appexchange.salesforce.com)"
      suite_path       = "config/suites/appexchange.csv"
      default_networks = ["prod", "staging"]
      envs = [
        {
          id       = "prod"
          name     = "PROD"
          networks = ["prod", "staging"]
          host_map = { "appexchange.salesforce.com" = "appexchange.salesforce.com" }
        },
        {
          id       = "uat"
          name     = "UAT"
          networks = ["prod", "staging"]
          host_map = { "appexchange.salesforce.com" = "appexchange-uat.salesforce.com" }
        }
      ]
    },
    {
      id               = "partners"
      name             = "Salesforce Partner Community & Ecosystem (partners.salesforce.com)"
      suite_path       = "config/suites/partners.csv"
      default_networks = ["prod", "staging"]
      envs = [
        {
          id       = "prod"
          name     = "PROD"
          networks = ["prod", "staging"]
          host_map = { "partners.salesforce.com" = "partners.salesforce.com" }
        },
        {
          id       = "uat"
          name     = "UAT"
          networks = ["prod", "staging"]
          host_map = { "partners.salesforce.com" = "partners-uat.salesforce.com" }
        }
      ]
    }
  ]
  description = "Complete multi-property topology, environment host maps, and optional per-environment Akamai Edge IP overrides"
}

# ----------------------------------------------------------------------------
# 11. SYNTHETIC TEST SUITE DEFINITIONS (PROVISIONED TO S3 & CANARY ENV BY TF)
# ----------------------------------------------------------------------------
variable "test_suite" {
  type = list(object({
    id              = string
    name            = string
    path            = string
    expected_status = string
    critical        = optional(bool, true)
    enabled         = optional(bool, true)
  }))
  default = [
    { id = "T01", name = "Salesforce Global Home & Hero Experience", path = "/", expected_status = "200", critical = true, enabled = true },
    { id = "T02", name = "Sales Cloud & Agentforce Product Overview", path = "/sales/", expected_status = "200", critical = true, enabled = true },
    { id = "T03", name = "Agentforce AI & Einstein Platform Landing", path = "/artificial-intelligence/", expected_status = "200", critical = true, enabled = true },
    { id = "T04", name = "Legacy CRM Redirect Normalization (/crm -> /crm/)", path = "/crm", expected_status = "301", critical = true, enabled = true },
    { id = "T05", name = "Salesforce Free Trial & Lead Capture Flow", path = "/form/signup/freetrial-sales/", expected_status = "200", critical = true, enabled = true },
    { id = "T06", name = "Enterprise Editions & Pricing Matrix", path = "/editions-pricing/sales-cloud/", expected_status = "200", critical = true, enabled = true },
    { id = "T07", name = "Customer 360 & Small Business Solutions", path = "/small-business/", expected_status = "200", critical = true, enabled = true },
    { id = "T08", name = "Company Overview & Global Trust Center Entry", path = "/company/", expected_status = "200", critical = true, enabled = true }
  ]
  description = "Synthetic test suite checks provisioned into S3 (CSV + JSON) and injected into CloudWatch Synthetics Canaries"
}

# ----------------------------------------------------------------------------
# 12. ACCEPTED DIFF RULES, COOKIES & VISUAL BASELINE POLICY
# ----------------------------------------------------------------------------
variable "ignore_accepted_diffs" {
  type        = bool
  default     = true
  description = "Default Release Gate policy: suppress accepted Header, Cookie, and Visual rules when computing GO/NO-GO"
}

variable "accepted_diff_rules" {
  type = list(object({
    id            = string
    app_id        = string
    comparison_id = string
    kind          = string
    enabled       = bool
    note          = string
  }))
  default = [
    {
      id            = "rule-default-x-cache-remote"
      app_id        = "www"
      comparison_id = "all"
      kind          = "x-cache-remote"
      enabled       = true
      note          = "Expected parent tier cache variance between Akamai Staging and Production"
    }
  ]
  description = "Accepted functional/header diff rules seeded into DynamoDB and S3 runtime config"
}

variable "accepted_cookies" {
  type        = list(string)
  default     = []
  description = "Cookie names pre-accepted across Staging vs Production comparisons (e.g. ['edge_region'])"
}

variable "accepted_visual_tests" {
  type        = list(string)
  default     = []
  description = "Test IDs whose visual diffs are pre-accepted in the Release Gate baseline"
}
