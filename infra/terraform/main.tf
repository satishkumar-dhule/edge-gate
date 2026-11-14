# ============================================================================
# AKAMAI SYNTHETIC RELEASE GATE — COMPLETE AWS TERRAFORM INFRASTRUCTURE (IaC)
# ============================================================================
# Every single infrastructure resource AND application configuration artifact
# is provisioned and managed by Terraform:
#   1. S3 Artifact & Config Bucket (Versioning, AES256 SSE, Lifecycle Rules)
#   2. S3 Config Provisioning (Per-Property CSV/JSON Suites + Runtime Config JSON)
#   3. Automatic Canary ZIP Packaging (nodejs/node_modules/canary-har-runner.js)
#   4. DynamoDB Table + Terraform-Seeded Accepted Diff Rules & Baseline Config
#   5. AWS Systems Manager (SSM) Parameter Store (Runtime, Edge & Nova Lite Config)
#   6. IAM Execution Roles (Synthetics, S3, DynamoDB, SSM, Bedrock Nova Lite, SNS)
#   7. CloudWatch Synthetics Canaries (Staging & Prod Edge Networks per Property)
#   8. CloudWatch Log Groups, Metric Alarms & SNS Alerting Topic
#   9. Amazon ECR & AWS App Runner Control Plane + Local .env.terraform Output
# ============================================================================

terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.70"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.5"
    }
    local = {
      source  = "hashicorp/local"
      version = "~> 2.5"
    }
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = merge(var.default_tags, {
      Environment = var.environment
      VisualJudge = var.bedrock_nova_lite_model_id
    })
  }
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

# ============================================================================
# LOCALS: RESOLVED TOPOLOGY, CANARY TARGET MATRIX & RUNTIME CONFIG PAYLOAD
# ============================================================================
locals {
  resolved_bucket_name = "${var.s3_artifact_bucket}-${data.aws_caller_identity.current.account_id}-${var.aws_region}"
  bedrock_model_arn    = "arn:aws:bedrock:${var.aws_region}::foundation-model/${var.bedrock_nova_lite_model_id}"

  enabled_test_suite = [
    for tc in var.test_suite : {
      id             = tc.id
      name           = tc.name
      path           = tc.path
      expectedStatus = tc.expected_status
      critical       = coalesce(tc.critical, true)
      enabled        = coalesce(tc.enabled, true)
    }
    if coalesce(tc.enabled, true)
  ]

  suite_csv_content = join("\n", concat(
    ["id,name,path,expected_status,critical,enabled"],
    [
      for tc in local.enabled_test_suite :
      "${tc.id},\"${replace(tc.name, "\"", "\"\"")}\",${tc.path},${tc.expectedStatus},${tc.critical},${tc.enabled}"
    ]
  ))

  # Flatten all property x environment x network targets into CloudWatch Synthetics Canaries
  # CloudWatch Synthetics canary names must be <= 21 chars, lowercase alphanumeric + hyphens
  canary_targets = flatten([
    for prop in var.properties : [
      for env in prop.envs : [
        for net in coalesce(env.networks, prop.default_networks, ["staging", "prod"]) : {
          key              = "${prop.id}-${env.id}-${net}"
          target_id        = "${prop.id}.${env.id}.${net}"
          canary_name      = substr(replace(lower("ak-${prop.id}-${env.id}-${net == "staging" ? "stg" : "prd"}"), "_", "-"), 0, 21)
          app_id           = prop.id
          app_name         = prop.name
          suite_path       = coalesce(prop.suite_path, "config/suites/${prop.id}.csv")
          property_headers = coalesce(prop.headers, {})
          env_id           = env.id
          env_name         = coalesce(env.name, upper(env.id))
          host_map         = coalesce(env.host_map, {})
          network          = net
          edge_ip = net == "staging" ? coalesce(env.staging_edge_ip, var.staging_edge_ip) : coalesce(env.prod_edge_ip, var.prod_edge_ip)
          edge_sfx = net == "staging" ? var.staging_edge_suffix : var.prod_edge_suffix
        }
      ]
    ]
  ])

  # Complete runtime configuration JSON published to S3, SSM Parameter Store, DynamoDB, and App Runner
  portal_runtime_config = {
    managedBy   = "terraform"
    projectName = var.project_name
    environment = var.environment
    awsAccount  = data.aws_caller_identity.current.account_id
    awsRegion   = var.aws_region
    branding = {
      defaultDomain = var.default_domain
      defaultOperator = {
        email   = var.operator_email
        role    = var.operator_role
        account = var.akamai_account_context
      }
    }
    networks = {
      staging = {
        id            = "staging"
        edgeSuffix    = var.staging_edge_suffix
        defaultEdgeIp = var.staging_edge_ip
      }
      prod = {
        id            = "prod"
        edgeSuffix    = var.prod_edge_suffix
        defaultEdgeIp = var.prod_edge_ip
      }
    }
    infrastructure = {
      runnerEngine             = "AWS CloudWatch Synthetics"
      runtimeVersion           = var.synthetics_runtime_version
      awsRegion                = var.aws_region
      s3Bucket                 = "s3://${local.resolved_bucket_name}"
      dynamodbTable            = var.dynamodb_table_name
      ssmConfigParameter       = "${var.ssm_parameter_prefix}/${var.environment}/runtime-config"
      mcpEndpoint              = var.mcp_endpoint_uri
      mcpNpmPackage            = var.mcp_npm_package
      pragmaHeaders            = var.akamai_pragma_headers
      userAgent                = var.canary_user_agent
      restrictedHeaders        = var.restricted_headers
      viewportWidth            = var.viewport_width
      viewportHeight           = var.viewport_height
      navigationTimeoutMs      = var.navigation_timeout_ms
      visualJudgeModel         = var.bedrock_nova_lite_model_id
      visualJudgeProvider      = var.visual_judge_provider_label
      bedrockModelArn          = local.bedrock_model_arn
      visualCostGatePct        = var.visual_judge_pixel_cost_gate_pct
      visualMinorThresholdPct  = var.visual_judge_minor_threshold_pct
      visualTemperature        = var.visual_judge_temperature
      visualMaxTokens          = var.visual_judge_max_tokens
    }
    policy = {
      ignoreAcceptedDiffs = var.ignore_accepted_diffs
      acceptedDiffRules   = var.accepted_diff_rules
      acceptedCookies     = var.accepted_cookies
      acceptedVisualTests = var.accepted_visual_tests
    }
    properties = [
      for prop in var.properties : {
        id              = prop.id
        name            = prop.name
        suitePath       = coalesce(prop.suite_path, "config/suites/${prop.id}.csv")
        defaultNetworks = coalesce(prop.default_networks, ["prod", "staging"])
        headers         = coalesce(prop.headers, {})
        envs = [
          for env in prop.envs : {
            id            = env.id
            name          = coalesce(env.name, upper(env.id))
            networks      = coalesce(env.networks, prop.default_networks, ["prod", "staging"])
            hostMap       = coalesce(env.host_map, {})
            stagingEdgeIp = coalesce(env.staging_edge_ip, var.staging_edge_ip)
            prodEdgeIp    = coalesce(env.prod_edge_ip, var.prod_edge_ip)
          }
        ]
      }
    ]
    testSuite = local.enabled_test_suite
  }
}

