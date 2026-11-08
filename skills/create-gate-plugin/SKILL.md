---
name: create-gate-plugin
description: Create a custom Release Gate Evaluator Plugin in src/engine/pluginRegistry.ts with unit tests.
---

# Skill: Create Release Gate Plugin (`/skills/create-gate-plugin/SKILL.md`)

## Step-by-Step Procedure
1. Open `src/engine/pluginRegistry.ts`.
2. Register your plugin metadata in `BUILTIN_GATE_PLUGINS` with a unique `id`, `category`, `hookPoint` (`'pre-compare' | 'dimension:headers' | 'dimension:cookies' | 'dimension:visual' | 'post-verdict'`), `blockingOnFailure`, and `configSchema`.
3. Add the pure evaluation branch inside `evaluatePluginPipeline(input, config)` returning a `PluginEvaluationResult` (`PASS | WARN | FAIL`).
4. Add a unit test in `src/engine/rules.test.ts` asserting your plugin's behavior on both passing and failing inputs.
