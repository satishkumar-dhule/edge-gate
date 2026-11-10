# ============================================================================
# TERRAFORM OUTPUTS — AKAMAI SYNTHETIC RELEASE GATE (100% CONFIG-AS-CODE)
# ============================================================================

output "aws_account_id" {
  description = "AWS Account ID where the Akamai Synthetic Release Gate is deployed"
  value       = data.aws_caller_identity.current.account_id
}

output "environment" {
  description = "Deployment environment stage"
  value       = var.environment
}

output "s3_artifact_bucket_name" {
  description = "Provisioned S3 bucket storing HARs, headers, cookies, screenshots, and suite configs"
  value       = aws_s3_bucket.synthetics_artifacts.id
}

output "s3_artifact_bucket_arn" {
  description = "ARN of the S3 artifact and configuration bucket"
  value       = aws_s3_bucket.synthetics_artifacts.arn
}

output "s3_portal_runtime_config_uri" {
  description = "S3 URI of the Terraform-provisioned portal runtime configuration JSON"
  value       = "s3://${aws_s3_bucket.synthetics_artifacts.id}/${aws_s3_object.portal_runtime_config.key}"
}

output "s3_property_suite_uris" {
  description = "Map of property ID to Terraform-provisioned S3 test suite CSV and JSON URIs"
  value = {
    for k, v in aws_s3_object.property_suite_json :
    k => {
      json = "s3://${aws_s3_bucket.synthetics_artifacts.id}/${v.key}"
      csv  = "s3://${aws_s3_bucket.synthetics_artifacts.id}/${aws_s3_object.property_suite_csv[k].key}"
    }
  }
}

output "ssm_parameter_names" {
  description = "AWS Systems Manager (SSM) Parameter Store paths containing Terraform-managed configurations"
  value = {
    runtime_config = aws_ssm_parameter.portal_runtime_config.name
    edge_networks  = aws_ssm_parameter.edge_network_config.name
    visual_judge   = aws_ssm_parameter.visual_judge_config.name
  }
}

output "dynamodb_runs_table_name" {
  description = "Provisioned DynamoDB table storing run metadata, seeded config, and accepted diff rules"
  value       = aws_dynamodb_table.release_gate_runs.name
}

output "dynamodb_runs_table_arn" {
  description = "ARN of the DynamoDB runs table"
  value       = aws_dynamodb_table.release_gate_runs.arn
}

output "sns_alerts_topic_arn" {
  description = "SNS Topic ARN receiving CloudWatch Synthetics Canary failure alarms"
  value       = aws_sns_topic.release_gate_alerts.arn
}

output "synthetics_execution_role_arn" {
  description = "IAM Role ARN used by CloudWatch Synthetics Canaries, App Runner, and Bedrock Nova Lite Judge"
  value       = aws_iam_role.synthetics_canary_role.arn
}

output "bedrock_nova_lite_model_arn" {
  description = "Amazon Bedrock Nova Lite foundation model ARN configured for visual diff evaluation"
  value       = local.bedrock_model_arn
}

output "provisioned_canary_names" {
  description = "Map of target_id to AWS CloudWatch Synthetics Canary names"
  value       = { for k, v in aws_synthetics_canary.property_gate : k => v.name }
}

output "provisioned_canary_alarm_names" {
  description = "Map of target_id to CloudWatch Metric Alarm names monitoring Canary pass rate"
  value       = { for k, v in aws_cloudwatch_metric_alarm.canary_failed_alarm : k => v.alarm_name }
}

output "lambda_cloudwatch_alarm_names" {
  description = "CloudWatch Metric Alarms monitoring the Scale-to-Zero Ad-Hoc Runner and Control Plane Lambda functions"
  value = var.deploy_serverless_lambda ? {
    adhoc_runner_errors  = aws_cloudwatch_metric_alarm.adhoc_runner_lambda_alarm[0].alarm_name
    control_plane_errors = aws_cloudwatch_metric_alarm.control_plane_lambda_alarm[0].alarm_name
  } : {}
}

output "s3_portal_spa_files" {
  description = "Compiled React SPA files uploaded by Terraform to the S3 CloudFront origin"
  value       = [for k, v in aws_s3_object.portal_spa_bundle : "s3://${aws_s3_bucket.synthetics_artifacts.id}/${v.key}"]
}

output "control_plane_lambda_function_name" {
  description = "Scale-to-Zero ($0/idle) Control Plane REST API, OpenAPI 3.1 & MCP AWS Lambda Function Name"
  value       = var.deploy_serverless_lambda ? aws_lambda_function.control_plane_api[0].function_name : "disabled"
}

output "adhoc_runner_lambda_function_name" {
  description = "Scale-to-Zero ($0/idle) Ad-Hoc On-Demand Akamai Edge Synthetic Runner AWS Lambda Function Name"
  value       = var.deploy_serverless_lambda ? aws_lambda_function.adhoc_edge_runner[0].function_name : "disabled"
}

output "control_plane_lambda_function_url" {
  description = "Direct HTTPS AWS Lambda Function URL for the Scale-to-Zero Control Plane & MCP Server"
  value       = var.deploy_serverless_lambda && var.enable_lambda_function_url ? aws_lambda_function_url.control_plane_url[0].function_url : "disabled"
}

output "apigateway_http_api_endpoint" {
  description = "Amazon API Gateway v2 HTTP API endpoint fronting the Scale-to-Zero Control Plane Lambda ($0/idle)"
  value       = var.deploy_serverless_lambda && var.enable_apigateway_http_api ? aws_apigatewayv2_api.control_plane_http_api[0].api_endpoint : "disabled"
}

output "cloudfront_distribution_id" {
  description = "Amazon CloudFront Distribution ID serving the React SPA (/*) and Scale-to-Zero Control Plane API (/api/*)"
  value       = var.deploy_cloudfront_distribution && var.deploy_serverless_lambda && var.enable_apigateway_http_api ? aws_cloudfront_distribution.portal_cdn[0].id : "disabled"
}

output "cloudfront_distribution_domain_name" {
  description = "Amazon CloudFront Distribution domain name (e.g., d111111abcdef8.cloudfront.net)"
  value       = var.deploy_cloudfront_distribution && var.deploy_serverless_lambda && var.enable_apigateway_http_api ? aws_cloudfront_distribution.portal_cdn[0].domain_name : "disabled"
}

output "cloudfront_portal_url" {
  description = "Primary HTTPS URL of the deployed CloudFront Release Gate Portal & API"
  value       = var.deploy_cloudfront_distribution && var.deploy_serverless_lambda && var.enable_apigateway_http_api ? "https://${aws_cloudfront_distribution.portal_cdn[0].domain_name}" : "disabled"
}

output "ecr_repository_url" {
  description = "Optional Amazon ECR Repository URL (only provisioned when deploy_apprunner_service = true)"
  value       = var.deploy_apprunner_service ? aws_ecr_repository.control_plane[0].repository_url : "disabled (using Scale-to-Zero AWS Lambda)"
}

output "apprunner_service_url" {
  description = "Optional AWS App Runner URL (disabled by default in favor of $0/idle Scale-to-Zero AWS Lambda)"
  value       = var.deploy_apprunner_service ? "https://${aws_apprunner_service.control_plane[0].service_url}" : "disabled (using Scale-to-Zero AWS Lambda)"
}

