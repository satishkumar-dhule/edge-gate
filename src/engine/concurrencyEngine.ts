/**
 * ============================================================================
 * CONSUMER QUEUES, PARALLEL PROCESSING & MULTITHREADED WORKER POOL ENGINE
 * ============================================================================
 * Provides three composable concurrency primitives across both Node.js
 * (Express / CLI / AWS Lambda) and Browser SPA runtimes:
 *
 *   1. WorkStealingConsumerQueue<TJob, TResult>:
 *      - Priority-aware ('critical' > 'high' > 'normal') multi-consumer queue
 *      - Bounded parallel worker slots (W1..WN) with work-stealing dispatch
 *      - Automatic retry with exponential backoff + Dead-Letter Queue (DLQ)
 *      - Real-time telemetry snapshot (queueDepth, inFlight, worker slots, throughput)
 *
 *   2. MultithreadedWorkerPool:
 *      - Node.js runtime: Spawns real OS threads via `node:worker_threads`
 *        (`os.availableParallelism()`) for CPU-bound RGBA frame diffing,
 *        heatmap generation, and SHA-256 digest computation off the event loop.
 *      - Browser runtime: Spawns real Web Workers (`window.Worker` via Blob URL)
 *        so 1280x760 RGBA pixel diffing and 640x380 heatmap rendering never
 *        block the 60fps main UI thread.
 *      - Seamless fallback to inline execution if Worker threads are unavailable.
 *
 *   3. executeParallelConsumerBatch:
 *      - Deterministic index-preserving parallel batch executor over the
 *        WorkStealingConsumerQueue with per-item workerId and timing metadata.
 * ============================================================================
 */

import { compareRgbaFrames, type MeasuredVisualDiffResult } from './pixelDiff';

export type QueuePriority = 'critical' | 'high' | 'normal';

export interface ConsumerWorkerSlot {
  workerId: number;
  label: string;
  state: 'idle' | 'busy';
  activeJobId: string | null;
  activeJobLabel: string | null;
  jobsCompleted: number;
  jobsFailed: number;
  totalBusyMs: number;
  lastDurationMs: number;
  updatedAtMs: number;
}

export interface DeadLetterQueueItem<TJob = unknown> {
  id: string;
  jobId: string;
  label: string;
  priority: QueuePriority;
  attempts: number;
  errorMessage: string;
  failedAtIso: string;
  payload: TJob;
}

export interface ConsumerJobContext {
  jobId: string;
  workerId: number;
  workerLabel: string;
  attempt: number;
  queueWaitMs: number;
  enqueuedAtMs: number;
  startedAtMs: number;
}

export interface ConsumerJobReceipt<TResult> {
  jobId: string;
  label: string;
  workerId: number;
  workerLabel: string;
  priority: QueuePriority;
  attempts: number;
  queueWaitMs: number;
  executionMs: number;
  totalElapsedMs: number;
  result: TResult;
}

export interface ConsumerQueueTelemetrySnapshot {
  queueName: string;
  maxConsumers: number;
  pendingCount: number;
  inFlightCount: number;
  completedCount: number;
  failedCount: number;
  dlqCount: number;
  totalEnqueuedCount: number;
  avgQueueWaitMs: number;
  avgExecutionMs: number;
  peakConcurrencyObserved: number;
  workers: ConsumerWorkerSlot[];
  dlqItems: DeadLetterQueueItem[];
  dlq: DeadLetterQueueItem[];
}

interface InternalQueuedTask<TJob, TResult> {
  seq: number;
  jobId: string;
  label: string;
  priority: QueuePriority;
  priorityWeight: number;
  payload: TJob;
  maxAttempts: number;
  retryDelayMs: number;
  enqueuedAtMs: number;
  execute: (payload: TJob, ctx: ConsumerJobContext) => Promise<TResult>;
  onStart?: (ctx: ConsumerJobContext) => void;
  onComplete?: (receipt: ConsumerJobReceipt<TResult>) => void;
  resolve: (receipt: ConsumerJobReceipt<TResult>) => void;
  reject: (err: Error) => void;
}

const PRIORITY_WEIGHTS: Record<QueuePriority, number> = {
  critical: 3,
  high: 2,
  normal: 1,
};

/**
 * Priority-ordered, work-stealing multi-consumer queue.
 * Multiple consumer fibers pull from the shared priority queue concurrently up to `maxConsumers`.
 */
export class WorkStealingConsumerQueue<TJob = unknown, TResult = unknown> {
  public readonly queueName: string;
  public readonly maxConsumers: number;
  private readonly defaultMaxAttempts: number;
  private readonly defaultRetryDelayMs: number;
  private readonly pendingQueue: Array<InternalQueuedTask<TJob, TResult>> = [];
  private readonly workers: ConsumerWorkerSlot[] = [];
  private readonly dlq: DeadLetterQueueItem<TJob>[] = [];
  private seqCounter = 0;
  private inFlightCount = 0;
  private completedCount = 0;
  private failedCount = 0;
  private totalEnqueuedCount = 0;
  private totalQueueWaitMs = 0;
  private totalExecutionMs = 0;
  private peakConcurrencyObserved = 0;
  private readonly listeners = new Set<
    (snapshot: ConsumerQueueTelemetrySnapshot) => void
  >();