# ============================================================================
# 1. S3 ARTIFACT & CONFIGURATION BUCKET (WITH VERSIONING, SSE & LIFECYCLE)
# ============================================================================
resource "aws_s3_bucket" "synthetics_artifacts" {
  bucket        = local.resolved_bucket_name
  force_destroy = var.s3_force_destroy
}

resource "aws_s3_bucket_versioning" "synthetics_versioning" {
  bucket = aws_s3_bucket.synthetics_artifacts.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "synthetics_sse" {
  bucket = aws_s3_bucket.synthetics_artifacts.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "synthetics_private" {
  bucket                  = aws_s3_bucket.synthetics_artifacts.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "synthetics_lifecycle" {
  bucket = aws_s3_bucket.synthetics_artifacts.id

  rule {
    id     = "expire-old-synthetic-runs"
    status = "Enabled"

    filter {
      prefix = "runs/"
    }

    expiration {
      days = var.artifact_retention_days
    }

    noncurrent_version_expiration {
      noncurrent_days = var.noncurrent_version_retention_days
    }
  }

  depends_on = [aws_s3_bucket_versioning.synthetics_versioning]
}

# ============================================================================
# 2. TERRAFORM-PROVISIONED S3 CONFIGURATION & SUITE ARTIFACTS
# ============================================================================
resource "aws_s3_object" "portal_runtime_config" {
  bucket       = aws_s3_bucket.synthetics_artifacts.id
  key          = "config/portal-runtime-config.json"
  content      = jsonencode(local.portal_runtime_config)
  content_type = "application/json"

  depends_on = [aws_s3_bucket_versioning.synthetics_versioning]
}

resource "aws_s3_object" "property_suite_csv" {
  for_each     = { for p in var.properties : p.id => p }
  bucket       = aws_s3_bucket.synthetics_artifacts.id
  key          = coalesce(each.value.suite_path, "config/suites/${each.key}.csv")
  content      = local.suite_csv_content
  content_type = "text/csv"

  depends_on = [aws_s3_bucket_versioning.synthetics_versioning]
}

resource "aws_s3_object" "property_suite_json" {
  for_each     = { for p in var.properties : p.id => p }
  bucket       = aws_s3_bucket.synthetics_artifacts.id
  key          = "config/suites/${each.key}.json"
  content      = jsonencode(local.enabled_test_suite)
  content_type = "application/json"

  depends_on = [aws_s3_bucket_versioning.synthetics_versioning]
}

# ============================================================================
# 3. AUTOMATIC CANARY ZIP PACKAGING & S3 CODE UPLOAD
# ============================================================================
data "archive_file" "canary_zip" {
  type        = "zip"
  output_path = "${path.module}/.terraform/tmp/canary-har-runner.zip"

  source {
    content  = file("${path.module}/../../aws-synthetics/canary-har-runner.js")
    filename = "nodejs/node_modules/canary-har-runner.js"
  }
}

resource "aws_s3_object" "canary_bundle" {
  bucket       = aws_s3_bucket.synthetics_artifacts.id
  key          = "canary-code/canary-har-runner.zip"
  source       = data.archive_file.canary_zip.output_path
  source_hash  = data.archive_file.canary_zip.output_base64sha256
  content_type = "application/zip"

  depends_on = [aws_s3_bucket_versioning.synthetics_versioning]
}

# ============================================================================
# 4. AWS SYSTEMS MANAGER (SSM) PARAMETER STORE (CENTRAL CONFIG REGISTRY)
# ============================================================================
resource "aws_ssm_parameter" "portal_runtime_config" {
  name        = "${var.ssm_parameter_prefix}/${var.environment}/runtime-config"
  description = "Complete Terraform-managed runtime topology, test suites, edge IPs, and policy for Akamai Synthetic Release Gate"
  type        = "String"
  tier        = "Intelligent-Tiering"
  value       = jsonencode(local.portal_runtime_config)
  overwrite   = true
}

resource "aws_ssm_parameter" "edge_network_config" {
  name        = "${var.ssm_parameter_prefix}/${var.environment}/edge-networks"
  description = "Akamai Staging and Production Edge DNS suffixes, IPs, and Pragma debug headers"
  type        = "String"
  value = jsonencode({
    defaultDomain = var.default_domain
    staging = {
      edgeSuffix = var.staging_edge_suffix
      edgeIp     = var.staging_edge_ip
    }
    prod = {
      edgeSuffix = var.prod_edge_suffix
      edgeIp     = var.prod_edge_ip
    }
    pragmaHeaders     = var.akamai_pragma_headers
    userAgent         = var.canary_user_agent
    restrictedHeaders = var.restricted_headers
  })
  overwrite = true
}

resource "aws_ssm_parameter" "visual_judge_config" {
  name        = "${var.ssm_parameter_prefix}/${var.environment}/bedrock-nova-lite"
  description = "Amazon Bedrock Nova Lite multimodal visual diff judge configuration"
  type        = "String"
  value = jsonencode({
    modelId              = var.bedrock_nova_lite_model_id
    modelArn             = local.bedrock_model_arn
    providerLabel        = var.visual_judge_provider_label
    pixelCostGatePct     = var.visual_judge_pixel_cost_gate_pct
    minorThresholdPct    = var.visual_judge_minor_threshold_pct
    temperature          = var.visual_judge_temperature
    maxTokens            = var.visual_judge_max_tokens
  })
  overwrite = true
}

# ============================================================================
# 5. DYNAMODB TABLE & TERRAFORM-SEEDED BASELINE / ACCEPTED DIFF RULES
# ============================================================================
resource "aws_dynamodb_table" "release_gate_runs" {
  name         = var.dynamodb_table_name
  billing_mode = var.dynamodb_billing_mode
  hash_key     = "target"
  range_key    = "runKey"

  attribute {
    name = "target"
    type = "S"
  }

  attribute {
    name = "runKey"
    type = "S"
  }

  attribute {
    name = "appId"
    type = "S"
  }

  global_secondary_index {
    name            = "AppIdIndex"
    hash_key        = "appId"
    range_key       = "runKey"
    projection_type = "ALL"
  }

  point_in_time_recovery {
    enabled = var.enable_point_in_time_recovery
  }
}

resource "aws_dynamodb_table_item" "seeded_portal_config" {
  count      = var.seed_accepted_rules_in_dynamodb ? 1 : 0
  table_name = aws_dynamodb_table.release_gate_runs.name
  hash_key   = aws_dynamodb_table.release_gate_runs.hash_key
  range_key  = aws_dynamodb_table.release_gate_runs.range_key

  item = jsonencode({
    target              = { S = "__CONFIG__" }
    runKey              = { S = "PORTAL_RUNTIME_CONFIG" }
    appId               = { S = "__SYSTEM__" }
    environment         = { S = var.environment }
    visualJudgeModelId  = { S = var.bedrock_nova_lite_model_id }
    ignoreAcceptedDiffs = { BOOL = var.ignore_accepted_diffs }
    configJson          = { S = jsonencode(local.portal_runtime_config) }
  })
}

resource "aws_dynamodb_table_item" "seeded_accepted_rules" {
  for_each = var.seed_accepted_rules_in_dynamodb ? {
    for r in var.accepted_diff_rules : r.id => r
  } : {}

  table_name = aws_dynamodb_table.release_gate_runs.name
  hash_key   = aws_dynamodb_table.release_gate_runs.hash_key
  range_key  = aws_dynamodb_table.release_gate_runs.range_key

  item = jsonencode({
    target       = { S = "__ACCEPTED_RULE__" }
    runKey       = { S = each.value.id }
    appId        = { S = each.value.app_id }
    comparisonId = { S = each.value.comparison_id }
    kind         = { S = each.value.kind }
    enabled      = { BOOL = each.value.enabled }
    note         = { S = each.value.note }
    by           = { S = var.operator_email }
  })
}

# ============================================================================
# 6. SNS ALERTING TOPIC & SUBSCRIPTION FOR RELEASE GATE / CANARY ALARMS
# ============================================================================
resource "aws_sns_topic" "release_gate_alerts" {
  name = "${var.project_name}-alerts-${var.environment}"
}

resource "aws_sns_topic_subscription" "email_alert" {
  count     = length(trimspace(var.alarm_notification_email)) > 0 ? 1 : 0
  topic_arn = aws_sns_topic.release_gate_alerts.arn
  protocol  = "email"
  endpoint  = trimspace(var.alarm_notification_email)
}

# ============================================================================
# 7. IAM EXECUTION ROLE & POLICY (SYNTHETICS + DYNAMODB + S3 + SSM + BEDROCK)
# ============================================================================
resource "aws_iam_role" "synthetics_canary_role" {
  name = "AkamaiSyntheticsReleaseGateRole-${var.environment}-${var.aws_region}"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = [
            "lambda.amazonaws.com",
            "synthetics.amazonaws.com",
            "tasks.apprunner.amazonaws.com"
          ]
        }
        Action = "sts:AssumeRole"
      }
    ]
  })
}

