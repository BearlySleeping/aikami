// packages/frontend/local-runtime/src/lib/local_task_pool.ts
//
// Layer 3 — LocalTaskPool: parallel micro-task runner.
// Manages a pool of Qwen3 local LLM instances, accepts micro-task requests,
// runs them with configurable concurrency, and returns structured results.

import type { LocalModelBundle } from '@aikami/constants';
import type {
  BattleTriggerInputSchema,
  ExpressionInputSchema,
  ImagePromptInputSchema,
  RelationshipInputSchema,
} from '@aikami/schemas';
import type { EngineBackend } from '@aikami/types';
import type { StaticDecode } from 'typebox';
import { LocalEngine } from './local_engine.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MicroTask =
  | { type: 'expression'; payload: StaticDecode<typeof ExpressionInputSchema> }
  | { type: 'battle-trigger'; payload: StaticDecode<typeof BattleTriggerInputSchema> }
  | { type: 'relationship'; payload: StaticDecode<typeof RelationshipInputSchema> }
  | { type: 'image-prompt'; payload: StaticDecode<typeof ImagePromptInputSchema> };

/** Text-generation backend — extends EngineBackend with a generate method. */
export type TextEngineBackend = EngineBackend & {
  generate(prompt: string): Promise<string>;
};

export type MicroTaskResult = {
  type: MicroTask['type'];
  output: string;
  latencyMs: number;
  /** Whether the output passed validation (false = fall back to gateway). */
  ok: boolean;
};

export type ValidationFunctions = {
  /** Strip markdown fences and extract JSON from a raw LLM response. */
  sanitizeJsonResponse: (raw: string) => string;
  /** Validate parsed JSON against a schema. Returns true if valid. */
  validateAgainstSchema: (options: { schema: Record<string, unknown>; parsed: unknown }) => boolean;
};

/** Loader whose result is guaranteed to be a TextEngineBackend. */
export type TextEngineLoader = (
  files: ReadonlyArray<{ path: string; data: ArrayBuffer }>,
  signal: AbortSignal,
) => Promise<TextEngineBackend>;

export type LocalTaskPoolOptions = {
  bundle: LocalModelBundle;
  loader: TextEngineLoader;
  maxConcurrency?: number;
  /** Optional validation functions for validate → repair → give-up loop. */
  validation?: ValidationFunctions;
};

// ---------------------------------------------------------------------------
// LocalTaskPool
// ---------------------------------------------------------------------------

export class LocalTaskPool {
  private readonly _engine: LocalEngine;
  private readonly _maxConcurrency: number;
  private readonly _validation: ValidationFunctions | null;
  private _activeCount = 0;
  private _queue: Array<{
    task: MicroTask;
    resolve: (result: MicroTaskResult) => void;
    reject: (error: Error) => void;
  }> = [];
  private _drainPromise: Promise<void> | null = null;
  private _drainResolve: (() => void) | null = null;

  constructor(options: LocalTaskPoolOptions) {
    this._engine = new LocalEngine({ bundle: options.bundle, loader: options.loader });
    const mc = options.maxConcurrency ?? 2;
    if (!Number.isFinite(mc) || mc <= 0 || !Number.isInteger(mc)) {
      throw new Error(`Invalid maxConcurrency: must be a positive integer, got ${mc}`);
    }
    this._maxConcurrency = mc;
    this._validation = options.validation ?? null;
  }

  // ── Public accessors ──────────────────────────────────────────────────────

  get engine(): LocalEngine {
    return this._engine;
  }

  get activeCount(): number {
    return this._activeCount;
  }

  get queuedCount(): number {
    return this._queue.length;
  }

