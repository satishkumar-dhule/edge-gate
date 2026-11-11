# ============================================================================
# TERRAFORM.TFVARS — SALESFORCE EDGE RELEASE GATE (100% CONFIG-AS-CODE)
# ============================================================================
# Configured for salesforce.com on AWS Account 030771555103 (us-east-1).
# ============================================================================

aws_region             = "us-east-1"
environment            = "prod"
project_name           = "salesforce-edge-release-gate"
operator_email         = "user-baluuezlosgz@salesforce.com"
operator_role          = "Lead Edge Release Engineer"
akamai_account_context = "SFDC-EDGE-373211957869 (AWS 373211957869 · Akamai Prod + Staging)"

s3_artifact_bucket                = "salesforce-akamai-synthetics"
s3_force_destroy                  = true
artifact_retention_days           = 90
noncurrent_version_retention_days = 30

dynamodb_table_name             = "salesforce-synthetics-gate-state"
dynamodb_billing_mode           = "PAY_PER_REQUEST"
enable_point_in_time_recovery   = true
seed_accepted_rules_in_dynamodb = true

ssm_parameter_prefix  = "/salesforce-release-gate"
generate_local_dotenv = true

bedrock_nova_lite_model_id       = "amazon.nova-lite-v1:0"
visual_judge_provider_label      = "Amazon Bedrock (Nova Lite Multimodal)"
visual_judge_pixel_cost_gate_pct = 0.1
visual_judge_minor_threshold_pct = 5.0
visual_judge_temperature         = 0.0
visual_judge_max_tokens          = 600

default_domain      = "salesforce.com"
staging_edge_suffix = ".edgekey-staging.net"
staging_edge_ip     = "23.48.201.18"
prod_edge_suffix    = ".edgekey.net"
prod_edge_ip        = "23.212.251.15"
canary_user_agent   = "Salesforce-Synthetics-Canary/9.1 (ReleaseGate; AWS-CloudWatch-Synthetics)"
restricted_headers  = ["Authorization", "Cookie"]

akamai_pragma_headers = [
  "akamai-x-cache-on",
  "akamai-x-cache-remote-on",
  "akamai-x-check-cacheable",
  "akamai-x-get-cache-key",
  "akamai-x-get-true-cache-key",
  "akamai-x-get-request-id"
]

deploy_synthetics_canaries    = false
synthetics_runtime_version    = "syn-nodejs-puppeteer-9.1"
start_canaries_on_apply       = false
canary_schedule_expression    = "rate(0 minutes)"
canary_timeout_seconds        = 120
canary_memory_mb              = 2048
canary_active_tracing         = true
canary_success_retention_days = 31
canary_failure_retention_days = 31
viewport_width                = 1440
viewport_height               = 900
navigation_timeout_ms         = 30000

log_retention_days          = 30
alarm_success_threshold_pct = 100
alarm_evaluation_periods    = 1
alarm_notification_email    = ""

deploy_serverless_lambda             = true
lambda_runtime                       = "nodejs20.x"
lambda_architecture                  = "arm64"
control_plane_lambda_memory_mb       = 512
control_plane_lambda_timeout_seconds = 30
adhoc_runner_lambda_memory_mb        = 1024
adhoc_runner_lambda_timeout_seconds  = 60
enable_lambda_function_url           = true
enable_apigateway_http_api           = true
deploy_cloudfront_distribution       = true
cloudfront_price_class               = "PriceClass_100"
cloudfront_spa_origin_path           = "/portal-ui"
deploy_apprunner_service             = false
ecr_repository_name                  = "salesforce-edge-release-gate"
container_image_tag                  = "latest"
apprunner_cpu                        = "1024"
apprunner_memory                     = "2048"
apprunner_port                       = "3000"
apprunner_health_check_path          = "/api/v1/health"
mcp_endpoint_uri                     = "/api/v1/mcp/rpc"
mcp_npm_package                      = "@salesforce-edge/akamai-release-gate-mcp"