resource "aws_iam_role_policy" "synthetics_bedrock_s3_policy" {
  name = "SyntheticsS3DynamoSsmBedrockNovaLitePolicy"
  role = aws_iam_role.synthetics_canary_role.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "S3ArtifactAndConfigReadWrite"
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:GetObject", "s3:ListBucket", "s3:GetBucketLocation"]
        Resource = [aws_s3_bucket.synthetics_artifacts.arn, "${aws_s3_bucket.synthetics_artifacts.arn}/*"]
      },
      {
        Sid    = "DynamoDBRunAndRuleStore"
        Effect = "Allow"
        Action = [
          "dynamodb:PutItem",
          "dynamodb:GetItem",
          "dynamodb:Query",
          "dynamodb:Scan",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem"
        ]
        Resource = [
          aws_dynamodb_table.release_gate_runs.arn,
          "${aws_dynamodb_table.release_gate_runs.arn}/index/*"
        ]
      },
      {
        Sid    = "SSMParameterConfigRead"
        Effect = "Allow"
        Action = [
          "ssm:GetParameter",
          "ssm:GetParameters",
          "ssm:GetParametersByPath"
        ]
        Resource = [
          aws_ssm_parameter.portal_runtime_config.arn,
          aws_ssm_parameter.edge_network_config.arn,
          aws_ssm_parameter.visual_judge_config.arn
        ]
      },
      {
        Sid    = "BedrockNovaLiteVisualJudge"
        Effect = "Allow"
        Action = [
          "bedrock:InvokeModel",
          "bedrock:InvokeModelWithResponseStream",
          "bedrock:Converse",
          "bedrock:ConverseStream"
        ]
        Resource = [
          local.bedrock_model_arn,
          "arn:aws:bedrock:*::foundation-model/amazon.nova-lite-v1:0"
        ]
      },
      {
        Sid      = "SNSAlertPublish"
        Effect   = "Allow"
        Action   = ["sns:Publish"]
        Resource = [aws_sns_topic.release_gate_alerts.arn]
      },
      {
        Sid    = "LambdaSelfAndRunnerInvoke"
        Effect = "Allow"
        Action = ["lambda:InvokeFunction"]
        Resource = [
          "arn:aws:lambda:${var.aws_region}:${data.aws_caller_identity.current.account_id}:function:${var.project_name}-*"
        ]
      },
      {
        Sid    = "CloudWatchLogsWrite"
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = [
          "arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda/*"
        ]
      },
      {
        Sid    = "CloudWatchSyntheticsOnDemandTrigger"
        Effect = "Allow"
        Action = [
          "synthetics:StartCanary",
          "synthetics:GetCanary",
          "synthetics:GetCanaryRuns",
          "synthetics:DescribeCanaries"
        ]
        Resource = "*"
      }
    ]
  })
}

# ============================================================================
# 8. AD-HOC / RUN-ONCE CLOUDWATCH SYNTHETICS CANARIES, LOG GROUPS & ALARMS
# ============================================================================
resource "aws_cloudwatch_log_group" "canary_logs" {
  for_each          = var.deploy_synthetics_canaries ? { for t in local.canary_targets : t.key => t } : {}
  name              = "/aws/lambda/cwsyn-${each.value.canary_name}"
  retention_in_days = var.log_retention_days
}

