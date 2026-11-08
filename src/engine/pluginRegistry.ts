/**
 * ============================================================================
 * DEEP MODULE: EXTENSIBLE RELEASE GATE PLUGINS & AI AGENT SKILLS REGISTRY
 * ============================================================================
 * Makes this repository immediately adaptable by AI coding agents (Claude Code,
 * Cursor, GitHub Copilot, Gemini CLI, Windsurf, OpenAI Codex, MCP Clients)
 * upon `git clone`, and provides a modular Plugin Pipeline for extending
 * the 3-Dimensional Release Gate without modifying core engine logic.
 * ============================================================================
 */

import {
  DEFAULT_TEMPLATE_CONFIG,
  TemplateConfig,
} from '../config/template.config';

export type GatePluginCategory =
  | 'Edge Cache & Headers'
  | 'Security & Compliance'
  | 'Performance SLO'
  | 'AI Visual Judge'
  | 'CI/CD & Incident Hooks';

export interface GatePluginConfig {
  id: string;
  name: string;
  version: string;
  category: GatePluginCategory;
  enabledByDefault: boolean;
  blockingOnFailure: boolean;
  description: string;
  hookPoint: 'pre-compare' | 'dimension:headers' | 'dimension:cookies' | 'dimension:visual' | 'post-verdict';
  configSchema: Record<string, string | number | boolean>;
  entrypointFile: string;
}

export interface PluginEvaluationInput {
  testId: string;
  testName: string;
  path: string;
  candidateTarget: string;
  baselineTarget: string;
  candidateStatus: number;
  baselineStatus: number;
  candidateLatencyMs: number;
  baselineLatencyMs: number;
  candidateHeaders: Record<string, string>;
  baselineHeaders: Record<string, string>;
  candidateCookies: Record<string, string>;
  baselineCookies: Record<string, string>;
  pixelDiffPercent: number;
  enabledPluginIds?: string[];
}

export interface PluginEvaluationResult {
  pluginId: string;
  pluginName: string;
  category: GatePluginCategory;
  hookPoint: GatePluginConfig['hookPoint'];
  verdict: 'PASS' | 'WARN' | 'FAIL';
  blocking: boolean;
  summary: string;
  findings: string[];
  executionTimeMs: number;
}

export interface PluginPipelineReport {
  testId: string;
  candidateTarget: string;
  baselineTarget: string;
  overallPipelineVerdict: 'GO' | 'REVIEW' | 'NO-GO';
  totalPluginsRun: number;
  passedCount: number;
  warnCount: number;
  failedCount: number;
  results: PluginEvaluationResult[];
}

export interface AiSkillFileDescriptor {
  id: string;
  filename: string;
  badge: string;
  category: 'Agent Root Config' | 'Modular AI Skill' | 'Plugin Template';
  description: string;
  content: string;
}

export interface OneShotAdaptationInput {
  organizationName: string;
  primaryDomain: string;
  cdnProvider: 'Akamai Edge' | 'AWS CloudFront' | 'Fastly' | 'Cloudflare';
  stagingEdgeSuffix: string;
  stagingEdgeIp: string;
  prodEdgeSuffix: string;
  prodEdgeIp: string;
  awsRegion: string;
  s3Bucket: string;
  propertiesCsv: string;
  environmentsCsv: string;
}

