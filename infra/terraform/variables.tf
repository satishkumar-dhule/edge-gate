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
  default     = "akamai-synthetic-release-gate"
  description = "Canonical project name used across IAM, S3, DynamoDB, SSM, ECR, and CloudWatch resources"
}

variable "operator_email" {
  type        = string
  default     = "satishkumardhule@gmail.com"
  description = "Default Principal Edge SRE operator identity seeded into Control Plane config"
}

variable "operator_role" {
  type        = string
  default     = "Principal Edge SRE"
  description = "Default operator role seeded into Control Plane config"
}

variable "akamai_account_context" {
  type        = string
  default     = "B-C-1AKAMAI-ENT (Enterprise Production)"
  description = "Akamai Control Center account context identifier"
}

variable "default_tags" {
  type = map(string)
  default = {
    Project     = "akamai-synthetic-release-gate"
    ManagedBy   = "terraform"
    ControlPlane = "akamai-edge-synthetics-mcp"
  }
  description = "Base tags applied to all provisioned AWS resources"
}

# ----------------------------------------------------------------------------
# 2. S3 ARTIFACT BUCKET & LIFECYCLE POLICY
# ----------------------------------------------------------------------------
variable "s3_artifact_bucket" {
  type        = string
  default     = "akamai-synthetics-gate-prod"
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
  default     = "akamai-synthetics-release-gate-runs"
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
  default     = "company.com"
  description = "Default canonical root domain for properties"
}

variable "staging_edge_suffix" {
  type        = string
  default     = ".edgekey-staging.net"
  description = "Akamai Staging Edge hostname suffix"
}

variable "staging_edge_ip" {
  type        = string
  default     = "23.56.128.45"
  description = "Default Akamai Staging Edge IP used for DNS pinning (--host-resolver-rules / curl --resolve)"
}

variable "prod_edge_suffix" {
  type        = string
  default     = ".edgekey.net"
  description = "Akamai Production Edge hostname suffix"
}