resource "aws_synthetics_canary" "property_gate" {
  for_each                 = var.deploy_synthetics_canaries ? { for t in local.canary_targets : t.key => t } : {}
  name                     = each.value.canary_name
  artifact_s3_location     = "s3://${aws_s3_bucket.synthetics_artifacts.id}/runs/${each.value.target_id}/"
  execution_role_arn       = aws_iam_role.synthetics_canary_role.arn
  handler                  = "canary-har-runner.handler"
  runtime_version          = var.synthetics_runtime_version
  start_canary             = var.start_canaries_on_apply
  s3_bucket                = aws_s3_bucket.synthetics_artifacts.id
  s3_key                   = aws_s3_object.canary_bundle.key
  s3_version               = aws_s3_object.canary_bundle.version_id
  success_retention_period = var.canary_success_retention_days
  failure_retention_period = var.canary_failure_retention_days

  schedule {
    expression          = var.canary_schedule_expression
    duration_in_seconds = 0
  }

  run_config {
    timeout_in_seconds = var.canary_timeout_seconds
    memory_in_mb       = var.canary_memory_mb
    active_tracing     = var.canary_active_tracing
    environment_variables = {
      TARGET_AWS_REGION                = var.aws_region
      ENVIRONMENT                      = var.environment
      TARGET_ID                        = each.value.target_id
      APP_ID                           = each.value.app_id
      ENV_ID                           = each.value.env_id
      EDGE_NETWORK                     = each.value.network
      EDGE_RESOLVE_IP                  = each.value.edge_ip
      EDGE_HOST_SUFFIX                 = each.value.edge_sfx
      DEFAULT_DOMAIN                   = var.default_domain
      HOST_MAP_JSON                    = jsonencode(each.value.host_map)
      PROPERTY_HEADERS_JSON            = jsonencode(each.value.property_headers)
      AKAMAI_PRAGMA_HEADERS            = join(",", var.akamai_pragma_headers)
      CANARY_USER_AGENT                = var.canary_user_agent
      RESTRICTED_HEADERS               = join(",", var.restricted_headers)
      VIEWPORT_WIDTH                   = tostring(var.viewport_width)
      VIEWPORT_HEIGHT                  = tostring(var.viewport_height)
      NAVIGATION_TIMEOUT_MS            = tostring(var.navigation_timeout_ms)
      SUITE_S3_KEY                     = "config/suites/${each.value.app_id}.json"
      SUITE_CHECKS_JSON                = jsonencode(local.enabled_test_suite)
      PORTAL_CONFIG_S3_KEY             = aws_s3_object.portal_runtime_config.key
      SSM_CONFIG_PARAMETER             = aws_ssm_parameter.portal_runtime_config.name
      S3_ARTIFACT_BUCKET               = aws_s3_bucket.synthetics_artifacts.id
      DYNAMODB_RUNS_TABLE              = aws_dynamodb_table.release_gate_runs.name
      BEDROCK_NOVA_LITE_MODEL_ID       = var.bedrock_nova_lite_model_id
      VISUAL_JUDGE_COST_GATE_PCT       = tostring(var.visual_judge_pixel_cost_gate_pct)
      VISUAL_JUDGE_MINOR_THRESHOLD_PCT = tostring(var.visual_judge_minor_threshold_pct)
    }
  }

  depends_on = [
    aws_s3_object.canary_bundle,
    aws_s3_object.property_suite_json,
    aws_s3_object.portal_runtime_config,
    aws_iam_role_policy.synthetics_bedrock_s3_policy,
    aws_cloudwatch_log_group.canary_logs
  ]
}

resource "aws_cloudwatch_metric_alarm" "canary_failed_alarm" {
  for_each            = var.deploy_synthetics_canaries ? { for t in local.canary_targets : t.key => t } : {}
  alarm_name          = "AkamaiGateCanaryAlarm-${each.value.canary_name}"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = var.alarm_evaluation_periods
  metric_name         = "SuccessPercent"
  namespace           = "CloudWatchSynthetics"
  period              = 900
  statistic           = "Average"
  threshold           = var.alarm_success_threshold_pct
  alarm_description   = "Triggers when Akamai Synthetic Release Gate Canary ${each.value.canary_name} (${each.value.target_id}) drops below ${var.alarm_success_threshold_pct}% pass rate"
  treat_missing_data  = "notBreaching"

  dimensions = {
    CanaryName = aws_synthetics_canary.property_gate[each.key].name
  }

  alarm_actions = [aws_sns_topic.release_gate_alerts.arn]
  ok_actions    = [aws_sns_topic.release_gate_alerts.arn]
}

# ============================================================================
# 9. SCALE-TO-ZERO AWS LAMBDA FUNCTIONS & API GATEWAY V2 ($0/IDLE AD-HOC MODE)
# ============================================================================
data "archive_file" "adhoc_runner_lambda_zip" {
  type        = "zip"
  output_path = "${path.module}/.terraform/tmp/adhoc-edge-runner.zip"

  source {
    content  = file("${path.module}/../../aws-lambda/adhoc-edge-runner.js")
    filename = "adhoc-edge-runner.js"
  }
}

data "archive_file" "control_plane_lambda_zip" {
  type        = "zip"
  output_path = "${path.module}/.terraform/tmp/control-plane-handler.zip"

  source {
    content  = file("${path.module}/../../aws-lambda/control-plane-handler.js")
    filename = "control-plane-handler.js"
  }
}

resource "aws_cloudwatch_log_group" "adhoc_runner_logs" {
  count             = var.deploy_serverless_lambda ? 1 : 0
  name              = "/aws/lambda/${var.project_name}-adhoc-runner-${var.environment}"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "adhoc_edge_runner" {
  count            = var.deploy_serverless_lambda ? 1 : 0
  function_name    = "${var.project_name}-adhoc-runner-${var.environment}"
  description      = "Scale-to-zero ($0/idle) on-demand Akamai Staging vs Prod edge synthetic runner"
  role             = aws_iam_role.synthetics_canary_role.arn
  handler          = "adhoc-edge-runner.handler"
  runtime          = var.lambda_runtime
  architectures    = [var.lambda_architecture]
  filename         = data.archive_file.adhoc_runner_lambda_zip.output_path
  source_code_hash = data.archive_file.adhoc_runner_lambda_zip.output_base64sha256
  memory_size      = var.adhoc_runner_lambda_memory_mb
  timeout          = var.adhoc_runner_lambda_timeout_seconds

  environment {
    variables = {
      ENVIRONMENT                = var.environment
      S3_ARTIFACT_BUCKET         = aws_s3_bucket.synthetics_artifacts.id
      DYNAMODB_RUNS_TABLE        = aws_dynamodb_table.release_gate_runs.name
      DEFAULT_DOMAIN             = var.default_domain
      AKAMAI_STAGING_EDGE_SUFFIX = var.staging_edge_suffix
      AKAMAI_STAGING_EDGE_IP     = var.staging_edge_ip
      AKAMAI_PROD_EDGE_SUFFIX    = var.prod_edge_suffix
      AKAMAI_PROD_EDGE_IP        = var.prod_edge_ip
      AKAMAI_PRAGMA_HEADERS      = join(",", var.akamai_pragma_headers)
      CANARY_USER_AGENT          = var.canary_user_agent
      NAVIGATION_TIMEOUT_MS      = tostring(var.navigation_timeout_ms)
      SUITE_CHECKS_JSON          = jsonencode(local.enabled_test_suite)
    }
  }

  depends_on = [
    aws_iam_role_policy.synthetics_bedrock_s3_policy,
    aws_cloudwatch_log_group.adhoc_runner_logs
  ]
}

resource "aws_cloudwatch_metric_alarm" "adhoc_runner_lambda_alarm" {
  count               = var.deploy_serverless_lambda ? 1 : 0
  alarm_name          = "${var.project_name}-adhoc-runner-errors-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Errors"
  namespace           = "AWS/Lambda"
  period              = 300
  statistic           = "Sum"
  threshold           = 0
  alarm_description   = "Triggers when the Salesforce Ad-Hoc Edge Synthetic Runner Lambda encounters execution errors"
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = aws_lambda_function.adhoc_edge_runner[0].function_name
  }

  alarm_actions = [aws_sns_topic.release_gate_alerts.arn]
  ok_actions    = [aws_sns_topic.release_gate_alerts.arn]
}

