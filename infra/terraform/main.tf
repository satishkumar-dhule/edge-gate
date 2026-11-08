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
        Sid    = "CloudWatchSyntheticsControlAndMetrics"
        Effect = "Allow"
        Action = [
          "cloudwatch:PutMetricData",
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
          "synthetics:StartCanary",
          "synthetics:StopCanary",
          "synthetics:GetCanary",
          "synthetics:GetCanaryRuns",
          "synthetics:DescribeCanaries",
          "xray:PutTraceSegments",
          "xray:PutTelemetryRecords"
        ]
        Resource = "*"
      }
    ]
  })
}

# ============================================================================
# 8. AWS CLOUDWATCH SYNTHETICS CANARIES, LOG GROUPS & METRIC ALARMS
# ============================================================================
resource "aws_cloudwatch_log_group" "canary_logs" {
  for_each          = { for t in local.canary_targets : t.key => t }
  name              = "/aws/lambda/cwsyn-${each.value.canary_name}"
  retention_in_days = var.log_retention_days
}

resource "aws_synthetics_canary" "property_gate" {
  for_each                 = { for t in local.canary_targets : t.key => t }
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
      AWS_REGION                       = var.aws_region
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
  for_each            = { for t in local.canary_targets : t.key => t }
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
# 9. AMAZON ECR REPOSITORY & AWS APP RUNNER CONTROL PLANE SERVICE
# ============================================================================
resource "aws_ecr_repository" "control_plane" {
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
      image_identifier      = "${aws_ecr_repository.control_plane.repository_url}:${var.container_image_tag}"
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
# 10. AUTOMATIC .ENV.TERRAFORM GENERATION FOR LOCAL / CI-CD SYNC
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
    DATA_SOURCE_MODE=remote-api
    SYNTHETICS_RUNNER_ENGINE=AWS CloudWatch Synthetics
    SYNTHETICS_RUNTIME_VERSION=${var.synthetics_runtime_version}
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