  constructor(options?: {
    queueName?: string;
    maxConsumers?: number;
    maxConcurrency?: number;
    defaultMaxAttempts?: number;
    maxRetries?: number;
    defaultRetryDelayMs?: number;
    retryBaseDelayMs?: number;
  }) {
    this.queueName = options?.queueName || 'release-gate-consumer-queue';
    const rawCon = options?.maxConsumers ?? options?.maxConcurrency ?? 4;
    this.maxConsumers = Math.max(1, Math.min(32, Number(rawCon)));
    const rawAtt =
      options?.defaultMaxAttempts ??
      (options?.maxRetries !== undefined ? options.maxRetries + 1 : 2);
    this.defaultMaxAttempts = Math.max(1, Number(rawAtt));
    const rawDelay = options?.defaultRetryDelayMs ?? options?.retryBaseDelayMs ?? 15;
    this.defaultRetryDelayMs = Math.max(1, Number(rawDelay));

    const now = Date.now();
    for (let i = 1; i <= this.maxConsumers; i++) {
      this.workers.push({
        workerId: i,
        label: `W${i}`,
        state: 'idle',
        activeJobId: null,
        activeJobLabel: null,
        jobsCompleted: 0,
        jobsFailed: 0,
        totalBusyMs: 0,
        lastDurationMs: 0,
        updatedAtMs: now,
      });
    }
  }

  public subscribe(
    listener: (snapshot: ConsumerQueueTelemetrySnapshot) => void
  ): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emitChange(): void {
    if (this.listeners.size === 0) return;
    const snap = this.getTelemetrySnapshot();
    for (const fn of this.listeners) {
      try {
        fn(snap);
      } catch {
        // Ignore listener error
      }
    }
  }

  /**
   * Enqueues a job into the priority queue and immediately wakes an idle consumer worker if available.
   */
  public enqueue(params: {
    id?: string;
    jobId?: string;
    label?: string;
    priority?: QueuePriority;
    payload: TJob;
    maxAttempts?: number;
    maxRetries?: number;
    retryDelayMs?: number;
    execute: (payload: TJob, ctx: ConsumerJobContext) => Promise<TResult>;
    onStart?: (ctx: ConsumerJobContext) => void;
    onComplete?: (receipt: ConsumerJobReceipt<TResult>) => void;
  }): Promise<ConsumerJobReceipt<TResult>> {
    const seq = ++this.seqCounter;
    const jobId = params.jobId || params.id || `job-${seq}`;
    const label = params.label || jobId;
    const priority = params.priority || 'normal';
    const priorityWeight = PRIORITY_WEIGHTS[priority] ?? 1;
    const enqueuedAtMs = Date.now();
    this.totalEnqueuedCount += 1;
    const resolvedAttempts =
      params.maxAttempts ??
      (params.maxRetries !== undefined ? params.maxRetries + 1 : this.defaultMaxAttempts);

    return new Promise<ConsumerJobReceipt<TResult>>((resolve, reject) => {
      const task: InternalQueuedTask<TJob, TResult> = {
        seq,
        jobId,
        label,
        priority,
        priorityWeight,
        payload: params.payload,
        maxAttempts: Math.max(1, resolvedAttempts),
        retryDelayMs: Math.max(1, params.retryDelayMs ?? this.defaultRetryDelayMs),
        enqueuedAtMs,
        execute: params.execute,
        onStart: params.onStart,
        onComplete: params.onComplete,
        resolve,
        reject,
      };

      // Insert in priority order (higher priorityWeight first, FIFO seq tie-breaker)
      let inserted = false;
      for (let i = 0; i < this.pendingQueue.length; i++) {
        const cur = this.pendingQueue[i];
        if (
          task.priorityWeight > cur.priorityWeight ||
          (task.priorityWeight === cur.priorityWeight && task.seq < cur.seq)
        ) {
          this.pendingQueue.splice(i, 0, task);
          inserted = true;
          break;
        }
      }
      if (!inserted) {
        this.pendingQueue.push(task);
      }

      this.emitChange();
      this.pumpConsumers();
    });
  }

  private pumpConsumers(): void {
    while (this.pendingQueue.length > 0 && this.inFlightCount < this.maxConsumers) {
      const idleWorker = this.workers.find((w) => w.state === 'idle');
      if (!idleWorker) break;
      const nextTask = this.pendingQueue.shift();
      if (!nextTask) break;
      void this.runTaskOnWorker(idleWorker, nextTask);
    }
  }