locals {
  use_ecr_chromium_runner       = var.deploy_serverless_lambda && var.enable_chromium_screenshot_lambda && length(trimspace(var.chromium_runner_image_uri)) > 0
  sparticuz_runner_bundle_path  = "${path.module}/../../aws-lambda/.dist/sparticuz-screenshot-runner.js"
  use_sparticuz_chromium_runner = var.deploy_serverless_lambda && var.enable_sparticuz_chromium_lambda && !local.use_ecr_chromium_runner && fileexists(local.sparticuz_runner_bundle_path)
}

data "archive_file" "sparticuz_chromium_lambda_zip" {
  count       = local.use_sparticuz_chromium_runner ? 1 : 0
  type        = "zip"
  output_path = "${path.module}/.terraform/tmp/sparticuz-screenshot-runner.zip"

  source {
    content  = file(local.sparticuz_runner_bundle_path)
    filename = "sparticuz-screenshot-runner.js"
  }
}

resource "aws_cloudwatch_log_group" "sparticuz_chromium_logs" {
  count             = local.use_sparticuz_chromium_runner ? 1 : 0
  name              = "/aws/lambda/${var.project_name}-chromium-zip-runner-${var.environment}"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "sparticuz_chromium_runner" {
  count            = local.use_sparticuz_chromium_runner ? 1 : 0
  function_name    = "${var.project_name}-chromium-zip-runner-${var.environment}"
  description      = "Zero-Docker scale-to-zero ($0/idle) headless Chromium ZIP Lambda (@sparticuz/chromium-min + puppeteer-core) for synchronous 1280x760 screenshots"
  role             = aws_iam_role.synthetics_canary_role.arn
  handler          = "sparticuz-screenshot-runner.handler"
  runtime          = "nodejs22.x"
  architectures    = ["x86_64"]
  filename         = data.archive_file.sparticuz_chromium_lambda_zip[0].output_path
  source_code_hash = data.archive_file.sparticuz_chromium_lambda_zip[0].output_base64sha256
  memory_size      = var.chromium_runner_lambda_memory_mb
  timeout          = var.chromium_runner_lambda_timeout_seconds

  ephemeral_storage {
    size = 1024
  }

  environment {
    variables = {
      NODE_ENV                   = "production"
      ENVIRONMENT                = var.environment
      SYNTHETICS_S3_BUCKET       = aws_s3_bucket.synthetics_artifacts.id
      CHROMIUM_PACK_S3_PREFIX    = var.sparticuz_chromium_s3_prefix
      AKAMAI_PRAGMA_HEADERS      = join(",", var.akamai_pragma_headers)
    }
  }

  depends_on = [
    aws_iam_role_policy.synthetics_bedrock_s3_policy,
    aws_cloudwatch_log_group.sparticuz_chromium_logs
  ]
}

resource "aws_cloudwatch_log_group" "control_plane_logs" {
  count             = var.deploy_serverless_lambda ? 1 : 0
  name              = "/aws/lambda/${var.project_name}-control-plane-${var.environment}"
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_log_group" "chromium_runner_logs" {
  count             = local.use_ecr_chromium_runner ? 1 : 0
  name              = "/aws/lambda/${var.project_name}-chromium-runner-${var.environment}"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "chromium_screenshot_runner" {
  count         = local.use_ecr_chromium_runner ? 1 : 0
  function_name = "${var.project_name}-chromium-runner-${var.environment}"
  description   = "Optional container AWS Lambda running headless Playwright Chromium for synchronous 1280x760 screenshots"
  role          = aws_iam_role.synthetics_canary_role.arn
  package_type  = "Image"
  image_uri     = trimspace(var.chromium_runner_image_uri)
  architectures = [var.lambda_architecture]
  memory_size   = var.chromium_runner_lambda_memory_mb
  timeout       = var.chromium_runner_lambda_timeout_seconds

  environment {
    variables = {
      NODE_ENV              = "production"
      ENVIRONMENT           = var.environment
      SYNTHETICS_S3_BUCKET  = aws_s3_bucket.synthetics_artifacts.id
      AKAMAI_PRAGMA_HEADERS = join(",", var.akamai_pragma_headers)
    }
  }

  depends_on = [
    aws_iam_role_policy.synthetics_bedrock_s3_policy,
    aws_cloudwatch_log_group.chromium_runner_logs
  ]
}

resource "aws_lambda_function" "control_plane_api" {
  count            = var.deploy_serverless_lambda ? 1 : 0
  function_name    = "${var.project_name}-control-plane-${var.environment}"
  description      = "Scale-to-zero ($0/idle) Control Plane REST API, OpenAPI 3.1 & MCP JSON-RPC Server"
  role             = aws_iam_role.synthetics_canary_role.arn
  handler          = "control-plane-handler.handler"
  runtime          = var.lambda_runtime
  architectures    = [var.lambda_architecture]
  filename         = data.archive_file.control_plane_lambda_zip.output_path
  source_code_hash = data.archive_file.control_plane_lambda_zip.output_base64sha256
  memory_size      = var.control_plane_lambda_memory_mb
  timeout          = var.control_plane_lambda_timeout_seconds

  environment {
    variables = {
      NODE_ENV                         = "production"
      ENVIRONMENT                      = var.environment
      PROJECT_NAME                     = var.project_name
      SYNTHETICS_CANARY_PREFIX         = "ak"
      DEPLOY_SYNTHETICS_CANARIES       = tostring(var.deploy_synthetics_canaries)
      COMPUTE_ARCHITECTURE             = "aws-lambda-scale-to-zero"
      SYNTHETICS_S3_BUCKET             = aws_s3_bucket.synthetics_artifacts.id
      SYNTHETICS_DYNAMODB_TABLE        = aws_dynamodb_table.release_gate_runs.name
      PORTAL_CONFIG_S3_KEY             = aws_s3_object.portal_runtime_config.key
      SSM_CONFIG_PARAMETER             = aws_ssm_parameter.portal_runtime_config.name
      ADHOC_RUNNER_LAMBDA_NAME         = aws_lambda_function.adhoc_edge_runner[0].function_name
      CHROMIUM_RUNNER_LAMBDA_NAME      = local.use_ecr_chromium_runner ? aws_lambda_function.chromium_screenshot_runner[0].function_name : (local.use_sparticuz_chromium_runner ? aws_lambda_function.sparticuz_chromium_runner[0].function_name : "")
      BEDROCK_VISUAL_JUDGE_MODEL_ID    = var.bedrock_nova_lite_model_id
      BEDROCK_VISUAL_JUDGE_MODEL_ARN   = local.bedrock_model_arn
      VISUAL_JUDGE_COST_GATE_PCT       = tostring(var.visual_judge_pixel_cost_gate_pct)
      VISUAL_JUDGE_MINOR_THRESHOLD_PCT = tostring(var.visual_judge_minor_threshold_pct)
      DEFAULT_DOMAIN                   = var.default_domain
      AKAMAI_STAGING_EDGE_SUFFIX       = var.staging_edge_suffix
      AKAMAI_STAGING_EDGE_IP           = var.staging_edge_ip
      AKAMAI_PROD_EDGE_SUFFIX          = var.prod_edge_suffix
      AKAMAI_PROD_EDGE_IP              = var.prod_edge_ip
    }
  }

  depends_on = [
    aws_iam_role_policy.synthetics_bedrock_s3_policy,
    aws_cloudwatch_log_group.control_plane_logs,
    aws_lambda_function.adhoc_edge_runner
  ]
}

resource "aws_cloudwatch_metric_alarm" "control_plane_lambda_alarm" {
  count               = var.deploy_serverless_lambda ? 1 : 0
  alarm_name          = "${var.project_name}-control-plane-errors-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Errors"
  namespace           = "AWS/Lambda"
  period              = 300
  statistic           = "Sum"
  threshold           = 0
  alarm_description   = "Triggers when the Salesforce Control Plane API/MCP Lambda encounters execution errors"
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = aws_lambda_function.control_plane_api[0].function_name
  }

  alarm_actions = [aws_sns_topic.release_gate_alerts.arn]
  ok_actions    = [aws_sns_topic.release_gate_alerts.arn]
}

resource "aws_lambda_function_url" "control_plane_url" {
  count              = var.deploy_serverless_lambda && var.enable_lambda_function_url ? 1 : 0
  function_name      = aws_lambda_function.control_plane_api[0].function_name
  authorization_type = "NONE"

  cors {
    allow_credentials = false
    allow_origins     = ["*"]
    allow_methods     = ["*"]
    allow_headers     = ["content-type", "authorization"]
    max_age           = 86400
  }
}

resource "aws_apigatewayv2_api" "control_plane_http_api" {
  count         = var.deploy_serverless_lambda && var.enable_apigateway_http_api ? 1 : 0
  name          = "${var.project_name}-http-api-${var.environment}"
  protocol_type = "HTTP"
  description   = "Scale-to-zero ($0/idle) HTTP API v2 fronting the Akamai Release Gate Control Plane & MCP Lambda"

  cors_configuration {
    allow_origins = ["*"]
    allow_methods = ["GET", "POST", "OPTIONS"]
    allow_headers = ["content-type", "authorization"]
    max_age       = 86400
  }
}

resource "aws_apigatewayv2_integration" "lambda_integration" {
  count                  = var.deploy_serverless_lambda && var.enable_apigateway_http_api ? 1 : 0
  api_id                 = aws_apigatewayv2_api.control_plane_http_api[0].id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.control_plane_api[0].invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "default_route" {
  count     = var.deploy_serverless_lambda && var.enable_apigateway_http_api ? 1 : 0
  api_id    = aws_apigatewayv2_api.control_plane_http_api[0].id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.lambda_integration[0].id}"
}

resource "aws_apigatewayv2_stage" "default_stage" {
  count       = var.deploy_serverless_lambda && var.enable_apigateway_http_api ? 1 : 0
  api_id      = aws_apigatewayv2_api.control_plane_http_api[0].id
  name        = "$default"
  auto_deploy = true
}

resource "aws_lambda_permission" "apigw_invoke" {
  count         = var.deploy_serverless_lambda && var.enable_apigateway_http_api ? 1 : 0
  statement_id  = "AllowExecutionFromAPIGatewayV2"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.control_plane_api[0].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.control_plane_http_api[0].execution_arn}/*/*"
}

# ============================================================================
# 9B. AMAZON CLOUDFRONT DISTRIBUTION (S3 SPA ORIGIN + /api/* LAMBDA ORIGIN)
# ============================================================================
locals {
  spa_dist_dir   = "${path.module}/../../dist"
  spa_dist_files = toset([
    for f in fileset(local.spa_dist_dir, "**/*") : f
    if !startswith(f, "assets/aistudio/") && !startswith(f, "screenshots/")
  ])
  spa_mime_types = {
    ".html" = "text/html; charset=utf-8"
    ".js"   = "application/javascript; charset=utf-8"
    ".css"  = "text/css; charset=utf-8"
    ".json" = "application/json; charset=utf-8"
    ".svg"  = "image/svg+xml"
    ".png"  = "image/png"
    ".jpg"  = "image/jpeg"
    ".jpeg" = "image/jpeg"
    ".ico"  = "image/x-icon"
  }
}

