/**
 * ============================================================================
 * SERVER-SIDE GEMINI AGENT & MULTIMODAL VISUAL JUDGE (@google/genai)
 * ============================================================================
 * Strictly server-side module (imported only by server.ts).
 * Uses `gemini-4-hydrogen` via `@google/genai` with `User-Agent: aistudio-build`
 * and multi-turn `FunctionDeclaration` tool calling to run everything the
 * Release Gate portal offers + inspect real screenshot pairs multimodally.
 * ============================================================================
 */

import {
  type Content,
  type FunctionDeclaration,
  GoogleGenAI,
  ThinkingLevel,
  Type,
} from '@google/genai';
import {
  type AgentPortalAction,
  type AgentPortalContext,
  buildAgentSystemInstruction,
  matchAgentSkills,
  planFallbackAgentResponse,
  PORTAL_TOOL_SCHEMAS,
} from './agentSkills';
import type { ItemizedVisualFinding } from './pixelDiff';
import type { ScheduledRunPoint } from './scheduledRunsEngine';

const GEMINI_MODEL = 'gemini-4-hydrogen';

export function isServerGeminiConfigured(): boolean {
  const key = process.env.GEMINI_API_KEY;
  return Boolean(key && key.trim().length > 8);
}

export function createServerGeminiClient(): GoogleGenAI | null {
  if (!isServerGeminiConfigured()) return null;
  return new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY!.trim(),
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function mapSchemaType(
  raw: 'STRING' | 'NUMBER' | 'BOOLEAN' | 'ARRAY'
): Type {
  switch (raw) {
    case 'NUMBER':
      return Type.NUMBER;
    case 'BOOLEAN':
      return Type.BOOLEAN;
    case 'ARRAY':
      return Type.ARRAY;
    default:
      return Type.STRING;
  }
}

export function buildGeminiPortalToolDeclarations(): FunctionDeclaration[] {
  return PORTAL_TOOL_SCHEMAS.map((schema) => {
    const props: Record<string, any> = {};
    for (const [k, def] of Object.entries(schema.parameters.properties)) {
      props[k] = {
        type: mapSchemaType(def.type),
        description: def.description,
        ...(def.enum ? { enum: def.enum } : {}),
        ...(def.items ? { items: { type: mapSchemaType(def.items.type) } } : {}),
      };
    }
    return {
      name: schema.name,
      description: schema.description,
      parameters: {
        type: Type.OBJECT,
        properties: props,
        ...(schema.parameters.required ? { required: schema.parameters.required } : {}),
      },
    };
  });
}

export interface AgentChatMessageInput {
  role: 'user' | 'assistant';
  content: string;
}

export interface ServerToolExecutors {
  getPortalState: () => Promise<Record<string, unknown>>;
  getScheduleAnalytics: (args: {
    appId?: string;
    range?: string;
  }) => Promise<Record<string, unknown>>;
  triggerScheduledRun: (args: {
    appId?: string;
    popId?: string;
  }) => Promise<Record<string, unknown>>;
  updateSchedulePolicy: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
  createOrUpdateProperty: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
  createOrUpdateTest: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
  deleteTest: (args: { appId?: string; testId: string }) => Promise<Record<string, unknown>>;
  evaluateVisualDiff: (args: { testId: string }) => Promise<Record<string, unknown>>;
}

export interface AgentChatResponsePayload {
  reply: string;
  model: string;
  mode: 'gemini-tool-agent' | 'deterministic-skill-router';
  matchedSkills: string[];
  actions: AgentPortalAction[];
  executedTools: Array<{ name: string; args: Record<string, unknown>; ok: boolean }>;
}

function mapToolCallToPortalAction(
  name: string,
  args: Record<string, unknown>
): AgentPortalAction | null {
  switch (name) {
    case 'switch_view':
      return {
        type: 'switch_view',
        viewMode: (args.viewMode as any) || 'workbench',
        setupTab: args.setupTab as any,
      };
    case 'select_property':
      return {
        type: 'select_property',
        appId: String(args.appId || 'www').toLowerCase(),
      };
    case 'select_check':
      return {
        type: 'select_check',
        testId: String(args.testId || 'T01').toUpperCase(),
        tab: args.tab as any,
      };
    case 'set_comparison_targets':
      return {
        type: 'set_comparison_targets',
        compareMode: args.compareMode as any,
        candidateTarget: args.candidateTarget ? String(args.candidateTarget) : undefined,
        baselineTarget: args.baselineTarget ? String(args.baselineTarget) : undefined,
        executionPopId: args.executionPopId ? String(args.executionPopId) : undefined,
        ignoreAcceptedDiffs:
          typeof args.ignoreAcceptedDiffs === 'boolean' ? args.ignoreAcceptedDiffs : undefined,
      };
    case 'run_live_gate':
      return {
        type: 'run_live_gate',
        appId: args.appId ? String(args.appId).toLowerCase() : undefined,
      };
    case 'rerun_check':
      return {
        type: 'rerun_check',
        testId: String(args.testId || 'T01').toUpperCase(),
      };
    case 'run_ai_visual_judge':
      return {
        type: 'run_ai_visual_judge',
        testId: String(args.testId || 'T01').toUpperCase(),
      };
    case 'trigger_scheduled_run':
      return {
        type: 'trigger_scheduled_run',
        appId: args.appId ? String(args.appId).toLowerCase() : undefined,
        popId: args.popId ? String(args.popId).toLowerCase() : undefined,
        switchToSchedulesView: Boolean(args.switchToSchedulesView),
      };
    case 'update_schedule_policy':
      return {
        type: 'update_schedule_policy',
        appId: args.appId ? String(args.appId).toLowerCase() : undefined,
        enabled: typeof args.enabled === 'boolean' ? args.enabled : undefined,
        intervalMinutes:
          typeof args.intervalMinutes === 'number' ? (args.intervalMinutes as any) : undefined,
        strategy: args.strategy as any,
        assignedPops: Array.isArray(args.assignedPops)
          ? args.assignedPops.map(String)
          : undefined,
        slaTargetPct: typeof args.slaTargetPct === 'number' ? args.slaTargetPct : undefined,
        slaWarningMs: typeof args.slaWarningMs === 'number' ? args.slaWarningMs : undefined,
      };
    case 'inspect_schedule_graph':
      return {
        type: 'inspect_schedule_graph',
        graphMode: args.graphMode as any,
        timeRange: args.timeRange as any,
        checkFilter: args.checkFilter ? String(args.checkFilter) : undefined,
        popFilter: args.popFilter ? String(args.popFilter) : undefined,
      };
    case 'create_property':
      return {
        type: 'create_property',
        id: String(args.id || '').toLowerCase(),
        name: String(args.name || args.id || 'New Property'),
        canonicalHost: String(args.canonicalHost || 'www.salesforce.com'),
      };
    case 'upsert_environment':
      return {
        type: 'upsert_environment',
        appId: args.appId ? String(args.appId).toLowerCase() : undefined,
        envId: String(args.envId || 'uat').toLowerCase(),
        envName: String(args.envName || args.envId || 'UAT'),
        stagingHost: args.stagingHost ? String(args.stagingHost) : undefined,
        prodHost: args.prodHost ? String(args.prodHost) : undefined,
        stagingEdgeIp: args.stagingEdgeIp ? String(args.stagingEdgeIp) : undefined,
        prodEdgeIp: args.prodEdgeIp ? String(args.prodEdgeIp) : undefined,
      };
    case 'create_or_update_test':
      return {
        type: 'create_or_update_test',
        appId: args.appId ? String(args.appId).toLowerCase() : undefined,
        testId: args.testId ? String(args.testId).toUpperCase() : undefined,
        name: String(args.name || 'Custom Synthetic Check'),
        path: String(args.path || '/'),
        testType: args.testType as any,
        httpMethod: args.httpMethod as any,
        expectedStatus: args.expectedStatus ? String(args.expectedStatus) : undefined,
        scriptEngine: args.scriptEngine as any,
        customScript: args.customScript ? String(args.customScript) : undefined,
      };
    case 'delete_test':
      return {
        type: 'delete_test',
        appId: args.appId ? String(args.appId).toLowerCase() : undefined,
        testId: String(args.testId || '').toUpperCase(),
      };
    case 'toggle_accept_header':
      return {
        type: 'toggle_accept_header',
        field: String(args.field || 'cache-control').toLowerCase(),
      };
    case 'toggle_accept_cookie':
      return {
        type: 'toggle_accept_cookie',
        cookieName: String(args.cookieName || '').toLowerCase(),
      };
    case 'toggle_accept_visual':
      return {
        type: 'toggle_accept_visual',
        testId: String(args.testId || 'T01').toUpperCase(),
      };
    case 'reset_policies':
      return { type: 'reset_policies' };
    case 'copy_gate_report':
      return { type: 'copy_gate_report' };
    default:
      return null;
  }
}

async function executeFallbackActionsOnServer(
  actions: AgentPortalAction[],
  context: AgentPortalContext,
  executors: ServerToolExecutors
): Promise<AgentChatResponsePayload['executedTools']> {
  const executedTools: AgentChatResponsePayload['executedTools'] = [];
  for (const action of actions) {
    if (action.type === 'trigger_scheduled_run') {
      const res = await executors.triggerScheduledRun({ appId: action.appId, popId: action.popId });
      if (res && typeof res === 'object' && 'point' in res && res.point) {
        action.point = res.point as ScheduledRunPoint;
      }
      executedTools.push({ name: 'trigger_scheduled_run', args: { appId: action.appId || context.activeAppId }, ok: true });
    } else if (action.type === 'update_schedule_policy') {
      await executors.updateSchedulePolicy(action as unknown as Record<string, unknown>);
      executedTools.push({ name: 'update_schedule_policy', args: { appId: action.appId || context.activeAppId }, ok: true });
    } else if (action.type === 'create_or_update_test') {
      await executors.createOrUpdateTest(action as unknown as Record<string, unknown>);
      executedTools.push({ name: 'create_or_update_test', args: { name: action.name, path: action.path }, ok: true });
    } else {
      executedTools.push({ name: action.type, args: action as unknown as Record<string, unknown>, ok: true });
    }
  }
  return executedTools;
}

export async function runGeminiPortalAgentChat(params: {
  prompt: string;
  history?: AgentChatMessageInput[];
  context: AgentPortalContext;
  enabledSkillIds?: string[];
  executors: ServerToolExecutors;
}): Promise<AgentChatResponsePayload> {
  const { prompt, history = [], context, enabledSkillIds, executors } = params;
  const activeSkills = matchAgentSkills(prompt, enabledSkillIds);
  const matchedSkillIds = activeSkills.map((s) => s.id);

  const ai = createServerGeminiClient();
  if (!ai) {
    const fallback = planFallbackAgentResponse(prompt, context, enabledSkillIds);
    const executedTools = await executeFallbackActionsOnServer(fallback.actions, context, executors);
    return {
      reply: fallback.reply,
      model: 'portal-skill-router',
      mode: 'deterministic-skill-router',
      matchedSkills: matchedSkillIds,
      actions: fallback.actions,
      executedTools,
    };
  }

  try {
    const systemInstruction = buildAgentSystemInstruction(context, activeSkills);
    const declarations = buildGeminiPortalToolDeclarations();

    const contents: Content[] = [
      ...history.slice(-8).map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
      { role: 'user', parts: [{ text: prompt }] },
    ];

    const collectedActions: AgentPortalAction[] = [];
    const executedTools: AgentChatResponsePayload['executedTools'] = [];
    let finalText = '';

    for (let turn = 0; turn < 3; turn++) {
      const response = await Promise.race([
        ai.models.generateContent({
          model: GEMINI_MODEL,
          contents,
          config: {
            systemInstruction,
            tools: [{ functionDeclarations: declarations }],
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          },
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Gemini agent turn timeout (16s)')), 16000)
        ),
      ]);

      const candidateContent = response.candidates?.[0]?.content;
      const fnCalls = response.functionCalls;

      if (!fnCalls || fnCalls.length === 0) {
        finalText = response.text?.trim() || '';
        break;
      }

      if (candidateContent) {
        contents.push(candidateContent);
      }

      const responseParts: Array<{
        functionResponse: { id?: string; name: string; response: Record<string, unknown> };
      }> = [];

      for (const call of fnCalls) {
        const fnName = call.name || '';
        const fnArgs = (call.args || {}) as Record<string, unknown>;
        let fnResult: Record<string, unknown> = { ok: true };
        let ok = true;

        try {
          if (fnName === 'get_portal_state') {
            fnResult = await executors.getPortalState();
          } else if (fnName === 'get_schedule_analytics') {
            fnResult = await executors.getScheduleAnalytics({
              appId: fnArgs.appId ? String(fnArgs.appId) : context.activeAppId,
              range: fnArgs.range ? String(fnArgs.range) : '24h',
            });
          } else if (fnName === 'trigger_scheduled_run') {
            fnResult = await executors.triggerScheduledRun({
              appId: fnArgs.appId ? String(fnArgs.appId) : context.activeAppId,
              popId: fnArgs.popId ? String(fnArgs.popId) : undefined,
            });
          } else if (fnName === 'update_schedule_policy') {
            fnResult = await executors.updateSchedulePolicy({
              ...fnArgs,
              appId: fnArgs.appId ? String(fnArgs.appId) : context.activeAppId,
            });
          } else if (fnName === 'create_property') {
            fnResult = await executors.createOrUpdateProperty(fnArgs);
          } else if (fnName === 'create_or_update_test') {
            fnResult = await executors.createOrUpdateTest({
              ...fnArgs,
              appId: fnArgs.appId ? String(fnArgs.appId) : context.activeAppId,
            });
          } else if (fnName === 'delete_test') {
            fnResult = await executors.deleteTest({
              appId: fnArgs.appId ? String(fnArgs.appId) : context.activeAppId,
              testId: String(fnArgs.testId || ''),
            });
          } else if (fnName === 'run_ai_visual_judge') {
            fnResult = await executors.evaluateVisualDiff({
              testId: String(fnArgs.testId || context.selectedTestId || 'T01'),
            });
          } else {
            fnResult = { queuedForClientExecution: true, action: fnName, args: fnArgs };
          }

          const mapped = mapToolCallToPortalAction(fnName, fnArgs);
          if (mapped) {
            if (
              mapped.type === 'trigger_scheduled_run' &&
              fnResult &&
              typeof fnResult === 'object' &&
              'point' in fnResult &&
              fnResult.point
            ) {
              mapped.point = fnResult.point as any;
              const { point: _omitPoint, ...compactResult } = fnResult;
              fnResult = compactResult;
            }
            collectedActions.push(mapped);
          }
        } catch (err) {
          ok = false;
          fnResult = { error: err instanceof Error ? err.message : 'Tool execution error' };
        }

        executedTools.push({ name: fnName, args: fnArgs, ok });
        responseParts.push({
          functionResponse: {
            id: call.id,
            name: fnName,
            response: fnResult,
          },
        });
      }

      contents.push({
        role: 'user',
        parts: responseParts as any,
      });
    }

    const fallbackPlan = planFallbackAgentResponse(prompt, context, enabledSkillIds);
    if (collectedActions.length === 0 && fallbackPlan.actions.length > 0) {
      const extraTools = await executeFallbackActionsOnServer(
        fallbackPlan.actions,
        context,
        executors
      );
      collectedActions.push(...fallbackPlan.actions);
      executedTools.push(...extraTools);
    }

    if (!finalText || finalText.toLowerCase() === 'done.') {
      finalText = fallbackPlan.reply;
    }

    return {
      reply: finalText,
      model: GEMINI_MODEL,
      mode: 'gemini-tool-agent',
      matchedSkills: matchedSkillIds,
      actions: collectedActions,
      executedTools,
    };
  } catch {
    // Graceful deterministic fallback on transient or restricted API keys
    const fallback = planFallbackAgentResponse(prompt, context, enabledSkillIds);
    const executedTools = await executeFallbackActionsOnServer(
      fallback.actions,
      context,
      executors
    );
    return {
      reply: fallback.reply,
      model: 'portal-skill-router',
      mode: 'deterministic-skill-router',
      matchedSkills: matchedSkillIds,
      actions: fallback.actions,
      executedTools,
    };
  }
}

export interface GeminiVisualJudgeOutput {
  verdict: 'same' | 'minor' | 'different';
  affectedArea: string;
  shortCallout: string;
  summary: string;
  differences: ItemizedVisualFinding[];
  modelUsed: string;
}

export async function runGeminiMultimodalVisualJudge(params: {
  testId: string;
  testName: string;
  url: string;
  candidateLabel: string;
  baselineLabel: string;
  pixelDiffPercent: number;
  sideABuffer: Buffer;
  sideBBuffer: Buffer;
}): Promise<GeminiVisualJudgeOutput | null> {
  const ai = createServerGeminiClient();
  if (!ai) return null;

  try {
    const prompt = [
      `Compare these two 1280x760 website screenshots for endpoint "${params.testName}" (${params.url}).`,
      `Image 1 is Candidate (${params.candidateLabel}). Image 2 is Baseline (${params.baselineLabel}).`,
      `Measured overall pixel delta is ${params.pixelDiffPercent.toFixed(2)}%.`,
      `DO NOT use a fixed or generic checklist of parameters.`,
      `Instead, first identify what kind of page this is from its URL and visible UI (e.g., pricing matrix, SSO login, lead-gen form, homepage campaign, developer docs, localized regional page), and dynamically invent 3 to 6 page-specific validation parameters that matter most for THIS exact page.`,
      `For each validation parameter include: id (kebab-case), region (the page-specific validation parameter name), rationale (short 1-line explanation of why you selected this parameter for this page), severity ("major" | "minor" | "match"), stagingObservation, prodObservation, description, impact, zoneDeltaPct (0-100), and box ({x,y,w,h} percentage 0-100 on the screenshot).`,
      `NEVER report "match" or 0% drift if Image 1 and Image 2 visibly differ in that area (for example, a collapsed mobile hamburger header, a right-side skeleton loader/drawer, missing imagery, or changed layout).`,
    ].join('\n');

    const response = await Promise.race([
      ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: [
          {
            role: 'user',
            parts: [
              { inlineData: { data: params.sideABuffer.toString('base64'), mimeType: 'image/jpeg' } },
              { inlineData: { data: params.sideBBuffer.toString('base64'), mimeType: 'image/jpeg' } },
              { text: prompt },
            ],
          },
        ],
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              verdict: { type: Type.STRING, enum: ['same', 'minor', 'different'] },
              affectedArea: { type: Type.STRING },
              shortCallout: { type: Type.STRING },
              summary: { type: Type.STRING },
              differences: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING },
                    region: { type: Type.STRING },
                    rationale: { type: Type.STRING },
                    severity: { type: Type.STRING, enum: ['major', 'minor', 'match'] },
                    stagingObservation: { type: Type.STRING },
                    prodObservation: { type: Type.STRING },
                    description: { type: Type.STRING },
                    impact: { type: Type.STRING },
                    zoneDeltaPct: { type: Type.NUMBER },
                    box: {
                      type: Type.OBJECT,
                      properties: {
                        x: { type: Type.NUMBER },
                        y: { type: Type.NUMBER },
                        w: { type: Type.NUMBER },
                        h: { type: Type.NUMBER },
                      },
                      required: ['x', 'y', 'w', 'h'],
                    },
                  },
                  required: [
                    'id',
                    'region',
                    'rationale',
                    'severity',
                    'stagingObservation',
                    'prodObservation',
                    'description',
                    'impact',
                    'zoneDeltaPct',
                  ],
                },
              },
            },
            required: ['verdict', 'affectedArea', 'shortCallout', 'summary', 'differences'],
          },
        },
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Gemini visual judge timeout (14s)')), 14000)
      ),
    ]);

    const parsed = JSON.parse(response.text || '{}');
    if (!parsed || !Array.isArray(parsed.differences) || parsed.differences.length === 0) {
      return null;
    }

    const defaultBoxes = [
      { x: 0, y: 0, w: 100, h: 14 },
      { x: 64, y: 10, w: 36, h: 88 },
      { x: 2, y: 14, w: 62, h: 48 },
      { x: 2, y: 62, w: 62, h: 24 },
      { x: 0, y: 84, w: 100, h: 16 },
    ];

    const clampBox = (b: any, fallback: { x: number; y: number; w: number; h: number }) => {
      if (!b || typeof b.x !== 'number' || typeof b.y !== 'number' || typeof b.w !== 'number' || typeof b.h !== 'number') {
        return fallback;
      }
      const x = Math.max(0, Math.min(95, Math.round(b.x)));
      const y = Math.max(0, Math.min(95, Math.round(b.y)));
      const w = Math.max(5, Math.min(100 - x, Math.round(b.w)));
      const h = Math.max(5, Math.min(100 - y, Math.round(b.h)));
      return { x, y, w, h };
    };

    return {
      verdict:
        parsed.verdict === 'same' || parsed.verdict === 'minor' || parsed.verdict === 'different'
          ? parsed.verdict
          : params.pixelDiffPercent > 5
          ? 'different'
          : params.pixelDiffPercent > 0.1
          ? 'minor'
          : 'same',
      affectedArea: String(parsed.affectedArea || 'Primary Content'),
      shortCallout: String(parsed.shortCallout || 'Visual layout comparison'),
      summary: String(parsed.summary || 'Visual comparison evaluated.'),
      differences: parsed.differences.slice(0, 6).map((d: any, idx: number) => ({
        id: String(d.id || `ai-param-${idx + 1}`),
        region: String(d.region || `Page Criterion ${idx + 1}`),
        rationale: d.rationale ? String(d.rationale) : undefined,
        parameterOrigin: 'gemini-multimodal' as const,
        severity:
          d.severity === 'major' || d.severity === 'minor' || d.severity === 'match'
            ? d.severity
            : 'minor',
        stagingObservation: String(d.stagingObservation || ''),
        prodObservation: String(d.prodObservation || ''),
        description: String(d.description || ''),
        impact: String(d.impact || ''),
        zoneDeltaPct: typeof d.zoneDeltaPct === 'number' ? d.zoneDeltaPct : params.pixelDiffPercent,
        box: clampBox(d.box, defaultBoxes[idx] || { x: 0, y: 0, w: 100, h: 25 }),
      })),
      modelUsed: GEMINI_MODEL,
    };
  } catch {
    return null;
  }
}