  private async runTaskOnWorker(
    worker: ConsumerWorkerSlot,
    task: InternalQueuedTask<TJob, TResult>
  ): Promise<void> {
    worker.state = 'busy';
    worker.activeJobId = task.jobId;
    worker.activeJobLabel = task.label;
    worker.updatedAtMs = Date.now();
    this.inFlightCount += 1;
    if (this.inFlightCount > this.peakConcurrencyObserved) {
      this.peakConcurrencyObserved = this.inFlightCount;
    }
    this.emitChange();

    const startedAtMs = Date.now();
    const queueWaitMs = Math.max(0, startedAtMs - task.enqueuedAtMs);
    this.totalQueueWaitMs += queueWaitMs;

    let lastError: Error | null = null;
    let attempt = 0;

    try {
      while (attempt < task.maxAttempts) {
        attempt += 1;
        const ctx: ConsumerJobContext = {
          jobId: task.jobId,
          workerId: worker.workerId,
          workerLabel: worker.label,
          attempt,
          queueWaitMs,
          enqueuedAtMs: task.enqueuedAtMs,
          startedAtMs,
        };
        if (attempt === 1 && task.onStart) {
          try {
            task.onStart(ctx);
          } catch {
            // Ignore callback error
          }
        }
        try {
          const result = await task.execute(task.payload, ctx);
          const finishedAtMs = Date.now();
          const executionMs = Math.max(1, finishedAtMs - startedAtMs);
          this.totalExecutionMs += executionMs;
          this.completedCount += 1;
          worker.jobsCompleted += 1;
          worker.totalBusyMs += executionMs;
          worker.lastDurationMs = executionMs;

          const receipt: ConsumerJobReceipt<TResult> = {
            jobId: task.jobId,
            label: task.label,
            workerId: worker.workerId,
            workerLabel: worker.label,
            priority: task.priority,
            attempts: attempt,
            queueWaitMs,
            executionMs,
            totalElapsedMs: queueWaitMs + executionMs,
            result,
          };

          if (task.onComplete) {
            try {
              task.onComplete(receipt);
            } catch {
              // Ignore callback error
            }
          }
          task.resolve(receipt);
          return;
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
          if (attempt < task.maxAttempts) {
            const backoffMs = task.retryDelayMs * Math.pow(2, attempt - 1);
            await new Promise((r) => setTimeout(r, backoffMs));
          }
        }
      }

      // Exhausted all attempts -> route to Dead-Letter Queue (DLQ)
      const finalError = lastError || new Error(`Job ${task.jobId} failed`);
      this.failedCount += 1;
      worker.jobsFailed += 1;
      this.dlq.unshift({
        id: task.jobId,
        jobId: task.jobId,
        label: task.label,
        priority: task.priority,
        attempts: attempt,
        errorMessage: finalError.message,
        failedAtIso: new Date().toISOString(),
        payload: task.payload,
      });
      if (this.dlq.length > 50) {
        this.dlq.length = 50;
      }
      task.reject(finalError);
    } finally {
      worker.state = 'idle';
      worker.activeJobId = null;
      worker.activeJobLabel = null;
      worker.updatedAtMs = Date.now();
      this.inFlightCount = Math.max(0, this.inFlightCount - 1);
      this.emitChange();
      this.pumpConsumers();
    }
  }

  public getTelemetrySnapshot(): ConsumerQueueTelemetrySnapshot {
    const settled = Math.max(1, this.completedCount + this.failedCount);
    const dlqSlice = this.dlq.slice(0, 20);
    return {
      queueName: this.queueName,
      maxConsumers: this.maxConsumers,
      pendingCount: this.pendingQueue.length,
      inFlightCount: this.inFlightCount,
      completedCount: this.completedCount,
      failedCount: this.failedCount,
      dlqCount: this.dlq.length,
      totalEnqueuedCount: this.totalEnqueuedCount,
      avgQueueWaitMs: Math.round(this.totalQueueWaitMs / settled),
      avgExecutionMs: Math.round(this.totalExecutionMs / Math.max(1, this.completedCount)),
      peakConcurrencyObserved: this.peakConcurrencyObserved,
      workers: this.workers.map((w) => ({ ...w })),
      dlqItems: dlqSlice,
      dlq: dlqSlice,
    };
  }
}

/**
 * Executes a batch of items in parallel across a WorkStealingConsumerQueue,
 * preserving deterministic output order while reporting per-item workerId & timing.
 */