resource "aws_s3_object" "portal_spa_bundle" {
  for_each      = local.spa_dist_files
  bucket        = aws_s3_bucket.synthetics_artifacts.id
  key           = "${trimprefix(var.cloudfront_spa_origin_path, "/")}/${each.value}"
  source        = "${local.spa_dist_dir}/${each.value}"
  etag          = filemd5("${local.spa_dist_dir}/${each.value}")
  content_type  = try(lookup(local.spa_mime_types, regex("\\.[^.]+$", each.value), "application/octet-stream"), "application/octet-stream")
  cache_control = each.value == "index.html" ? "no-cache, max-age=0, must-revalidate" : "public, max-age=31536000, immutable"

  depends_on = [aws_s3_bucket_versioning.synthetics_versioning]
}

resource "aws_cloudfront_origin_access_control" "portal_oac" {
  count                             = var.deploy_cloudfront_distribution ? 1 : 0
  name                              = "${var.project_name}-s3-oac-${var.environment}-${var.aws_region}"
  description                       = "Origin Access Control (SigV4) for Akamai Release Gate S3 SPA Origin"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}


resource "aws_cloudfront_distribution" "portal_cdn" {
  count               = var.deploy_cloudfront_distribution && var.deploy_serverless_lambda && var.enable_apigateway_http_api ? 1 : 0
  enabled             = true
  is_ipv6_enabled     = true
  comment             = "Akamai Synthetic Release Gate — Scale-to-Zero SPA + Serverless API/MCP Distribution (${var.environment})"
  default_root_object = "index.html"
  price_class         = var.cloudfront_price_class
  http_version        = "http2and3"

  # Origin 1: S3 Bucket (React SPA static assets under /portal-ui)
  origin {
    domain_name              = aws_s3_bucket.synthetics_artifacts.bucket_regional_domain_name
    origin_id                = "S3PortalSpaOrigin"
    origin_path              = var.cloudfront_spa_origin_path
    origin_access_control_id = aws_cloudfront_origin_access_control.portal_oac[0].id
  }

  # Origin 2: Scale-to-Zero API Gateway v2 HTTP API -> Control Plane & MCP Lambda
  origin {
    domain_name = replace(aws_apigatewayv2_api.control_plane_http_api[0].api_endpoint, "https://", "")
    origin_id   = "ControlPlaneApiOrigin"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  # Default Behavior: Serve React SPA from S3 with OAC (static screenshots are excluded; live screenshots route to Lambda)
  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "S3PortalSpaOrigin"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true
    min_ttl                = 0
    default_ttl            = 0
    max_ttl                = 86400

    forwarded_values {
      query_string = true
      cookies {
        forward = "none"
      }
    }
  }

  # Ordered Behavior: Route all /screenshots/* requests directly to Control Plane Lambda (zero CloudFront caching, always live Chromium / verified live S3)
  ordered_cache_behavior {
    path_pattern           = "/screenshots/*"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "ControlPlaneApiOrigin"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true
    min_ttl                = 0
    default_ttl            = 0
    max_ttl                = 0

    forwarded_values {
      query_string = true
      headers      = ["Accept", "Authorization", "Origin"]
      cookies {
        forward = "none"
      }
    }
  }

  # Ordered Behavior: Route all /api/* requests (REST, OpenAPI, MCP, Synthetics, Users) to Lambda
  ordered_cache_behavior {
    path_pattern           = "/api/*"
    allowed_methods        = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "ControlPlaneApiOrigin"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true
    min_ttl                = 0
    default_ttl            = 0
    max_ttl                = 0

    forwarded_values {
      query_string = true
      headers      = ["Accept", "Authorization", "Content-Type", "X-Operator-Email"]
      cookies {
        forward = "all"
      }
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }

  depends_on = [
    aws_s3_object.portal_spa_bundle,
    aws_apigatewayv2_stage.default_stage
  ]
}

resource "aws_s3_bucket_policy" "allow_cloudfront_oac" {
  count  = var.deploy_cloudfront_distribution && var.deploy_serverless_lambda && var.enable_apigateway_http_api ? 1 : 0
  bucket = aws_s3_bucket.synthetics_artifacts.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AllowCloudFrontServicePrincipalReadSpaAssets"
        Effect    = "Allow"
        Principal = { Service = "cloudfront.amazonaws.com" }
        Action    = "s3:GetObject"
        Resource  = "${aws_s3_bucket.synthetics_artifacts.arn}${var.cloudfront_spa_origin_path}/*"
        Condition = {
          StringEquals = {
            "AWS:SourceArn" = aws_cloudfront_distribution.portal_cdn[0].arn
          }
        }
      }
    ]
  })
}

