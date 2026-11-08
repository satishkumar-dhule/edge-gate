---
name: add-property-and-suite
description: Add a new Akamai property, environment hostMap, or synthetic test case to the Release Gate and Terraform stack.
---

# Skill: Add Property & Test Suite (`/skills/add-property-and-suite/SKILL.md`)

## Step-by-Step Procedure
1. **Add Property in `src/config/template.config.ts`**:
   - Append an `AppConfig` entry to `DEFAULT_TEMPLATE_CONFIG.properties` with `id`, `name`, `suitePath`, `defaultNetworks: ['prod', 'staging']`, and `envs` (each containing `hostMap` mapping environment hostnames to canonical production hostnames for `Location` header normalization).
2. **Add Test Cases in `DEFAULT_TEMPLATE_CONFIG.testSuite`**:
   - Append `TestCaseDefinition` entries with `id`, `name`, `path`, `expectedStatus`, `category`, `visualGate`, and `critical`.
3. **Sync Terraform**:
   - Add the matching entry in `infra/terraform/terraform.tfvars.example` (or export via the **Terraform IaC** tab in the UI).