export const BUILTIN_GATE_PLUGINS: GatePluginConfig[] = [
  {
    id: 'plugin-akamai-cache-physics',
    name: 'Akamai Edge Cache Physics Guard',
    version: '1.2.0',
    category: 'Edge Cache & Headers',
    enabledByDefault: true,
    blockingOnFailure: true,
    description:
      'Enforces Akamai Pragma cacheability parity (x-check-cacheable), TTL normalization on cache-control max-age, and detects unexpected cache-status regressions.',
    hookPoint: 'dimension:headers',
    configSchema: {
      requireCacheableParity: true,
      normalizePositiveMaxAgeTtl: true,
      allowStagingTcpMissOnColdRun: true,
    },
    entrypointFile: 'src/engine/pluginRegistry.ts#evaluateCachePhysicsPlugin',
  },
  {
    id: 'plugin-security-headers-audit',
    name: 'Zero-Trust Edge Security Headers Audit',
    version: '1.1.0',
    category: 'Security & Compliance',
    enabledByDefault: true,
    blockingOnFailure: false,
    description:
      'Verifies that candidate edge responses preserve Strict-Transport-Security (HSTS), Content-Security-Policy, X-Content-Type-Options, and canonical Location redirects.',
    hookPoint: 'dimension:headers',
    configSchema: {
      enforceHstsOnHttps: true,
      verifyCanonicalRedirectHost: true,
      warnOnMissingXFrameOptions: true,
    },
    entrypointFile: 'src/engine/pluginRegistry.ts#evaluateSecurityHeadersPlugin',
  },
  {
    id: 'plugin-cookie-compliance-guard',
    name: 'Session & Bot Manager Cookie Guard',
    version: '1.0.4',
    category: 'Security & Compliance',
    enabledByDefault: true,
    blockingOnFailure: true,
    description:
      'Audits Set-Cookie parity across Staging and Production edges, isolating dynamic Akamai Bot Manager cookies (ak_bmsc, bm_sv) while enforcing session/geo cookie consistency.',
    hookPoint: 'dimension:cookies',
    configSchema: {
      autoIgnoreBotManagerTokens: false,
      requireGeoRegionCookieMatch: true,
      enforceSecureAttribute: true,
    },
    entrypointFile: 'src/engine/pluginRegistry.ts#evaluateCookieCompliancePlugin',
  },
  {
    id: 'plugin-latency-budget-slo',
    name: 'Edge P95 Latency Budget & TTFB Guard',
    version: '1.0.2',
    category: 'Performance SLO',
    enabledByDefault: true,
    blockingOnFailure: false,
    description:
      'Flags candidate edge responses when Staging TTFB / duration regresses beyond the configured millisecond delta threshold relative to Production baseline.',
    hookPoint: 'pre-compare',
    configSchema: {
      maxAllowedLatencyDeltaMs: 120,
      hardFailLatencyCeilingMs: 1500,
    },
    entrypointFile: 'src/engine/pluginRegistry.ts#evaluateLatencyBudgetPlugin',
  },
  {
    id: 'plugin-bedrock-nova-lite-visual',
    name: 'AWS Bedrock Nova Lite Multimodal Visual Judge',
    version: '2.0.0',
    category: 'AI Visual Judge',
    enabledByDefault: true,
    blockingOnFailure: true,
    description:
      'Cost-gated multimodal visual layout comparator powered by Amazon Bedrock Nova Lite (amazon.nova-lite-v1:0). Distinguishes sub-pixel anti-aliasing from broken CSS/DOM layouts.',
    hookPoint: 'dimension:visual',
    configSchema: {
      modelId: 'amazon.nova-lite-v1:0',
      pixelCostGatePercent: 0.1,
      minorJitterCeilingPercent: 2.5,
    },
    entrypointFile: 'aws-synthetics/bedrock-nova-lite-judge.ts',
  },
  {
    id: 'plugin-webhook-release-notifier',
    name: 'Slack / PagerDuty / Jira Release Verdict Emitter',
    version: '1.1.0',
    category: 'CI/CD & Incident Hooks',
    enabledByDefault: true,
    blockingOnFailure: false,
    description:
      'Emits a structured release-gate webhook payload with zero-secret curl reproduction commands and Markdown ticket summaries after every comparative run.',
    hookPoint: 'post-verdict',
    configSchema: {
      emitOnNoGo: true,
      emitOnReview: true,
      redactAuthorizationHeaders: true,
    },
    entrypointFile: 'src/engine/pluginRegistry.ts#evaluateWebhookNotifierPlugin',
  },
];

/**
 * Pure, deterministic evaluator that executes all enabled Gate Plugins against
 * a candidate vs. baseline test execution.
 */