# Seed initial operator user records in DynamoDB for CLI/API user management & tracking
resource "aws_dynamodb_table_item" "seeded_operator_users" {
  for_each   = var.seed_accepted_rules_in_dynamodb ? { for u in var.initial_operator_users : u.email => u } : {}
  table_name = aws_dynamodb_table.release_gate_runs.name
  hash_key   = aws_dynamodb_table.release_gate_runs.hash_key
  range_key  = aws_dynamodb_table.release_gate_runs.range_key

  item = jsonencode({
    target      = { S = "__USER__" }
    runKey      = { S = each.value.email }
    appId       = { S = "__USERS__" }
    userEmail   = { S = each.value.email }
    payloadJson = {
      S = jsonencode({
        userId             = "usr-${substr(sha256(each.value.email), 0, 8)}"
        email              = each.value.email
        displayName        = each.value.display_name
        role               = each.value.role
        status             = "active"
        createdAt          = "2026-03-01T00:00:00.000Z"
        passwordUpdatedAt  = "2026-03-01T00:00:00.000Z"
        passwordResetCount = 0
        stats = {
          totalActions          = 1
          runsTriggered         = 1
          comparisonsEvaluated  = 0
          visualJudgesInvoked   = 0
          mcpCallsExecuted      = 0
          cliCommandsRun        = 0
          lastActiveAt          = "2026-03-01T00:00:00.000Z"
          lastActionName        = "trigger_run"
        }
      })
    }
  })
}

