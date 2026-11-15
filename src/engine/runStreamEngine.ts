/**
 * ============================================================================
 * SYNCHRONOUS RUN STREAM ENGINE — PER-CHECK LIVE EXECUTION & AI OPINION PIPELINE
 * ============================================================================
 * Pure state machine for tracking progressive, check-by-check execution across:
 *   Step 1: Live Multi-Hop HTTP Flow, Headers & Set-Cookie Probe ('probing-http')
 *   Step 2: Real 1280x760 DOM Screen Capture ('capturing-screenshot')
 *   Step 3: Automatic AI Visual Judge Logical Opinion ('judging-ai')
 *   Step 4: Completed ('completed')
 * ============================================================================
 */

export type TestStreamPhase =
  | 'queued'
  | 'probing-http'
  | 'capturing-screenshot'
  | 'judging-ai'
  | 'completed';

export type RunStreamMode =
  | 'compare'
  | 'single-run'
  | 'rerun-single'
  | 'rerun-diffs';

export interface TestCheckStreamStatus {
  testId: string;
  testName: string;
  phase: TestStreamPhase;
  stepNumber: 0 | 1 | 2 | 3;
  stepLabel: string;
  shortBadge: string;
  httpDone: boolean;
  screenshotCaptured: boolean;
  aiJudged: boolean;
  aiVerdict?: 'same' | 'minor' | 'different';
  aiAffectedArea?: string;
  aiShortCallout?: string;
  aiSummary?: string;
  candLatencyMs?: number;
  baseLatencyMs?: number;
  httpStatus?: number;
  screenshotRevision?: number;
  screenshotSha256?: string;
  workerId?: number;
  workerLabel?: string;
  queueWaitMs?: number;
  executionMs?: number;
  updatedAtMs: number;
}

export interface ActiveRunStreamState {
  active: boolean;
  mode: RunStreamMode;
  runKeyA: string;
  runKeyB?: string;
  targetA: string;
  targetB: string;
  suiteAppId: string;
  startedAtMs: number;
  totalCount: number;
  completedCount: number;
  queuedCount: number;
  activeWorkers: number;
  maxConcurrency: number;
  progressPercent: number;
  currentTestId: string | null;
  currentTestName: string | null;
  currentPhase: TestStreamPhase;
  headlineStatus: string;
  byTestId: Record<string, TestCheckStreamStatus>;
}

export function formatPhaseStepMeta(phase: TestStreamPhase): {
  stepNumber: 0 | 1 | 2 | 3;
  stepLabel: string;
  shortBadge: string;
} {
  switch (phase) {
    case 'queued':
      return {
        stepNumber: 0,
        stepLabel: 'Queued · Awaiting consumer worker slot',
        shortBadge: 'Queued',
      };
    case 'probing-http':
      return {
        stepNumber: 1,
        stepLabel: 'Step 1/3 · Probing HTTP flow, headers & cookies…',
        shortBadge: '1/3 HTTP…',
      };
    case 'capturing-screenshot':
      return {
        stepNumber: 2,
        stepLabel: 'Step 2/3 · Capturing 1280×760 DOM screenshots…',
        shortBadge: '2/3 Capture…',
      };
    case 'judging-ai':
      return {
        stepNumber: 3,
        stepLabel: 'Step 3/3 · Evaluating AI Visual Judge opinion…',
        shortBadge: '3/3 AI Judge…',
      };
    case 'completed':
      return {
        stepNumber: 3,
        stepLabel: 'Complete · HTTP flow, 1280×760 capture & AI opinion ready',
        shortBadge: 'Ready',
      };
  }
}

export function createInitialRunStreamState(params: {
  mode: RunStreamMode;
  runKeyA: string;
  runKeyB?: string;
  targetA: string;
  targetB: string;
  suiteAppId: string;
  checks: ReadonlyArray<{ id: string; name: string }>;
  maxConcurrency?: number;
  nowMs?: number;
}): ActiveRunStreamState {
  const nowMs = params.nowMs ?? Date.now();
  const maxConcurrency = Math.max(1, Math.min(16, params.maxConcurrency ?? 4));
  const byTestId: Record<string, TestCheckStreamStatus> = {};
  const meta = formatPhaseStepMeta('queued');

  for (const chk of params.checks) {
    byTestId[chk.id] = {
      testId: chk.id,
      testName: chk.name,
      phase: 'queued',
      stepNumber: meta.stepNumber,
      stepLabel: meta.stepLabel,
      shortBadge: meta.shortBadge,
      httpDone: false,
      screenshotCaptured: false,
      aiJudged: false,
      updatedAtMs: nowMs,
    };
  }

  const first = params.checks[0] || null;
  const totalCount = params.checks.length;

  return {
    active: true,
    mode: params.mode,
    runKeyA: params.runKeyA,
    runKeyB: params.runKeyB,
    targetA: params.targetA,
    targetB: params.targetB,
    suiteAppId: params.suiteAppId,
    startedAtMs: nowMs,
    totalCount,
    completedCount: 0,
    queuedCount: totalCount,
    activeWorkers: 0,
    maxConcurrency,
    progressPercent: 0,
    currentTestId: first?.id ?? null,
    currentTestName: first?.name ?? null,
    currentPhase: 'queued',
    headlineStatus: first
      ? `Consumer Queue (${maxConcurrency} workers) · Enqueued ${totalCount} check${totalCount === 1 ? '' : 's'}…`
      : 'Starting parallel consumer queue…',
    byTestId,
  };
}