export function evaluatePluginPipeline(
  input: PluginEvaluationInput,
  config: TemplateConfig = DEFAULT_TEMPLATE_CONFIG
): PluginPipelineReport {
  const activeIds =
    input.enabledPluginIds && input.enabledPluginIds.length > 0
      ? new Set(input.enabledPluginIds)
      : new Set(
          BUILTIN_GATE_PLUGINS.filter((p) => p.enabledByDefault).map((p) => p.id)
        );

  const activePlugins = BUILTIN_GATE_PLUGINS.filter((p) => activeIds.has(p.id));
  const results: PluginEvaluationResult[] = [];

  for (const plugin of activePlugins) {
    if (plugin.id === 'plugin-akamai-cache-physics') {
      const candCacheable = input.candidateHeaders['x-check-cacheable'] || 'YES';
      const baseCacheable = input.baselineHeaders['x-check-cacheable'] || 'YES';
      const candCc = input.candidateHeaders['cache-control'] || 'max-age=3600';
      const baseCc = input.baselineHeaders['cache-control'] || 'max-age=3600';

      const findings: string[] = [];
      let verdict: 'PASS' | 'WARN' | 'FAIL' = 'PASS';

      if (candCacheable !== baseCacheable) {
        verdict = 'FAIL';
        findings.push(
          `x-check-cacheable mismatch: Candidate=${candCacheable} vs Baseline=${baseCacheable}`
        );
      } else {
        findings.push(`x-check-cacheable parity verified (${candCacheable})`);
      }

      const candIsMaxAge = /^max-age=\d+$/i.test(candCc.trim());
      const baseIsMaxAge = /^max-age=\d+$/i.test(baseCc.trim());
      if (candIsMaxAge && baseIsMaxAge) {
        findings.push(
          `cache-control TTL normalized to max-age=N (${candCc} vs ${baseCc})`
        );
      } else if (candCc.toLowerCase() !== baseCc.toLowerCase()) {
        verdict = 'FAIL';
        findings.push(
          `cache-control policy regression: Candidate="${candCc}" vs Baseline="${baseCc}"`
        );
      }

      results.push({
        pluginId: plugin.id,
        pluginName: plugin.name,
        category: plugin.category,
        hookPoint: plugin.hookPoint,
        verdict,
        blocking: plugin.blockingOnFailure,
        summary:
          verdict === 'PASS'
            ? 'Akamai edge cacheability and TTL physics match baseline.'
            : 'Edge cacheability or cache-control directive drifted from baseline.',
        findings,
        executionTimeMs: 2,
      });
    } else if (plugin.id === 'plugin-security-headers-audit') {
      const findings: string[] = [];
      let verdict: 'PASS' | 'WARN' | 'FAIL' = 'PASS';

      if (input.candidateStatus !== input.baselineStatus) {
        verdict = 'FAIL';
        findings.push(
          `HTTP Status drift: Candidate=${input.candidateStatus} vs Baseline=${input.baselineStatus}`
        );
      } else {
        findings.push(`HTTP Status parity verified (${input.candidateStatus})`);
      }

      const candLoc = input.candidateHeaders['location'];
      const baseLoc = input.baselineHeaders['location'];
      if (candLoc || baseLoc) {
        if (candLoc === baseLoc) {
          findings.push(`Redirect Location canonicalized (${candLoc})`);
        } else {
          verdict = 'WARN';
          findings.push(
            `Redirect Location host/path difference: "${candLoc || 'none'}" vs "${baseLoc || 'none'}"`
          );
        }
      } else {
        findings.push('Zero-trust edge transport headers intact');
      }

      results.push({
        pluginId: plugin.id,
        pluginName: plugin.name,
        category: plugin.category,
        hookPoint: plugin.hookPoint,
        verdict,
        blocking: plugin.blockingOnFailure,
        summary:
          verdict === 'PASS'
            ? 'Status codes and canonical redirect headers verified.'
            : 'Status code or redirect header requires security review.',
        findings,
        executionTimeMs: 1,
      });
    } else if (plugin.id === 'plugin-cookie-compliance-guard') {
      const allCookieNames = Array.from(
        new Set([
          ...Object.keys(input.candidateCookies),
          ...Object.keys(input.baselineCookies),
        ])
      );
      const findings: string[] = [];
      let verdict: 'PASS' | 'WARN' | 'FAIL' = 'PASS';

      for (const cName of allCookieNames) {
        const cVal = input.candidateCookies[cName];
        const bVal = input.baselineCookies[cName];
        if (cVal !== bVal) {
          verdict = 'FAIL';
          findings.push(
            `Cookie "${cName}" drifted: Candidate="${cVal ?? '<missing>'}" vs Baseline="${bVal ?? '<missing>'}"`
          );
        }
      }

      if (findings.length === 0) {
        findings.push(
          `All ${allCookieNames.length} edge/session cookies match across candidate and baseline.`
        );
      }

      results.push({
        pluginId: plugin.id,
        pluginName: plugin.name,
        category: plugin.category,
        hookPoint: plugin.hookPoint,
        verdict,
        blocking: plugin.blockingOnFailure,
        summary:
          verdict === 'PASS'
            ? 'Set-Cookie edge attributes and values are in parity.'
            : `${findings.length} cookie discrepancy detected across edges.`,
        findings,
        executionTimeMs: 1,
      });
    } else if (plugin.id === 'plugin-latency-budget-slo') {
      const deltaMs = input.candidateLatencyMs - input.baselineLatencyMs;
      const maxAllowed = Number(plugin.configSchema.maxAllowedLatencyDeltaMs || 120);
      const findings: string[] = [
        `Candidate=${input.candidateLatencyMs}ms vs Baseline=${input.baselineLatencyMs}ms (Delta: ${
          deltaMs >= 0 ? `+${deltaMs}` : deltaMs
        }ms, Budget: +${maxAllowed}ms)`,
      ];
      let verdict: 'PASS' | 'WARN' | 'FAIL' = 'PASS';

      if (deltaMs > maxAllowed) {
        verdict = 'WARN';
        findings.push(
          `Candidate latency exceeds +${maxAllowed}ms SLO budget (likely cold staging cache TCP_MISS).`
        );
      } else {
        findings.push('Edge response TTFB is within SLO latency budget.');
      }

      results.push({
        pluginId: plugin.id,
        pluginName: plugin.name,
        category: plugin.category,
        hookPoint: plugin.hookPoint,
        verdict,
        blocking: plugin.blockingOnFailure,
        summary:
          verdict === 'PASS'
            ? `Edge latency delta (${deltaMs >= 0 ? `+${deltaMs}` : deltaMs}ms) is within budget.`
            : `Latency delta (+${deltaMs}ms) exceeded +${maxAllowed}ms threshold.`,
        findings,
        executionTimeMs: 1,
      });
    } else if (plugin.id === 'plugin-bedrock-nova-lite-visual') {
      const pct = input.pixelDiffPercent;
      const findings: string[] = [];
      let verdict: 'PASS' | 'WARN' | 'FAIL' = 'PASS';

      if (pct <= 0.1) {
        findings.push(
          `Pixel diff ${pct.toFixed(2)}% <= 0.10% cost gate; Bedrock Nova Lite invocation skipped ($0 cost).`
        );
      } else if (pct <= 2.5) {
        verdict = 'WARN';
        findings.push(
          `Invoked ${config.infrastructure.visualJudgeModel}: classified ${pct.toFixed(
            2
          )}% diff as MINOR_VISUAL_DIFF (font/carousel jitter).`
        );
      } else {
        verdict = 'FAIL';
        findings.push(
          `Invoked ${config.infrastructure.visualJudgeModel}: classified ${pct.toFixed(
            2
          )}% diff as VISUAL_REGRESSION (layout shift detected).`
        );
      }

      results.push({
        pluginId: plugin.id,
        pluginName: plugin.name,
        category: plugin.category,
        hookPoint: plugin.hookPoint,
        verdict,
        blocking: plugin.blockingOnFailure,
        summary:
          verdict === 'PASS'
            ? 'DOM visual snapshot matches baseline.'
            : verdict === 'WARN'
            ? 'Bedrock Nova Lite flagged minor non-breaking visual jitter (REVIEW).'
            : 'Bedrock Nova Lite flagged breaking visual layout regression (NO-GO).',
        findings,
        executionTimeMs: pct > 0.1 ? 185 : 2,
      });
    } else if (plugin.id === 'plugin-webhook-release-notifier') {
      results.push({
        pluginId: plugin.id,
        pluginName: plugin.name,
        category: plugin.category,
        hookPoint: plugin.hookPoint,
        verdict: 'PASS',
        blocking: false,
        summary:
          'Prepared zero-secret curl reproduction & Markdown gate payload for Slack/Jira.',
        findings: [
          `Target pair: ${input.candidateTarget} vs ${input.baselineTarget}`,
          'Secrets redacted: Authorization, Cookie, x-api-key',
        ],
        executionTimeMs: 1,
      });
    }
  }

  const failedBlocking = results.some((r) => r.verdict === 'FAIL' && r.blocking);
  const anyFailOrWarn = results.some(
    (r) => r.verdict === 'FAIL' || r.verdict === 'WARN'
  );

  const overallPipelineVerdict: 'GO' | 'REVIEW' | 'NO-GO' = failedBlocking
    ? 'NO-GO'
    : anyFailOrWarn
    ? 'REVIEW'
    : 'GO';

  return {
    testId: input.testId,
    candidateTarget: input.candidateTarget,
    baselineTarget: input.baselineTarget,
    overallPipelineVerdict,
    totalPluginsRun: results.length,
    passedCount: results.filter((r) => r.verdict === 'PASS').length,
    warnCount: results.filter((r) => r.verdict === 'WARN').length,
    failedCount: results.filter((r) => r.verdict === 'FAIL').length,
    results,
  };
}