# ============================================================================
# 10. OPTIONAL ECR & APP RUNNER (DISABLED BY DEFAULT FOR $0/IDLE LAMBDA MODE)
# ============================================================================
resource "aws_ecr_repository" "control_plane" {
  count                = var.deploy_apprunner_service ? 1 : 0
  name                 = var.ecr_repository_name
  image_tag_mutability = "MUTABLE"
  force_delete         = true

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_iam_role" "apprunner_ecr_access_role" {
  count = var.deploy_apprunner_service ? 1 : 0
  name  = "AkamaiGateAppRunnerEcrAccessRole-${var.environment}-${var.aws_region}"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Principal = { Service = "build.apprunner.amazonaws.com" }
        Action    = "sts:AssumeRole"
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "apprunner_ecr_policy" {
  count      = var.deploy_apprunner_service ? 1 : 0
  role       = aws_iam_role.apprunner_ecr_access_role[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess"
}

resource "aws_apprunner_service" "control_plane" {
  count        = var.deploy_apprunner_service ? 1 : 0
  service_name = "${var.project_name}-${var.environment}-${var.aws_region}"

  source_configuration {
    authentication_configuration {
      access_role_arn = aws_iam_role.apprunner_ecr_access_role[0].arn
    }
    image_repository {
      image_identifier      = "${aws_ecr_repository.control_plane[0].repository_url}:${var.container_image_tag}"
      image_repository_type = "ECR"
      image_configuration {
        port = var.apprunner_port
        runtime_environment_variables = {
          NODE_ENV                         = "production"
          PORT                             = var.apprunner_port
          AWS_REGION                       = var.aws_region
          ENVIRONMENT                      = var.environment
          DATA_SOURCE_MODE                 = "remote-api"
          SYNTHETICS_S3_BUCKET             = aws_s3_bucket.synthetics_artifacts.id
          SYNTHETICS_DYNAMODB_TABLE        = aws_dynamodb_table.release_gate_runs.name
          PORTAL_CONFIG_S3_KEY             = aws_s3_object.portal_runtime_config.key
          SSM_CONFIG_PARAMETER             = aws_ssm_parameter.portal_runtime_config.name
          BEDROCK_VISUAL_JUDGE_MODEL_ID    = var.bedrock_nova_lite_model_id
          BEDROCK_VISUAL_JUDGE_MODEL_ARN   = local.bedrock_model_arn
          VISUAL_JUDGE_COST_GATE_PCT       = tostring(var.visual_judge_pixel_cost_gate_pct)
          VISUAL_JUDGE_MINOR_THRESHOLD_PCT = tostring(var.visual_judge_minor_threshold_pct)
          VISUAL_JUDGE_TEMPERATURE         = tostring(var.visual_judge_temperature)
          VISUAL_JUDGE_MAX_TOKENS          = tostring(var.visual_judge_max_tokens)
          DEFAULT_DOMAIN                   = var.default_domain
          AKAMAI_STAGING_EDGE_SUFFIX       = var.staging_edge_suffix
          AKAMAI_STAGING_EDGE_IP           = var.staging_edge_ip
          AKAMAI_PROD_EDGE_SUFFIX          = var.prod_edge_suffix
          AKAMAI_PROD_EDGE_IP              = var.prod_edge_ip
          AKAMAI_PRAGMA_HEADERS            = join(",", var.akamai_pragma_headers)
          CANARY_USER_AGENT                = var.canary_user_agent
          VIEWPORT_WIDTH                   = tostring(var.viewport_width)
          VIEWPORT_HEIGHT                  = tostring(var.viewport_height)
          NAVIGATION_TIMEOUT_MS            = tostring(var.navigation_timeout_ms)
          MCP_SERVER_URI                   = var.mcp_endpoint_uri
          MCP_NPM_PACKAGE                  = var.mcp_npm_package
        }
      }
    }
    auto_deployments_enabled = true
  }

  instance_configuration {
    cpu               = var.apprunner_cpu
    memory            = var.apprunner_memory
    instance_role_arn = aws_iam_role.synthetics_canary_role.arn
  }

  health_check_configuration {
    protocol            = "HTTP"
    path                = var.apprunner_health_check_path
    interval            = 10
    timeout             = 5
    healthy_threshold   = 1
    unhealthy_threshold = 5
  }
}

# ============================================================================
# 11. AUTOMATIC .ENV.TERRAFORM GENERATION FOR LOCAL / CI-CD SYNC
# ============================================================================
resource "local_file" "dotenv_terraform" {
  count    = var.generate_local_dotenv ? 1 : 0
  filename = "${path.module}/../../.env.terraform"
  content  = <<-EOT
    # Auto-generated by Terraform on apply (infra/terraform/main.tf)
    PORT=${var.apprunner_port}
    NODE_ENV=production
    ENVIRONMENT=${var.environment}
    AWS_REGION=${var.aws_region}
    COMPUTE_ARCHITECTURE=aws-lambda-scale-to-zero
    DEPLOYMENT_TOPOLOGY=cloudfront-s3-oac-plus-lambda-apigw-v2
    CLOUDFRONT_DISTRIBUTION_ID=${var.deploy_cloudfront_distribution && var.deploy_serverless_lambda && var.enable_apigateway_http_api ? aws_cloudfront_distribution.portal_cdn[0].id : "disabled"}
    CLOUDFRONT_PORTAL_URL=${var.deploy_cloudfront_distribution && var.deploy_serverless_lambda && var.enable_apigateway_http_api ? "https://${aws_cloudfront_distribution.portal_cdn[0].domain_name}" : "disabled"}
    DATA_SOURCE_MODE=remote-api
    CONTROL_PLANE_LAMBDA_NAME=${var.deploy_serverless_lambda ? aws_lambda_function.control_plane_api[0].function_name : "disabled"}
    ADHOC_RUNNER_LAMBDA_NAME=${var.deploy_serverless_lambda ? aws_lambda_function.adhoc_edge_runner[0].function_name : "disabled"}
    CHROMIUM_RUNNER_LAMBDA_NAME=${local.use_ecr_chromium_runner ? aws_lambda_function.chromium_screenshot_runner[0].function_name : (local.use_sparticuz_chromium_runner ? aws_lambda_function.sparticuz_chromium_runner[0].function_name : "disabled")}
    CHROMIUM_PACK_S3_PREFIX=${var.sparticuz_chromium_s3_prefix}
    SYNTHETICS_RUNNER_ENGINE=AWS Lambda Ad-Hoc + CloudWatch Synthetics (Run-Once)
    SYNTHETICS_RUNTIME_VERSION=${var.synthetics_runtime_version}
    CANARY_SCHEDULE_EXPRESSION=${var.canary_schedule_expression}
    START_CANARIES_ON_APPLY=${var.start_canaries_on_apply}
    SYNTHETICS_S3_BUCKET=s3://${aws_s3_bucket.synthetics_artifacts.id}
    SYNTHETICS_DYNAMODB_TABLE=${aws_dynamodb_table.release_gate_runs.name}
    PORTAL_CONFIG_S3_KEY=${aws_s3_object.portal_runtime_config.key}
    SSM_CONFIG_PARAMETER=${aws_ssm_parameter.portal_runtime_config.name}
    SYNTHETICS_IAM_ROLE_ARN=${aws_iam_role.synthetics_canary_role.arn}
    SNS_ALERTS_TOPIC_ARN=${aws_sns_topic.release_gate_alerts.arn}
    BEDROCK_VISUAL_JUDGE_MODEL_ID=${var.bedrock_nova_lite_model_id}
    BEDROCK_VISUAL_JUDGE_MODEL_ARN=${local.bedrock_model_arn}
    VISUAL_JUDGE_COST_GATE_PCT=${var.visual_judge_pixel_cost_gate_pct}
    VISUAL_JUDGE_MINOR_THRESHOLD_PCT=${var.visual_judge_minor_threshold_pct}
    VISUAL_JUDGE_TEMPERATURE=${var.visual_judge_temperature}
    VISUAL_JUDGE_MAX_TOKENS=${var.visual_judge_max_tokens}
    DEFAULT_DOMAIN=${var.default_domain}
    AKAMAI_STAGING_EDGE_SUFFIX=${var.staging_edge_suffix}
    AKAMAI_STAGING_EDGE_IP=${var.staging_edge_ip}
    AKAMAI_PROD_EDGE_SUFFIX=${var.prod_edge_suffix}
    AKAMAI_PROD_EDGE_IP=${var.prod_edge_ip}
    AKAMAI_PRAGMA_HEADERS=${join(",", var.akamai_pragma_headers)}
    CANARY_USER_AGENT=${var.canary_user_agent}
    VIEWPORT_WIDTH=${var.viewport_width}
    VIEWPORT_HEIGHT=${var.viewport_height}
    NAVIGATION_TIMEOUT_MS=${var.navigation_timeout_ms}
    MCP_SERVER_URI=${var.mcp_endpoint_uri}
    MCP_NPM_PACKAGE=${var.mcp_npm_package}
  EOT
}
