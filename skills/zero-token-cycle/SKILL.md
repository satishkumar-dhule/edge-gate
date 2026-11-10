---
name: zero-token-cycle
description: Execute the complete .env credential rotation -> Terraform -> CloudFront -> Live Fleet Seed -> Playwright E2E cycle with zero AI tokens, invoking AI only for genuinely new unseen diffs or new features.
---

# Skill: Zero-Token Autonomous Lifecycle (`/skills/zero-token-cycle/SKILL.md`)

## Core Architectural Rule
Never spend LLM or Coding Agent tokens repeating routine operational cycles (`.env` credential rotation, `terraform apply`, CloudFront invalidation, DynamoDB 8-property fleet seeding, or known visual/header diff evaluations).

### 3-Tier Zero-Token AI Funnel
1. **Tier 1 (0 Tokens — Deterministic & 0.1% Pixel Cost-Gate)**:
   - When `pixelDiffPercent <= 0.1%` or diffs are resolved by deterministic HTTP Header/Cookie/Redirect rules, Bedrock Nova Lite is completely bypassed (`0 tokens / $0.00`).
2. **Tier 2 (0 Tokens — SHA-256 Diff Fingerprint Cache)**:
   - Every candidate-vs-baseline diff is hashed into a deterministic SHA-256 signature (`ztf_<16hex>`) stored in DynamoDB (`__AI_VERDICT_CACHE__`).
   - Re-running comparisons on previously evaluated diff signatures reuses the cached verdict with **0 tokens consumed**.
3. **Tier 3 (Novel Unseen Delta Only — `amazon.nova-lite-v1:0`)**:
   - Invokes AWS Bedrock Nova Lite **ONLY** when a genuinely new, unseen diff signature (`pixelDiffPercent > 0.1%` AND `cacheHit === false`) appears, then caches the result so it never consumes tokens again.

## Zero-Token Execution Commands
```bash
# Run the complete .env -> Terraform -> CloudFront -> Live Fleet Seed -> Playwright E2E cycle (0 Tokens):
pnpm run zero-token-cycle

# Or watch /.env continuously and auto-apply whenever AWS credentials rotate (0 Tokens):
pnpm run zero-token-watch
```