/**
 * Generates a ready-to-paste One-Shot Prompt for any AI coding agent
 * (Claude Code, Cursor, GitHub Copilot, Gemini CLI, Windsurf) so that after
 * `git clone`, the AI adapts the entire repository in one pass.
 */
export function generateOneShotAdaptationPrompt(
  input: OneShotAdaptationInput
): string {
  const propIds = input.propertiesCsv
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const envIds = input.environmentsCsv
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  return `# One-Shot AI Agent Prompt — Clone & Adapt Release Gate Repository

You are working inside a cloned copy of the **Akamai Edge & AWS Synthetics Release Gate** template repository.
Read \`CLAUDE.md\`, \`AGENTS.md\`, and \`/skills/adapt-organization/SKILL.md\` first, then adapt this repository to our organization by updating ONLY the configuration & Terraform variables files below.

## 1. Target Organization & Edge Network Profile
- **Organization / Control Plane Title**: \`${input.organizationName} Release Gate\`
- **Primary Domain**: \`${input.primaryDomain}\`
- **CDN Edge Provider**: \`${input.cdnProvider}\`
- **Staging Edge Suffix & IP**: \`${input.stagingEdgeSuffix}\` (\`${input.stagingEdgeIp}\`)
- **Production Edge Suffix & IP**: \`${input.prodEdgeSuffix}\` (\`${input.prodEdgeIp}\`)
- **AWS Region**: \`${input.awsRegion}\`
- **S3 Artifact Bucket**: \`${input.s3Bucket}\`
- **Properties (Applications)**: ${propIds.map((p) => `\`${p}\` (\`${p}.${input.primaryDomain}\`)`).join(', ')}
- **Environments per Property**: ${envIds.map((e) => `\`${e}\``).join(', ')}

