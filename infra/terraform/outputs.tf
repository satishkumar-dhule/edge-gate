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

output "ecr_repository_url" {
  description = "Amazon ECR Repository URL for pushing the Control Plane Docker image"
  value       = aws_ecr_repository.control_plane.repository_url
}

output "apprunner_service_url" {
  description = "Public HTTPS URL of the AWS App Runner Control Plane (when deploy_apprunner_service = true)"
  value       = var.deploy_apprunner_service ? "https://${aws_apprunner_service.control_plane[0].service_url}" : "Run scripts/deploy-aws.sh --with-apprunner to build & deploy container"
}