export async function executeParallelConsumerBatch<TItem, TResult>(params: {
  items: ReadonlyArray<TItem>;
  concurrency?: number;
  queueName?: string;
  maxAttempts?: number;
  retryDelayMs?: number;
  getJobId?: (item: TItem, index: number) => string;
  getLabel?: (item: TItem, index: number) => string;
  getPriority?: (item: TItem, index: number) => QueuePriority;
  worker: (item: TItem, ctx: ConsumerJobContext, index: number) => Promise<TResult>;
  onItemStart?: (item: TItem, ctx: ConsumerJobContext, index: number) => void;
  onItemComplete?: (
    item: TItem,
    receipt: ConsumerJobReceipt<TResult>,
    index: number
  ) => void;
  onQueueProgress?: (snapshot: ConsumerQueueTelemetrySnapshot) => void;
}): Promise<{
  results: TResult[];
  receipts: Array<ConsumerJobReceipt<TResult>>;
  telemetry: ConsumerQueueTelemetrySnapshot;
}> {
  const queue = new WorkStealingConsumerQueue<
    { item: TItem; index: number },
    TResult
  >({
    queueName: params.queueName || 'batch-consumer-queue',
    maxConsumers: params.concurrency ?? 4,
    defaultMaxAttempts: params.maxAttempts ?? 2,
    defaultRetryDelayMs: params.retryDelayMs ?? 10,
  });

  const unsub = params.onQueueProgress
    ? queue.subscribe(params.onQueueProgress)
    : null;

  try {
    const promises = params.items.map((item, index) => {
      const jobId = params.getJobId ? params.getJobId(item, index) : `item-${index + 1}`;
      const label = params.getLabel ? params.getLabel(item, index) : jobId;
      const priority = params.getPriority ? params.getPriority(item, index) : 'normal';
      return queue.enqueue({
        jobId,
        label,
        priority,
        payload: { item, index },
        execute: ({ item: it, index: idx }, ctx) => params.worker(it, ctx, idx),
        onStart: (ctx) => params.onItemStart?.(item, ctx, index),
        onComplete: (receipt) => params.onItemComplete?.(item, receipt, index),
      });
    });

    const receipts = await Promise.all(promises);
    const results = receipts.map((r) => r.result);
    return {
      results,
      receipts,
      telemetry: queue.getTelemetrySnapshot(),
    };
  } finally {
    if (unsub) unsub();
  }
}

/**
 * Pure RGBA Diff Heatmap generator (also used inside Web Workers / Node worker_threads).
 * Highlights differing pixels in high-contrast rose (#f43f5e) and dims matching pixels.
 */
export function computeDiffHeatmapRgba(
  frameA: Uint8Array | Uint8ClampedArray,
  frameB: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  threshold = 18
): Uint8ClampedArray {
  const totalBytes = Math.max(0, width * height * 4);
  const out = new Uint8ClampedArray(totalBytes);
  if (totalBytes === 0 || frameA.length < totalBytes || frameB.length < totalBytes) {
    return out;
  }

  for (let i = 0; i < totalBytes; i += 4) {
    const dr = Math.abs(frameA[i] - frameB[i]);
    const dg = Math.abs(frameA[i + 1] - frameB[i + 1]);
    const db = Math.abs(frameA[i + 2] - frameB[i + 2]);
    if (dr > threshold || dg > threshold || db > threshold) {
      out[i] = 244;
      out[i + 1] = 63;
      out[i + 2] = 94;
      out[i + 3] = 255;
    } else {
      const lum = Math.round((frameB[i] + frameB[i + 1] + frameB[i + 2]) / 3);
      out[i] = Math.round(lum * 0.35);
      out[i + 1] = Math.round(lum * 0.38);
      out[i + 2] = Math.round(lum * 0.45);
      out[i + 3] = 255;
    }
  }
  return out;
}

// ============================================================================
// TRUE MULTITHREADED WORKER POOL (NODE.JS worker_threads + BROWSER Web Worker)
// ============================================================================