export function advanceTestStreamPhase(
  state: ActiveRunStreamState,
  testId: string,
  phase: TestStreamPhase,
  patch: Partial<
    Omit<
      TestCheckStreamStatus,
      'testId' | 'testName' | 'phase' | 'stepNumber' | 'stepLabel' | 'shortBadge'
    >
  > = {},
  nowMs: number = Date.now()
): ActiveRunStreamState {
  const existing = state.byTestId[testId] || {
    testId,
    testName: testId,
    phase: 'queued' as const,
    stepNumber: 0 as const,
    stepLabel: 'Queued',
    shortBadge: 'Queued',
    httpDone: false,
    screenshotCaptured: false,
    aiJudged: false,
    updatedAtMs: nowMs,
  };

  const meta = formatPhaseStepMeta(phase);
  const httpDone =
    patch.httpDone ??
    (phase === 'capturing-screenshot' ||
      phase === 'judging-ai' ||
      phase === 'completed' ||
      existing.httpDone);
  const screenshotCaptured =
    patch.screenshotCaptured ??
    (phase === 'judging-ai' ||
      phase === 'completed' ||
      existing.screenshotCaptured);
  const aiJudged =
    patch.aiJudged ?? (phase === 'completed' || existing.aiJudged);

  const workerLabel =
    patch.workerLabel ||
    (typeof patch.workerId === 'number' ? `W${patch.workerId}` : existing.workerLabel);

  const updatedItem: TestCheckStreamStatus = {
    ...existing,
    ...patch,
    workerLabel,
    phase,
    stepNumber: meta.stepNumber,
    stepLabel: meta.stepLabel,
    shortBadge: workerLabel && phase !== 'completed' && phase !== 'queued'
      ? `${workerLabel} · ${meta.shortBadge}`
      : meta.shortBadge,
    httpDone,
    screenshotCaptured,
    aiJudged,
    updatedAtMs: nowMs,
  };

  const nextByTestId: Record<string, TestCheckStreamStatus> = {
    ...state.byTestId,
    [testId]: updatedItem,
  };

  const allItems = Object.values(nextByTestId);
  const totalCount = Math.max(1, state.totalCount || allItems.length);
  const completedCount = allItems.filter((it) => it.phase === 'completed').length;
  const queuedCount = allItems.filter((it) => it.phase === 'queued').length;
  const activeWorkers = allItems.filter(
    (it) =>
      it.phase === 'probing-http' ||
      it.phase === 'capturing-screenshot' ||
      it.phase === 'judging-ai'
  ).length;

  // Compute fractional progress so intra-test phases (step 1, 2, 3) visibly advance the bar
  const fractionalDone = allItems.reduce((acc, it) => {
    if (it.phase === 'completed') return acc + 1;
    if (it.phase === 'probing-http') return acc + 0.25;
    if (it.phase === 'capturing-screenshot') return acc + 0.55;
    if (it.phase === 'judging-ai') return acc + 0.85;
    return acc;
  }, 0);
  const progressPercent = Math.min(
    100,
    Math.max(2, Math.round((fractionalDone / totalCount) * 100))
  );

  const checkIndex = allItems.findIndex((it) => it.testId === testId);
  const ordinal = checkIndex >= 0 ? `${checkIndex + 1}/${totalCount}` : `${completedCount}/${totalCount}`;
  const workerPrefix = workerLabel ? `[${workerLabel}] ` : '';

  const headlineStatus =
    phase === 'completed' && completedCount >= totalCount
      ? `Completed ${completedCount}/${totalCount} checks across ${state.maxConcurrency} parallel consumer workers`
      : `${workerPrefix}${testId} (${ordinal}) ${updatedItem.testName} — ${meta.stepLabel}`;

  return {
    ...state,
    completedCount,
    queuedCount,
    activeWorkers,
    progressPercent,
    currentTestId: testId,
    currentTestName: updatedItem.testName,
    currentPhase: phase,
    headlineStatus,
    byTestId: nextByTestId,
  };
}

export function finalizeRunStreamState(
  state: ActiveRunStreamState,
  nowMs: number = Date.now()
): ActiveRunStreamState {
  const nextByTestId: Record<string, TestCheckStreamStatus> = {};
  const completedMeta = formatPhaseStepMeta('completed');

  for (const [id, item] of Object.entries(state.byTestId)) {
    nextByTestId[id] = {
      ...item,
      phase: 'completed',
      stepNumber: completedMeta.stepNumber,
      stepLabel: completedMeta.stepLabel,
      shortBadge: completedMeta.shortBadge,
      httpDone: true,
      screenshotCaptured: true,
      aiJudged: true,
      updatedAtMs: nowMs,
    };
  }

  const totalCount = Object.keys(nextByTestId).length;
  return {
    ...state,
    active: false,
    completedCount: totalCount,
    queuedCount: 0,
    activeWorkers: 0,
    progressPercent: 100,
    currentPhase: 'completed',
    headlineStatus: `Completed ${totalCount}/${totalCount} checks · HTTP flows, 1280×760 screenshots & AI visual opinions verified`,
    byTestId: nextByTestId,
  };
}