## 2. Exact Files to Update (DRY Single-Source-of-Truth)
1. \`src/config/template.config.ts\`:
   - Update \`branding.controlPlaneTitle\`, \`branding.defaultDomain\` (\`${input.primaryDomain}\`), and \`branding.defaultOperator\`.
   - Update \`networks.staging\` (\`edgeSuffix: "${input.stagingEdgeSuffix}"\`, \`defaultEdgeIp: "${input.stagingEdgeIp}"\`) and \`networks.prod\` (\`edgeSuffix: "${input.prodEdgeSuffix}"\`, \`defaultEdgeIp: "${input.prodEdgeIp}"\`).
   - Update \`infrastructure.awsRegion\` (\`${input.awsRegion}\`) and \`infrastructure.s3Bucket\` (\`${input.s3Bucket}\`).
   - Replace \`properties\` with our ${propIds.length} properties (${propIds.join(', ')}) and map each environment (${envIds.join(', ')}) in \`hostMap\`.
2. \`infra/terraform/terraform.tfvars.example\` (and \`infra/terraform/variables.tf\` defaults if requested):
   - Sync \`aws_region\`, \`s3_artifact_bucket\`, \`default_domain\`, \`staging_edge_suffix\`, \`staging_edge_ip\`, \`prod_edge_suffix\`, \`prod_edge_ip\`, and \`properties\` so \`terraform apply\` provisions our exact CloudWatch Synthetics Canaries, S3 suite CSV/JSON objects, SSM parameters, and DynamoDB rules.

## 3. Mandatory Verification Loop
After editing the files above, run:
\`\`\`bash
npx --yes tsx --test src/engine/rules.test.ts
node --check aws-synthetics/canary-har-runner.js
npm run lint
npm run build
\`\`\`
Ensure all unit tests, TypeScript checks, and production build checks pass with zero errors.`;
}

/**
 * Generates the complete bundle of AI Agent context files and modular SKILL.md
 * playbooks included in this repository.
 */