const SHARED_PIXEL_WORKER_LOGIC = `
function runCompareRgbaFrames(frameA, frameB, width, height, channelThreshold) {
  const threshold = typeof channelThreshold === 'number' ? channelThreshold : 18;
  const totalPixels = Math.max(0, width * height);
  if (totalPixels === 0 || frameA.length < totalPixels * 4 || frameB.length < totalPixels * 4) {
    return { pixelDiffPercent: 0, changedPixels: 0, totalPixels, changedBox: null };
  }
  let changedPixels = 0;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  const headerEndY = Math.max(1, Math.floor(height * 0.14));
  const heroEndY = Math.max(headerEndY + 1, Math.floor(height * 0.62));
  const footerStartY = Math.max(heroEndY, Math.floor(height * 0.84));
  const rightPanelStartX = Math.floor(width * 0.72);
  const rightPanelStartY = Math.floor(height * 0.10);

  let headerTotal = 0, headerChanged = 0;
  let heroTotal = 0, heroChanged = 0;
  let rightTotal = 0, rightChanged = 0;
  let lowerTotal = 0, lowerChanged = 0;
  let footerTotal = 0, footerChanged = 0;
  let headerEdgeA = 0, headerEdgeB = 0;
  let rightEdgeA = 0, rightEdgeB = 0;
  let lumSumA = 0, lumSumB = 0;

  for (let y = 0; y < height; y++) {
    const rowOffset = y * width;
    const inHeader = y < headerEndY;
    const inHeroY = y >= headerEndY && y < heroEndY;
    const inLowerY = y >= heroEndY && y < footerStartY;
    const inFooter = y >= footerStartY;

    for (let x = 0; x < width; x++) {
      const i = (rowOffset + x) * 4;
      const dr = Math.abs(frameA[i] - frameB[i]);
      const dg = Math.abs(frameA[i + 1] - frameB[i + 1]);
      const db = Math.abs(frameA[i + 2] - frameB[i + 2]);
      const isDiff = dr > threshold || dg > threshold || db > threshold;

      lumSumA += (frameA[i] + frameA[i + 1] + frameA[i + 2]) / 3;
      lumSumB += (frameB[i] + frameB[i + 1] + frameB[i + 2]) / 3;
      const inRight = x >= rightPanelStartX && y >= rightPanelStartY;

      if (x > 0 && (inHeader || inRight)) {
        const ea = Math.abs(frameA[i] - frameA[i - 4]) + Math.abs(frameA[i + 1] - frameA[i - 3]) + Math.abs(frameA[i + 2] - frameA[i - 2]);
        const eb = Math.abs(frameB[i] - frameB[i - 4]) + Math.abs(frameB[i + 1] - frameB[i - 3]) + Math.abs(frameB[i + 2] - frameB[i - 2]);
        if (inHeader) { headerEdgeA += ea; headerEdgeB += eb; }
        if (inRight) { rightEdgeA += ea; rightEdgeB += eb; }
      }

      if (inHeader) { headerTotal += 1; if (isDiff) headerChanged += 1; }
      else if (inFooter) { footerTotal += 1; if (isDiff) footerChanged += 1; }
      else if (inHeroY && x < rightPanelStartX) { heroTotal += 1; if (isDiff) heroChanged += 1; }
      else if (inLowerY && x < rightPanelStartX) { lowerTotal += 1; if (isDiff) lowerChanged += 1; }
      if (inRight) { rightTotal += 1; if (isDiff) rightChanged += 1; }

      if (isDiff) {
        changedPixels += 1;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  const pixelDiffPercent = totalPixels > 0 ? Number(((changedPixels / totalPixels) * 100).toFixed(2)) : 0;
  const changedBox = changedPixels > 0 && maxX >= minX && maxY >= minY
    ? {
        x: Number(((minX / width) * 100).toFixed(1)),
        y: Number(((minY / height) * 100).toFixed(1)),
        w: Number((((maxX - minX + 1) / width) * 100).toFixed(1)),
        h: Number((((maxY - minY + 1) / height) * 100).toFixed(1)),
      }
    : null;
  const pct = (part, whole) => (whole > 0 ? Number(((part / whole) * 100).toFixed(2)) : 0);
  return {
    pixelDiffPercent,
    changedPixels,
    totalPixels,
    changedBox,
    zones: {
      headerPct: pct(headerChanged, headerTotal),
      heroCenterPct: pct(heroChanged, heroTotal),
      rightPanelPct: pct(rightChanged, rightTotal),
      lowerBodyPct: pct(lowerChanged, lowerTotal),
      footerPct: pct(footerChanged, footerTotal),
      headerEdgeContrastA: Number((headerEdgeA / Math.max(1, headerTotal)).toFixed(2)),
      headerEdgeContrastB: Number((headerEdgeB / Math.max(1, headerTotal)).toFixed(2)),
      rightEdgeContrastA: Number((rightEdgeA / Math.max(1, rightTotal)).toFixed(2)),
      rightEdgeContrastB: Number((rightEdgeB / Math.max(1, rightTotal)).toFixed(2)),
      meanLumDiff: Number((Math.abs(lumSumA - lumSumB) / totalPixels).toFixed(2)),
    },
  };
}

function runComputeHeatmap(frameA, frameB, width, height, threshold) {
  const th = typeof threshold === 'number' ? threshold : 18;
  const totalBytes = Math.max(0, width * height * 4);
  const out = new Uint8ClampedArray(totalBytes);
  if (totalBytes === 0 || frameA.length < totalBytes || frameB.length < totalBytes) {
    return out;
  }
  for (let i = 0; i < totalBytes; i += 4) {
    const dr = Math.abs(frameA[i] - frameB[i]);
    const dg = Math.abs(frameA[i + 1] - frameB[i + 1]);
    const db = Math.abs(frameA[i + 2] - frameB[i + 2]);
    if (dr > th || dg > th || db > th) {
      out[i] = 244; out[i + 1] = 63; out[i + 2] = 94; out[i + 3] = 255;
    } else {
      const lum = Math.round((frameB[i] + frameB[i + 1] + frameB[i + 2]) / 3);
      out[i] = Math.round(lum * 0.35);
      out[i + 1] = Math.round(lum * 0.38);
      out[i + 2] = Math.round(lum * 0.45);
      out[i + 3] = 255;
    }
  }
  return out;
}
`;