  get maxConcurrency(): number {
    return this._maxConcurrency;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Ensure the underlying engine is loaded. Safe to call multiple times.
   */
  async ensureLoaded(signal?: AbortSignal): Promise<void> {
    const state = await this._engine.load(signal);
    if (state.status !== 'ready') {
      throw new Error(`Engine failed to load: ${state.status}`);
    }
  }

  /**
   * Unload the engine and cancel all queued tasks.
   */
  async dispose(): Promise<void> {
    // Reject all queued tasks
    const queue = this._queue;
    this._queue = [];
    for (const entry of queue) {
      entry.reject(new Error('TaskPool disposed'));
    }
    await this._engine.unload();
  }

  // ── Task submission ───────────────────────────────────────────────────────

  /**
   * Submit a micro-task for execution. Returns a promise that resolves with
   * the result when the task completes.
   */
  async submit(task: MicroTask, signal?: AbortSignal): Promise<MicroTaskResult> {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    return await new Promise<MicroTaskResult>((resolve, reject) => {
      // Handle abort signal
      if (signal) {
        const onAbort = (): void => {
          const idx = this._queue.findIndex((e) => e.resolve === resolve);
          if (idx >= 0) {
            this._queue.splice(idx, 1);
          }
          reject(new DOMException('Aborted', 'AbortError'));
        };
        signal.addEventListener('abort', onAbort, { once: true });
      }

      this._queue.push({ task, resolve, reject });
      this._processQueue();
    });
  }

  /**
   * Wait for all queued tasks to complete. Resolves when the queue is empty.
   */
  async drain(): Promise<void> {
    if (this._queue.length === 0 && this._activeCount === 0) {
      return;
    }
    if (!this._drainPromise) {
      this._drainPromise = new Promise<void>((resolve) => {
        this._drainResolve = resolve;
      });
    }
    return await this._drainPromise;
  }

  // ── Private ───────────────────────────────────────────────────────────────

  /** Safe cast — the pool's loader is typed as TextEngineLoader. */
  private get _textBackend(): TextEngineBackend {
    if (!this._engine.backend) {
      throw new Error('Engine not loaded — call ensureLoaded() first');
    }
    return this._engine.backend as TextEngineBackend;
  }

  private _processQueue(): void {
    while (this._activeCount < this._maxConcurrency && this._queue.length > 0) {
      const shifted = this._queue.shift();
      if (!shifted) {
        break;
      }
      const entry = shifted;
      this._activeCount++;
      this._executeTask(entry.task)
        .then((result) => {
          entry.resolve(result);
        })
        .catch((error) => {
          entry.reject(error instanceof Error ? error : new Error(String(error)));
        })
        .finally(() => {
          this._activeCount--;
          this._processQueue();
          if (this._queue.length === 0 && this._activeCount === 0) {
            this._drainResolve?.();
            this._drainPromise = null;
            this._drainResolve = null;
          }
        });
    }
  }

  /** Returns the expected output JSON schema for a given task type. */
  private _getOutputSchema(type: MicroTask['type']): Record<string, unknown> {
    switch (type) {
      case 'expression':
        return {
          type: 'object',
          properties: {
            name: { type: 'string' },
            expression: { type: 'string' },
          },
          required: ['name', 'expression'],
          additionalProperties: false,
        };
      case 'battle-trigger':
        return {
          type: 'object',
          properties: {
            battle: { type: 'boolean' },
            enemy: { type: 'string' },
          },
          required: ['battle', 'enemy'],
          additionalProperties: false,
        };
      case 'relationship':
        return {
          type: 'object',
          properties: {
            change: { type: 'string', enum: ['improve', 'worsen', 'neutral'] },
            magnitude: { type: 'number', minimum: 0, maximum: 10 },
            reason: { type: 'string' },
          },
          required: ['change', 'magnitude', 'reason'],
          additionalProperties: false,
        };
      case 'image-prompt':
        return {
          type: 'object',
          properties: {
            prompt: { type: 'string' },
            negativePrompt: { type: 'string' },
            style: { type: 'string' },
          },
          required: ['prompt'],
          additionalProperties: false,
        };
      default:
        return {};
    }
  }

  private async _executeTask(task: MicroTask): Promise<MicroTaskResult> {
    const start = performance.now();

    const prompt = this._buildPrompt(task);
    const rawOutput = await this._textBackend.generate(prompt);

    // Validate → repair → give-up loop
    if (this._validation) {
      const { sanitizeJsonResponse, validateAgainstSchema } = this._validation;
      const schema = this._getOutputSchema(task.type);
      let output = rawOutput;
      let attempts = 0;
      const maxAttempts = 2;

      while (attempts < maxAttempts) {
        attempts++;
        try {
          const sanitized = sanitizeJsonResponse(output);
          const parsed = JSON.parse(sanitized);
          if (validateAgainstSchema({ schema, parsed })) {
            return {
              type: task.type,
              output: sanitized,
              latencyMs: Math.round(performance.now() - start),
              ok: true,
            };
          }
        } catch {
          // Parse or validation failed — retry with repair prompt
        }

        if (attempts < maxAttempts) {
          // Repair: ask the model to fix its output
          const repairPrompt = `${prompt}\n\nYour previous response was not valid JSON. Please respond with ONLY valid JSON matching the expected format. Previous: ${rawOutput}`;
          output = await this._textBackend.generate(repairPrompt);
        }
      }

      // Give up — return with ok: false
      return {
        type: task.type,
        output: rawOutput,
        latencyMs: Math.round(performance.now() - start),
        ok: false,
      };
    }

    // No validation configured — return raw output
    return {
      type: task.type,
      output: rawOutput,
      latencyMs: Math.round(performance.now() - start),
      ok: true,
    };
  }

  private _buildPrompt(task: MicroTask): string {
    switch (task.type) {
      case 'expression': {
        const p = task.payload;
        return `Characters ${p.characters.join(', ')}: ${p.prose}`;
      }
      case 'battle-trigger': {
        const p = task.payload;
        return `Battle check: ${p.prose}`;
      }
      case 'relationship': {
        const p = task.payload;
        return `${p.speaker} → ${p.target}: ${p.dialogue}`;
      }
      case 'image-prompt': {
        const p = task.payload;
        return `Scene: ${p.scene} | Mood: ${p.mood} | Characters: ${p.characters.join(', ')}`;
      }
      default:
        return '';
    }
  }
}
