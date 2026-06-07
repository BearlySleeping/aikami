// packages/backend/audio/src/lib/tts_worker_pool.ts

/** A single TTS job to be processed by a worker. */
export type TtsJob = {
  /** Unique identifier for this job. */
  id: string;
  /** The sentence text to synthesize. */
  text: string;
  /** Order index for preserving output sequence. */
  sequence: number;
};

/** Result returned by a worker after processing a job. */
export type TtsJobResult = {
  /** Matches the input job id. */
  jobId: string;
  /** PCM audio samples as Float32Array. */
  audio: Float32Array;
  /** Sample rate of the generated audio. */
  sampleRate: number;
  /** Duration of the audio in seconds. */
  durationSeconds: number;
  /** Preserved sequence index for reordering. */
  sequence: number;
  /** Error message if processing failed (undefined on success). */
  error?: string;
};

/** Options for constructing a TtsWorkerPool. */
export type TtsWorkerPoolOptions = {
  /** Maximum number of concurrent worker threads (default: 1). */
  concurrency?: number;
};

/** Options for processBatch. */
export type ProcessBatchOptions = {
  /** Jobs to dispatch to workers. */
  jobs: TtsJob[];
  /** AbortSignal to cancel pending work. */
  signal?: AbortSignal;
};

/** Pool status information. */
export type PoolInfo = {
  /** Total number of worker threads. */
  totalWorkers: number;
  /** Number of workers currently processing a job. */
  activeWorkers: number;
  /** Whether the pool has been terminated. */
  terminated: boolean;
};

/** Type for a pending batch request queued when all workers are busy. */
type PendingBatch = {
  jobs: TtsJob[];
  signal: AbortSignal | undefined;
  resolve: (results: TtsJobResult[]) => void;
  reject: (error: Error) => void;
  results: Array<TtsJobResult | undefined>;
  dispatchedCount: number;
  completedCount: number;
};

/**
 * Manages a pool of Bun Worker threads for CPU-bound TTS inference.
 *
 * Workers run in separate threads, keeping the main event loop responsive.
 * Jobs are dispatched via Bun IPC (`postMessage`), results are collected
 * and reordered by `sequence` index. Supports abort via `AbortSignal`.
 *
 * Multiple concurrent `processBatch()` calls are queued and dispatched
 * as workers become available — no starvation.
 *
 * @example
 * ```typescript
 * const pool = new TtsWorkerPool({ concurrency: 2 });
 * const results = await pool.processBatch({
 *   jobs: [
 *     { id: '1', text: 'Hello.', sequence: 0 },
 *     { id: '2', text: 'World.', sequence: 1 },
 *   ],
 * });
 * await pool.terminate();
 * ```
 */
export class TtsWorkerPool {
  private readonly _workers: Worker[] = [];
  private readonly _workerBusy: boolean[] = [];
  private readonly _pendingBatches: PendingBatch[] = [];
  private _terminated = false;
  private _activeCount = 0;

  constructor(options: TtsWorkerPoolOptions = {}) {
    const concurrency = options.concurrency ?? 1;

    for (let i = 0; i < concurrency; i++) {
      const worker = new Worker(new URL('./tts_worker_script.ts', import.meta.url));
      this._workers.push(worker);
      this._workerBusy.push(false);
    }
  }

  /**
   * Process a batch of TTS jobs concurrently.
   *
   * Jobs are dispatched to workers as they become available. Results are
   * collected and sorted by `sequence` index before the promise resolves.
   * When `signal` is provided and aborted, pending jobs are cancelled and
   * the promise rejects with an `AbortError`.
   *
   * Multiple concurrent calls are supported — they queue internally and
   * share the worker pool fairly.
   *
   * @param options — Batch processing options.
   * @returns Results sorted by sequence index.
   */
  async processBatch(options: ProcessBatchOptions): Promise<TtsJobResult[]> {
    if (this._terminated) {
      throw new Error('TtsWorkerPool has been terminated');
    }

    const { jobs, signal } = options;

    if (jobs.length === 0) {
      return [];
    }

    if (signal?.aborted) {
      throw new DOMException('The operation was aborted', 'AbortError');
    }

    return new Promise<TtsJobResult[]>((resolve, reject) => {
      const pending: PendingBatch = {
        jobs,
        signal,
        resolve,
        reject,
        results: new Array(jobs.length),
        dispatchedCount: 0,
        completedCount: 0,
      };

      this._pendingBatches.push(pending);
      this._drainPending();
    });
  }

  /**
   * Drain the pending batch queue — dispatch jobs from the front of the queue
   * to any available workers.
   */
  private _drainPending(): void {
    // Try to dispatch from pending batches
    while (this._pendingBatches.length > 0) {
      const workerIndex = this._workerBusy.indexOf(false);
      if (workerIndex === -1) {
        break; // No free workers
      }

      const pending = this._pendingBatches[0];

      // Check abort
      if (pending.signal?.aborted) {
        this._pendingBatches.shift();
        pending.reject(new DOMException('The operation was aborted', 'AbortError'));
        continue;
      }

      // Check if this batch has more jobs
      if (pending.dispatchedCount >= pending.jobs.length) {
        // All jobs in this batch dispatched; remove if all completed
        if (pending.completedCount >= pending.jobs.length) {
          this._pendingBatches.shift();
          pending.resolve(pending.results.filter((r): r is TtsJobResult => r !== undefined));
        }
        break;
      }

      const job = pending.jobs[pending.dispatchedCount];
      pending.dispatchedCount++;

      this._workerBusy[workerIndex] = true;
      this._activeCount++;

      const worker = this._workers[workerIndex];

      const onMessage = (event: MessageEvent<TtsJobResult>) => {
        worker.removeEventListener('message', onMessage);

        const result = event.data;
        pending.results[result.sequence] = result;

        this._workerBusy[workerIndex] = false;
        this._activeCount--;

        if (result.error) {
          // Don't increment completed — error result still counts
        }
        pending.completedCount++;

        // If all jobs in this batch completed, resolve
        if (pending.completedCount >= pending.jobs.length && this._pendingBatches[0] === pending) {
          this._pendingBatches.shift();
          pending.resolve(pending.results.filter((r): r is TtsJobResult => r !== undefined));
        }

        // Continue draining (may free up a slot for another batch)
        this._drainPending();
      };

      worker.addEventListener('message', onMessage);
      worker.postMessage({ type: 'process', job });
    }
  }

  /**
   * Terminate all workers and mark the pool as unusable.
   *
   * After calling this, `processBatch()` will throw. Call this when
   * the WebSocket disconnects or the TTS session ends.
   */
  async terminate(): Promise<void> {
    if (this._terminated) {
      return;
    }

    this._terminated = true;

    // Reject all pending batches
    for (const pending of this._pendingBatches) {
      pending.reject(new Error('TtsWorkerPool has been terminated'));
    }
    this._pendingBatches.length = 0;

    for (const worker of this._workers) {
      worker.postMessage({ type: 'terminate' });
      worker.terminate();
    }

    this._workers.length = 0;
    this._workerBusy.length = 0;
    this._activeCount = 0;
  }

  /**
   * Get pool status information for monitoring.
   */
  getInfo(): PoolInfo {
    return {
      totalWorkers: this._workers.length,
      activeWorkers: this._activeCount,
      terminated: this._terminated,
    };
  }
}