const NODE_WORKER_SCRIPT = `
const { parentPort, threadId } = require('node:worker_threads');
${SHARED_PIXEL_WORKER_LOGIC}
if (parentPort) {
  parentPort.on('message', (msg) => {
    const t0 = Date.now();
    try {
      const a = new Uint8Array(msg.frameA);
      const b = new Uint8Array(msg.frameB);
      if (msg.op === 'heatmap') {
        const heatmap = runComputeHeatmap(a, b, msg.width, msg.height, msg.threshold);
        const diff = runCompareRgbaFrames(a, b, msg.width, msg.height, msg.threshold);
        parentPort.postMessage(
          {
            id: msg.id,
            ok: true,
            threadId,
            computeMs: Math.max(1, Date.now() - t0),
            heatmapBuffer: heatmap.buffer,
            diff,
          },
          [heatmap.buffer]
        );
      } else {
        const diff = runCompareRgbaFrames(a, b, msg.width, msg.height, msg.threshold);
        parentPort.postMessage({
          id: msg.id,
          ok: true,
          threadId,
          computeMs: Math.max(1, Date.now() - t0),
          diff,
        });
      }
    } catch (err) {
      parentPort.postMessage({
        id: msg.id,
        ok: false,
        threadId,
        error: err && err.message ? err.message : String(err),
      });
    }
  });
}
`;

const BROWSER_WEB_WORKER_SCRIPT = `
${SHARED_PIXEL_WORKER_LOGIC}
self.onmessage = function(e) {
  const msg = e.data;
  const t0 = performance.now();
  try {
    const a = new Uint8Array(msg.frameA);
    const b = new Uint8Array(msg.frameB);
    if (msg.op === 'heatmap') {
      const heatmap = runComputeHeatmap(a, b, msg.width, msg.height, msg.threshold);
      const diff = runCompareRgbaFrames(a, b, msg.width, msg.height, msg.threshold);
      self.postMessage(
        {
          id: msg.id,
          ok: true,
          threadId: msg.workerSlotId || 1,
          computeMs: Math.max(1, Math.round(performance.now() - t0)),
          heatmapBuffer: heatmap.buffer,
          diff,
        },
        [heatmap.buffer]
      );
    } else {
      const diff = runCompareRgbaFrames(a, b, msg.width, msg.height, msg.threshold);
      self.postMessage({
        id: msg.id,
        ok: true,
        threadId: msg.workerSlotId || 1,
        computeMs: Math.max(1, Math.round(performance.now() - t0)),
        diff,
      });
    }
  } catch (err) {
    self.postMessage({
      id: msg.id,
      ok: false,
      threadId: msg.workerSlotId || 1,
      error: err && err.message ? err.message : String(err),
    });
  }
};
`;

export interface MultithreadedPoolTelemetry {
  runtime: 'node-worker-threads' | 'browser-web-workers' | 'inline-fallback';
  poolSize: number;
  cpuCoresDetected: number;
  activeThreads: number;
  tasksCompleted: number;
  completedTasks: number;
  tasksFallbackInline: number;
  avgComputeMs: number;
}

interface PoolThreadHandle {
  slotId: number;
  busy: boolean;
  postTask: (payload: any, transferList: ArrayBuffer[]) => Promise<any>;
  terminate: () => Promise<void>;
}

/**
 * Manages a pool of real OS threads (Node.js `worker_threads` or Browser `Web Workers`)
 * for parallel RGBA pixel comparison and heatmap computation.
 */
export class MultithreadedPixelDiffPool {
  private readonly maxThreads: number;
  private handles: PoolThreadHandle[] = [];
  private initPromise: Promise<void> | null = null;
  private runtimeMode: MultithreadedPoolTelemetry['runtime'] = 'inline-fallback';
  private cpuCoresDetected = 4;
  private tasksCompleted = 0;
  private tasksFallbackInline = 0;
  private totalComputeMs = 0;
  private msgSeq = 0;
  private readonly waitQueue: Array<() => void> = [];