variable "prod_edge_ip" {
  type        = string
  default     = "104.96.22.11"
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
# 7. AWS CLOUDWATCH SYNTHETICS CANARY EXECUTION & VIEWPORT SETTINGS
# ----------------------------------------------------------------------------
variable "synthetics_runtime_version" {
  type        = string
  default     = "syn-nodejs-puppeteer-9.1"
  description = "AWS CloudWatch Synthetics runtime version"
}

variable "start_canaries_on_apply" {
  type        = bool
  default     = true
  description = "Automatically start CloudWatch Synthetics canaries immediately after terraform apply"
}

variable "canary_schedule_expression" {
  type        = string
  default     = "rate(15 minutes)"
  description = "CloudWatch Synthetics schedule expression (e.g. rate(15 minutes) or rate(0 minutes) for on-demand only)"
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
  description = "CloudWatch Log Group retention in days for Canary execution logs"
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
# 9. CONTROL PLANE (ECR, APP RUNNER, OPENAPI & MCP SERVER)
# ----------------------------------------------------------------------------
variable "ecr_repository_name" {
  type        = string
  default     = "akamai-synthetic-release-gate"
  description = "Amazon ECR repository name for the Control Plane container image"
}

variable "deploy_apprunner_service" {
  type        = bool
  default     = false
  description = "Set to true after pushing the Docker image to ECR to provision the AWS App Runner Control Plane"
}

variable "container_image_tag" {
  type        = string
  default     = "latest"
  description = "Docker image tag in ECR for the Control Plane service"
}

variable "apprunner_cpu" {
  type        = string
  default     = "1024"
  description = "AWS App Runner vCPU allocation (1024 = 1 vCPU, 2048 = 2 vCPU)"
}

variable "apprunner_memory" {
  type        = string
  default     = "2048"
  description = "AWS App Runner memory allocation in MB (2048 = 2 GB, 4096 = 4 GB)"
}

variable "apprunner_port" {
  type        = string
  default     = "3000"
  description = "Container port exposed by the Express + Vite/SPA Control Plane"
}

variable "apprunner_health_check_path" {
  type        = string
  default     = "/api/v1/health"
  description = "HTTP health check endpoint path for AWS App Runner"
}

variable "mcp_endpoint_uri" {
  type        = string
  default     = "mcp://akamai-synthetics-gate/v1"
  description = "Logical Model Context Protocol (MCP) server URI exposed to AI coding agents"
}

variable "mcp_npm_package" {
  type        = string
  default     = "@company/akamai-synthetics-mcp-server"
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
      name             = "Main Public Portal"
      suite_path       = "config/suites/www.csv"
      default_networks = ["prod", "staging"]
      headers          = { "x-portal-team" = "edge-release-eng" }
      envs = [
        {
          id       = "prod"
          name     = "Production"
          networks = ["prod", "staging"]
          host_map = {
            "www.company.com"    = "www.company.com"
            "assets.company.com" = "assets.company.com"
          }
        },
        {
          id       = "uat"
          name     = "UAT"
          networks = ["prod", "staging"]
          host_map = {
            "www.company.com"    = "uat-www.company.com"
            "assets.company.com" = "uat-assets.company.com"
          }
        }
      ]
    },
    {
      id               = "store"
      name             = "E-Commerce Storefront"
      suite_path       = "config/suites/store.csv"
      default_networks = ["prod", "staging"]
      envs = [
        {
          id       = "prod"
          name     = "Production"
          networks = ["prod", "staging"]
          host_map = { "store.company.com" = "store.company.com" }
        },
        {
          id       = "uat"
          name     = "UAT"
          networks = ["prod", "staging"]
          host_map = { "store.company.com" = "uat-store.company.com" }
        }
      ]
    },
    {
      id               = "help"
      name             = "Help & Docs Center"
      suite_path       = "config/suites/help.csv"
      default_networks = ["prod", "staging"]
      envs = [
        {
          id       = "prod"
          name     = "Production"
          networks = ["prod", "staging"]
          host_map = { "help.company.com" = "help.company.com" }
        }
      ]
    },
    {
      id               = "checkout"
      name             = "Global Checkout & Payments"
      suite_path       = "config/suites/checkout.csv"
      default_networks = ["prod", "staging"]
      envs = [
        {
          id       = "prod"
          name     = "Production"
          networks = ["prod", "staging"]
          host_map = { "checkout.company.com" = "checkout.company.com" }
        },
        {
          id       = "uat"
          name     = "UAT"
          networks = ["prod", "staging"]
          host_map = { "checkout.company.com" = "uat-checkout.company.com" }
        }
      ]
    },
    {
      id               = "api"
      name             = "Edge GraphQL & REST Gateway"
      suite_path       = "config/suites/api.csv"
      default_networks = ["prod", "staging"]
      envs = [
        {
          id       = "prod"
          name     = "Production"
          networks = ["prod", "staging"]
          host_map = { "api.company.com" = "api.company.com" }
        },
        {
          id       = "uat"
          name     = "UAT"
          networks = ["prod", "staging"]
          host_map = { "api.company.com" = "uat-api.company.com" }
        }
      ]
    },
    {
      id               = "auth"
      name             = "Identity & SSO Edge Broker"
      suite_path       = "config/suites/auth.csv"
      default_networks = ["prod", "staging"]
      envs = [
        {
          id       = "prod"
          name     = "Production"
          networks = ["prod", "staging"]
          host_map = { "auth.company.com" = "auth.company.com" }
        },
        {
          id       = "uat"
          name     = "UAT"
          networks = ["prod", "staging"]
          host_map = { "auth.company.com" = "uat-auth.company.com" }
        }
      ]
    },
    {
      id               = "developer"
      name             = "Developer Hub & API Reference"
      suite_path       = "config/suites/developer.csv"
      default_networks = ["prod", "staging"]
      envs = [
        {
          id       = "prod"
          name     = "Production"
          networks = ["prod", "staging"]
          host_map = { "developer.company.com" = "developer.company.com" }
        }
      ]
    },
    {
      id               = "partners"
      name             = "Partner Portal & Rebates"
      suite_path       = "config/suites/partners.csv"
      default_networks = ["prod", "staging"]
      envs = [
        {
          id       = "prod"
          name     = "Production"
          networks = ["prod", "staging"]
          host_map = { "partners.company.com" = "partners.company.com" }
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
    { id = "T01", name = "Homepage Root & Edge Cache", path = "/", expected_status = "200", critical = true, enabled = true },
    { id = "T02", name = "Product Catalog & Session Cookie", path = "/products", expected_status = "200", critical = true, enabled = true },
    { id = "T03", name = "Enterprise Solutions Hero Layout", path = "/solutions/enterprise", expected_status = "200", critical = true, enabled = true },
    { id = "T04", name = "Global Geo Redirect (/global)", path = "/global", expected_status = "301", critical = true, enabled = true },
    { id = "T05", name = "Authentication Sign-In Portal", path = "/login", expected_status = "200", critical = true, enabled = true },
    { id = "T06", name = "Customer Case Studies Feed", path = "/customers/stories", expected_status = "200", critical = false, enabled = true },
    { id = "T07", name = "Pricing & Tier Calculator", path = "/pricing", expected_status = "200", critical = true, enabled = true },
    { id = "T08", name = "Edge Health Check Probe", path = "/healthz", expected_status = "200", critical = true, enabled = true }
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