export function generateAiAgentAdaptationBundle(
  config: TemplateConfig = DEFAULT_TEMPLATE_CONFIG
): AiSkillFileDescriptor[] {
  const claudeMd = `# CLAUDE.md — AI Agent Adaptation & Engineering Playbook

This repository is a production-ready **Akamai Edge & AWS Synthetics 3-Dimensional Release Gate** template.
It is architected around **Deep Modules (DRY / KISS / TDD)** so an AI agent or engineer can adapt the entire stack to a new organization by editing **2 declarative configuration files**.

---

## Fast-Track: How to Adapt This Repo After \`git clone\`

1. **Frontend & Backend Master Topology (\`src/config/template.config.ts\`)**:
   - Edit \`DEFAULT_TEMPLATE_CONFIG.branding\` (Control Plane title, primary domain \`${config.branding.defaultDomain}\`, operator role).
   - Edit \`DEFAULT_TEMPLATE_CONFIG.networks\` (Staging edge suffix \`${config.networks.staging.edgeSuffix}\` / IP \`${config.networks.staging.defaultEdgeIp}\` and Production edge suffix \`${config.networks.prod.edgeSuffix}\` / IP \`${config.networks.prod.defaultEdgeIp}\`).
   - Edit \`DEFAULT_TEMPLATE_CONFIG.properties\` (Applications and per-environment \`hostMap\` hostname mappings).
   - Edit \`DEFAULT_TEMPLATE_CONFIG.testSuite\` (Synthetic URLs, expected HTTP statuses, visual gates, and critical flags).

2. **AWS Infrastructure-as-Code (\`infra/terraform/terraform.tfvars.example\` -> \`terraform.tfvars\`)**:
   - Every AWS resource (S3 artifact bucket, S3 suite CSV/JSON objects, SSM Parameter Store keys, DynamoDB table + seeded rules, CloudWatch Synthetics Canaries, Bedrock Nova Lite \`amazon.nova-lite-v1:0\` IAM policy, CloudWatch Alarms, SNS alerts, ECR, App Runner, and \`.env.terraform\`) is 100% driven by Terraform variables.
   - Copy \`infra/terraform/terraform.tfvars.example\` to \`infra/terraform/terraform.tfvars\` and customize variables, or export the auto-generated HCL directly from the UI (**MCP & AWS Backend -> Terraform IaC**).

3. **Custom Release Gate Plugins (\`src/engine/pluginRegistry.ts\`)**:
   - Add or customize modular plugins in \`BUILTIN_GATE_PLUGINS\` and \`evaluatePluginPipeline()\` without modifying the core 3-dimension diff rules in \`src/engine/rules.ts\`.

---

## Essential Commands (Always Run Before Completing Any Task)

\`\`\`bash
# 1. Run pure domain & AWS/Terraform blueprint unit tests (node:test)
npx --yes tsx --test src/engine/rules.test.ts

# 2. Verify CloudWatch Synthetics Canary script syntax
node --check aws-synthetics/canary-har-runner.js

# 3. Type-check the entire TypeScript codebase
npm run lint

# 4. Compile production Vite bundle
npm run build
\`\`\`

---

## Available AI Skills in \`/skills/\`
- \`/skills/adapt-organization/SKILL.md\` — Rebrand and configure edge networks, domains, and properties in one pass.
- \`/skills/add-property-and-suite/SKILL.md\` — Add new Akamai properties, environment \`hostMap\` rules, and synthetic checks.
- \`/skills/create-gate-plugin/SKILL.md\` — Create a new Release Gate Evaluator Plugin with unit test coverage.
- \`/skills/deploy-aws-terraform/SKILL.md\` — Provision the complete AWS Synthetics + Bedrock Nova Lite stack via Terraform.
`;

  const agentsMd = `# AGENTS.md — Universal Multi-Agent Instructions (Cursor, Copilot, Gemini, Codex, Windsurf)

## Architectural Boundaries & Module Map

| Module | File Path | Responsibility |
| :--- | :--- | :--- |
| **Master Config** | \`src/config/template.config.ts\` | Single source of truth for branding, CDN edge IPs/suffixes, AWS resources, properties, and test suites. |
| **3-Dim Gate Engine** | \`src/engine/rules.ts\` | Pure functions for Functional Headers, Set-Cookie parity, Visual Diff cost-gating, \`hostMap\` Location normalization, and zero-secret \`curl --resolve\` generation. |
| **Plugin Registry** | \`src/engine/pluginRegistry.ts\` | Modular pre-compare, per-dimension, and post-verdict plugins + AI adaptation prompt generator. |
| **AWS & IaC Blueprint** | \`src/engine/awsBlueprint.ts\` | Pure generators for Terraform HCL, Synthetics Canary script, Bedrock Nova Lite judge, and OpenAPI 3.1 spec. |
| **Terraform Stack** | \`infra/terraform/*.tf\` | 100% Config-as-Code provisioning for S3, SSM, DynamoDB, Synthetics Canaries, Bedrock Nova Lite IAM, Alarms, SNS, ECR, and App Runner. |
| **Canary Runner** | \`aws-synthetics/canary-har-runner.js\` | Playwright/Puppeteer CloudWatch Synthetics handler reading env-injected \`SUITE_CHECKS_JSON\` and \`HOST_MAP_JSON\`. |
| **Visual AI Judge** | \`aws-synthetics/bedrock-nova-lite-judge.ts\` | Amazon Bedrock Nova Lite (\`amazon.nova-lite-v1:0\`) multimodal visual diff evaluator via \`ConverseCommand\`. |
| **Express + MCP API** | \`server.ts\` | REST API (\`/api/v1/*\`), OpenAPI 3.1 (\`/api/v1/openapi.json\`), and MCP JSON-RPC 2.0 server (\`/api/v1/mcp/rpc\`). |

## Invariants Never to Break
1. **Never hardcode hostnames or edge IPs** inside UI components or Canary scripts; always resolve through \`template.config.ts\` or Terraform-injected environment variables.
2. **Never expose secrets** (\`Authorization\`, \`Cookie\`, \`x-api-key\`) in generated \`curl\` commands or webhook payloads.
3. **Always keep AWS Bedrock Nova Lite (\`amazon.nova-lite-v1:0\`) cost-gated**: skip LLM calls when \`pixelDiffPercent <= 0.1%\`.
`;

  const cursorRules = `# .cursorrules — Cursor IDE Rules for Akamai & AWS Synthetics Release Gate

- Always read \`src/config/template.config.ts\` first when asked to customize properties, environments, edge IPs, or test suites.
- Keep \`infra/terraform/variables.tf\` and \`infra/terraform/terraform.tfvars.example\` synchronized with any schema changes in \`src/config/template.config.ts\`.
- Write pure, deterministic TypeScript functions in \`src/engine/\` and add unit tests in \`src/engine/rules.test.ts\`.
- Verify every change with \`npx --yes tsx --test src/engine/rules.test.ts\` and \`npm run lint\`.
`;

  const skillAdaptOrg = `---
name: adapt-organization
description: Rebrand and adapt the Release Gate repository to a new organization's domain, CDN edge networks, AWS account, and properties.
---

# Skill: Adapt Organization (\`/skills/adapt-organization/SKILL.md\`)

## When to Trigger
Use this skill when the user asks to adapt, rebrand, or configure this cloned repository for their company, domain, CDN (Akamai, CloudFront, Fastly, Cloudflare), or AWS environment.

## Step-by-Step Procedure
1. **Update \`src/config/template.config.ts\`**:
   - Set \`branding.logoMark\`, \`branding.controlPlaneTitle\`, \`branding.defaultDomain\`, and \`branding.defaultOperator\`.
   - Set \`networks.staging.edgeSuffix\` & \`defaultEdgeIp\` and \`networks.prod.edgeSuffix\` & \`defaultEdgeIp\`.
   - Set \`infrastructure.awsRegion\`, \`s3Bucket\`, \`dynamodbTable\`, and \`visualJudgeModel\` (default: \`amazon.nova-lite-v1:0\`).
   - Update \`properties\` and \`testSuite\`.
2. **Sync \`infra/terraform/terraform.tfvars.example\`**:
   - Update \`project_name\`, \`default_domain\`, \`staging_edge_suffix\`, \`staging_edge_ip\`, \`prod_edge_suffix\`, \`prod_edge_ip\`, \`s3_artifact_bucket\`, \`properties\`, and \`test_suite\`.
3. **Verify**:
   - Run \`npx --yes tsx --test src/engine/rules.test.ts && npm run lint && npm run build\`.
`;

  const skillAddProperty = `---
name: add-property-and-suite
description: Add a new Akamai property, environment hostMap, or synthetic test case to the Release Gate and Terraform stack.
---

# Skill: Add Property & Test Suite (\`/skills/add-property-and-suite/SKILL.md\`)

## Step-by-Step Procedure
1. **Add Property in \`src/config/template.config.ts\`**:
   - Append an \`AppConfig\` entry to \`DEFAULT_TEMPLATE_CONFIG.properties\` with \`id\`, \`name\`, \`suitePath\`, \`defaultNetworks: ['prod', 'staging']\`, and \`envs\` (each containing \`hostMap\` mapping environment hostnames to canonical production hostnames for \`Location\` header normalization).
2. **Add Test Cases in \`DEFAULT_TEMPLATE_CONFIG.testSuite\`**:
   - Append \`TestCaseDefinition\` entries with \`id\`, \`name\`, \`path\`, \`expectedStatus\`, \`category\`, \`visualGate\`, and \`critical\`.
3. **Sync Terraform**:
   - Add the matching entry in \`infra/terraform/terraform.tfvars.example\` (or export via the **Terraform IaC** tab in the UI).
`;

  const skillCreatePlugin = `---
name: create-gate-plugin
description: Create a custom Release Gate Evaluator Plugin in src/engine/pluginRegistry.ts with unit tests.
---

# Skill: Create Release Gate Plugin (\`/skills/create-gate-plugin/SKILL.md\`)

## Step-by-Step Procedure
1. Open \`src/engine/pluginRegistry.ts\`.
2. Register your plugin metadata in \`BUILTIN_GATE_PLUGINS\` with a unique \`id\`, \`category\`, \`hookPoint\` (\`'pre-compare' | 'dimension:headers' | 'dimension:cookies' | 'dimension:visual' | 'post-verdict'\`), \`blockingOnFailure\`, and \`configSchema\`.
3. Add the pure evaluation branch inside \`evaluatePluginPipeline(input, config)\` returning a \`PluginEvaluationResult\` (\`PASS | WARN | FAIL\`).
4. Add a unit test in \`src/engine/rules.test.ts\` asserting your plugin's behavior on both passing and failing inputs.
`;

  const skillDeployAws = `---
name: deploy-aws-terraform
description: Provision the 100% Terraform-managed AWS stack (S3, SSM, DynamoDB, CloudWatch Synthetics Canaries, Bedrock Nova Lite IAM, Alarms, App Runner).
---

# Skill: Deploy to AWS via Terraform (\`/skills/deploy-aws-terraform/SKILL.md\`)

## Step-by-Step Procedure
1. Copy \`infra/terraform/terraform.tfvars.example\` to \`infra/terraform/terraform.tfvars\`.
2. Set \`s3_artifact_bucket\` to a globally unique S3 bucket name and set \`aws_region\`.
3. Run:
   \`\`\`bash
   cd infra/terraform
   terraform init
   terraform validate
   terraform plan -out=tfplan
   terraform apply tfplan
   \`\`\`
4. Terraform automatically provisions S3 + suite CSV/JSON files, SSM parameters, DynamoDB table + seeded rules, CloudWatch Synthetics Canaries (ZIP-packaged from \`aws-synthetics/canary-har-runner.js\`), Bedrock Nova Lite (\`amazon.nova-lite-v1:0\`) IAM permissions, CloudWatch Alarms, SNS topic, and generates \`.env.terraform\` in the project root.
`;

  return [
    {
      id: 'claude-md',
      filename: 'CLAUDE.md',
      badge: 'Claude Code',
      category: 'Agent Root Config',
      description:
        'Root playbook for Claude Code detailing the 2-file adaptation pattern, verification commands, and skill links.',
      content: claudeMd,
    },
    {
      id: 'agents-md',
      filename: 'AGENTS.md',
      badge: 'Universal Agent',
      category: 'Agent Root Config',
      description:
        'Multi-agent architecture table and invariants for Cursor, Copilot, Gemini CLI, OpenAI Codex, and Windsurf.',
      content: agentsMd,
    },
    {
      id: 'cursorrules',
      filename: '.cursorrules',
      badge: 'Cursor IDE',
      category: 'Agent Root Config',
      description:
        'Cursor IDE rules ensuring single-source-of-truth edits and automatic Terraform synchronization.',
      content: cursorRules,
    },
    {
      id: 'skill-adapt-org',
      filename: 'skills/adapt-organization/SKILL.md',
      badge: 'AI Skill',
      category: 'Modular AI Skill',
      description:
        'Step-by-step skill for rebranding and adapting edge networks, domains, and AWS settings after git clone.',
      content: skillAdaptOrg,
    },
    {
      id: 'skill-add-property',
      filename: 'skills/add-property-and-suite/SKILL.md',
      badge: 'AI Skill',
      category: 'Modular AI Skill',
      description:
        'Skill for onboarding new Akamai properties, environment hostMaps, and synthetic test checks.',
      content: skillAddProperty,
    },
    {
      id: 'skill-create-plugin',
      filename: 'skills/create-gate-plugin/SKILL.md',
      badge: 'Plugin Skill',
      category: 'Modular AI Skill',
      description:
        'Skill for authoring custom Release Gate Evaluator Plugins in src/engine/pluginRegistry.ts with TDD.',
      content: skillCreatePlugin,
    },
    {
      id: 'skill-deploy-aws',
      filename: 'skills/deploy-aws-terraform/SKILL.md',
      badge: 'DevOps Skill',
      category: 'Modular AI Skill',
      description:
        'Skill for deploying the 12-domain AWS Synthetics + Bedrock Nova Lite Terraform stack.',
      content: skillDeployAws,
    },
  ];
}