  constructor(maxThreads = 4) {
    this.maxThreads = Math.max(1, Math.min(8, maxThreads));
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      // 1. Browser Web Worker initialization
      if (typeof window !== 'undefined' && typeof window.Worker === 'function' && typeof Blob !== 'undefined') {
        try {
          this.cpuCoresDetected =
            typeof navigator !== 'undefined' && navigator.hardwareConcurrency
              ? navigator.hardwareConcurrency
              : 4;
          const count = Math.min(this.maxThreads, Math.max(2, this.cpuCoresDetected));
          const blob = new Blob([BROWSER_WEB_WORKER_SCRIPT], {
            type: 'application/javascript',
          });
          const blobUrl = URL.createObjectURL(blob);
          const pendingMap = new Map<
            number,
            { resolve: (v: any) => void; reject: (e: Error) => void }
          >();

          for (let i = 1; i <= count; i++) {
            const w = new window.Worker(blobUrl);
            w.onmessage = (ev: MessageEvent) => {
              const data = ev.data;
              const entry = pendingMap.get(data?.id);
              if (!entry) return;
              pendingMap.delete(data.id);
              if (data.ok) entry.resolve(data);
              else entry.reject(new Error(data.error || 'Web Worker task failed'));
            };
            w.onerror = (err) => {
              for (const [, entry] of pendingMap) {
                entry.reject(new Error(err.message || 'Web Worker error'));
              }
              pendingMap.clear();
            };
            this.handles.push({
              slotId: i,
              busy: false,
              postTask: (payload, transferList) =>
                new Promise((resolve, reject) => {
                  const id = ++this.msgSeq;
                  pendingMap.set(id, { resolve, reject });
                  w.postMessage({ ...payload, id, workerSlotId: i }, transferList);
                }),
              terminate: async () => {
                w.terminate();
              },
            });
          }
          this.runtimeMode = 'browser-web-workers';
          return;
        } catch {
          this.handles = [];
        }
      }

      // 2. Node.js worker_threads initialization
      if (typeof process !== 'undefined' && process.versions?.node) {
        try {
          const wtMod = 'node:worker_threads';
          const osMod = 'node:os';
          const [{ Worker }, os] = await Promise.all([
            import(/* @vite-ignore */ wtMod),
            import(/* @vite-ignore */ osMod),
          ]);
          this.cpuCoresDetected =
            typeof os.availableParallelism === 'function'
              ? os.availableParallelism()
              : os.cpus()?.length || 4;
          const count = Math.min(this.maxThreads, Math.max(2, this.cpuCoresDetected));
          const pendingMap = new Map<
            number,
            { resolve: (v: any) => void; reject: (e: Error) => void }
          >();

          for (let i = 1; i <= count; i++) {
            const w = new Worker(NODE_WORKER_SCRIPT, { eval: true });
            w.unref?.();
            w.on('message', (data: any) => {
              const entry = pendingMap.get(data?.id);
              if (!entry) return;
              pendingMap.delete(data.id);
              if (data.ok) entry.resolve(data);
              else entry.reject(new Error(data.error || 'worker_threads task failed'));
            });
            w.on('error', (err: Error) => {
              for (const [, entry] of pendingMap) {
                entry.reject(err);
              }
              pendingMap.clear();
            });
            this.handles.push({
              slotId: i,
              busy: false,
              postTask: (payload, transferList) =>
                new Promise((resolve, reject) => {
                  const id = ++this.msgSeq;
                  pendingMap.set(id, { resolve, reject });
                  w.postMessage({ ...payload, id }, transferList as any);
                }),
              terminate: async () => {
                await w.terminate();
              },
            });
          }
          this.runtimeMode = 'node-worker-threads';
          return;
        } catch {
          this.handles = [];
        }
      }

      this.runtimeMode = 'inline-fallback';
    })();
    return this.initPromise;
  }

  private async acquireHandle(): Promise<PoolThreadHandle | null> {
    await this.ensureInitialized();
    if (this.handles.length === 0) return null;
    const free = this.handles.find((h) => !h.busy);
    if (free) {
      free.busy = true;
      return free;
    }
    return new Promise<PoolThreadHandle>((resolve) => {
      this.waitQueue.push(() => {
        const nextFree = this.handles.find((h) => !h.busy) || this.handles[0];
        nextFree.busy = true;
        resolve(nextFree);
      });
    });
  }

  private releaseHandle(handle: PoolThreadHandle): void {
    handle.busy = false;
    const nextWaiter = this.waitQueue.shift();
    if (nextWaiter) nextWaiter();
  }

  /**
   * Offloads RGBA pixel comparison to a worker thread (`node:worker_threads` or `Web Worker`).
   */
  public async compareFramesMultithreaded(
    frameA: Uint8Array | Uint8ClampedArray,
    frameB: Uint8Array | Uint8ClampedArray,
    width: number,
    height: number,
    channelThreshold = 18
  ): Promise<
    MeasuredVisualDiffResult & {
      threadId?: number;
      computeMs?: number;
      executedOnWorkerThread: boolean;
    }
  > {
    const handle = await this.acquireHandle();
    if (!handle) {
      const t0 = Date.now();
      this.tasksFallbackInline += 1;
      const syncRes = compareRgbaFrames(frameA, frameB, width, height, channelThreshold);
      return {
        ...syncRes,
        threadId: 0,
        computeMs: Math.max(1, Date.now() - t0),
        executedOnWorkerThread: false,
      };
    }

    try {
      const copyA = new Uint8Array(frameA).buffer;
      const copyB = new Uint8Array(frameB).buffer;
      const res = await handle.postTask(
        {
          op: 'diff',
          frameA: copyA,
          frameB: copyB,
          width,
          height,
          threshold: channelThreshold,
        },
        [copyA, copyB]
      );
      this.tasksCompleted += 1;
      this.totalComputeMs += Number(res.computeMs || 1);
      return {
        ...(res.diff as MeasuredVisualDiffResult),
        threadId: res.threadId,
        computeMs: res.computeMs,
        executedOnWorkerThread: true,
      };
    } catch {
      this.tasksFallbackInline += 1;
      return {
        ...compareRgbaFrames(frameA, frameB, width, height, channelThreshold),
        executedOnWorkerThread: false,
      };
    } finally {
      this.releaseHandle(handle);
    }
  }

  /**
   * Offloads both 640x380 RGBA diff heatmap generation AND pixel diff calculation to a worker thread.
   */
  public async computeHeatmapAndDiffMultithreaded(
    frameA: Uint8Array | Uint8ClampedArray,
    frameB: Uint8Array | Uint8ClampedArray,
    width: number,
    height: number,
    threshold = 18
  ): Promise<{
    heatmapRgba: Uint8ClampedArray;
    diff: MeasuredVisualDiffResult;
    pixelDiffPercent: number;
    threadId: number;
    computeMs: number;
    executedOnWorkerThread: boolean;
  }> {
    const handle = await this.acquireHandle();
    if (!handle) {
      const t0 = Date.now();
      this.tasksFallbackInline += 1;
      const diff = compareRgbaFrames(frameA, frameB, width, height, threshold);
      return {
        heatmapRgba: computeDiffHeatmapRgba(frameA, frameB, width, height, threshold),
        diff,
        pixelDiffPercent: diff.pixelDiffPercent,
        threadId: 0,
        computeMs: Math.max(1, Date.now() - t0),
        executedOnWorkerThread: false,
      };
    }

    try {
      const copyA = new Uint8Array(frameA).buffer;
      const copyB = new Uint8Array(frameB).buffer;
      const res = await handle.postTask(
        {
          op: 'heatmap',
          frameA: copyA,
          frameB: copyB,
          width,
          height,
          threshold,
        },
        [copyA, copyB]
      );
      this.tasksCompleted += 1;
      this.totalComputeMs += Number(res.computeMs || 1);
      const diff = res.diff as MeasuredVisualDiffResult;
      return {
        heatmapRgba: new Uint8ClampedArray(res.heatmapBuffer),
        diff,
        pixelDiffPercent: diff.pixelDiffPercent,
        threadId: Number(res.threadId || handle.slotId),
        computeMs: Number(res.computeMs || 1),
        executedOnWorkerThread: true,
      };
    } catch {
      const t0 = Date.now();
      this.tasksFallbackInline += 1;
      const diff = compareRgbaFrames(frameA, frameB, width, height, threshold);
      return {
        heatmapRgba: computeDiffHeatmapRgba(frameA, frameB, width, height, threshold),
        diff,
        pixelDiffPercent: diff.pixelDiffPercent,
        threadId: 0,
        computeMs: Math.max(1, Date.now() - t0),
        executedOnWorkerThread: false,
      };
    } finally {
      this.releaseHandle(handle);
    }
  }

  public async warmup(): Promise<MultithreadedPoolTelemetry> {
    await this.ensureInitialized();
    return this.getTelemetry();
  }

  public getTelemetry(): MultithreadedPoolTelemetry {
    return {
      runtime: this.runtimeMode,
      poolSize: this.handles.length || this.maxThreads,
      cpuCoresDetected: this.cpuCoresDetected,
      activeThreads: this.handles.filter((h) => h.busy).length,
      tasksCompleted: this.tasksCompleted,
      completedTasks: this.tasksCompleted,
      tasksFallbackInline: this.tasksFallbackInline,
      avgComputeMs:
        this.tasksCompleted > 0
          ? Math.round(this.totalComputeMs / this.tasksCompleted)
          : 0,
    };
  }

  public async shutdown(): Promise<void> {
    const current = [...this.handles];
    this.handles = [];
    this.initPromise = null;
    await Promise.all(current.map((h) => h.terminate().catch(() => undefined)));
  }

  public async terminate(): Promise<void> {
    await this.shutdown();
  }
}

export const defaultMultithreadedPixelPool = new MultithreadedPixelDiffPool(4);
export const defaultProbeConsumerQueue = new WorkStealingConsumerQueue<any, any>({
  queueName: 'akamai-edge-probe-consumer-queue',
  maxConsumers: 4,
  defaultMaxAttempts: 2,
  defaultRetryDelayMs: 20,
});
